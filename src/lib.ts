import type { Article } from "./types";

export function articleTitle(article: Pick<Article, "title" | "translatedTitle">, original = false): string {
  return (!original && article.translatedTitle?.trim()) || article.title;
}

export function relativeTime(value: string | null, now = Date.now()): string {
  if (!value) return "时间未知";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "时间未知";
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
export function readPreference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
export function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// Match the 15.625em grid column minimum and 6px gap; width excludes container padding.
export function previewArticleCount(width: number, fontSize = 16): number {
  return Math.max(1, Math.floor((width + 6) / (15.625 * fontSize + 6)));
}

export function expansionLabel(expanded: boolean, original: boolean): string {
  return original ? (expanded ? "SHOW LESS" : "SHOW MORE") : (expanded ? "收起" : "显示全部");
}

export function allSectionsOpen(closed: string[], visible: string[]): boolean {
  const closedIds = new Set(closed);
  return visible.length > 0 && visible.every(id => !closedIds.has(id));
}

export function toggleSections(closed: string[], visible: string[]): string[] {
  if (!visible.length) return closed;
  const visibleIds = new Set(visible);
  return allSectionsOpen(closed, visible)
    ? [...new Set([...closed, ...visible])]
    : closed.filter(id => !visibleIds.has(id));
}
