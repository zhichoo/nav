import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SEARCH_ENGINES, searchEngine } from "../src/web-search.ts";
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("search providers use distinct official HTTPS endpoints with correct query names", () => {
  assert.deepEqual(SEARCH_ENGINES.map(engine => engine.id), ["google", "bing", "duckduckgo"]);
  assert.equal(new Set(SEARCH_ENGINES.map(engine => engine.action)).size, 3);
  for (const engine of SEARCH_ENGINES) {
    const url = new URL(engine.action);
    assert.equal(url.protocol, "https:");
    assert.equal(url.username, ""); assert.equal(url.password, "");
    assert.equal(engine.parameter, "q");
    url.searchParams.set(engine.parameter, "中文 + RSS & API?");
    assert.equal(url.searchParams.get(engine.parameter), "中文 + RSS & API?");
  }
});

test("invalid saved engine identifiers safely use Google instead of an arbitrary destination", () => {
  assert.equal(searchEngine("bing").id, "bing");
  for (const id of ["", "https://untrusted.example/search", "__proto__", "removed-engine", "baidu"]) assert.equal(searchEngine(id).id, "google");
});

test("centered search sits after Nav and before categories with the old tagline removed", async () => {
  const app = await read("src/App.tsx");
  const html = await read("index.html");
  const css = await read("src/styles.css");
  assert.ok(app.indexOf("<WebSearch />") > app.indexOf('className="brand-title">Nav'));
  assert.ok(app.indexOf("<WebSearch />") < app.indexOf('className="reading-toolbar"'));
  assert.doesNotMatch(app + html, /技术、工具与互联网生活，按来源慢慢读。/);
  assert.match(css, /\.web-search \{[^}]*margin: 0 auto;/);
  assert.match(css, /\.web-search input \{[^}]*min-width: 0;/);
});

test("native search form opens the selected provider directly without a site API or stored queries", async () => {
  const component = await read("src/WebSearch.tsx");
  assert.match(component, /role="search"/);
  assert.match(component, /action=\{engine.action\} method="get" target="_blank" rel="noopener noreferrer"/);
  assert.match(component, /name=\{engine.parameter\}/);
  assert.match(component, /if \(!query.trim\(\)\) event.preventDefault\(\)/);
  assert.match(component, /savePreference\("nav:search-engine", selected\)/);
  assert.doesNotMatch(component, /fetch\(|\/api\/|savePreference\([^,]+, query/);
});


test("search refinements retain accessible native controls and add clear / keyboard affordances", async () => {
  const component = await read("src/WebSearch.tsx");
  const css = await read("src/styles.css");
  assert.match(component, /<div className="search-engine"><select aria-label="搜索引擎"/);
  assert.match(component, /aria-label="清空搜索"/);
  assert.match(component, /inputRef.current\?\.focus\(\)/);
  assert.match(component, /event.key === "Escape" && query/);
  assert.match(component, /disabled=\{!query.trim\(\)\}/);
  assert.match(component, /enterKeyHint="search"/);
  assert.doesNotMatch(component, /search-shortcut|<kbd/);
  assert.match(component, /event.isComposing/);
  assert.match(component, /target.isContentEditable/);
  assert.match(component, /document.querySelector\("dialog\[open\]"\)/);
  assert.match(component, /removeEventListener\("keydown", focusSearch\)/);
  assert.match(css, /\.web-search:focus-within/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
