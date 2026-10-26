import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../shared/sources.json" with { type: "json" };
import { SOURCES } from "../server/sources.mjs";
import { createFeedService } from "../server/feed-service.mjs";

test("frontend and backend share a unique public source catalog", () => {
  assert.deepEqual(SOURCES, catalog);
  assert.equal(new Set(SOURCES.map(s => s.id)).size, SOURCES.length);
  assert.equal(new Set(SOURCES.map(s => s.feed)).size, SOURCES.length);
  for (const source of SOURCES) {
    assert.match(source.id, /^[a-z][a-z0-9-]*$/);
    assert.equal(new URL(source.home).protocol, "https:");
    assert.equal(new URL(source.feed).protocol, "https:");
    assert.ok(["rss", "dev", "lobsters", "anthropic", "v2ex", "nodeseek"].includes(source.kind));
  }
});

test("requested topics have multiple independent sources", () => {
  for (const category of ["ai", "vps", "dev", "nomad", "news"]) {
    assert.ok(SOURCES.filter(s => s.category === category).length >= 2, category);
  }
});

test("requested authors use discovered feeds rather than individual post URLs", () => {
  assert.equal(SOURCES.find(s => s.id === "ruanyifeng").feed, "https://www.ruanyifeng.com/blog/atom.xml");
  assert.equal(SOURCES.find(s => s.id === "rrorange").feed, "https://rrorangeandfriends.de/feed.xml");
});


test("old cached subscriptions cannot reappear after catalog removal", async () => {
  const removed = ["showhn", "bbc", "nature", "stackoverflow", "nomadgate", "nomadicmatt", "nomadicnotes", "hnnew"];
  const calls = [];
  const service = createFeedService({
    sources: SOURCES,
    initial: removed.map(id => ({ id, articles: [{ title: "Old cached article" }] })),
    fetcher: async source => { calls.push(source.id); return [{ title: "Current article" }]; },
  });
  await service.refresh();
  assert.equal(calls.length, SOURCES.length);
  for (const id of removed) {
    assert.ok(!calls.includes(id), id);
    assert.ok(!service.snapshot().some(source => source.id === id), id);
  }
});
