import { useEffect, useRef } from "react";
import { createCategoryGesture } from "./category-gesture";
import type { DropPosition } from "./organization";
import { sourceDropTarget, sourceInsertionTarget } from "./source-drop";

export type DragState = { kind: "category" | "source"; id: string; target: string; position: DropPosition };

export function useSourceDrag(enabled: boolean, onDrop: (drag: DragState) => void, onChange: (drag: DragState | null) => void) {
  const callbacks = useRef({ onDrop, onChange });
  callbacks.current = { onDrop, onChange };
  useEffect(() => {
    const root = document.getElementById("feeds");
    if (!enabled || !root) return;
    let session: { row: HTMLElement; id: string; x: number; y: number; active: boolean; pointerId: number | null; touchId: number | null; drag: DragState } | null = null;
    let frame = 0;
    function locate() {
      const current = session;
      if (!current) return;
      const point = document.elementFromPoint(current.x, current.y);
      const ignored = point?.closest<HTMLElement>('[data-category-drop="ignored"]');
      const target = ignored || point?.closest<HTMLElement>("[data-source-drop]");
      let targetId = ignored ? "ignored" : target?.dataset.sourceDrop || "";
      const rect = (ignored ? target : target?.querySelector("summary") || target)?.getBoundingClientRect();
      let position: DropPosition = rect && current.y > rect.top + rect.height / 2 ? "after" : "before";
      if (!target) {
        const bounds = root!.getBoundingClientRect();
        const zones = [...root!.querySelectorAll<HTMLElement>("[data-source-drop]")].map(element => {
          const rect = element.getBoundingClientRect();
          const heading = (element.querySelector("summary") || element).getBoundingClientRect();
          return { id: element.dataset.sourceDrop!, top: rect.top, bottom: rect.bottom, split: heading.top + heading.height / 2 };
        });
        const first = zones[0];
        const toolbar = document.querySelector(".reading-toolbar")?.getBoundingClientRect();
        const overToolbar = point?.closest(".reading-toolbar");
        const availableTop = Math.min(first?.top ?? Infinity, toolbar?.bottom ?? Infinity);
        if (first && current.x >= bounds.left && current.x <= bounds.right &&
          current.y >= availableTop - 12 && current.y <= bounds.bottom + 12 &&
          (!overToolbar || first.top >= (toolbar?.bottom ?? 0) - 1)) {
          const drop = sourceDropTarget(zones, current.y);
          if (drop) { targetId = drop.target; position = drop.position; }
        }
      }
      if (targetId && !ignored) {
        const order = [...root!.querySelectorAll<HTMLElement>("[data-source-drop]")].map(element => element.dataset.sourceDrop!);
        const insertion = sourceInsertionTarget(order, current.id, targetId, position);
        targetId = insertion?.target || "";
        position = insertion?.position || "before";
      }
      current.drag = { kind: "source", id: current.id, target: targetId, position };
      callbacks.current.onChange(current.drag);
    }
    function autoScroll() {
      const current = session;
      if (!current?.active) return;
      if (!document.elementFromPoint(current.x, current.y)?.closest(".reading-toolbar")) {
        const edge = 70;
        const distance = current.y < edge ? -Math.ceil((edge - current.y) / 4) : current.y > innerHeight - edge ? Math.ceil((current.y - innerHeight + edge) / 4) : 0;
        if (distance) { window.scrollBy(0, distance); locate(); }
      }
      frame = requestAnimationFrame(autoScroll);
    }
    function complete(cancelled: boolean) {
      const current = session;
      if (!current) return;
      session = null;
      cancelAnimationFrame(frame);
      if (current.pointerId !== null && current.row.hasPointerCapture(current.pointerId)) current.row.releasePointerCapture(current.pointerId);
      if (current.active) callbacks.current.onChange(null);
      if (current.active && !cancelled && current.drag.target) callbacks.current.onDrop(current.drag);
    }
    const gesture = createCategoryGesture({
      onStart: () => { if (session) { session.active = true; locate(); frame = requestAnimationFrame(autoScroll); } },
      onMove: point => { if (session) { session.x = point.x; session.y = point.y; locate(); } },
      onEnd: complete,
    });
    function finish(cancelled = true) { gesture.finish(cancelled); complete(true); }
    function start(target: EventTarget | null, x: number, y: number, pointerId: number | null, touchId: number | null) {
      finish();
      gesture.consumeClick();
      if (!(target instanceof Element)) return;
      const control = target.closest('a, button, input, select, textarea, [role="button"]');
      if (control && !control.matches(".drag-handle")) return;
      const row = target.closest<HTMLElement>(".source-summary, .ignored-row");
      const id = row?.closest<HTMLElement>("[data-source-drop]")?.dataset.sourceDrop;
      if (!row || !id || !root!.contains(row)) return;
      session = { row, id, x, y, active: false, pointerId, touchId, drag: { kind: "source", id, target: "", position: "before" } };
      if (pointerId !== null) row.setPointerCapture(pointerId);
      gesture.start({ x, y }, touchId !== null);
    }
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.button === 0 && event.isPrimary) start(event.target, event.clientX, event.clientY, event.pointerId, null);
    };
    const pointerMove = (event: PointerEvent) => {
      if (session?.pointerId !== event.pointerId) return;
      if (gesture.move({ x: event.clientX, y: event.clientY })) event.preventDefault();
    };
    const pointerUp = (event: PointerEvent) => { if (session?.pointerId === event.pointerId) finish(false); };
    const pointerCancel = (event: PointerEvent) => { if (session?.pointerId === event.pointerId) finish(); };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { finish(); return; }
      const touch = event.changedTouches[0];
      start(event.target, touch.clientX, touch.clientY, null, touch.identifier);
    };
    const touchMove = (event: TouchEvent) => {
      const touch = Array.from(event.changedTouches).find(item => item.identifier === session?.touchId);
      if (!touch) return;
      if (!event.cancelable) { finish(); return; }
      if (gesture.move({ x: touch.clientX, y: touch.clientY })) event.preventDefault();
      else if (!gesture.isTracking()) complete(true);
    };
    const touchEnd = (event: TouchEvent) => {
      if (!Array.from(event.changedTouches).some(item => item.identifier === session?.touchId)) return;
      const active = session?.active;
      finish(false);
      if (active && event.cancelable) event.preventDefault();
    };
    const cancel = () => finish();
    const keyDown = (event: KeyboardEvent) => { if (event.key === "Escape") finish(); };
    const scroll = () => { if (session && !session.active) finish(); };
    const visibility = () => { if (document.hidden) finish(); };
    const click = (event: MouseEvent) => { if (event.detail > 0 && gesture.consumeClick()) { event.preventDefault(); event.stopPropagation(); } };
    const contextMenu = (event: Event) => { if (session) event.preventDefault(); };
    root.addEventListener("pointerdown", pointerDown);
    root.addEventListener("touchstart", touchStart, { passive: true });
    root.addEventListener("click", click, true);
    root.addEventListener("contextmenu", contextMenu);
    document.addEventListener("pointermove", pointerMove);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", pointerCancel);
    document.addEventListener("lostpointercapture", pointerCancel);
    document.addEventListener("touchmove", touchMove, { passive: false });
    document.addEventListener("touchend", touchEnd, { passive: false });
    document.addEventListener("touchcancel", cancel);
    document.addEventListener("keydown", keyDown);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("scroll", scroll, { passive: true, capture: true });
    window.addEventListener("blur", cancel);
    return () => {
      root.removeEventListener("pointerdown", pointerDown);
      root.removeEventListener("touchstart", touchStart);
      root.removeEventListener("click", click, true);
      root.removeEventListener("contextmenu", contextMenu);
      document.removeEventListener("pointermove", pointerMove);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerCancel);
      document.removeEventListener("lostpointercapture", pointerCancel);
      document.removeEventListener("touchmove", touchMove);
      document.removeEventListener("touchend", touchEnd);
      document.removeEventListener("touchcancel", cancel);
      document.removeEventListener("keydown", keyDown);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("blur", cancel);
      finish();
    };
  }, [enabled]);
}

export function DragHandle({ label, onShift }: { label: string; onShift: (direction: -1 | 1) => void }) {
  return <button className="drag-handle source-handle" aria-label={`调整${label}顺序`} title="整行均可拖动，手机长按后移动；支持上下方向键"
    onClick={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => {
      if (["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        onShift(event.key === "ArrowUp" ? -1 : 1);
      }
    }}><span aria-hidden="true">⠿</span></button>;
}
