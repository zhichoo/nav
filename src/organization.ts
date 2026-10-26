export type Organization = { categoryOrder: string[]; sourceOrder: string[]; ignored: string[] };
export type DropPosition = "before" | "after";
const stringIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(item)))].slice(0, 300)
  : [];

export function parseOrganization(value: unknown): Organization {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { categoryOrder: stringIds(data.categoryOrder), sourceOrder: stringIds(data.sourceOrder), ignored: stringIds(data.ignored) };
}
export function normalizeOrder(saved: string[], available: string[]): string[] {
  const allowed = new Set(available);
  return [...new Set([...saved.filter(id => allowed.has(id)), ...available])];
}
export function categoryOrder(saved: string[], available: string[]): string[] {
  return ["all", ...normalizeOrder(saved, available.filter(id => id !== "all" && id !== "ignored")), "ignored"];
}
export function moveItem(order: string[], id: string, target: string, position: DropPosition = "before"): string[] {
  if (id === target || !order.includes(id) || !order.includes(target)) return order;
  const next = order.filter(item => item !== id);
  next.splice(next.indexOf(target) + Number(position === "after"), 0, id);
  return next;
}
export function moveCategory(order: string[], id: string, target: string, position: DropPosition): string[] {
  if ([id, target].some(value => value === "all" || value === "ignored")) return order;
  return moveItem(order, id, target, position);
}
// Reorder only the visible slots: other categories and ignored sources keep their positions.
export function moveVisibleSources(order: string[], visible: string[], id: string, target: string, position: DropPosition): string[] {
  const visibleSet = new Set(visible);
  const subset = order.filter(value => visibleSet.has(value));
  const moved = moveItem(subset, id, target, position);
  if (moved === subset) return order;
  let cursor = 0;
  return order.map(value => visibleSet.has(value) ? moved[cursor++] : value);
}
export function ignoreSource(organization: Organization, id: string, ignored: boolean): Organization {
  return { ...organization, ignored: ignored ? [...new Set([...organization.ignored, id])] : organization.ignored.filter(value => value !== id) };
}
export function organizedSources<T extends { id: string; category: string }>(sources: T[], organization: Organization, category: string): T[] {
  const ignored = new Set(organization.ignored);
  const available = new Map(sources.map(source => [source.id, source]));
  return normalizeOrder(organization.sourceOrder, sources.map(source => source.id))
    .map(id => available.get(id)!)
    .filter(source => category === "ignored" ? ignored.has(source.id) : !ignored.has(source.id) && (category === "all" || source.category === category));
}
