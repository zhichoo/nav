import test from "node:test";
import assert from "node:assert/strict";
import { SOURCES, parseSource, fetchSource } from "../server/sources.mjs";
const source = SOURCES.find(source => source.id === "anthropic");
const row = (url, title, date) => `<li data-listing-row="example"><a href="${url}"><h3 class="font-medium">${title}</h3></a><p>Public excerpt.</p><time>${date}</time></li>`;
const html = `<html><nav><a href="/news/announcements">Announcements</a></nav><script>fake content</script><ul>${row("/news/example", "A model &amp; tools", "Oct 22, 2026")}${row("/news/example", "Duplicate", "Oct 22, 2026")}<li data-listing-row="date-attr"><a href="/news/second"><h2>Second story</h2></a><time datetime="2026-10-21T00:00:00Z">yesterday</time></li><li data-listing-row="unsafe"><a href="javascript:alert(1)"><h3>Unsafe</h3></a></li></ul></html>`;

test("official Anthropic news adapter ignores navigation/scripts and normalizes articles", () => {
  assert.equal(source.kind, "anthropic");
  const articles = parseSource(source, html);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, "A model & tools");
  assert.equal(articles[0].url, "https://www.anthropic.com/news/example");
  assert.equal(articles[0].publishedAt, "2026-10-22T00:00:00.000Z");
  assert.equal(articles[1].publishedAt, "2026-10-21T00:00:00.000Z");
  assert.equal(articles[0].points, null);
  assert.equal(articles[0].image, null);
});

test("official page uses text transport and fails honestly when markup changes", async () => {
  let requested;
  const result = await fetchSource(source, async (url) => {
    requested = url;
    return {ok:true, text:async()=>html, json:async()=>{throw new Error("not JSON");}};
  });
  assert.equal(requested, "https://www.anthropic.com/news");
  assert.equal(result.length, 2);
  await assert.rejects(fetchSource(source, async()=>({ok:true,text:async()=>'<html>Page layout changed</html>'})), /响应不是可用订阅/);
});
