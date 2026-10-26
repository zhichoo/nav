import RANKINGS from "../shared/nodeseek-rankings.json" with { type: "json" };
import type { NodeSeekRanking, Source } from "./types";
export const NODESEEK_TABS = RANKINGS.map(item => ({ id: item.id as NodeSeekRanking, name: item.name }));
export function nodeSeekRanking(value: string): NodeSeekRanking {
  return value === "realtime" || value === "weekly" ? value : "daily";
}
export function selectNodeSeekRanking(source: Source, ranking: NodeSeekRanking): Source {
  if (source.id !== "nodeseek") return source;
  const selected = source.rankings?.[ranking];
  return selected ? { ...source, ...selected } : { ...source, articles: [], updatedAt: null, checkedAt: null, status: "loading", error: null, errorCode: null, transport: null };
}
