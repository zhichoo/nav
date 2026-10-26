import test from "node:test";
import assert from "node:assert/strict";
import { expansionLabel, previewArticleCount } from "../src/lib.ts";

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
