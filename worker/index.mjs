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
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) {
      if (!["/api/feeds", "/api/health"].includes(path)) return json({ error: "Not found" }, 404);
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      try { return await sharedStore(env).fetch(request); }
      catch { return json({ error: "Service temporarily unavailable" }, 503); }
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
