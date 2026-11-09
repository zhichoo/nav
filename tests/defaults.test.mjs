import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_IGNORED, defaultOrganization, restoreOrganization, serializeOrganization } from "../src/defaults.ts";
import { parseOrganization } from "../src/organization.ts";

const categories = ["all", "ai", "nomad", "news", "vps", "dev", "tech", "product", "weekly", "ignored"];
const sources = ["hn", "dev", "lobsters", "simonwillison", "cloudflare", "deepmind"];
const defaults = defaultOrganization(categories, sources);

test("site defaults include the current category, source and ignored-source baseline", () => {
  assert.deepEqual(defaults, {
    categoryOrder: ["ai", "nomad", "news", "vps", "dev", "tech", "product", "weekly"],
    sourceOrder: sources,
    ignored: DEFAULT_IGNORED,
  });
  assert.deepEqual(defaultOrganization(categories, ["hn"]).ignored, []);
});

test("legacy automatically written empty state upgrades once to the site defaults", () => {
  for (const legacy of [null, undefined, false, {}, {categoryOrder: [], sourceOrder: [], ignored: []}]) {
    assert.deepEqual(restoreOrganization(legacy, defaults), defaults);
  }
});

test("legacy explicit customization survives migration while versioned empty state stays explicit", () => {
  const custom = parseOrganization({categoryOrder: ["dev", "ai"], sourceOrder: ["dev", "hn"], ignored: ["hn"]});
  assert.deepEqual(restoreOrganization(custom, defaults), custom);
  const serialized = JSON.parse(serializeOrganization(parseOrganization(null)));
  assert.equal(serialized.version, 2);
  assert.deepEqual(restoreOrganization(serialized, defaults), parseOrganization(null));
});

test("serialized defaults roundtrip without changing their meaning", () => {
  assert.deepEqual(restoreOrganization(JSON.parse(serializeOrganization(defaults)), parseOrganization(null)), defaults);
});
