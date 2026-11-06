import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { createCategoryGesture } from "./category-gesture";
import type { DragState } from "./DragHandle";

type Props = {
  id: string; label: string; selected: boolean; className: string; sorting: boolean;
  onSelect: () => void; onDrop: (drag: DragState) => void;
  onChange: (drag: DragState | null) => void; onShift: (direction: -1 | 1) => void;
};
export function CategoryTab({ id, label, selected, className, sorting, onSelect, onDrop, onChange, onShift }: Props) {
  const movable = sorting && id !== "all" && id !== "ignored";
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useRef<DragState | null>(null);
  const callbacks = useRef({ onDrop, onChange });
  callbacks.current = { onDrop, onChange };
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const button = ref.current;
    const nav = button?.parentElement;
    if (!selected || !button || !nav || nav.scrollWidth <= nav.clientWidth) return;
    const bounds = nav.getBoundingClientRect();
    const tab = button.getBoundingClientRect();
    if (tab.left < bounds.left) nav.scrollLeft += tab.left - bounds.left - 4;
    else if (tab.right > bounds.right) nav.scrollLeft += tab.right - bounds.right + 4;
  }, [selected]);
  const [gesture] = useState(() => createCategoryGesture({
    onStart: () => { setDragging(true); ref.current?.focus({ preventScroll: true }); },
    onMove: ({ x, y }) => {
      const nav = ref.current?.parentElement;
      const bounds = nav?.getBoundingClientRect();
      if (nav && bounds && y >= bounds.top && y <= bounds.bottom) {
        if (x < bounds.left + 32) nav.scrollLeft -= 12;
        else if (x > bounds.right - 32) nav.scrollLeft += 12;
      }
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-category-drop]");
      const targetId = target?.dataset.categoryDrop || "";
      const rect = target?.getBoundingClientRect();
      drag.current = { kind: "category", id, target: ["all", "ignored"].includes(targetId) ? "" : targetId, position: rect && x > rect.left + rect.width / 2 ? "after" : "before" };
      callbacks.current.onChange(drag.current);
    },
    onEnd: cancelled => {
      const value = drag.current;
      drag.current = null;
      setDragging(false);
      callbacks.current.onChange(null);
      if (!cancelled && value?.target && value.target !== id) callbacks.current.onDrop(value);
    },
  }));
  useEffect(() => {
    const button = ref.current;
    if (!button || !movable) return;
    let touchId: number | null = null;
    const cancel = () => { touchId = null; gesture.finish(true); };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { cancel(); return; }
      const touch = event.changedTouches[0];
      touchId = touch.identifier;
      gesture.start({ x: touch.clientX, y: touch.clientY }, true);
    };
    const touchMove = (event: TouchEvent) => {
      const touch = Array.from(event.changedTouches).find(item => item.identifier === touchId);
      if (!touch) return;
      if (!event.cancelable) { cancel(); return; }
      if (gesture.move({ x: touch.clientX, y: touch.clientY })) event.preventDefault();
    };
    const touchEnd = (event: TouchEvent) => {
      if (!Array.from(event.changedTouches).some(item => item.identifier === touchId)) return;
      touchId = null;
      if (gesture.finish() && event.cancelable) event.preventDefault();
    };
    const keyDown = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    const visibility = () => { if (document.hidden) cancel(); };
    const scroll = (event: Event) => { if (event.target !== button.parentElement) cancel(); };
    // A short swipe scrolls; only a deliberate hold reserves the touch for sorting.
    button.addEventListener("touchstart", touchStart, { passive: true });
    button.addEventListener("touchmove", touchMove, { passive: false });
    button.addEventListener("touchend", touchEnd, { passive: false });
    button.addEventListener("touchcancel", cancel);
    window.addEventListener("scroll", scroll, { passive: true, capture: true });
    window.addEventListener("blur", cancel);
    document.addEventListener("keydown", keyDown);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      button.removeEventListener("touchstart", touchStart);
      button.removeEventListener("touchmove", touchMove);
      button.removeEventListener("touchend", touchEnd);
      button.removeEventListener("touchcancel", cancel);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("keydown", keyDown);
      document.removeEventListener("visibilitychange", visibility);
      gesture.finish(true);
    };
  }, [gesture, movable]);
  function pointerEnd(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    if (event.pointerType === "touch") return;
    gesture.finish(cancelled);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <button ref={ref} type="button" data-category-drop={id} aria-pressed={selected}
    className={`category-chip${movable ? " category-movable" : ""}${dragging ? " is-dragging" : ""} ${className}`}
    title={movable ? "拖动或长按排序；点击切换；Alt + 左右方向键调整顺序" : undefined}
    aria-keyshortcuts={movable ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
    onClick={event => { if (event.detail > 0 && gesture.consumeClick()) { event.preventDefault(); return; } onSelect(); }}
    onPointerDown={event => {
      if (!movable || event.pointerType === "touch" || event.button !== 0 || !event.isPrimary) return;
      gesture.start({ x: event.clientX, y: event.clientY }, false);
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      if (event.pointerType !== "touch" && gesture.move({ x: event.clientX, y: event.clientY })) event.preventDefault();
    }}
    onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)}
    onLostPointerCapture={event => { if (event.pointerType !== "touch") gesture.finish(true); }}
    onContextMenu={event => { if (gesture.isTracking()) event.preventDefault(); }}
    onDragStart={event => event.preventDefault()}
    onKeyDown={event => {
      if (movable && event.altKey && !event.ctrlKey && !event.metaKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault(); gesture.finish(true); onShift(event.key === "ArrowLeft" ? -1 : 1);
      }
    }}>{label}</button>;
}
