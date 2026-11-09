import { SOURCES, fetchSourceDetailed } from "../server/sources.mjs";
import { REFRESH_MS } from "../server/feed-service.mjs";
import RANKINGS from "../shared/nodeseek-rankings.json" with { type: "json" };
import { applyTranslations, isTranslationEnabled, missingTranslationTitles, translateMissing, translationKey, workersAIReservation, WORKERS_AI_MODEL } from "../server/translation.mjs";

const MINUTE = 60000;
const SYNC_MS = 10 * MINUTE;
const MAX_TRANSLATIONS = 5000;
const bounded = (value, fallback, max) => Math.min(max, Math.max(1, Math.floor(Number(value) || fallback)));
const empty = source => ({ ...source, articles: [], updatedAt: null, checkedAt: null, status: "loading", error: null });

// One named Durable Object owns the shared cache and translation budget for all readers.
export function createWorkerStore(storage, env, {
  sources = SOURCES, fetcher = source => fetchSourceDetailed(source, { proxyUrl: "" }),
  translate = translateMissing, clock = Date.now,
} = {}) {
  const jobs = sources.flatMap(source => source.id === "nodeseek"
    ? RANKINGS.map(rank => ({ key: `ranking:${rank.id}`, source: { ...source, feed: rank.feed, kind: "nodeseek" }, interval: rank.refreshMs, staleAfter: rank.staleAfterMs, rank: rank.id }))
    : [{ key: `source:${source.id}`, source, interval: REFRESH_MS, staleAfter: REFRESH_MS * 2 }]);
  const states = new Map();
  const translations = {};
  const savedTranslations = new Map();
  const loadedTranslations = new Set();
  let loadingTranslations;
  let meta = {};
  let pending;
  let translating = false;
  const ready = (async () => {
    // Read only the configured feeds and budget. Historical translations are loaded on demand.
    const entries = await storage.get(["meta", ...jobs.map(job => job.key)]);
    meta = entries.get("meta") || {};
    for (const job of jobs) {
      const saved = entries.get(job.key);
      states.set(job.key, saved?.feed === job.source.feed && saved?.kind === job.source.kind && Array.isArray(saved.articles)
        ? { ...saved, ...job.source } : empty(job.source));
    }
  })();
  function activeTranslationKeys() {
    return new Set(allArticles().flatMap(source => source.articles.map(article => translationKey(article.title))));
  }
  async function loadTranslations() {
    // Serialize readers so simultaneous requests do not repeat the same storage reads.
    const previous = loadingTranslations;
    const task = (async () => {
      await previous;
      const active = activeTranslationKeys();
      for (const hash of loadedTranslations) {
        if (active.has(hash)) continue;
        loadedTranslations.delete(hash);
        savedTranslations.delete(hash);
        delete translations[hash];
      }
      const hashes = [...active].filter(hash => !loadedTranslations.has(hash));
      // Durable Object multi-get accepts at most 128 keys per call.
      for (let offset = 0; offset < hashes.length; offset += 128) {
        const batch = hashes.slice(offset, offset + 128);
        const entries = await storage.get(batch.map(hash => `translation:${hash}`));
        for (const hash of batch) {
          const entry = entries.get(`translation:${hash}`);
          if (typeof entry?.text === "string") {
            translations[hash] = entry.text;
            savedTranslations.set(hash, entry);
          }
          loadedTranslations.add(hash);
        }
      }
    })();
    loadingTranslations = task;
    try { await task; }
    finally { if (loadingTranslations === task) loadingTranslations = null; }
  }
  async function pruneTranslations() {
    const day = new Date(clock()).toISOString().slice(0, 10);
    if (meta.translationsPrunedOn === day) return;
    const entries = [];
    let startAfter;
    for (;;) {
      const page = await storage.list({ prefix: "translation:", limit: 1000, ...(startAfter ? { startAfter } : {}) });
      for (const [key, entry] of page) entries.push({ key, createdAt: entry?.createdAt || 0 });
      if (page.size < 1000) break;
      startAfter = [...page.keys()].at(-1);
    }
    // Keep visible titles first; prune old history once per UTC day, never during a public read.
    const active = activeTranslationKeys();
    entries.sort((a, b) => Number(active.has(a.key.slice(12))) - Number(active.has(b.key.slice(12))) || a.createdAt - b.createdAt);
    const excess = entries.slice(0, Math.max(0, entries.length - MAX_TRANSLATIONS));
    for (let offset = 0; offset < excess.length; offset += 128) {
      const batch = excess.slice(offset, offset + 128);
      await storage.delete(batch.map(entry => entry.key));
      for (const { key } of batch) {
        const hash = key.slice(12);
        loadedTranslations.delete(hash);
        savedTranslations.delete(hash);
        delete translations[hash];
      }
    }
    meta.translationsPrunedOn = day;
  }
  function snapshot() {
    const visible = key => {
      const state = states.get(key);
      const job = jobs.find(item => item.key === key);
      return state?.status === "live" && clock() - Date.parse(state.updatedAt) > job.staleAfter
        ? { ...state, status: "stale", error: "上游暂未更新，显示最近缓存。" } : { ...state };
    };
    return sources.map(source => source.id === "nodeseek" ? {
      ...source, ...visible("ranking:daily"),
      rankings: Object.fromEntries(RANKINGS.map(rank => [rank.id, visible(`ranking:${rank.id}`)])),
    } : visible(`source:${source.id}`));
  }
  function allArticles() {
    return [...states.values()].map(state => ({ articles: state.articles }));
  }
  async function saveTranslations() {
    const changes = {};
    for (const [hash, text] of Object.entries(translations)) {
      if (savedTranslations.get(hash)?.text === text) continue;
      const entry = { text, createdAt: clock() };
      changes[`translation:${hash}`] = entry;
    }
    if (Object.keys(changes).length) {
      await storage.put(changes);
      for (const [key, entry] of Object.entries(changes)) savedTranslations.set(key.slice(12), entry);
    }
  }
  const config = {
    provider: env.TRANSLATION_PROVIDER || "openai", format: env.TRANSLATION_FORMAT || "numbered",
    apiKey: env.TRANSLATION_API_KEY, deeplxUrl: env.DEEPLX_URL,
    baseUrl: env.TRANSLATION_BASE_URL || "https://tokenhub.tencentmaas.com/v1", model: env.TRANSLATION_MODEL || "hy-mt2-pro",
    ai: env.AI,
    chunkSize: bounded(env.TRANSLATION_CHUNK_SIZE, 16, 24), intervalMs: 1000, onProgress: saveTranslations,
  };
  async function translateBatch() {
    if (!isTranslationEnabled(config) || clock() < (meta.retryAt || 0)) return;
    const day = new Date(clock()).toISOString().slice(0, 10);
    if (meta.day !== day) { meta.day = day; meta.used = 0; meta.aiReservedNeurons = 0; }
    const missing = missingTranslationTitles(allArticles(), translations);
    if (!missing.length) { meta.translationError = null; return; }
    const remaining = bounded(env.TRANSLATION_DAILY_LIMIT, 1000, 10000) - (meta.used || 0);
    if (remaining <= 0) { meta.translationError = "站点今日翻译额度已用完。"; return; }
    const workersAI = config.provider === "workers-ai";
    const batchSize = Math.min(missing.length, remaining, bounded(env.TRANSLATION_BATCH_SIZE, 16, workersAI ? 16 : 24));
    if (workersAI) {
      if (config.model !== WORKERS_AI_MODEL) { meta.translationError = "站点翻译模型配置不受支持。"; return; }
      const reservation = workersAIReservation(missing.slice(0, batchSize));
      const budget = bounded(env.TRANSLATION_AI_DAILY_NEURONS, 8000, 8000);
      if ((meta.aiReservedNeurons || 0) + reservation > budget) { meta.translationError = "站点今日免费翻译预算已用完。"; return; }
      meta.aiReservedNeurons = (meta.aiReservedNeurons || 0) + reservation;
    }
    // Reserve before sending: a restart or failed provider response cannot reset the daily cap.
    meta.used = (meta.used || 0) + batchSize;
    await storage.put("meta", meta);
    translating = true;
    try {
      await translate(allArticles(), translations, { ...config, batchSize });
      await saveTranslations();
      meta.translationError = null;
      meta.retryAt = 0;
    } catch (error) {
      meta.translationError = "站点翻译暂时不可用。";
      meta.retryAt = clock() + Math.max(MINUTE, Math.min(3600000, Number(error.retryAfterMs) || MINUTE));
    } finally { translating = false; }
  }
  async function run() {
    await ready;
    // Cron changes can take time to propagate; duplicate ticks must not reset the cadence.
    const lastSync = Date.parse(meta.lastSyncAt);
    if (Number.isFinite(lastSync) && clock() - lastSync < SYNC_MS) return;
    const due = jobs.filter(job => {
      const checked = Date.parse(states.get(job.key).checkedAt);
      return !Number.isFinite(checked) || clock() - checked >= job.interval;
    });
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, due.length) }, async () => {
      while (cursor < due.length) {
        const job = due[cursor++];
        const previous = states.get(job.key);
        let next;
        try {
          const result = await fetcher(job.source);
          const updated = job.rank ? Date.parse(result.upstreamUpdatedAt) : clock();
          if (!Number.isFinite(updated) || updated > clock() + 300000 || !result.articles?.length) throw new Error("Invalid feed response");
          if (job.rank && previous.updatedAt && updated < Date.parse(previous.updatedAt)) throw new Error("Older ranking response");
          next = { ...job.source, articles: result.articles, updatedAt: new Date(updated).toISOString(), checkedAt: new Date(clock()).toISOString(), status: "live", error: null, errorCode: null, transport: result.transport || "direct", attempts: result.attempts || [] };
        } catch {
          next = { ...previous, checkedAt: new Date(clock()).toISOString(), status: previous.articles.length ? "stale" : "error", error: "来源暂时无法更新，将自动重试。" };
        }
        await storage.put(job.key, next);
        states.set(job.key, next);
      }
    }));
    await loadTranslations();
    await translateBatch();
    await pruneTranslations();
    meta.lastSyncAt = new Date(clock()).toISOString();
    await storage.put("meta", meta);
  }
  return {
    ready,
    refresh() {
      if (!pending) pending = run().finally(() => { pending = null; });
      return pending;
    },
    async payload() {
      await ready;
      await loadTranslations();
      const translated = applyTranslations(snapshot(), translations).map(source => {
        if (source.rankings) source.rankings = Object.fromEntries(Object.entries(source.rankings).map(([id, rank]) => [id, applyTranslations([rank], translations)[0]]));
        const { kind: _kind, ...safe } = source;
        return safe;
      });
      return { sources: translated, refreshInterval: REFRESH_MS, updating: Boolean(pending), translation: { enabled: isTranslationEnabled(config), updating: translating, error: isTranslationEnabled(config) ? meta.translationError || null : null } };
    },
    async health() {
      await ready;
      return { ok: true, lastSyncAt: meta.lastSyncAt || null, sources: snapshot().map(({ id, status, updatedAt, checkedAt }) => ({ id, status, updatedAt, checkedAt })) };
    },
  };
}
