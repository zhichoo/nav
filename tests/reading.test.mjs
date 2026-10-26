import test from "node:test";
import assert from "node:assert/strict";
import { allSectionsOpen, expansionLabel, previewArticleCount, toggleSections } from "../src/lib.ts";

test("preview counts fit one fixed-column card row on mobile, tablet and desktop", () => {
  assert.equal(previewArticleCount(0), 1);
  assert.equal(previewArticleCount(310), 1);
  assert.equal(previewArticleCount(758), 2);
  assert.equal(previewArticleCount(1750), 6);
  assert.equal(previewArticleCount(1530), 6);
  assert.equal(previewArticleCount(1524), 5);
  assert.equal(previewArticleCount((15.625 * 16 + 6) * 3 - 6), 3);
});

test("expand controls follow the selected article language without mixed labels", () => {
  assert.equal(expansionLabel(false, false), "显示全部");
  assert.equal(expansionLabel(true, false), "收起");
  assert.equal(expansionLabel(false, true), "SHOW MORE");
  assert.equal(expansionLabel(true, true), "SHOW LESS");
});

test("bulk source toggle collapses all open sources and expands a mixed selection", () => {
  const visible = ["hn", "dev", "openai"];
  assert.equal(allSectionsOpen([], visible), true);
  const closed = toggleSections([], visible);
  assert.deepEqual(closed, visible);
  assert.equal(allSectionsOpen(closed, visible), false);
  assert.deepEqual(toggleSections(closed, visible), []);
  assert.deepEqual(toggleSections(["dev"], visible), []);
});

test("bulk toggle preserves other categories, ignored sources and source order", () => {
  const closed = ["hidden", "hn", "openai"];
  const visible = ["dev", "hn"];
  assert.deepEqual(toggleSections(closed, visible), ["hidden", "openai"]);
  assert.deepEqual(toggleSections(["hidden", "openai"], visible), ["hidden", "openai", "dev", "hn"]);
  assert.deepEqual(toggleSections(["hidden"], ["dev", "dev"]), ["hidden", "dev"]);
  assert.deepEqual(closed, ["hidden", "hn", "openai"]);
  assert.deepEqual(visible, ["dev", "hn"]);
});

test("empty categories do not change saved collapse preferences", () => {
  const closed = ["hn"];
  assert.equal(allSectionsOpen(closed, []), false);
  assert.strictEqual(toggleSections(closed, []), closed);
});
