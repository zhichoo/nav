import test from "node:test";
import assert from "node:assert/strict";
import { categoryOrder, ignoreSource, moveCategory, moveItem, moveVisibleSources, normalizeOrder, organizedSources, parseOrganization } from "../src/organization.ts";

const sources = [
  { id: "hn", category: "tech" }, { id: "dev", category: "dev" },
  { id: "openai", category: "ai" }, { id: "lobsters", category: "dev" },
  { id: "github", category: "dev" },
];
const empty = () => parseOrganization(null);

test("invalid or outdated saved preferences are safe and new IDs append once", () => {
  for (const value of [null, false, 4, "bad", [], {}]) assert.deepEqual(parseOrganization(value), { categoryOrder: [], sourceOrder: [], ignored: [] });
  const parsed = parseOrganization({ categoryOrder: ["ai", 4, "ai", "<script>", "missing"], sourceOrder: null, ignored: ["dev", "dev", false] });
  assert.deepEqual(parsed.ignored, ["dev"]);
  assert.deepEqual(normalizeOrder(parsed.categoryOrder, ["tech", "ai", "dev"]), ["ai", "tech", "dev"]);
  assert.deepEqual(normalizeOrder(["hn", "gone", "hn"], ["dev", "hn", "github"]), ["hn", "dev", "github"]);
});

test("all stays first and ignored stays last, even with corrupted stored order", () => {
  const ordered = categoryOrder(["ignored", "dev", "all", "ai", "dev"], ["all", "ai", "dev", "tech"]);
  assert.deepEqual(ordered, ["all", "dev", "ai", "tech", "ignored"]);
  assert.deepEqual(moveCategory(ordered, "tech", "dev", "before"), ["all", "tech", "dev", "ai", "ignored"]);
  for (const [id, target] of [["all", "dev"], ["dev", "all"], ["ignored", "dev"], ["dev", "ignored"]]) assert.strictEqual(moveCategory(ordered, id, target, "after"), ordered);
});

test("move semantics support before and after without losing or duplicating IDs", () => {
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(moveItem(order, "a", "c", "after"), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(order, "d", "b", "before"), ["a", "d", "b", "c"]);
  assert.strictEqual(moveItem(order, "a", "a"), order);
  assert.strictEqual(moveItem(order, "gone", "a"), order);
  assert.deepEqual(order, ["a", "b", "c", "d"]);
});

test("source sorting changes only visible slots and is reflected in all view", () => {
  const order = sources.map(source => source.id);
  const visible = ["dev", "lobsters", "github"];
  const moved = moveVisibleSources(order, visible, "github", "dev", "before");
  assert.deepEqual(moved, ["hn", "github", "openai", "dev", "lobsters"]);
  assert.deepEqual(organizedSources(sources, { ...empty(), sourceOrder: moved }, "dev").map(source => source.id), ["github", "dev", "lobsters"]);
  assert.deepEqual(organizedSources(sources, { ...empty(), sourceOrder: moved }, "all").map(source => source.id), moved);
  assert.strictEqual(moveVisibleSources(order, visible, "dev", "openai", "before"), order);
});

test("ignore hides from all and its category; restore recovers its saved position", () => {
  const original = { ...empty(), sourceOrder: ["github", "hn", "dev", "lobsters", "openai"] };
  const ignored = ignoreSource(original, "dev", true);
  assert.deepEqual(organizedSources(sources, ignored, "dev").map(source => source.id), ["github", "lobsters"]);
  assert.deepEqual(organizedSources(sources, ignored, "all").map(source => source.id), ["github", "hn", "lobsters", "openai"]);
  assert.deepEqual(organizedSources(sources, ignored, "ignored").map(source => source.id), ["dev"]);
  assert.deepEqual(ignoreSource(ignored, "dev", true).ignored, ["dev"]);
  const restored = ignoreSource(ignored, "dev", false);
  assert.deepEqual(organizedSources(sources, restored, "all").map(source => source.id), original.sourceOrder);
  assert.deepEqual(original.ignored, []);
  assert.deepEqual(parseOrganization(JSON.parse(JSON.stringify(ignored))), ignored);
});
