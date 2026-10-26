import { SOURCES, fetchSourceDetailed } from "./sources.mjs";

export const REFRESH_MS = 10 * 60 * 1000;
export function createFeedService({
  sources = SOURCES,
  fetcher = fetchSourceDetailed,
  concurrency = 4,
  initial = [],
  onChange = async () => {},
  clock = Date.now,
} = {}) {
  const states = new Map(
    sources.map((source) => {
      // Do not relabel an old latest-feed cache as a newly configured hot list.
      const cached = initial.find((entry) => entry.id === source.id && entry.feed === source.feed && entry.kind === source.kind);
      return [
        source.id,
        {
          ...source,
          articles: cached?.articles ?? [],
          updatedAt: cached?.updatedAt ?? null,
          status: cached?.articles?.length ? "stale" : "loading",
          error: null,
          checkedAt: cached?.checkedAt ?? null,
          errorCode: null,
          transport: cached?.transport ?? null,
          attempts: [],
        },
      ];
    }),
  );
  let pending;
  let lastAttempt = 0;
  function snapshot() {
    return sources.map((source) => ({ ...states.get(source.id) }));
  }
  async function refresh({ force = false } = {}) {
    if (pending) return pending;
    if (!force && lastAttempt && clock() - lastAttempt < REFRESH_MS)
      return snapshot();
    // Coalesce visitors into one refresh; one slow or failing source never erases other feeds.
    lastAttempt = clock();
    pending = (async () => {
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.max(1, Math.min(sources.length, concurrency)) }, async () => {
          while (cursor < sources.length) {
            const source = sources[cursor++];
            const previous = states.get(source.id);
            try {
              const result = await fetcher(source);
              const { articles, transport, attempts } = Array.isArray(result) ? { articles: result, transport: "direct", attempts: [] } : result;
              states.set(source.id, {
                ...source,
                articles,
                updatedAt: new Date(clock()).toISOString(),
                status: "live",
                error: null,
                checkedAt: new Date(clock()).toISOString(),
                errorCode: null, transport, attempts,
              });
            } catch (error) {
              states.set(source.id, {
                ...previous,
                status: previous.articles.length ? "stale" : "error",
                error: error.message,
                checkedAt: new Date(clock()).toISOString(),
                errorCode: error.feedCode || "NETWORK",
                attempts: error.attempts || [],
              });
            }
            try {
              await onChange(snapshot());
            } catch (error) {
              console.error("Cache save failed:", error.message);
            }
          }
        }),
      );
      return snapshot();
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  return {
    snapshot,
    refresh,
    get updating() {
      return Boolean(pending);
    },
  };
}
