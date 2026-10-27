import test from "node:test";
import assert from "node:assert/strict";
import { SOURCES, parseSource, fetchSourceDetailed } from "../server/sources.mjs";
import { createFeedService } from "../server/feed-service.mjs";

const source = SOURCES.find(source => source.id === "thepaper");
const row = (id, extra = {}) => ({contId:String(id), name:`Story ${id}`, forwardType:"0", link:"", pubTimeLong:Date.parse("2026-10-27T01:33:59Z"), smallPic:"https://imgpai.thepaper.cn/example.jpg", nodeInfo:{name:"Current affairs"}, ...extra});
const page = (rows, extra = {}) => ({page:"/channel/[id]",query:{id:"25950"},props:{pageProps:{data:{list:rows},topData:[row(999)]}},...extra});
const html = data => `<html><nav><a href="/newsDetail_forward_998">Not a list item</a></nav><script type="application/json" id="__NEXT_DATA__">${JSON.stringify(data)}</script></html>`;

test("The Paper replaces Economist with a direct official current-affairs page", () => {
  assert.equal(source.category, "news");
  assert.equal(source.kind, "thepaper");
  assert.equal(source.feed, "https://m.thepaper.cn/channel_25950");
  assert.equal(source.home, source.feed);
  assert.ok(!SOURCES.some(item => item.id === "economist"));
});

test("official channel list preserves order and normalizes dates, images and unique article URLs", () => {
  const articles = parseSource(source, html(page([
    row(2, {name:"Title &amp; tools", forwardType:"74"}), row(1), row(2),
    row(3, {forwardType:"42", link:"https://m.thepaper.cn/papernews/morningEveningPaper?n=3"}),
  ])));
  assert.deepEqual(articles.map(item => item.title), ["Title & tools", "Story 1", "Story 3"]);
  assert.equal(articles[0].url, "https://m.thepaper.cn/newsDetail_forward_2");
  assert.equal(articles[0].sourceId, "thepaper");
  assert.equal(articles[0].publishedAt, "2026-10-27T01:33:59.000Z");
  assert.equal(articles[0].image, "https://imgpai.thepaper.cn/example.jpg");
  assert.deepEqual(articles[0].tags, ["Current affairs"]);
  assert.equal(articles[0].points, null);
  assert.equal(articles[0].comments, null);
  assert.match(articles[2].url, /morningEveningPaper/);
});

test("invalid IDs, external forwards and unknown destinations cannot become article links", () => {
  const articles = parseSource(source, html(page([
    null, row("0"), row("-1"), row("1/path"), row("9007199254740993"),
    row(1, {link:"javascript:alert(1)"}), row(2, {link:"https://example.com/article"}),
    row(3, {link:"https://m.thepaper.cn.evil.example/story"}),
    row(4, {link:"https://user:secret@m.thepaper.cn/story"}), row(5, {forwardType:"42"}),
    row(6, {name:" "}), row(7, {pubTimeLong:Infinity,smallPic:"javascript:alert(1)",pubTime:"1 hour ago"}),
    row(8, {pubTimeLong:"1793064839015"}),
  ])));
  assert.deepEqual(articles.map(item => item.title), ["Story 7", "Story 8"]);
  assert.equal(articles[0].publishedAt, null);
  assert.equal(articles[0].image, null);
  assert.equal(articles[1].publishedAt, null);
});

test("HTML transport rejects wrong channels, missing state and changed schemas without fake fallback", async () => {
  const result = await fetchSourceDetailed(source, {proxyUrl:"", fetcher:async url => {
    assert.equal(url, source.feed);
    return {ok:true,text:async()=>html(page([row(1)])),json:async()=>{throw new Error("not JSON");}};
  }});
  assert.equal(result.transport, "direct");
  assert.equal(result.articles.length, 1);
  for (const body of ["<html>Changed layout</html>", html({}), html(page([row(1)],{query:{id:"122908"}})), html(page([row(1)],{page:"/"})), html(page(null)), html(page([])), '<script id="__NEXT_DATA__">broken JSON</script>']) {
    await assert.rejects(fetchSourceDetailed(source, {proxyUrl:"",fetcher:async()=>({ok:true,text:async()=>body})}), error => error.feedCode === "PARSE");
  }
});

test("The Paper uses the existing direct-to-proxy fallback and retains cached news on failure", async () => {
  const urls = [];
  const fetcher = () => fetchSourceDetailed(source, {fetcher:async url => {
    urls.push(url); return {ok:false,status:403};
  },proxyFetcher:async url => {urls.push(url); return {ok:true,text:async()=>html(page([row(1)]))};}});
  const service = createFeedService({sources:[source],fetcher});
  await service.refresh();
  assert.deepEqual(urls, [source.feed, source.feed]);
  const saved = service.snapshot();
  const failed = createFeedService({sources:[source],initial:saved,fetcher:async()=>{throw new Error("unavailable");}});
  await failed.refresh();
  assert.equal(failed.snapshot()[0].articles[0].title, "Story 1");
});

test("channel lists keep the common 24-item ceiling without padding", () => {
  assert.equal(parseSource(source, html(page(Array.from({length:30}, (_, i) => row(i + 1))))).length, 24);
  assert.equal(parseSource(source, html(page([row(1)]))).length, 1);
});
