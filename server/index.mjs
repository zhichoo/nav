import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createFeedService, REFRESH_MS } from "./feed-service.mjs";
import { SOURCES } from "./sources.mjs";
import { createNodeSeekRankings, NODESEEK_REFRESH_MS, withNodeSeekRankings } from "./nodeseek-rankings.mjs";
import { applyTranslations, isTranslationEnabled, translateMissing } from "./translation.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(resolve(root, ".env"))) loadEnvFile(resolve(root, ".env"));
const cacheDir = resolve(root, ".cache");
await mkdir(cacheDir, { recursive: true });
async function readCache(name, fallback) {
  try {
    return JSON.parse(await readFile(resolve(cacheDir, name), "utf8"));
  } catch {
    return fallback;
  }
}
let writeQueue = Promise.resolve();
function saveCache(name, value) {
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      const destination = resolve(cacheDir, name);
      await writeFile(`${destination}.tmp`, JSON.stringify(value));
      await rename(`${destination}.tmp`, destination);
    });
  return writeQueue;
}
const cached = await readCache("feeds.json", []);
const translations = await readCache("translations.json", {});
const shutdown = new AbortController();
const translationConfig = {
  signal: shutdown.signal,
  provider: process.env.TRANSLATION_PROVIDER || "openai",
  format: process.env.TRANSLATION_FORMAT || "json",
  deeplxUrl: process.env.DEEPLX_URL,
  chunkSize: process.env.TRANSLATION_PROVIDER === "deeplx"
    ? Number(process.env.DEEPLX_CHUNK_SIZE) || 8
    : Number(process.env.TRANSLATION_CHUNK_SIZE) || 16,
  intervalMs: process.env.TRANSLATION_PROVIDER === "deeplx"
    ? Number(process.env.DEEPLX_INTERVAL_MS) || 1500
    : Number(process.env.TRANSLATION_INTERVAL_MS) || 1000,
  onProgress: () => saveCache("translations.json", translations),
  apiKey: process.env.TRANSLATION_API_KEY,
  baseUrl: process.env.TRANSLATION_BASE_URL || "https://api.openai.com/v1",
  model: process.env.TRANSLATION_MODEL || "gpt-4.1-mini",
  batchSize: Math.min(
    200,
    Math.max(1, Number(process.env.TRANSLATION_BATCH_SIZE) || 24),
  ),
};
let translationError = null;
let translating = false;
let lastTranslationRound = "";
let translationRetryAt = 0;
const feeds = createFeedService({
  sources: SOURCES.filter(source => source.id !== "nodeseek"),
  initial: Array.isArray(cached) ? cached : [],
  onChange: (value) => saveCache("feeds.json", value),
});
const rankings = createNodeSeekRankings({
  initial: await readCache("nodeseek-rankings.json", {}),
  onChange: value => saveCache("nodeseek-rankings.json", value),
});
const feedSnapshot = () => withNodeSeekRankings(feeds.snapshot(), rankings.snapshot());
async function update() {
  await Promise.all([feeds.refresh(), rankings.refresh()]);
  if (shutdown.signal.aborted || !isTranslationEnabled(translationConfig) || translating || Date.now() < translationRetryAt) return;
  const round = feedSnapshot()
    .map((source) => source.updatedAt)
    .join("|");
  if (round === lastTranslationRound && !translationError) return;
  // Coalesce polling; retries after provider errors are rate-limited separately.
  lastTranslationRound = round;
  translating = true;
  try {
    if (
      await translateMissing(feedSnapshot(), translations, translationConfig)
    )
      await saveCache("translations.json", translations);
    translationError = null;
    translationRetryAt = 0;
  } catch (error) {
    if (shutdown.signal.aborted) return;
    translationError = error.message;
    translationRetryAt = Date.now() + Math.max(60000, error.retryAfterMs || 60000);
    console.error("Translation failed:", translationError);
  } finally {
    translating = false;
  }
}
function payload() {
  return {
    sources: applyTranslations(feedSnapshot(), translations).map(
      ({ kind: _kind, ...source }) => source,
    ),
    refreshInterval: REFRESH_MS,
    updating: feeds.updating || rankings.updating,
    translation: {
      enabled: isTranslationEnabled(translationConfig),
      updating: translating,
      error: translationError,
    },
  };
}
function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/feeds" && request.method === "GET") {
      void update().catch(console.error);
      return json(response, 200, payload());
    }
    if (url.pathname === "/api/health")
      return json(response, 200, {
        ok: true,
        sources: feedSnapshot()
          .map(({ id, status, updatedAt, checkedAt, transport, errorCode, error, attempts }) => ({ id, status, updatedAt, checkedAt, transport, errorCode, error, attempts })),
      });
    if (url.pathname.startsWith("/api/"))
      return json(response, 404, { error: "Not found" });
    if (!["GET", "HEAD"].includes(request.method))
      return json(response, 405, { error: "Method not allowed" });
    const dist = resolve(root, "dist");
    const pathname = decodeURIComponent(url.pathname);
    let target = resolve(dist, `.${pathname}`);
    if (target !== dist && !target.startsWith(`${dist}${sep}`))
      return json(response, 403, { error: "Forbidden" });
    try {
      if (!(await stat(target)).isFile()) target = resolve(dist, "index.html");
    } catch {
      if (extname(pathname)) return json(response, 404, { error: "Not found" });
      target = resolve(dist, "index.html");
    }
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": mime[extname(target)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": target.includes(`${sep}assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    if (error.code === "ENOENT")
      return json(response, 404, {
        error: "Run npm run build before starting the production server.",
      });
    console.error(error.message);
    json(response, 500, { error: "Internal server error" });
  }
});
const port = Number(process.env.PORT || 4318);
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () =>
  console.log(`SIGNAL feed server: http://${host}:${port}`),
);
void update().catch(console.error);
const timer = setInterval(() => void update().catch(console.error), NODESEEK_REFRESH_MS);
timer.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    shutdown.abort();
    clearInterval(timer);
    server.close();
  });
