import { createWorkerStore } from "./store.mjs";

const json = (value, status = 200) => Response.json(value, { status, headers: {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow",
} });
const sharedStore = env => env.FEED_STORE.get(env.FEED_STORE.idFromName("nav-shared-v1"));

export class NavFeedStore {
  constructor(ctx, env) {
    this.store = createWorkerStore(ctx.storage, env);
    ctx.blockConcurrencyWhile(() => this.store.ready);
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/sync" && request.method === "POST") {
      await this.store.refresh();
      return json({ ok: true });
    }
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (path === "/api/feeds") return json(await this.store.payload());
    if (path === "/api/health") return json(await this.store.health());
    return json({ error: "Not found" }, 404);
  }
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) {
      if (!["/api/feeds", "/api/health"].includes(path)) return json({ error: "Not found" }, 404);
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const cache = path === "/api/feeds" ? globalThis.caches?.default : null;
      const cacheKey = new Request(new URL(path, request.url), { method: "GET" });
      if (cache) {
        try {
          const cached = await cache.match(cacheKey);
          if (cached) {
            const response = new Response(cached.body, cached);
            response.headers.set("Cache-Control", "no-store");
            return response;
          }
        } catch { /* A cache failure must not prevent a live read. */ }
      }
      let response;
      try { response = await sharedStore(env).fetch(request); }
      catch { return json({ error: "Service temporarily unavailable" }, 503); }
      response = new Response(response.body, response);
      response.headers.set("Cache-Control", "no-store");
      if (cache && response.ok) {
        // Cache only at the edge. Browser TTL rules must not keep feed data for hours.
        const cachedResponse = new Response(response.clone().body, response);
        cachedResponse.headers.set("Cache-Control", "public, max-age=60");
        const saving = cache.put(cacheKey, cachedResponse).catch(() => {});
        if (ctx) ctx.waitUntil(saving);
        else await saving;
      }
      return response;
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    // Only Cron can request a sync. Public traffic cannot trigger paid translation work.
    ctx.waitUntil(sharedStore(env).fetch("https://nav.internal/sync", { method: "POST" }).then(response => {
      if (!response.ok) throw new Error("Scheduled sync failed");
    }));
  },
};
