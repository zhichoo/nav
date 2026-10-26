import SOURCES from "../shared/sources.json";
import { CATEGORIES } from "./categories";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DragHandle } from "./DragHandle";
import { CategoryTab } from "./CategoryTab";
import type { DragState } from "./DragHandle";
import { SourceTools } from "./SourceTools";
import { WebSearch } from "./WebSearch";
import { NodeSeekTabs } from "./NodeSeekTabs";
import { nodeSeekRanking, selectNodeSeekRanking } from "./nodeseek";
import { PersonalTranslationContext, TranslationSettings, usePersonalArticle } from "./TranslationSettings";
import { createPersonalTranslator } from "./personal-translation";
import { PERSONAL_PREFERENCE_KEY, readPersonalConfig } from "./personal-preferences";
import { categoryOrder, ignoreSource, moveCategory, moveVisibleSources, normalizeOrder, organizedSources, parseOrganization } from "./organization";
import type { Organization } from "./organization";
import type { Article, Category, FeedResponse, NodeSeekRanking, Source } from "./types";
import { articleTitle, expansionLabel, previewArticleCount, readPreference, relativeTime, savePreference } from "./lib";

const initialSources: Source[] = SOURCES.map(source => ({ ...source, category: source.category as Source["category"], articles: [], updatedAt: null, status: "loading", error: null }));
function readIds(key: string): string[] {
  try { const value: unknown = JSON.parse(readPreference(key, "[]")); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; }
  catch { return []; }
}

function ArticleCard({ article, index, original, showImages }: {
  article: Article; index: number; original: boolean; showImages: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const personal = usePersonalArticle(article, original);
  const title = articleTitle({ ...article, translatedTitle: personal.title }, original);
  const tooltip = title !== article.title ? `${title}\n${article.title}` : title;
  return <article className="card article" ref={personal.ref}>
    <div className="card-inner">
      <h3 className="article-title"><a href={article.url} target="_blank" rel="noopener noreferrer" title={tooltip}><span className="plain-rank">{index + 1}. </span>{title}</a></h3>
      {showImages && article.image && !failed && <a className="article-image" href={article.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
        <img src={article.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </a>}
      <div className="article-domain">({article.domain})</div>
      <footer className="article-meta"><time dateTime={article.publishedAt || undefined}>{relativeTime(article.publishedAt)}</time>
        <span className="article-discussion">{article.points !== null && <span title="来源真实热度">↑ {article.points}</span>}{article.comments !== null && article.discussionUrl && <a href={article.discussionUrl} target="_blank" rel="noopener noreferrer">{article.comments} 条讨论</a>}</span>
      </footer>
      {article.tags.length > 0 && <div className="article-tags">{article.tags.slice(0, 2).map(tag => <span key={tag}>#{tag}</span>)}</div>}
    </div>
  </article>;
}

function FeedSection({ source, original, showImages, closed, onToggle, tools, dropClass, ranking, onRankingChange }: {
  source: Source; original: boolean; showImages: boolean; ranking?: NodeSeekRanking; onRankingChange: (ranking: NodeSeekRanking) => void;
  closed: boolean; onToggle: (id: string, closed: boolean) => void; tools: ReactNode; dropClass: string;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [ranking]);
  const feedRef = useRef<HTMLDivElement>(null);
  const [rowSize, setRowSize] = useState(1);
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const observer = new ResizeObserver(([entry]) => setRowSize(previewArticleCount(Math.max(0, entry.contentRect.width - 6), parseFloat(getComputedStyle(feed).fontSize))));
    observer.observe(feed);
    return () => observer.disconnect();
  }, []);
  const previewCount = rowSize;
  const hasMore = source.articles.length > previewCount;
  const articles = expanded ? source.articles : source.articles.slice(0, previewCount);
  function collapseArticles() {
    if (expanded && feedRef.current && feedRef.current.getBoundingClientRect().top < 0) document.getElementById(source.id)?.scrollIntoView({ block: "start" });
    setExpanded(!expanded);
  }
  const status = { live: "LIVE", stale: "CACHED", error: "OFFLINE", loading: "CONNECTING" }[source.status];
  return <details className={`sites feed-section ${dropClass}`} data-source-drop={source.id} id={source.id} open={!closed}
    onToggle={event => { if (event.currentTarget.open !== !closed) onToggle(source.id, !event.currentTarget.open); }}>
    <summary className="stick source-summary"><span className="source-heading"><strong>{source.name}</strong>{ranking && <NodeSeekTabs value={ranking} onChange={onRankingChange} />}<span className="source-address"> - <a className="source-home" href={source.home} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>{new URL(source.home).hostname.replace(/^www\./, "")}</a></span></span>
      <span className={`source-status status-${source.status}`} title={[ranking ? "第三方热榜：bimg.eu.org（非官方），时间为榜单生成时间" : "", source.updatedAt ? `${ranking ? "榜单更新" : "最近同步"}：${new Date(source.updatedAt).toLocaleString()}` : "尚无成功同步", source.transport === "proxy" ? "通过本机代理采集" : "直连采集", source.error || ""].filter(Boolean).join("\n")}>{status}<span className="source-count"> / {source.articles.length} 篇</span></span>
      {tools}
    </summary>
    <div className={`feed-content${expanded ? " is-expanded" : hasMore ? " has-preview" : ""}${!source.articles.length ? " is-empty" : ""}`} ref={feedRef} id={`feed-${source.id}`}>
      {source.articles.length ? <>
        <div className="container">{articles.map((article, i) => <ArticleCard key={article.id} article={article} index={i} original={original} showImages={showImages} />)}</div>
        {!expanded && hasMore && <div className="container preview-peek" aria-hidden="true" inert>{source.articles.slice(previewCount, previewCount * 2).map((article, i) => <ArticleCard key={article.id} article={article} index={previewCount + i} original={original} showImages={showImages} />)}</div>}
      </> : <div className="source-empty"><p>{source.status === "loading" ? "正在连接公开来源…" : "暂未收到更新"}</p><small>{source.status === "loading" ? "内容到达后自动显示。" : source.error || "上游当前无法访问，将自动重试。"}</small></div>}
    </div>
    {hasMore && <div className="section-actions"><button className="show-more" onClick={collapseArticles} aria-expanded={expanded} aria-controls={`feed-${source.id}`}>{expansionLabel(expanded, original)}<span> [{source.articles.length}]</span></button></div>}
  </details>;
}

function About({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { const previous = document.activeElement as HTMLElement | null; const element = ref.current; element?.showModal(); return () => { element?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className="about-dialog" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-heading about-heading"><button onClick={onClose} aria-label="关闭关于">[x]</button></div><h2>Nav，把阅读还给自己。</h2>
    <p>Nav 汇集技术、工具、互联网生活与新闻的公开订阅。按来源阅读，不做个性化推荐；标题直达原文，不抓取付费全文。</p>
    <p>默认使用站点译文，可切换原文。个人接口仅在站点翻译不可用时按需补译，由浏览器直连；配置含密钥保存在当前浏览器，可在设置中清除。分类、排序和忽略保存在当前浏览器；忽略不影响公共采集。</p>
    <p>NodeSeek 热榜由 <a href="https://bimg.eu.org" target="_blank" rel="noopener noreferrer">bimg.eu.org</a> 提供，非官方榜单；帖子链接直达 NodeSeek。</p>
    <p>布局学习自 <a href="https://www.buzzing.cc/" target="_blank" rel="noopener noreferrer">Buzzing</a>，独立非官方项目；不使用其动态数据，文章版权归原作者。</p>
  </dialog>;
}

export default function App() {
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [category, setCategory] = useState<Category | "ignored">(() => { const saved = readPreference("signal:category", "all"); return saved === "ignored" ? "ignored" : CATEGORIES.find(item => item.id === saved)?.id || "all"; });
  const [organization, setOrganization] = useState<Organization>(() => {
    try { return parseOrganization(JSON.parse(readPreference("signal:organization:v1", "{}"))); }
    catch { return parseOrganization(null); }
  });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [notice, setNotice] = useState<{ text: string; undoId?: string; restore?: boolean } | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => { setStorageFailed(!savePreference("signal:organization:v1", JSON.stringify(organization))); }, [organization]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [closed, setClosed] = useState<string[]>(() => readIds("signal:closed"));
  const [compact, setCompact] = useState(() => readPreference("signal:layout", "grid") === "compact");
  const [ranking, setRanking] = useState(() => nodeSeekRanking(readPreference("nav:nodeseek-ranking", "daily")));
  function changeRanking(value: NodeSeekRanking) { setRanking(value); savePreference("nav:nodeseek-ranking", value); }
  const [showImages, setShowImages] = useState(() => readPreference("signal:images", "show") !== "hide");
  const [original, setOriginal] = useState(() => readPreference("signal:language", "translated") === "original");
  const [about, setAbout] = useState(false);
  const [settings, setSettings] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [, refreshPersonal] = useReducer((value: number) => value + 1, 0);
  const [personal] = useState(() => createPersonalTranslator({ onChange: () => refreshPersonal() }));
  const personalStatus = personal.snapshot();
  const [networkError, setNetworkError] = useState(false);
  const [translation, setTranslation] = useState<FeedResponse["translation"]>({ enabled: false, updating: false, error: null });
  const [revision, setRevision] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: number;
    async function load() {
      let pending = false;
      try {
        const response = await fetch("/api/feeds", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data: FeedResponse = await response.json();
        if (!Array.isArray(data.sources) || controller.signal.aborted) return;
        setSources(data.sources); setTranslation(data.translation); setNetworkError(false); setLoaded(true);
        pending = data.updating || data.translation.updating;
      } catch { if (!controller.signal.aborted) setNetworkError(true); }
      finally { if (!controller.signal.aborted) timer = window.setTimeout(() => void load(), pending ? 2500 : 60000); }
    }
    void load(); return () => { controller.abort(); window.clearTimeout(timer); };
  }, [revision]);
  useEffect(() => { const timer = window.setInterval(() => tick(value => value + 1), 60000); return () => window.clearInterval(timer); }, []);
  const personalAllowed = loaded && !original && category !== "ignored" && (!translation.enabled || Boolean(translation.error));
  useEffect(() => { personal.setAvailable(personalAllowed); }, [personal, personalAllowed]);
  useEffect(() => {
    const restore = () => {
      const config = readPersonalConfig(undefined, location.origin);
      if (config) personal.enable(config, location.origin);
      else personal.disable();
    };
    const clearMemory = () => personal.disable();
    const sync = (event: StorageEvent) => { if ((event.key === null || event.key === PERSONAL_PREFERENCE_KEY)) restore(); };
    restore();
    window.addEventListener("pagehide", clearMemory);
    window.addEventListener("pageshow", restore);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("pagehide", clearMemory); window.removeEventListener("pageshow", restore); window.removeEventListener("storage", sync);
      personal.disable();
    };
  }, [personal]);
  function toggleClosed(id: string, isClosed: boolean) {
    setClosed(current => { const next = isClosed ? [...new Set([...current, id])] : current.filter(value => value !== id); savePreference("signal:closed", JSON.stringify(next)); return next; });
  }
  const categories = categoryOrder(organization.categoryOrder, CATEGORIES.map(item => item.id));
  const allSourceIds = normalizeOrder(organization.sourceOrder, sources.map(source => source.id));
  const visibleSources = organizedSources(sources, organization, category);
  const ignoredCount = sources.filter(source => organization.ignored.includes(source.id)).length;
  function selectCategory(id: Category | "ignored") { setCategory(id); savePreference("signal:category", id); }
  function toggleIgnored(id: string, ignored: boolean) {
    setOrganization(current => ignoreSource(current, id, ignored));
    const name = sources.find(source => source.id === id)?.name || id;
    setNotice({ text: ignored ? `已忽略 ${name}，可在【忽略】中恢复。` : `已恢复 ${name} 到原分类。`, undoId: id, restore: !ignored });
  }
  function moveSource(id: string, direction: -1 | 1) {
    const index = visibleSources.findIndex(source => source.id === id);
    const target = visibleSources[index + direction];
    if (!target) return;
    setOrganization(current => ({ ...current, sourceOrder: moveVisibleSources(normalizeOrder(current.sourceOrder, sources.map(source => source.id)), visibleSources.map(source => source.id), id, target.id, direction < 0 ? "before" : "after") }));
    setNotice({ text: `已${direction < 0 ? "上移" : "下移"} ${visibleSources[index].name}` });
  }
  function moveCategoryByKey(id: string, direction: -1 | 1) {
    const target = categories[categories.indexOf(id) + direction];
    if (!target || ["all", "ignored"].includes(target)) return;
    setOrganization(current => ({ ...current, categoryOrder: moveCategory(categories, id, target, direction < 0 ? "before" : "after") }));
    setNotice({ text: "分类顺序已调整" });
  }
  function handleDrop(value: DragState) {
    if (value.kind === "category") {
      if (![value.id, value.target].every(id => categories.includes(id) && !["all", "ignored"].includes(id))) return;
      setOrganization(current => ({ ...current, categoryOrder: moveCategory(categories, value.id, value.target, value.position) }));
      setNotice({ text: "分类顺序已调整" });
    } else if (value.target === "ignored" && category !== "ignored") toggleIgnored(value.id, true);
    else {
      setOrganization(current => ({ ...current, sourceOrder: moveVisibleSources(allSourceIds, visibleSources.map(source => source.id), value.id, value.target, value.position) }));
      setNotice({ text: "来源顺序已调整" });
    }
  }
  const dropClass = (kind: DragState["kind"], id: string) => drag?.kind === kind && drag.target === id && drag.id !== id ? `drop-${drag.position}` : "";
  return <PersonalTranslationContext.Provider value={{ translator: personal, allowed: personalAllowed }}><div className={`signal-shell${compact ? " compact" : ""}${drag ? " is-organizing" : ""}`} id="top">
    <a className="skip-link" href="#feeds">跳到文章</a>
    <header className="header site-header"><div className="masthead"><h1 className="site-name"><span className="wordmark"><span className="brand-copy"><span className="brand-title">Nav</span></span></span></h1><div className="header-links"><button className="text-control" onClick={() => setSettings(true)} aria-label="翻译设置">[设置]</button></div></div><WebSearch /></header>
    <div className="reading-toolbar">
      <nav className="category-tabs" aria-label="内容分类">{categories.map(id => {
        const item = CATEGORIES.find(entry => entry.id === id);
        const ignored = id === "ignored";
        return <CategoryTab key={id} id={id} label={ignored ? `【忽略】${ignoredCount ? ` ${ignoredCount}` : ""}` : item?.name || id}
          selected={category === id} className={`${dropClass("category", id)}${ignored && category !== "ignored" && drag?.kind === "source" ? " ignore-drop-target" : ""}${ignored && drag?.target === "ignored" ? " drop-active" : ""}`}
          onSelect={() => selectCategory(id as Category | "ignored")} onDrop={handleDrop} onChange={setDrag} onShift={direction => moveCategoryByKey(id, direction)} />;
      })}</nav>
      <div className="reading-controls"><button className="text-control" aria-pressed={compact} onClick={() => { setCompact(!compact); savePreference("signal:layout", compact ? "grid" : "compact"); }} title="切换卡片 / 紧凑列表">{compact ? "[ 卡片 ]" : "[ 列表 ]"}</button><div className="language-switch image-switch" role="group" aria-label="文章配图"><button aria-pressed={showImages} onClick={() => { setShowImages(true); savePreference("signal:images", "show"); }}>有图</button><button aria-pressed={!showImages} onClick={() => { setShowImages(false); savePreference("signal:images", "hide"); }}>无图</button></div><div className="language-switch" role="group" aria-label="文章语言"><button aria-pressed={!original} onClick={() => { setOriginal(false); savePreference("signal:language", "translated"); }}>中文翻译</button><button aria-pressed={original} onClick={() => { setOriginal(true); savePreference("signal:language", "original"); }}>原文</button></div></div>
    </div>
    {networkError && <p className="network-notice" role="alert">无法连接聚合服务，已有内容仍可阅读。<button onClick={() => setRevision(value => value + 1)}>重试</button></p>}
    {translation.error && <p className="network-notice" role="status">{personalStatus.active && !personalStatus.paused ? "站点翻译暂不可用，个人接口将按需补译；已有译文仍可阅读。" : "站点翻译暂不可用，已有译文仍可阅读。"}<button onClick={() => setSettings(true)}>翻译设置</button></p>}
    {personalStatus.error && <p className="network-notice" role="status">{personalStatus.error}<button onClick={() => setSettings(true)}>检查个人接口</button></p>}
    {storageFailed && <p className="network-notice" role="status">浏览器未允许保存设置；排序和忽略在刷新后可能丢失。</p>}
    {notice && <div className="organization-notice" role="status"><span>{notice.text}</span>{notice.undoId && <button onClick={() => { setOrganization(current => ignoreSource(current, notice.undoId!, Boolean(notice.restore))); setNotice(null); }}>撤销</button>}<button onClick={() => setNotice(null)} aria-label="关闭操作提示">×</button></div>}
    <main id="feeds" tabIndex={-1}>
      {category === "ignored" ? <section className="ignored-panel" aria-labelledby="ignored-heading">
        <h2 id="ignored-heading">忽略的来源</h2>
        {visibleSources.map(source => <div className={`ignored-row ${dropClass("source", source.id)}`} data-source-drop={source.id} key={source.id}>
          <DragHandle kind="source" id={source.id} label={source.name} onDrop={handleDrop} onChange={setDrag} onShift={direction => moveSource(source.id, direction)} />
          <div><strong>{source.name}</strong><span>{CATEGORIES.find(item => item.id === source.category)?.name} · <a href={source.home} target="_blank" rel="noopener noreferrer">{new URL(source.home).hostname.replace(/^www\./, "")}</a></span></div>
          <button className="restore-source" onClick={() => toggleIgnored(source.id, false)} aria-label={`恢复${source.name}`}>恢复</button>
        </div>)}
      </section> : visibleSources.map((source, index) => <FeedSection key={source.id} source={selectNodeSeekRanking(source, ranking)} ranking={source.id === "nodeseek" ? ranking : undefined} onRankingChange={changeRanking} original={original} showImages={showImages} closed={closed.includes(source.id)} onToggle={toggleClosed} dropClass={dropClass("source", source.id)} tools={<SourceTools id={source.id} name={source.name} canMoveUp={index > 0} canMoveDown={index < visibleSources.length - 1} onMove={direction => moveSource(source.id, direction)} onIgnore={() => toggleIgnored(source.id, true)} onDrop={handleDrop} onDrag={setDrag} />} />)}
      {category !== "ignored" && visibleSources.length === 0 && <div className="ignored-empty">这个分类的来源已被忽略。<button className="text-control" onClick={() => selectCategory("ignored")}>前往【忽略】恢复</button></div>}
    </main>
    <footer className="footer site-footer"><span className="footer-mark">Nav</span><nav className="footer-actions" aria-label="页尾导航"><button className="footer-about" onClick={() => setAbout(true)}>关于</button><span aria-hidden="true">/</span><a className="back-top" href="#top">↑ 回到顶部</a></nav></footer>
    {settings && <TranslationSettings translator={personal} site={translation} onClose={() => setSettings(false)} />}
    {about && <About onClose={() => setAbout(false)} />}
  </div></PersonalTranslationContext.Provider>;
}
