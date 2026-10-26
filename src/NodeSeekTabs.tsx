import { NODESEEK_TABS } from "./nodeseek";
import type { NodeSeekRanking } from "./types";
export function NodeSeekTabs({ value, onChange }: { value: NodeSeekRanking; onChange: (value: NodeSeekRanking) => void }) {
  return <span className="source-ranking-tabs" role="group" aria-label="NodeSeek 热榜" title="由 bimg.eu.org 提供的第三方榜单，非 NodeSeek 官方榜单">
    {NODESEEK_TABS.map(tab => <button key={tab.id} type="button" aria-pressed={tab.id === value}
      onClick={event => { event.preventDefault(); event.stopPropagation(); onChange(tab.id); }}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}>[{tab.name}]</button>)}
  </span>;
}
