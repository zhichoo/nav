import type { Organization } from "./organization.ts";
import { parseOrganization } from "./organization.ts";

export const ORGANIZATION_KEY = "signal:organization:v2";
export const LEGACY_ORGANIZATION_KEY = "signal:organization:v1";
const ORGANIZATION_VERSION = 2;
export const DEFAULT_IGNORED = ["lobsters", "simonwillison", "cloudflare", "deepmind"];

export function defaultOrganization(categoryIds: string[], sourceIds: string[]): Organization {
  const available = new Set(sourceIds);
  return {
    categoryOrder: categoryIds.filter(id => id !== "all" && id !== "ignored"),
    sourceOrder: [...sourceIds],
    ignored: DEFAULT_IGNORED.filter(id => available.has(id)),
  };
}

// Empty legacy records were written automatically on first visit, not chosen by the reader.
export function restoreOrganization(value: unknown, fallback: Organization): Organization {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const data = value as Record<string, unknown>;
  const saved = parseOrganization(data);
  if (data.version === ORGANIZATION_VERSION) return saved;
  return saved.categoryOrder.length || saved.sourceOrder.length || saved.ignored.length ? saved : fallback;
}

export function serializeOrganization(organization: Organization): string {
  return JSON.stringify({ version: ORGANIZATION_VERSION, ...organization });
}
