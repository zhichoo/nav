import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, filterSources } from "../src/categories.ts";
import sources from "../shared/sources.json" with { type: "json" };
import { parseSource } from "../server/sources.mjs";

test("categories cover the curated source catalog without restoring cancelled layouts", () => {
  assert.equal(sources.length, 27);
  assert.equal(new Set(CATEGORIES.map(item => item.id)).size, CATEGORIES.length);
  assert.equal(CATEGORIES[0].id, "all");
  for (const source of sources) {
    assert.ok(CATEGORIES.some(item => item.id === source.category), source.id);
    for (const key of ["limit", "aiSummary", "freq", "layout", "refreshMs"]) assert.equal(key in source, false, key);
  }
  assert.equal(sources.find(source => source.id === "lowendtalk").feed, "https://lowendtalk.com/discussions/feed.rss");
});

test("filtering preserves source references, original order and all-view contents", () => {
  const before = JSON.stringify(sources);
  assert.strictEqual(filterSources(sources, "all"), sources);
  for (const category of CATEGORIES.filter(item => item.id !== "all")) {
    const selected = filterSources(sources, category.id);
    assert.ok(selected.length > 0, category.name);
    assert.deepEqual(selected, sources.filter(source => source.category === category.id));
    assert.ok(selected.every(source => sources.includes(source)));
  }
  assert.equal(JSON.stringify(sources), before);
});

test("weekly feeds retain multiple entries, not the cancelled one-issue limit", () => {
  const source = sources.find(source => source.id === "ruanyifeng");
  const feed = `<feed>${Array.from({length: 3}, (_, i) => `<entry><title>Issue ${i}</title><link href="https://example.com/${i}"/></entry>`).join("")}</feed>`;
  assert.equal(parseSource(source, feed).length, 3);
});


test("catalog uses independent public feeds, excludes failed candidates and keeps existing categories", () => {
  assert.equal(new Set(sources.map(source => source.id)).size, sources.length);
  assert.equal(new Set(sources.map(source => source.feed)).size, sources.length);
  assert.deepEqual(CATEGORIES.map(item => item.id), ["all", "ai", "vps", "dev", "nomad", "news", "weekly", "tech", "product"]);
  for (const source of sources) {
    for (const value of [source.feed, source.home]) {
      const url = new URL(value);
      assert.equal(url.protocol, "https:");
      assert.ok(!/(^|\.)buzzing\.cc$/i.test(url.hostname));
      assert.equal(url.username, "");
      assert.equal(url.password, "");
    }
  }
  for (const id of ["politico", "yahoo", "reuters", "reuterslatest"]) assert.ok(!sources.some(source => source.id === id));
  assert.equal(sources.find(source => source.id === "nodeloc").feed, "https://www.nodeloc.com/hot.json");
});


test("requested removals are unsubscribed, and News keeps three complementary channels without BBC", () => {
  const removed = ["economist", "phys", "sciencealert", "bigthink", "showhn", "stackoverflow", "hnnew", "nomadgate", "nomadicmatt", "nomadicnotes", "nature", "bbc", "npr", "axios", "sky", "nytimes", "atlantic", "newyorker", "economistnew", "bloomberg", "wsj", "businessinsider", "googlenews", "news", "finance", "china"];
  for (const id of removed) assert.ok(!sources.some(source => source.id === id), id);
  assert.deepEqual(sources.filter(source => source.category === "news").map(source => source.id).sort(), ["ft", "guardian", "thepaper"]);
  assert.deepEqual(sources.filter(source => source.category === "nomad").map(source => source.id), ["nodeseek", "nodeloc"]);
  assert.deepEqual(sources.filter(source => source.category === "tech").map(source => source.id), ["hn", "arstechnica", "solidot"]);
  assert.equal(CATEGORIES.find(category => category.id === "nomad").name, "数字生活");
});
