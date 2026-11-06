import type { DropPosition } from "./organization";

type SourceDropZone = { id: string; top: number; bottom: number; split: number };
type SourceInsertion = { target: string; position: DropPosition };

// A gap has one anchor: before the following row, or after the final row.
export function sourceInsertionTarget(order: string[], draggedId: string, target: string, position: DropPosition): SourceInsertion | null {
  const index = order.indexOf(target);
  const draggedIndex = order.indexOf(draggedId);
  if (index < 0 || draggedIndex < 0) return null;
  const boundary = index + Number(position === "after");
  if (boundary === draggedIndex || boundary === draggedIndex + 1) return null;
  return boundary < order.length ? { target: order[boundary], position: "before" } : { target: order[order.length - 1], position: "after" };
}

// Include leading/trailing edges and gaps, not only the DOM element under the pointer.
export function sourceDropTarget(zones: SourceDropZone[], y: number): { target: string; position: DropPosition } | null {
  const zone = zones.find(item => y <= item.bottom) ?? zones.at(-1);
  if (!zone) return null;
  return { target: zone.id, position: y > zone.split ? "after" : "before" };
}
