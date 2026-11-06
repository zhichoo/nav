import { useEffect, useRef, useState } from "react";
import { DragHandle } from "./DragHandle";

type Props = {
  name: string; canMoveUp: boolean; canMoveDown: boolean; sorting: boolean;
  onMove: (direction: -1 | 1) => void; onIgnore: () => void;
};
export function SourceTools({ name, canMoveUp, canMoveDown, sorting, onMove, onIgnore }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return <span className="source-tools" ref={root} onClick={event => event.stopPropagation()}>
    {sorting && <DragHandle label={name} onShift={onMove} />}
    <button className="source-menu-trigger" ref={trigger} aria-label={`管理${name}`} aria-haspopup="menu" aria-expanded={open} onClick={event => { event.preventDefault(); setOpen(!open); }}>···</button>
    {open && <span className="source-menu" role="menu" aria-label={`${name}来源操作`} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
      const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
      if (event.key === "Tab") setOpen(false);
    }}>
      <button role="menuitem" disabled={!canMoveUp} onClick={event => { event.preventDefault(); onMove(-1); setOpen(false); trigger.current?.focus(); }}>上移</button>
      <button role="menuitem" disabled={!canMoveDown} onClick={event => { event.preventDefault(); onMove(1); setOpen(false); trigger.current?.focus(); }}>下移</button>
      <button role="menuitem" onClick={event => { event.preventDefault(); setOpen(false); onIgnore(); }}>加入忽略</button>
    </span>}
  </span>;
}
