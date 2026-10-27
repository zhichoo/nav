import { useEffect, useRef } from "react";
import type { PointerEvent } from "react";
import type { DropPosition } from "./organization";
import { sourceDropTarget } from "./source-drop";

export type DragState = { kind: "category" | "source"; id: string; target: string; position: DropPosition };
type Props = {
  kind: DragState["kind"]; id: string; label: string;
  onDrop: (drag: DragState) => void; onChange: (drag: DragState | null) => void;
  onShift: (direction: -1 | 1) => void;
};
export function DragHandle({ kind, id, label, onDrop, onChange, onShift }: Props) {
  const session = useRef<{ startX: number; startY: number; x: number; y: number; active: boolean; drag: DragState } | null>(null);
  const frame = useRef(0);
  const callbacks = useRef({ onDrop, onChange });
  callbacks.current = { onDrop, onChange };
  useEffect(() => () => { cancelAnimationFrame(frame.current); }, []);
  function locate() {
    const current = session.current;
    if (!current) return;
    const point = document.elementFromPoint(current.x, current.y);
    const ignored = kind === "source" ? point?.closest<HTMLElement>('[data-category-drop="ignored"]') : null;
    const target = ignored || point?.closest<HTMLElement>(kind === "source" ? "[data-source-drop]" : "[data-category-drop]");
    let targetId = ignored ? "ignored" : target?.dataset[kind === "source" ? "sourceDrop" : "categoryDrop"] || "";
    const rect = (kind === "source" && !ignored ? target?.querySelector("summary") || target : target)?.getBoundingClientRect();
    const after = rect && (kind === "source" ? current.y > rect.top + rect.height / 2 : current.x > rect.left + rect.width / 2);
    let position: DropPosition = after ? "after" : "before";
    if (kind === "source" && !target) {
      const root = document.getElementById("feeds");
      const bounds = root?.getBoundingClientRect();
      const zones = [...(root?.querySelectorAll<HTMLElement>("[data-source-drop]") || [])].map(element => {
        const rect = element.getBoundingClientRect();
        const heading = (element.querySelector("summary") || element).getBoundingClientRect();
        return { id: element.dataset.sourceDrop!, top: rect.top, bottom: rect.bottom, split: heading.top + heading.height / 2 };
      });
      const first = zones[0];
      const toolbar = document.querySelector(".reading-toolbar")?.getBoundingClientRect();
      const overToolbar = point?.closest(".reading-toolbar");
      const availableTop = Math.min(first?.top ?? Infinity, toolbar?.bottom ?? Infinity);
      if (bounds && first && current.x >= bounds.left && current.x <= bounds.right &&
        current.y >= availableTop - 12 && current.y <= bounds.bottom + 12 &&
        (!overToolbar || first.top >= (toolbar?.bottom ?? 0) - 1)) {
        const drop = sourceDropTarget(zones, current.y);
        if (drop) { targetId = drop.target; position = drop.position; }
      }
    }
    current.drag = { kind, id, target: targetId, position };
    callbacks.current.onChange(current.drag);
  }
  function autoScroll() {
    const current = session.current;
    if (!current?.active) return;
    // Keep the destination stable while hovering the sticky category/drop toolbar.
    if (kind === "category" || document.elementFromPoint(current.x, current.y)?.closest(".reading-toolbar")) {
      frame.current = requestAnimationFrame(autoScroll); return;
    }
    const edge = 70;
    const distance = current.y < edge ? -Math.ceil((edge - current.y) / 4) : current.y > innerHeight - edge ? Math.ceil((current.y - innerHeight + edge) / 4) : 0;
    if (distance) { window.scrollBy(0, distance); locate(); }
    frame.current = requestAnimationFrame(autoScroll);
  }
  function start(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, drag: { kind, id, target: "", position: "before" } };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = session.current;
    if (!current) return;
    current.x = event.clientX; current.y = event.clientY;
    if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) < 6) return;
    if (!current.active) { current.active = true; frame.current = requestAnimationFrame(autoScroll); }
    event.preventDefault(); locate();
  }
  function finish(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const current = session.current;
    if (!current) return;
    if (current.active && !cancel) locate();
    session.current = null;
    cancelAnimationFrame(frame.current);
    callbacks.current.onChange(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.active && !cancel && current.drag.target) callbacks.current.onDrop(current.drag);
  }
  return <button className={`drag-handle ${kind}-handle`} aria-label={`调整${label}顺序`} title={kind === "category" ? "拖动调整分类顺序，或聚焦后按左右方向键" : "上下拖动排序，也可拖到【忽略】；支持上下方向键"}
    onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={event => { if (session.current) finish(event, true); }}
    onClick={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => {
      if (event.key === "Escape") { session.current = null; cancelAnimationFrame(frame.current); callbacks.current.onChange(null); }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        onShift(event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1);
      }
    }}><span aria-hidden="true">⠿</span></button>;
}
