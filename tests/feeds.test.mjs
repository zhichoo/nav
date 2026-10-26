import test from "node:test";
import assert from "node:assert/strict";
import {
  SOURCES,
  safeUrl,
  cleanText,
  parseSource,
  fetchSource,
} from "../server/sources.mjs";
import { createFeedService, REFRESH_MS } from "../server/feed-service.mjs";
import {
  applyTranslations,
  translationKey,
  translateMissing,
} from "../server/translation.mjs";

const source = SOURCES[0];
const rss = `<rss xmlns:hn="https://hnrss.org"><channel><item><title><![CDATA[Tools &amp; ideas]]></title><link>https://example.com/post</link><pubDate>Tue, 20 Oct 2026 12:00:00 GMT</pubDate><hn:score>123</hn:score><hn:comments>7</hn:comments><comments>https://news.ycombinator.com/item?id=1</comments></item><item><title>Duplicate</title><link>https://example.com/post</link></item><item><title>Unsafe</title><link>javascript:alert(1)</link></item></channel></rss>`;
test("RSS parsing normalizes entities, dates, scores and deduplicates safe URLs", () => {
  const articles = parseSource(source, rss);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "Tools & ideas");
  assert.equal(articles[0].points, 123);
  assert.equal(articles[0].comments, 7);
  assert.equal(articles[0].publishedAt, "2026-10-20T12:00:00.000Z");
  assert.equal(articles[0].domain, "example.com");
});
test("Atom handles alternate links and single entry", () => {
  const articles = parseSource(
    SOURCES[1],
    `<feed><entry><title>A product</title><link rel="self" href="https://example.com/feed/1"/><link rel="alternate" href="https://example.com/product"/><updated>2026-10-20T00:00:00Z</updated><category term="tools"/></entry></feed>`,
  );
  assert.equal(articles[0].url, "https://example.com/product");
  assert.deepEqual(articles[0].tags, ["tools"]);
  assert.equal(articles[0].points, null);
});
test("unsafe URLs and invalid dates are not trusted", () => {
  assert.equal(safeUrl("javascript:alert(1)", source.home), null);
  assert.equal(safeUrl("data:text/html,no", source.home), null);
  const [article] = parseSource(
    source,
    "<rss><channel><item><title>Undated</title><link>https://example.com</link><pubDate>not-a-date</pubDate></item></channel></rss>",
  );
  assert.equal(article.publishedAt, null);
  assert.equal(cleanText("&#x1F600; &quot;test&quot;"), '😀 "test"');
});
test("JSON adapters map DEV and Lobsters fields", () => {
  const [dev] = parseSource(SOURCES[3], [
    {
      title: "Article",
      url: "https://dev.to/me/article",
      published_at: "2026-10-20",
      tag_list: ["webdev"],
      positive_reactions_count: 42,
      comments_count: 2,
    },
  ]);
  assert.equal(dev.points, 42);
  assert.deepEqual(dev.tags, ["webdev"]);
  const [lobster] = parseSource(SOURCES[2], [
    {
      title: "Link",
      url: "https://example.com",
      comments_url: "https://lobste.rs/s/id",
      score: 9,
      comment_count: 3,
      tags: ["programming"],
    },
  ]);
  assert.equal(lobster.comments, 3);
  assert.equal(lobster.discussionUrl, "https://lobste.rs/s/id");
});
test("source HTTP errors are surfaced, malformed feeds rejected", async () => {
  await assert.rejects(
    fetchSource(source, async () => ({ ok: false, status: 429 })),
    /429/,
  );
  assert.throws(() => parseSource(source, "<html>error</html>"), /no articles/);
});
test("refresh keeps stale cache when upstream fails and deduplicates concurrent refreshes", async () => {
  let calls = 0;
  let reject = false;
  let now = Date.now();
  const article = parseSource(source, rss)[0];
  const service = createFeedService({
    sources: [source],
    clock: () => now,
    fetcher: async () => {
      calls++;
      if (reject) throw new Error("Offline");
      return [article];
    },
  });
  await Promise.all([service.refresh(), service.refresh()]);
  assert.equal(calls, 1);
  assert.equal(service.snapshot()[0].status, "live");
  await service.refresh();
  assert.equal(calls, 1);
  now += REFRESH_MS + 1;
  reject = true;
  await service.refresh();
  assert.equal(service.snapshot()[0].status, "stale");
  assert.equal(service.snapshot()[0].articles[0].id, article.id);
});
test("one source failure does not block another source", async () => {
  const service = createFeedService({
    sources: SOURCES.slice(0, 2),
    fetcher: async (item) => {
      if (item.id === "hn") throw new Error("Offline");
      return [{ title: "Product" }];
    },
  });
  await service.refresh();
  assert.equal(service.snapshot()[0].status, "error");
  assert.equal(service.snapshot()[1].status, "live");
});
test("translations are opt-in and cached by exact original title", async () => {
  assert.equal(await translateMissing([], {}, { apiKey: "" }), false);
  const translated = applyTranslations(
    [{ articles: [{ title: "Hello" }, { title: "World" }] }],
    { [translationKey("Hello")]: "你好" },
  );
  assert.equal(translated[0].articles[0].translatedTitle, "你好");
  assert.equal(translated[0].articles[1].translatedTitle, null);
});

test("actual HNRSS description exposes scores and missing links are not homepage articles", () => {
  const articles = parseSource(
    source,
    `<rss><channel><item><title>Low score</title><link>https://example.com/low</link><description><![CDATA[<p>Points: 5</p><p># Comments: 0</p>]]></description></item><item><title>High score</title><link>https://example.com/high</link><description><![CDATA[<p>Points: 220</p><p># Comments: 115</p>]]></description></item><item><title>No link</title></item></channel></rss>`,
  );
  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, "High score");
  assert.equal(articles[0].points, 220);
  assert.equal(articles[0].comments, 115);
  assert.equal(articles[1].comments, 0);
  assert.equal(safeUrl(undefined, source.home), null);
});
