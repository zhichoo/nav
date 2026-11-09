import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWorkerStore } from "../worker/store.mjs";
import worker from "../worker/index.mjs";
import { SOURCES } from "../server/sources.mjs";
import { translationKey, workersAIReservation, WORKERS_AI_MODEL } from "../server/translation.mjs";

const minute = 60000;
const epoch = Date.parse("2026-10-26T00:00:00Z");
const ordinary = SOURCES.find(source => source.id !== "nodeseek");
const nodeseek = SOURCES.find(source => source.id === "nodeseek");
function memoryStorage(initial = []) {
  const values = new Map(initial);
  const readKeys = [];
  const listCalls = [];
  return {
    values, readKeys, listCalls,
    async get(keys) {
      assert.ok(Array.isArray(keys) && keys.length <= 128, "multi-get must respect the 128-key limit");
      readKeys.push(...keys);
      return new Map(keys.filter(key => values.has(key)).map(key => [key, structuredClone(values.get(key))]));
    },
    async list({ limit = 1000, startAfter = "", prefix = "" } = {}) {
      listCalls.push({ limit, startAfter, prefix });
      return new Map([...values].filter(([key]) => key > startAfter && key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b, "en")).slice(0, limit).map(([key, value]) => [key, structuredClone(value)]));
    },
    async put(key, value) {
      if (typeof key === "object") for (const [k, v] of Object.entries(key)) values.set(k, structuredClone(v));
      else values.set(key, structuredClone(value));
    },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
  };
}
function fixture(options = {}) {
  let now = epoch;
  const calls = [];
  const storage = options.storage || memoryStorage();
  const sources = options.sources || [ordinary, nodeseek];
  const fetcher = async source => {
    calls.push(source.feed);
    return { articles: [{ title: `Title ${source.feed}`, url: "https://example.com/article" }], transport: "direct", upstreamUpdatedAt: new Date(now).toISOString() };
  };
  const store = createWorkerStore(storage, options.env || {}, { sources, fetcher: options.fetcher || fetcher, clock: () => now, ...(options.translate ? { translate: options.translate } : {}) });
  return { store, calls, storage, sources, setTime(value) { now = value; } };
}

test("Worker reads do not fetch sources, translate titles, accept secrets or accept public syncs", async () => {
  const { store, calls } = fixture();
  const payload = await store.payload();
  assert.equal(calls.length, 0);
  assert.equal(payload.sources.length, 2);
  assert.equal(payload.translation.enabled, false);
  const env = { FEED_STORE: { idFromName: () => "shared", get: () => ({ fetch: async () => Response.json(payload) }) }, ASSETS: { fetch: async () => new Response("asset") } };
  assert.equal((await worker.fetch(new Request("https://nav.example/api/feeds"), env)).status, 200);
  assert.equal((await worker.fetch(new Request("https://nav.example/api/translate", { method: "POST", body: "private key" }), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://nav.example/api/feeds", { method: "POST" }), env)).status, 405);
  assert.equal(await (await worker.fetch(new Request("https://nav.example/sync", { method: "POST" }), env)).text(), "asset");
  assert.equal(calls.length, 0);
});

test("Cron is the only public Worker entrypoint that requests shared background sync", async () => {
  let call;
  let work;
  const env = { FEED_STORE: { idFromName: name => { assert.equal(name, "nav-shared-v1"); return name; }, get: () => ({ fetch: async (url, options) => { call = [url, options]; return Response.json({ok:true}); } }) } };
  await worker.scheduled({}, env, { waitUntil(value) { work = value; } });
  await work;
  assert.deepEqual(call, ["https://nav.internal/sync", { method: "POST" }]);
});

test("all sources and rankings refresh independently of reader preferences and retain one NodeSeek", async () => {
  const { store, calls } = fixture();
  await store.refresh();
  assert.equal(calls.length, 4);
  const payload = await store.payload();
  assert.equal(payload.sources.filter(source => source.id === "nodeseek").length, 1);
  const node = payload.sources.find(source => source.id === "nodeseek");
  assert.equal(Object.keys(node.rankings).length, 3);
  assert.equal(node.articles[0].title, node.rankings.daily.articles[0].title);
  assert.equal(payload.sources[0].status, "live");
});

test("cadences persist across Durable Object restarts rather than refetching on every cold start", async () => {
  const first = fixture();
  await first.store.refresh();
  const restarted = fixture({ storage: first.storage });
  restarted.setTime(epoch + minute);
  await restarted.store.refresh();
  assert.deepEqual(restarted.calls, []);
  assert.equal(first.storage.values.get("meta").lastSyncAt, new Date(epoch).toISOString());
  assert.equal(first.storage.values.get("meta").translationsPrunedOn, "2026-10-26");
  restarted.setTime(epoch + 10 * minute);
  await restarted.store.refresh();
  assert.deepEqual(restarted.calls, ["https://api.bimg.eu.org/hot.json"]);
  restarted.setTime(epoch + 30 * minute);
  await restarted.store.refresh();
  assert.equal(restarted.calls.length, 4);
  assert.equal(restarted.calls.filter(url => url === ordinary.feed).length, 1);
  assert.equal(restarted.calls.filter(url => url.includes("weekly.json")).length, 0);
});

test("overlapping Cron ticks coalesce and source concurrency stays at most four", async () => {
  let active = 0;
  let peak = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const sources = Array.from({length: 12}, (_, i) => ({...ordinary, id: `source-${i}`}));
  const { store } = fixture({ sources, fetcher: async () => { active++; peak = Math.max(peak, active); await gate; active--; return {articles:[{title:"Title"}]}; } });
  const first = store.refresh();
  assert.equal(store.refresh(), first);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(peak, 4);
  release();
  await first;
  assert.equal((await store.payload()).sources.length, 12);
});

test("failures retain own source/ranking caches and never expose upstream secret-bearing errors", async () => {
  const first = fixture();
  await first.store.refresh();
  const failed = fixture({storage:first.storage, fetcher:async () => {throw new Error("private credential URL");}});
  failed.setTime(epoch + 8 * 60 * minute);
  await failed.store.refresh();
  const payload = await failed.store.payload();
  assert.equal(payload.sources[0].status, "stale");
  assert.ok(payload.sources[0].articles.length);
  assert.equal(payload.sources[1].rankings.weekly.status, "stale");
  assert.ok(!JSON.stringify(payload).includes("private credential URL"));
});

test("NodeSeek generation timestamps age and cannot regress or move into the future", async () => {
  const first = fixture();
  await first.store.refresh();
  first.setTime(epoch + 31 * minute);
  assert.equal((await first.store.payload()).sources[1].rankings.realtime.status, "stale");
  for (const upstreamUpdatedAt of [new Date(epoch - minute).toISOString(), new Date(epoch + 90 * minute).toISOString()]) {
    const next = fixture({storage:first.storage, fetcher: async () => ({ articles:[{title:"wrong"}], upstreamUpdatedAt })});
    next.setTime(epoch + 60 * minute);
    await next.store.refresh();
    assert.equal((await next.store.payload()).sources[1].rankings.daily.updatedAt, new Date(epoch).toISOString());
  }
});

test("site translation persists all three rankings and never repeats cached titles after restart", async () => {
  let requests = 0;
  const translate = async (sources, cache, config) => {
    requests++;
    for (const {articles} of sources) for (const article of articles) cache[translationKey(article.title)] = "Translated";
    await config.onProgress();
  };
  const first = fixture({env:{TRANSLATION_API_KEY:"private-site-key"}, translate});
  await first.store.refresh();
  const payload = await first.store.payload();
  assert.equal(payload.sources[1].rankings.weekly.articles[0].translatedTitle, "Translated");
  assert.ok(!JSON.stringify(payload).includes("private-site-key"));
  const next = fixture({storage:first.storage, env:{TRANSLATION_API_KEY:"private-site-key"}, translate});
  await next.store.refresh();
  assert.equal(requests, 1);
});

test("daily translation reservations survive failures/restarts and reset on the next UTC day", async () => {
  let requests = 0;
  const env = {TRANSLATION_API_KEY:"private", TRANSLATION_DAILY_LIMIT:"2"};
  const translate = async (_sources, _cache, config) => { requests++; assert.equal(config.batchSize, 2); throw new Error("private-token-in-error"); };
  const first = fixture({env, translate});
  await first.store.refresh();
  assert.equal(first.storage.values.get("meta").used, 2);
  const next = fixture({env, translate, storage:first.storage});
  next.setTime(epoch + 10 * minute);
  await next.store.refresh();
  assert.equal(requests, 1);
  assert.match((await next.store.payload()).translation.error, /额度/);
  assert.ok(!JSON.stringify(await next.store.payload()).includes("private-token-in-error"));
  next.setTime(epoch + 24 * 60 * minute);
  await next.store.refresh();
  assert.equal(requests, 2);
});

test("provider Retry-After is persisted, and HTTP readers cannot bypass it", async () => {
  let requests = 0;
  const env = {TRANSLATION_API_KEY:"private"};
  const translate = async () => { requests++; throw Object.assign(new Error("limited"), {retryAfterMs:5 * minute}); };
  const first = fixture({env, translate});
  await first.store.refresh();
  const next = fixture({env, translate, storage:first.storage});
  next.setTime(epoch + minute);
  await next.store.payload();
  await next.store.refresh();
  assert.equal(requests, 1);
  next.setTime(epoch + 10 * minute);
  await next.store.refresh();
  assert.equal(requests, 2);
});

test("Workers AI reserves its full request estimate before inference; failure and restart do not refund it", async () => {
  let requests = 0;
  const title = `Title ${ordinary.feed}`;
  const reservation = workersAIReservation([title]);
  const env = { TRANSLATION_PROVIDER: "workers-ai", TRANSLATION_MODEL: WORKERS_AI_MODEL, TRANSLATION_AI_DAILY_NEURONS: String(reservation), AI: { async run() {
    requests++;
    assert.equal(storage.values.get("meta").aiReservedNeurons, reservation);
    throw new Error("upstream failure");
  } } };
  const storage = memoryStorage();
  const first = fixture({ env, storage, sources: [ordinary] });
  await first.store.refresh();
  assert.equal(requests, 1);
  const next = fixture({ env, storage, sources: [ordinary] });
  next.setTime(epoch + 30 * minute);
  await next.store.refresh();
  assert.equal(requests, 1);
  assert.match((await next.store.payload()).translation.error, /免费翻译预算/);
  next.setTime(epoch + 24 * 60 * minute);
  await next.store.refresh();
  assert.equal(requests, 2);
  assert.equal(storage.values.get("meta").aiReservedNeurons, reservation);
});

test("Chinese-only content spends no translation budget", async () => {
  const source = { ...ordinary, id: "chinese" };
  const ai = { async run() { assert.fail("Chinese titles must not invoke inference"); } };
  const { store, storage } = fixture({ env: { TRANSLATION_PROVIDER: "workers-ai", TRANSLATION_MODEL: WORKERS_AI_MODEL, AI: ai }, sources: [source], fetcher: async () => ({ articles: [{ title: "科技爱好者周刊：本周值得关注的消息" }] }) });
  await store.refresh();
  assert.equal(storage.values.get("meta").used, 0);
  assert.equal(storage.values.get("meta").aiReservedNeurons, 0);
  assert.equal((await store.payload()).translation.error, null);
});

test("Workers AI cannot raise its 8000-Neuron cap or silently switch to an unbudgeted model", async () => {
  for (const model of [WORKERS_AI_MODEL, "unbudgeted-model"]) {
    const storage = memoryStorage([["meta", { day: "2026-10-26", used: 0, aiReservedNeurons: 7999 }]]);
    const { store } = fixture({ storage, sources: [ordinary], env: {
      TRANSLATION_PROVIDER: "workers-ai", TRANSLATION_MODEL: model, TRANSLATION_AI_DAILY_NEURONS: "999999",
      AI: { async run() { assert.fail("No unbudgeted model call is allowed"); } },
    } });
    await store.refresh();
    assert.equal(storage.values.get("meta").aiReservedNeurons, 7999);
    assert.match((await store.payload()).translation.error, model === WORKERS_AI_MODEL ? /免费翻译预算/ : /模型配置/);
  }
});

test("legacy translations beyond 1000 entries are restored on demand without translating them again", async () => {
  const entries = Array.from({length:1500}, (_, i) => [`translation:${String(i).padStart(64,"0")}`, {text:"Saved",createdAt:epoch}]);
  const title = `Title ${ordinary.feed}`;
  entries.push([`translation:${translationKey(title)}`, {text:"Restored",createdAt:epoch}]);
  const {store} = fixture({storage:memoryStorage(entries)});
  await store.refresh();
  assert.equal((await store.payload()).sources[0].articles[0].translatedTitle, "Restored");
});

test("cold starts read only configured feeds and active translations, sharing concurrent reads", async () => {
  const articles = Array.from({ length: 320 }, (_, i) => ({ title: `Visible title ${i}`, url: `https://example.com/${i}` }));
  const entries = Array.from({ length: 5000 }, (_, i) => [`translation:${translationKey(`Old title ${i}`)}`, { text: "Old translation", createdAt: epoch }]);
  for (const article of articles) entries.push([`translation:${translationKey(article.title)}`, { text: "Visible translation", createdAt: epoch }]);
  entries.push([`source:${ordinary.id}`, { ...ordinary, articles, status: "live", updatedAt: new Date(epoch).toISOString() }]);
  const storage = memoryStorage(entries);
  const { store } = fixture({ storage, sources: [ordinary] });
  await store.health();
  assert.deepEqual(storage.readKeys, ["meta", `source:${ordinary.id}`]);
  assert.equal(storage.listCalls.length, 0);
  const payloads = await Promise.all([store.payload(), store.payload(), store.payload()]);
  assert.ok(payloads.every(payload => payload.sources[0].articles.every(article => article.translatedTitle === "Visible translation")));
  assert.equal(storage.readKeys.length, 322);
  assert.equal(storage.listCalls.length, 0);
  await store.payload();
  assert.equal(storage.readKeys.length, 322);
});

test("missing translations are read once, and new feed titles reuse historical translations before billing", async () => {
  const oldTitle = `Title ${ordinary.feed}`;
  const nextTitle = "A returning title";
  const storage = memoryStorage([[`translation:${translationKey(nextTitle)}`, { text: "Historical translation", createdAt: epoch }]]);
  let requests = 0;
  const env = { TRANSLATION_API_KEY: "private" };
  const translate = async (sources, cache) => {
    requests++;
    for (const { articles } of sources) for (const { title } of articles) cache[translationKey(title)] = "First translation";
  };
  const { store, setTime } = fixture({ storage, sources: [ordinary], env, translate, fetcher: async () => ({ articles: [{ title: requests ? nextTitle : oldTitle }] }) });
  await store.refresh();
  assert.equal(requests, 1);
  setTime(epoch + 30 * minute);
  await store.refresh();
  assert.equal(requests, 1);
  assert.equal((await store.payload()).sources[0].articles[0].translatedTitle, "Historical translation");
  const cold = fixture({ storage, sources: [ordinary] });
  await cold.store.payload();
  const reads = storage.readKeys.length;
  await cold.store.payload();
  assert.equal(storage.readKeys.length, reads);
});

test("history cleanup runs only once per UTC day across restarts and preserves visible old titles", async () => {
  const title = `Title ${ordinary.feed}`;
  const key = `translation:${translationKey(title)}`;
  const entries = Array.from({ length: 5100 }, (_, i) => [`translation:${translationKey(`Old ${i}`)}`, { text: "Old", createdAt: epoch + i }]);
  entries.push([key, { text: "Still visible", createdAt: epoch - minute }]);
  const storage = memoryStorage(entries);
  const first = fixture({ storage, sources: [ordinary] });
  await first.store.refresh();
  assert.equal([...storage.values.keys()].filter(key => key.startsWith("translation:")).length, 5000);
  assert.equal(storage.values.get(key).text, "Still visible");
  assert.equal(storage.values.get("meta").translationsPrunedOn, "2026-10-26");
  assert.ok(storage.listCalls.length > 1);
  assert.ok(storage.listCalls.every(call => call.prefix === "translation:"));
  const scans = storage.listCalls.length;
  const restarted = fixture({ storage, sources: [ordinary] });
  restarted.setTime(epoch + 10 * minute);
  await restarted.store.refresh();
  assert.equal(storage.listCalls.length, scans);
  restarted.setTime(epoch + 24 * 60 * minute);
  await restarted.store.refresh();
  assert.ok(storage.listCalls.length > scans);
  assert.equal(storage.values.get("meta").translationsPrunedOn, "2026-10-27");
});

test("edge cache coalesces feed URL variants, bypasses health and does not cache failures", async t => {
  const original = globalThis.caches;
  t.after(() => { if (original === undefined) delete globalThis.caches; else globalThis.caches = original; });
  const responses = new Map();
  globalThis.caches = { default: {
    async match(request) { return responses.get(request.url)?.clone(); },
    async put(request, response) { responses.set(request.url, response); },
  } };
  let calls = 0;
  let status = 200;
  const env = { FEED_STORE: { idFromName: () => "shared", get: () => ({ fetch: async () => { calls++; return Response.json({ ok: true }, { status }); } }) } };
  const first = await worker.fetch(new Request("https://nav.example/api/feeds?refresh=1"), env);
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  assert.equal(responses.get("https://nav.example/api/feeds").headers.get("Cache-Control"), "public, max-age=60");
  const cached = await worker.fetch(new Request("https://nav.example/api/feeds?refresh=2"), env);
  assert.equal(cached.headers.get("Cache-Control"), "no-store");
  assert.equal(calls, 1);
  await worker.fetch(new Request("https://nav.example/api/health"), env);
  await worker.fetch(new Request("https://nav.example/api/health"), env);
  assert.equal(calls, 3);
  responses.clear();
  status = 503;
  assert.equal((await worker.fetch(new Request("https://nav.example/api/feeds"), env)).status, 503);
  assert.equal(responses.size, 0);
  globalThis.caches.default.match = async () => { throw new Error("cache unavailable"); };
  status = 200;
  assert.equal((await worker.fetch(new Request("https://nav.example/api/feeds"), env)).status, 200);
});

test("release config has no credentials or proxy, uses SQLite, excludes baseline and avoids public sync routes", async () => {
  const wrangler = JSON.parse(await readFile(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
  assert.equal(wrangler.migrations[0].new_sqlite_classes[0], "NavFeedStore");
  assert.equal(wrangler.ai.binding, "AI");
  assert.equal(wrangler.vars.TRANSLATION_PROVIDER, "workers-ai");
  assert.equal(wrangler.vars.TRANSLATION_MODEL, WORKERS_AI_MODEL);
  for (const key of ["TRANSLATION_API_KEY","DEEPLX_URL","FEED_PROXY_URL"]) assert.equal(wrangler.vars[key], undefined);
  assert.deepEqual(wrangler.triggers.crons, ["*/10 * * * *"]);
  assert.deepEqual(wrangler.routes, [{ pattern: "nav.zhichoo.com", custom_domain: true }]);
  const vite = await readFile(new URL("../vite.config.ts",import.meta.url),"utf8");
  assert.match(vite, /copyPublicDir: false/);
  const ignore = await readFile(new URL("../public/.assetsignore",import.meta.url),"utf8");
  assert.match(ignore, /\/baseline\/\*\*/);
});


test("removed subscriptions stay out of Worker payloads and jobs while HN and Ask HN remain", async () => {
  const removed = [
    ["economist", "https://www.economist.com/the-world-this-week/rss.xml"],
    ["showhn", "https://hnrss.org/show"],
    ["phys", "https://phys.org/rss-feed/"],
    ["sciencealert", "https://www.sciencealert.com/feed"],
    ["bigthink", "https://bigthink.com/feed/"],
  ];
  const storage = memoryStorage(removed.map(([id, feed]) => [`source:${id}`, {
    id, feed, kind: "rss",
    articles: [{ title: "Removed source article", url: `https://example.com/removed/${id}` }],
  }]));
  const { store, calls } = fixture({ storage, sources: SOURCES });
  const before = await store.payload();
  assert.equal(before.sources.length, 27);
  for (const [id] of removed) assert.ok(!before.sources.some(source => source.id === id), id);
  for (const id of ["hn", "askhn"]) assert.ok(before.sources.some(source => source.id === id));
  await store.refresh();
  const after = await store.payload();
  const health = await store.health();
  for (const [id, feed] of removed) {
    assert.ok(!calls.includes(feed), id);
    assert.ok(!after.sources.some(source => source.id === id), id);
    assert.ok(!health.sources.some(source => source.id === id), id);
  }
  assert.ok(calls.includes("https://hnrss.org/frontpage"));
  assert.ok(calls.includes("https://hnrss.org/ask"));
  assert.ok(calls.includes("https://m.thepaper.cn/channel_25950"));
});


test("Worker discards NodeLoc latest RSS cache and schedules the official hot JSON", async () => {
  const source = SOURCES.find(item => item.id === "nodeloc");
  const storage = memoryStorage([["source:nodeloc", {
    ...source, feed:"https://www.nodeloc.com/latest.rss", kind:"rss",
    articles:[{title:"Old latest topic"}], updatedAt:new Date(epoch).toISOString(),
  }]]);
  const {store,calls}=fixture({storage,sources:[source]});
  const before=await store.payload();
  assert.deepEqual(before.sources[0].articles,[]);
  assert.equal(before.sources[0].status,"loading");
  await store.refresh();
  assert.deepEqual(calls,["https://www.nodeloc.com/hot.json"]);
  assert.equal((await store.payload()).sources[0].status,"live");
});
