import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { readPreference, savePreference } from "./lib";
import { SEARCH_ENGINES, searchEngine } from "./web-search";

export function WebSearch() {
  const [engineId, setEngineId] = useState(() => searchEngine(readPreference("nav:search-engine", "google")).id);
  const [query, setQuery] = useState("");
  const engine = searchEngine(engineId);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || Boolean(target.closest('[role="textbox"]')));
      if (event.key !== "/" || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || editing || document.querySelector("dialog[open]")) return;
      event.preventDefault(); inputRef.current?.focus();
    }
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);
  return <div className="web-search-region">
    <form className="web-search" role="search" aria-label="网页搜索" action={engine.action} method="get" target="_blank" rel="noopener noreferrer" autoComplete="off" onSubmit={event => { if (!query.trim()) event.preventDefault(); }}>
      <div className="search-engine"><select aria-label="搜索引擎" value={engineId} onChange={event => {
        const selected = searchEngine(event.target.value).id;
        setEngineId(selected); savePreference("nav:search-engine", selected);
      }}>{SEARCH_ENGINES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={12} aria-hidden="true" /></div>
      <Search className="search-glyph" size={16} aria-hidden="true" />
      <input ref={inputRef} type="search" name={engine.parameter} aria-label="搜索关键词" placeholder="搜索网页…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); }
      }} required maxLength={500} enterKeyHint="search" />
      {query && <button type="button" className="search-clear" aria-label="清空搜索" title="清空搜索（Esc）" onClick={() => { setQuery(""); inputRef.current?.focus(); }}><X size={14} aria-hidden="true" /></button>}
      <button type="submit" className="text-control search-submit" disabled={!query.trim()}>[搜索]</button>
    </form>
  </div>;
}
