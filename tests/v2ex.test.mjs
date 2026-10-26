import test from "node:test";
import assert from "node:assert/strict";
import { SOURCES, parseSource, fetchSourceDetailed } from "../server/sources.mjs";
import { createFeedService } from "../server/feed-service.mjs";
const source = SOURCES.find(item => item.id === "v2ex");
const topic = (id, replies = 3) => ({ id, title: `Topic ${id}`, url: `https://www.v2ex.com/t/${id}`, created: 1792893600, replies, node: { title: "程序员" } });

test("V2EX subscribes to the official hot API, not the latest RSS", () => {
  assert.equal(source.feed, "https://www.v2ex.com/api/topics/hot.json");
  assert.equal(source.kind, "v2ex");
  assert.match(source.name, /今日热议/);
});
test("hot-list order survives normalization without sorting by time, ID or replies", () => {
  const articles = parseSource(source, [topic(8, 5), topic(2, 99), topic(4, 0)]);
  assert.deepEqual(articles.map(item => item.title), ["Topic 8", "Topic 2", "Topic 4"]);
  assert.deepEqual(articles.map(item => item.comments), [5, 99, 0]);
  assert.ok(articles.every(item => item.points === null && item.image === null));
  assert.equal(articles[0].publishedAt, new Date(1792893600 * 1000).toISOString());
  assert.equal(articles[0].discussionUrl, "https://www.v2ex.com/t/8");
  assert.deepEqual(articles[0].tags, ["程序员"]);
});
test("deleted, malformed and duplicate hot topics are discarded; fewer than 24 stay fewer", () => {
  const data = [null, {}, topic(-1), { ...topic(5), deleted: 1 }, topic(7), topic(7), { ...topic(9), title: "" }];
  assert.deepEqual(parseSource(source, data).map(item => item.url), ["https://www.v2ex.com/t/7"]);
  assert.throws(() => parseSource(source, { error: "limited" }), /Invalid V2EX/);
  const [item] = parseSource(source, [{ ...topic(1), created: Infinity, replies: -1, node: null }]);
  assert.equal(item.publishedAt, null);
  assert.equal(item.comments, null);
  assert.deepEqual(item.tags, []);
});
test("hot API uses shared direct-then-proxy collection without falling back to latest RSS", async () => {
  const urls = [];
  const result = await fetchSourceDetailed(source, {
    proxyUrl: "",
    fetcher: async url => { urls.push(url); return { ok: false, status: 403 }; },
    proxyFetcher: async url => { urls.push(url); return { ok: true, json: async () => [topic(1)] }; },
  });
  assert.equal(result.transport, "proxy");
  assert.equal(result.articles.length, 1);
  assert.deepEqual(urls, [source.feed, source.feed]);
  assert.equal(result.attempts[0].code, "HTTP_403");
});
test("latest-feed cache is not displayed as a hot list after changing subscription", () => {
  const initial = [{ ...source, feed: "https://www.v2ex.com/index.xml", kind: "rss", articles: [{ title: "Newest, not hot" }], updatedAt: "2026-10-25T00:00:00Z" }];
  const service = createFeedService({ sources: [source], initial });
  const [state] = service.snapshot();
  assert.deepEqual(state.articles, []);
  assert.equal(state.status, "loading");
  assert.equal(state.updatedAt, null);
});
test("matching hot cache remains usable on failure and successful refresh replaces the whole list", async () => {
  const articles = parseSource(source, [topic(1), topic(2)]);
  let fail = true;
  const service = createFeedService({ sources: [source], initial: [{ ...source, articles }], fetcher: async () => {
    if (fail) throw new Error("Offline");
    return parseSource(source, [topic(3)]);
  } });
  await service.refresh();
  assert.equal(service.snapshot()[0].status, "stale");
  assert.deepEqual(service.snapshot()[0].articles, articles);
  fail = false;
  await service.refresh({ force: true });
  assert.deepEqual(service.snapshot()[0].articles.map(item => item.title), ["Topic 3"]);
});
