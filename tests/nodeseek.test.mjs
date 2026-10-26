import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import RANKINGS from "../shared/nodeseek-rankings.json" with { type: "json" };
import { SOURCES, parseSource, fetchSourceDetailed } from "../server/sources.mjs";
import { createNodeSeekRankings, withNodeSeekRankings } from "../server/nodeseek-rankings.mjs";
import { nodeSeekRanking, selectNodeSeekRanking } from "../src/nodeseek.ts";
const source = SOURCES.find(item => item.id === "nodeseek");
const now = Date.parse("2026-10-26T02:00:00Z");
const payload = (ids = [3, 1, 2], updated = now) => ({ updated_at: updated / 1000, posts: ids.map(id => ({ score: 1000 - id, post: { id, title: `Post ${id}`, post_timestamp: (now - id * 1000) / 1000, views: id * 100, comments: id, category: "info", summary: "<img src='bad-image'>" } })) });
const result = (item, stamp = now, ids = [3, 1, 2]) => ({ articles: parseSource(item, payload(ids, stamp)), upstreamUpdatedAt: new Date(stamp).toISOString(), transport: "direct", attempts: [] });
const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("one NodeSeek subscription stays in digital life, with three public ranking endpoints", () => {
  assert.equal(SOURCES.filter(item => item.id === "nodeseek").length, 1);
  assert.equal(source.category, "nomad");
  assert.equal(source.feed, "https://api.bimg.eu.org/daily.json");
  assert.equal(source.kind, "nodeseek");
  assert.deepEqual(RANKINGS.map(item => item.id), ["realtime", "daily", "weekly"]);
  assert.deepEqual(RANKINGS.map(item => item.refreshMs), [60000, 300000, 3600000]);
});
test("ranking parsing preserves upstream order, canonical links, replies and fixed 24-item limit", () => {
  const articles = parseSource(source, payload());
  assert.deepEqual(articles.map(item => item.title), ["Post 3", "Post 1", "Post 2"]);
  assert.equal(articles[0].url, "https://www.nodeseek.com/post-3-1");
  assert.equal(articles[0].discussionUrl, articles[0].url);
  assert.equal(articles[0].comments, 3);
  assert.equal(articles[0].publishedAt, new Date(now - 3000).toISOString());
  assert.deepEqual(articles[0].tags, ["info"]);
  assert.ok(articles.every(item => item.points === null && item.image === null));
  assert.equal(parseSource(source, payload([1, 1, 2])).length, 2);
  assert.equal(parseSource(source, payload(Array.from({length:100}, (_, i) => i + 1))).length, 24);
});
test("malformed responses, invalid timestamps and malformed posts cannot masquerade as rankings", () => {
  for (const input of [null, [], {posts:[]}, {updated_at:Infinity,posts:[]}, {updated_at:"today",posts:[]}]) assert.throws(() => parseSource(source, input), /Invalid NodeSeek/);
  const data = payload([1]);
  data.posts.unshift(null, {}, {post:{id:-1}}, {post:{id:"1"}}, {post:{id:2,title:""}});
  assert.equal(parseSource(source, data).length, 1);
  const empty = payload([1]); empty.posts[0].post.comments = -1;
  assert.equal(parseSource(source, empty)[0].comments, null);
});
test("upstream generation time is retained through the shared direct/proxy adapter", async () => {
  const urls = [];
  const response = await fetchSourceDetailed(source, { proxyUrl: "", fetcher: async url => { urls.push(url); return {ok:false,status:403}; }, proxyFetcher: async url => { urls.push(url); return {ok:true,json:async()=>payload()}; } });
  assert.equal(response.upstreamUpdatedAt, new Date(now).toISOString());
  assert.equal(response.transport, "proxy");
  assert.deepEqual(urls, [source.feed, source.feed]);
});
test("background sync respects each cadence and shares in-flight work across visitors", async () => {
  let time = now;
  const calls = [];
  const release = [];
  const service = createNodeSeekRankings({ clock: () => time, fetcher: async item => {
    calls.push(item.feed);
    await new Promise(resolve => release.push(resolve));
    return result(item, time);
  } });
  const first = service.refresh(); const second = service.refresh();
  assert.equal(service.updating, true);
  assert.equal(calls.length, 3);
  release.splice(0).forEach(resolve => resolve());
  await Promise.all([first,second]);
  assert.equal(service.updating, false);
  await service.refresh(); assert.equal(calls.length, 3);
  time += 60000;
  const minute = service.refresh();
  assert.equal(calls.length, 4); assert.equal(calls.at(-1), RANKINGS[0].feed);
  release.splice(0).forEach(resolve => resolve()); await minute;
  time = now + 300000;
  const five = service.refresh(); assert.equal(calls.length, 6);
  assert.deepEqual(calls.slice(-2), [RANKINGS[0].feed,RANKINGS[1].feed]);
  release.splice(0).forEach(resolve => resolve()); await five;
  time = now + 3600000;
  const hour = service.refresh(); assert.equal(calls.length, 9);
  release.splice(0).forEach(resolve => resolve()); await hour;
});
test("each ranking fails independently and retains only its own previous list", async () => {
  let fail = false;
  let saves = 0;
  const service = createNodeSeekRankings({clock:()=>now, onChange:async()=>{saves++;},fetcher:async item=>{
    if (item.feed === RANKINGS[0].feed && fail) throw new Error("private internal detail");
    return result(item, now, item.feed === RANKINGS[0].feed ? [8] : [9]);
  }});
  await service.refresh(); fail = true;
  await service.refresh({force:true});
  const state = service.snapshot();
  assert.equal(state.realtime.status, "stale"); assert.equal(state.daily.status, "live"); assert.equal(state.weekly.status, "live");
  assert.equal(state.realtime.articles[0].title, "Post 8");
  assert.equal(state.daily.articles[0].title, "Post 9");
  assert.doesNotMatch(state.realtime.error, /private internal detail/);
  assert.equal(saves, 6);
});
test("old upstream timestamps become CACHED even when HTTP succeeds", async () => {
  const service = createNodeSeekRankings({clock:()=>now,fetcher:async item=>result(item, now - 4 * 3600000)});
  await service.refresh();
  for (const state of Object.values(service.snapshot())) {
    assert.equal(state.status, "stale"); assert.equal(state.errorCode, "STALE");
    assert.equal(state.updatedAt, new Date(now - 4 * 3600000).toISOString());
    assert.equal(state.checkedAt, new Date(now).toISOString());
  }
});
test("cached content ages without fetches and regressing upstream snapshots never overwrite newer ones", async () => {
  let time = now, upstream = now;
  const service = createNodeSeekRankings({clock:()=>time,fetcher:async item=>result(item,upstream,[3])});
  await service.refresh();
  time += RANKINGS[0].staleAfterMs + 1;
  assert.equal(service.snapshot().realtime.status, "stale");
  assert.equal(service.snapshot().daily.status, "live");
  upstream -= 60000;
  await service.refresh({force:true});
  assert.equal(service.snapshot().daily.updatedAt, new Date(now).toISOString());
  assert.equal(service.snapshot().daily.status, "stale");
  assert.match(service.snapshot().daily.error, /较旧榜单/);
});
test("future or missing timestamps and empty results fail without labeling them LIVE", async () => {
  for (const value of [{...result(source),upstreamUpdatedAt:null}, result(source,now+3600000), {...result(source),articles:[]}]) {
    const service = createNodeSeekRankings({clock:()=>now,fetcher:async()=>value});
    await service.refresh();
    assert.equal(service.snapshot().daily.status,"error");
    assert.deepEqual(service.snapshot().daily.articles,[]);
  }
});
test("matching per-ranking disk caches restore, old RSS and cross-ranking caches do not", async () => {
  const service = createNodeSeekRankings({clock:()=>now,fetcher:async item=>result(item)});
  await service.refresh();
  const saved = service.snapshot();
  const restored = createNodeSeekRankings({clock:()=>now,initial:saved});
  assert.equal(restored.snapshot().daily.status,"stale");
  assert.deepEqual(restored.snapshot().daily.articles,saved.daily.articles);
  const wrong = createNodeSeekRankings({initial:{daily:{...saved.daily,feed:"https://www.nodeseek.com/rss.xml",kind:"rss"},weekly:saved.daily}});
  assert.deepEqual(wrong.snapshot().daily.articles,[]);
  assert.deepEqual(wrong.snapshot().weekly.articles,[]);
});
test("combined API snapshot exposes one NodeSeek source and defaults to daily without mutating another reader", async () => {
  const service = createNodeSeekRankings({clock:()=>now,fetcher:async item=>result(item, now, item.feed === RANKINGS[2].feed ? [8] : [9])});
  await service.refresh();
  const sources = withNodeSeekRankings(SOURCES.filter(item=>item.id!=="nodeseek"), service.snapshot());
  assert.equal(sources.length,SOURCES.length);
  const node = sources.find(item=>item.id==="nodeseek");
  assert.equal(node.articles[0].title,"Post 9");
  const weekly = selectNodeSeekRanking(node,"weekly");
  assert.equal(weekly.articles[0].title,"Post 8");
  assert.equal(node.articles[0].title,"Post 9");
  assert.equal(selectNodeSeekRanking(node,"daily").articles[0].title,"Post 9");
  const other = sources.find(item=>item.id==="hn");
  assert.strictEqual(selectNodeSeekRanking(other,"weekly"),other);
});
test("invalid browser choices use daily, and missing rankings never show another list as a substitute", () => {
  for(const value of ["", "__proto__", "all", "rss", "daily"]) assert.equal(nodeSeekRanking(value),"daily");
  assert.equal(nodeSeekRanking("realtime"),"realtime"); assert.equal(nodeSeekRanking("weekly"),"weekly");
  const old = {...source,articles:[{title:"old RSS"}],updatedAt:new Date(now).toISOString(),status:"live"};
  assert.deepEqual(selectNodeSeekRanking(old,"weekly").articles,[]);
  assert.equal(selectNodeSeekRanking(old,"weekly").status,"loading");
});
test("controls sit beside the source name, stop details toggling, and do not fetch from the browser", async () => {
  const app = await read("src/App.tsx"), tabs = await read("src/NodeSeekTabs.tsx"), server = await read("server/index.mjs");
  assert.match(app, /<strong>\{source.name\}<\/strong>\{ranking && <NodeSeekTabs/);
  assert.match(app, /readPreference\("nav:nodeseek-ranking", "daily"\)/);
  assert.match(app, /savePreference\("nav:nodeseek-ranking", value\)/);
  assert.match(tabs, /event.preventDefault\(\); event.stopPropagation\(\)/);
  assert.match(tabs, /aria-pressed/);
  assert.match(tabs, /\[\{tab.name\}\]/);
  assert.doesNotMatch(tabs, /fetch\(|localStorage/);
  assert.match(server, /sources: SOURCES.filter\(source => source.id !== "nodeseek"\)/);
  assert.match(server, /setInterval\([\s\S]*NODESEEK_REFRESH_MS/);
  assert.match(server, /updating: feeds.updating \|\| rankings.updating/);
});
