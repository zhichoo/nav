import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("requested copy is removed and About sits beside back-to-top in the footer", async () => {
  const app = await read("src/App.tsx");
  for (const copy of ["仅从正常分类和「全部」中隐藏，订阅仍会更新。恢复后回到原分类与已保存的位置。", "还没有忽略的来源。", "好内容不该被信息流淹没。", "公开来源 · 定时更新 · 标题直达原文"]) assert.ok(!app.includes(copy), copy);
  const header = app.slice(app.indexOf('<header className="header site-header">'), app.indexOf('<div className="reading-toolbar">'));
  assert.ok(!header.includes("setAbout"));
  assert.ok(header.includes("setSettings"));
  const footer = app.slice(app.indexOf('<footer className="footer site-footer">'), app.indexOf('{settings &&'));
  assert.match(footer, /footer-about/);
  assert.match(footer, /back-top/);
  assert.ok(!footer.includes("布局参考"));
  assert.ok(!footer.includes("translation.enabled"));
});

test("the non-interactive masthead and metadata share the Nav identity", async () => {
  const app = await read("src/App.tsx");
  const html = await read("index.html");
  assert.match(app, /<span className="wordmark"><span className="brand-copy"><span className="brand-title">Nav<\/span>/);
  assert.doesNotMatch(app, /<a[^>]*className="wordmark"/);
  assert.match(html, /<title>Nav<\/title>/);
  assert.match(html, /favicon\.svg\?v=nav-n/);
  const icon = await read("public/favicon.svg");
  assert.match(icon, /M20 46V18L44 46V18/);
  assert.match(html, /noindex,nofollow/);
});


test("footer is centered in two rows, names have no logo and settings entry shares the list control style", async () => {
  const app = await read("src/App.tsx");
  const css = await read("src/styles.css");
  assert.doesNotMatch(app, /brand-mark|\[\*\]/);
  assert.ok(app.includes('className="text-control" onClick={() => setSettings(true)} aria-label="翻译设置">[设置]</button>'));
  assert.doesNotMatch(css, /\.header-links button/);
  assert.match(css, /\.site-footer \{[^}]*flex-direction: column;[^}]*align-items: center;/);
  assert.match(app, /footer-mark">Nav<\/span>/);
});

test("translation settings remove extra copy and describe provider model requirements", async () => {
  const settings = await read("src/TranslationSettings.tsx");
  for (const removed of ["./preferences", "默认使用", "站点译文缺失且服务不可用时", "个人备用接口", "不登录 · 不保存", "刷新即清除", "本次启用"]) assert.ok(!settings.includes(removed), removed);
  assert.match(settings, /OpenAI 兼容（需模型名）/);
  assert.match(settings, /DeepLX（无需模型名）/);
  assert.match(settings, /draft.provider === "openai" && <div className="translation-fields">/);
  assert.match(settings, /draft.provider === "deeplx" && <label>API Key（选填）/);
  assert.match(settings, /地址已含令牌时留空，否则通过 Bearer 请求头发送/);
  assert.match(settings, /savePersonalConfig/);
  assert.match(settings, /API 配置仅保存在本地浏览器。/);
});


test("About removes the command, baseline link and redundant return action but retains close", async () => {
  const app = await read("src/App.tsx");
  const about = app.slice(app.indexOf("function About("), app.indexOf("export default function App("));
  for (const removed of ["cat about.txt", "返回阅读", "/baseline/index.html", "Buzzing 原样学习基线", "非官方，默认不公开"]) assert.ok(!about.includes(removed), removed);
  assert.match(about, /aria-label="关闭关于"/);
  assert.match(about, /布局学习自/);
});


test("translation actions share the list text control without boxed button overrides", async () => {
  const settings = await read("src/TranslationSettings.tsx");
  const css = await read("src/styles.css");
  assert.ok(settings.includes('className="text-control" onClick={() => void test()}'));
  assert.ok(settings.includes('type="submit" className="text-control"'));
  assert.match(settings, /\[测试连接\]/);
  assert.match(settings, /\[保存并启用\]/);
  assert.doesNotMatch(css, /\.translation-actions button|\.settings-primary|\.settings-secondary/);
});


test("all origins use one light rounded appearance regardless of legacy theme preferences", async () => {
  const app = await read("src/App.tsx");
  const css = await read("src/styles.css");
  assert.doesNotMatch(app, /signal:skin|data-skin|type Skin|card-command|source-rule/);
  assert.doesNotMatch(css, /data-skin|card-command|source-rule/);
  assert.match(css, /--paper: #fffcf9/);
  assert.match(css, /--accent: #0066cc/);
  assert.match(css, /\.source-summary::before \{ content: "▸"/);
  assert.match(css, /details\[open\] > \.source-summary::before \{ content: "▾"/);
});


test("bulk collapse sits beside layout and controls only visible source sections", async () => {
  const app = await read("src/App.tsx");
  assert.match(app, /\[ 列表 \][\s\S]*?<\/button>\{category !== "ignored" && <button className="text-control" onClick=\{toggleAllSections\}/);
  assert.match(app, /disabled=\{!visibleSourceIds.length\} aria-expanded=\{allOpen\} aria-controls="feeds"/);
  assert.match(app, /toggleSections\(current, visibleSourceIds\)/);
  assert.match(app, /savePreference\("signal:closed", JSON.stringify\(next\)\)/);
});

test("source categories appear after domains, before status, only in all view", async () => {
  const app = await read("src/App.tsx");
  const css = await read("src/styles.css");
  assert.match(app, /categoryName=\{category === "all" \? CATEGORIES.find\(item => item.id === source.category\)\?\.name : undefined\}/);
  assert.match(app, /categoryName && <span className="source-category"> · \{categoryName\}<\/span>/);
  const domain = app.indexOf('className="source-home"');
  const label = app.indexOf('className="source-category"');
  const status = app.indexOf('className={`source-status');
  assert.ok(domain < label && label < status);
  assert.match(css, /\.source-category \{[^}]*color: var\(--muted\);[^}]*font-weight: 400;/);
});
