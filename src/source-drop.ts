import type { DropPosition } from "./organization";

type SourceDropZone = { id: string; top: number; bottom: number; split: number };

// Include leading/trailing edges and gaps, not only the DOM element under the pointer.
export function sourceDropTarget(zones: SourceDropZone[], y: number): { target: string; position: DropPosition } | null {
  const zone = zones.find(item => y <= item.bottom) ?? zones.at(-1);
  if (!zone) return null;
  return { target: zone.id, position: y > zone.split ? "after" : "before" };
}
