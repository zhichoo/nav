import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Article, FeedResponse } from "./types";
import { translatePersonalTitle, validatePersonalConfig } from "./personal-translation";
import type { PersonalConfig, PersonalTranslator } from "./personal-translation";
import { clearPersonalConfig, emptyPersonalConfig, readPersonalConfig, savePersonalConfig } from "./personal-preferences";

export const PersonalTranslationContext = createContext<{ translator: PersonalTranslator; allowed: boolean } | null>(null);
export function usePersonalArticle(article: Article, original: boolean) {
  const context = useContext(PersonalTranslationContext);
  const ref = useRef<HTMLElement>(null);
  const status = context?.translator.snapshot();
  useEffect(() => {
    const element = ref.current;
    if (!element || !context || !context.allowed || !status?.active || status.paused || original || article.translatedTitle?.trim() || element.closest("[inert]")) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) context.translator.request(article.title);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [context?.translator, context?.allowed, status?.active, status?.paused, status?.revision, article.title, article.translatedTitle, original]);
  return { ref, title: article.translatedTitle?.trim() || context?.translator.get(article.title) || null };
}

export function TranslationSettings({ translator, site, onClose }: {
  translator: PersonalTranslator; site: FeedResponse["translation"]; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const testRequest = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState<PersonalConfig>(() => translator.getConfiguration() || readPersonalConfig(undefined, location.origin) || emptyPersonalConfig());
  const [hasSaved, setHasSaved] = useState(() => Boolean(readPersonalConfig(undefined, location.origin)));
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const status = translator.snapshot();
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { testRequest.current?.abort(); element?.close(); previous?.focus(); };
  }, []);
  function edit(next: Partial<PersonalConfig>) {
    testRequest.current?.abort(); setTesting(false); setTested(false); setMessage(null);
    setDraft(current => ({ ...current, ...next }));
  }
  async function test() {
    try {
      const config = validatePersonalConfig(draft, location.origin);
      const controller = new AbortController(); testRequest.current = controller;
      setTesting(true); setTested(false); setMessage(null);
      try {
        const result = await translatePersonalTitle(config, "A new open-source tool for developers", { signal: controller.signal });
        if (!controller.signal.aborted) { setMessage(`直连成功：${result}`); setTested(true); }
      } catch (error) { if (!controller.signal.aborted) setMessage((error as Error).message); }
      finally { if (!controller.signal.aborted) setTesting(false); }
    } catch (error) { setMessage((error as Error).message); }
  }
  function enable() {
    try {
      const config = validatePersonalConfig(draft, location.origin);
      const saved = savePersonalConfig(config, undefined, location.origin);
      translator.enable(config, location.origin);
      if (saved) { onClose(); }
      else { setTested(false); setMessage("浏览器未能保存更改，本次已启用；刷新后不会保留本次更改。"); }
    }
    catch (error) { setMessage((error as Error).message); }
  }
  return <dialog ref={dialog} className="about-dialog translation-dialog" aria-labelledby="translation-settings-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-heading translation-heading"><h2 id="translation-settings-title">翻译设置</h2><button type="button" onClick={onClose} aria-label="关闭翻译设置">[x]</button></div>
    <div className="translation-site-status"><span>站点翻译</span><span className="settings-status">{site.error ? "暂不可用" : site.enabled ? site.updating ? "翻译中" : "正常" : "未启用"}</span></div>
    <div className="personal-heading"><h3>个人接口</h3><span className="settings-status">{status.active ? status.paused ? "已暂停" : "已启用" : "未启用"}</span></div>
    <form autoComplete="off" onSubmit={event => { event.preventDefault(); enable(); }}>
      <label>接口类型<select value={draft.provider} onChange={event => edit({ provider: event.target.value as PersonalConfig["provider"], apiKey: "" })}><option value="openai">OpenAI 兼容（需模型名）</option><option value="deeplx">DeepLX（无需模型名）</option></select></label>
      <label>接口地址<input type="url" required value={draft.endpoint} placeholder={draft.provider === "openai" ? "https://api.example.com/v1" : "https://api.example.com/translate"} spellCheck={false} autoCapitalize="none" autoComplete="off" onChange={event => edit({ endpoint: event.target.value })} /></label>
      {draft.provider === "openai" && <div className="translation-fields"><label>模型名称<input required value={draft.model} placeholder="例如 hy-mt2-pro" autoComplete="off" spellCheck={false} onChange={event => edit({ model: event.target.value })} /></label><label>API Key<input type="password" required value={draft.apiKey} placeholder="填写你的 API Key" autoComplete="new-password" spellCheck={false} onChange={event => edit({ apiKey: event.target.value })} /></label></div>}
      {draft.provider === "deeplx" && <label>API Key（选填）<input aria-label="API Key" type="password" value={draft.apiKey} placeholder="地址已含令牌时留空，否则通过 Bearer 请求头发送" autoComplete="new-password" spellCheck={false} onChange={event => edit({ apiKey: event.target.value })} /></label>}
      <p className="translation-privacy">API 配置仅保存在本地浏览器。</p>
      {message && <p className={`translation-message${tested ? " is-success" : ""}`} role="status">{message}</p>}
      {status.error && !message && <p className="translation-message" role="status">{status.error}</p>}
      <div className="translation-actions"><button type="button" className="text-control" onClick={() => void test()} disabled={testing}>{testing ? "[正在测试…]" : "[测试连接]"}</button><button type="submit" className="text-control" disabled={testing}>[保存并启用]</button></div>
    </form>
    {(status.active || hasSaved) && <button type="button" className="clear-personal" onClick={() => {
      testRequest.current?.abort(); translator.disable();
      const cleared = clearPersonalConfig();
      setDraft(emptyPersonalConfig()); setHasSaved(!cleared); setTested(false); setTesting(false);
      setMessage(cleared ? null : "个人接口已停用，但浏览器阻止了清除。请在浏览器中清除此站点的数据。");
    }}>清除配置</button>}
  </dialog>;
}
