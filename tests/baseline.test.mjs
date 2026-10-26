import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

const skip = existsSync(new URL("../reference/buzzing/mirror/index.html", import.meta.url)) ? false : "Private reference fixtures are not included in the release repository";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
test("baseline document differs only by the declared private-study injection", { skip }, async () => {
  const raw = await read("reference/buzzing/mirror/index.html");
  const published = await read("public/baseline/index.html");
  const injection = published.slice(published.indexOf("<head>") + 6, published.indexOf("<!-- UNOFFICIAL LOCAL STUDY COPY."));
  assert.match(injection, /<meta name="robots" content="noindex,nofollow"/);
  const restored = published.replace(/\n?<meta name="robots" content="noindex,nofollow" \/>\n?<!-- UNOFFICIAL LOCAL STUDY COPY\. Original: https:\/\/www\.buzzing\.cc\/ \. Copyright belongs to the original authors\. -->\n?/, "");
  assert.equal(restored, raw);
  assert.equal(createHash("sha256").update(raw).digest("hex"), "44340d62f119727d696b2817852fb89b0bbf46a2fcc40263504c386df0a083ac");
});
test("baseline CSS is the first inline stylesheet, with no iframe styles leaked", { skip }, async () => {
  const raw = await read("reference/buzzing/mirror/index.html");
  const css = raw.match(/<style[^>]*>([\s\S]*?)<\/style>/i)[1];
  assert.equal(await read("reference/buzzing/source.css"), css);
  assert.equal(await read("src/buzzing-base.css"), `/* Source: reference/buzzing/source.css; exact first inline stylesheet. Do not hand-edit. */\n${css}`);
});

test("release keeps the immutable baseline CSS even without private fixtures", async () => {
  const css = await read("src/buzzing-base.css");
  assert.equal(createHash("sha256").update(css).digest("hex"), "b58e77ee047a98694843fe52f6252986f5fffc85cdaff03506a01855a0ac6fb7");
});
