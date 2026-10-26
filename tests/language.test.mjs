import test from "node:test";
import assert from "node:assert/strict";
import { articleTitle } from "../src/lib.ts";

test("article titles default to the translated version", () => {
  const article = { title: "Docker is weird", translatedTitle: "Docker 挺奇怪的" };
  assert.equal(articleTitle(article), "Docker 挺奇怪的");
  assert.equal(articleTitle(article, false), "Docker 挺奇怪的");
});
test("original mode preserves the source title without changing the article", () => {
  const article = { title: "Docker is weird", translatedTitle: "Docker 挺奇怪的" };
  assert.equal(articleTitle(article, true), "Docker is weird");
  assert.equal(article.translatedTitle, "Docker 挺奇怪的");
});
test("missing or blank translations fall back to the original title", () => {
  for (const translatedTitle of [null, "", "  "]) {
    assert.equal(articleTitle({ title: "Original title", translatedTitle }), "Original title");
  }
});
