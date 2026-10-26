# Buzzing 首页取证

## 来源

reference/buzzing/probe/a.html，与 b.html 字节一致。原文档 sha256：44340d62f119727d696b2817852fb89b0bbf46a2fcc40263504c386df0a083ac。CSS 从第一段 style 逐字提取；其余 style 属于 iframe srcdoc，不可提升到全局。

## 事实与机制

- body margin:0 auto，padding:0，line-height:1.5em，背景 rgb(255,252,249)。
- .container 为 flex-wrap:wrap，.card 为 flex:1 1 15.625em，margin:.2em；因此 1758px 下约六栏，不是固定三栏 dashboard。
- .feed-content 只显示 400px，mask-image 在85%后淡出；checkbox 展开全部，不是每来源只取3篇。
- 每来源为原生 details，展开/折叠与列表内部的 Show More 是两个独立动作。
- .card-inner padding:.5em；h3 是正文内的序号标题，保留英文、图片、域名和时间。
- 小于480px时 container display:block。
- 本地存储只记关闭的来源 id，避免刷新丢失折叠状态。

## 不应发明

没有大 Hero、侧栏、系统状态面板、巨大品牌区。不能把 terminal 当成需要 dashboard 的理由。

## 技术栈

源站首页：原生 HTML/CSS/JavaScript，没有前端框架运行时版本需要安装。原样 baseline 不经过 React。自己的信息源组件为 React 衍生实现，不声称与源文档 DOM 字节等价。

## 验收边界

文档字节门可直接证明 baseline 仅多 noindex 和归属注释。外部图片仍使用源 URL，未宣称整站断网自包含，也未宣称像素门已通过。
