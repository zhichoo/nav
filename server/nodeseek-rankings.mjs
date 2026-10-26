import RANKINGS from "../shared/nodeseek-rankings.json" with { type: "json" };
import { SOURCES, fetchSourceDetailed } from "./sources.mjs";
export const NODESEEK_REFRESH_MS = 60000;

export function createNodeSeekRankings({
  source = SOURCES.find(item => item.id === "nodeseek"),
  initial = {}, fetcher = fetchSourceDetailed, clock = Date.now, onChange = async () => {},
} = {}) {
  const states = new Map(RANKINGS.map(ranking => {
    const cached = initial?.[ranking.id];
    const valid = cached?.feed === ranking.feed && cached?.kind === "nodeseek" && Array.isArray(cached.articles) && Number.isFinite(Date.parse(cached.updatedAt));
    return [ranking.id, {
      feed: ranking.feed, kind: "nodeseek", articles: valid ? cached.articles : [],
      updatedAt: valid ? cached.updatedAt : null, checkedAt: null,
      status: valid && cached.articles.length ? "stale" : "loading", error: null, errorCode: null,
      transport: valid ? cached.transport : null, attempts: [],
    }];
  }));
  const attempted = new Map();
  const pending = new Map();
  function snapshot() {
    return Object.fromEntries(RANKINGS.map(ranking => {
      const value = states.get(ranking.id);
      if (value.status === "live" && clock() - Date.parse(value.updatedAt) > ranking.staleAfterMs) return [ranking.id, {
        ...value, status: "stale", errorCode: "STALE", error: "第三方榜单已超过预期更新时间，暂显示最近榜单。",
      }];
      return [ranking.id, { ...value }];
    }));
  }
  function refresh({ force = false } = {}) {
    return Promise.all(RANKINGS.map(ranking => {
      if (pending.has(ranking.id)) return pending.get(ranking.id);
      if (!force && attempted.has(ranking.id) && clock() - attempted.get(ranking.id) < ranking.refreshMs) return;
      attempted.set(ranking.id, clock());
      const task = (async () => {
        const previous = states.get(ranking.id);
        try {
          const result = await fetcher({ ...source, feed: ranking.feed, kind: "nodeseek" });
          const upstream = Date.parse(result.upstreamUpdatedAt);
          if (!Number.isFinite(upstream) || upstream > clock() + 300000) throw Object.assign(new Error("Invalid ranking timestamp"), { feedCode: "PARSE" });
          if (!Array.isArray(result.articles) || !result.articles.length) throw Object.assign(new Error("Empty ranking"), { feedCode: "PARSE" });
          if (previous.updatedAt && upstream < Date.parse(previous.updatedAt)) {
            states.set(ranking.id, { ...previous, status: "stale", checkedAt: new Date(clock()).toISOString(), errorCode: "STALE", error: "第三方返回较旧榜单，暂保留最近缓存。" });
          } else {
            states.set(ranking.id, { ...previous, articles: result.articles, updatedAt: new Date(upstream).toISOString(),
              checkedAt: new Date(clock()).toISOString(), status: "live", error: null, errorCode: null,
              transport: result.transport, attempts: result.attempts || [],
            });
          }
        } catch (error) {
          states.set(ranking.id, { ...previous, status: previous.articles.length ? "stale" : "error",
            checkedAt: new Date(clock()).toISOString(), errorCode: error.feedCode || "NETWORK",
            error: "热榜暂时无法更新，将自动重试。", attempts: error.attempts || [],
          });
        }
        try { await onChange(snapshot()); }
        catch { console.error("NodeSeek ranking cache save failed"); }
      })().finally(() => pending.delete(ranking.id));
      pending.set(ranking.id, task);
      return task;
    })).then(snapshot);
  }
  return { snapshot, refresh, get updating() { return pending.size > 0; } };
}

export function withNodeSeekRankings(sources, rankings) {
  const byId = new Map(sources.map(source => [source.id, source]));
  return SOURCES.map(source => source.id === "nodeseek"
    ? { ...source, ...rankings.daily, rankings }
    : byId.get(source.id)).filter(Boolean);
}
