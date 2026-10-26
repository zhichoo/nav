import type { Category } from "./types";

export const CATEGORIES: { id: Category; name: string }[] = [
  { id: "all", name: "全部" },
  { id: "ai", name: "AI" },
  { id: "vps", name: "VPS" },
  { id: "dev", name: "开发" },
  { id: "nomad", name: "数字生活" },
  { id: "news", name: "News" },
  { id: "weekly", name: "周刊" },
  { id: "tech", name: "科技" },
  { id: "product", name: "产品" },
];

export function filterSources<T extends { category: string }>(sources: T[], category: Category): T[] {
  return category === "all" ? sources : sources.filter(source => source.category === category);
}
