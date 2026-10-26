# Nav

布局学习自 Buzzing 的文章聚合站，统一使用白底、蓝色链接、圆角卡片的阅读样式。React + TypeScript + Vite 前端，Node.js 原生 HTTP 后端；另提供 Cloudflare Workers + SQLite Durable Object 云端适配。

## 本地与线上

- http://127.0.0.1:5186/baseline/index.html：Buzzing 首页静态学习快照，保留原 HTML、CSS 和原生交互，仅增加 noindex / 来源注释。不是持续更新的 Buzzing 镜像，外部图片仍需联网。
- http://127.0.0.1:5186/：自有实时数据的 Nav。仅保留一套外观，本地与生产构建相同，不再读取旧的主题偏好；卡片 / 列表、有图 / 无图、中文 / 原文仍可切换。

布局基于提取的原始 CSS：`flex: 1 1 15.625em`、400px 淡出容器、来源 details 折叠、480px 以下单列。不加入 Hero、侧栏或仪表盘。文档字节 / CSS 等价测试通过；**未完成所有第三方媒体离线镜像、断网门或像素对拍，不宣称完整 L2/L3 验收通过**。详见 `REBUILD_PLAN.md`、`docs/divergence.md`。

代码仓库按用户要求公开，正式访问地址配置为 https://nav.zhichoo.com ，保留 https://nav.lzhichao1212.workers.dev 备用入口与 noindex。原站完整学习快照仅保存在本机，不包含于公开仓库或生产构建。第三方来源与许可范围见 `THIRD_PARTY_NOTICES.md`。

## Cloudflare Workers

```sh
npm ci
npm run check
npm run release:check -- --history  # 本地检查 Git 历史，不联网
npm run cf:check  # 构建和部署预检，不上传
```

已支持共享持久缓存、每分钟后台调度、NodeSeek 三榜独立更新、站点翻译 Secret 和持久化日额度。个人接口仍只在浏览器直连。部署步骤、二级域名、GitHub 自动部署及用量边界见 [DEPLOY.md](DEPLOY.md)。实际部署命令为 `npm run cf:deploy`，需提供你自己的 Cloudflare 部署认证。

## 开发

要求 Node.js 22.16+（推荐 24）。

```sh
npm install
npm run dev
```

打开 http://127.0.0.1:5186 。开发脚本同时启动 Vite（5186）和 API 服务（4318）。

## 生产运行

```sh
npm run build
npm start
```

打开 http://127.0.0.1:4318 。对外部署时设置 `HOST=0.0.0.0`，并通过 HTTPS 反向代理访问。默认不对局域网开放。

## 数据与更新

来源目录统一保存在 `shared/sources.json`，前后端共享配置，共 31 个来源。本轮按用户选择从 50 个精简：移除 6 个指定来源，News 从 18 个减至 3 个，数字生活补入 2 个已验证公开订阅。

- AI：OpenAI News、Simon Willison、Latent Space、Anthropic News、Google DeepMind、Hugging Face Blog
- VPS / 基础设施：LowEndBox、LowEndTalk、Cloudflare Blog
- 开发：Lobsters、DEV Community、GitHub Blog、V2EX · 今日热议、Show HN、Ask HN
- 数字生活：NodeSeek、NodeLoc
- News：The Guardian World、金融时报、经济学人「本周」
- 周刊：阮一峰科技爱好者周刊、大橘和朋友们的周刊、Import AI
- 科技 / 产品：Hacker News、Ars Technica、Solidot、Phys.org、ScienceAlert、Big Think、Product Hunt、少数派

本轮真正停用 Stack Overflow Blog、HN 最新、Nomad Gate、Nomadic Matt、Nomadic Notes、Nature，以及未保留的 News 来源（含 BBC 与四个 Google News 频道）。这些来源不再采集或参与新标题翻译，不是仅在页面隐藏；历史译文缓存不主动删除。保留媒体按覆盖面互补选择，不保证某一家绝对准确；FT / 经济学人原文可能需要订阅。
两位作者的订阅地址分别为 `https://www.ruanyifeng.com/blog/atom.xml` 和 `https://rrorangeandfriends.de/feed.xml`。前者是作者公开的整个博客 Atom（当前条目为周刊），不冒充仅周刊专用 feed；后者会更新最新期数，不固定在第 038 期。Simon Willison 属于个人技术博客，不保证每篇都是 AI 主题；VPS 分类也包含基础设施。数字生活关注互联网服务、优惠情报及 eSIM，不再订阅旅行攻略；内部分类 ID 仍为 `nomad`，以兼容用户已保存的分类顺序。NodeSeek / NodeLoc 为用户社区，涉及网络工具、互联网服务、优惠、额度活动和使用经验，包含推广和交易，不代表本站验证或背书。eSIMDB 虽能采集，但条目更新较慢且偏出境上网，本轮不加入；也不加入未经验证的虚拟卡推广源。社区信息不保证每条都涉及虚拟卡或 eSIM，不承诺活动有效或服务商可靠。

运行 `npm run feeds:check` 可低并发检查真实采集可用性，自动读取本机 `.env`，输出成功路径（direct / proxy）和失败原因。运行时来源不使用任何 Buzzing 数据接口；大多数使用官方 RSS，HN 使用公开 HNRSS，DEV / Lobsters 沿用公开 JSON 接口，不再订阅 Google News 聚合频道。经济学人保留的是 The World This Week 栏目，不冒充完整最新文章频道。

Anthropic 使用官方 `/news` 列表适配，不冒充官方 RSS；页面结构变化时按来源故障处理。日期只有年月日时按 UTC 日历日归一化，不声称提供精确发布时间。

### 直连与代理

RSS / API / 官方新闻页面采集先直连（10 秒超时）；失败后，若配置 `FEED_PROXY_URL`，使用同一地址经 HTTP(S) 代理重试一次（18 秒超时）。不改系统设置，不影响翻译服务，不使用 Buzzing 作为回退。

```dotenv
FEED_PROXY_URL=http://127.0.0.1:7890
```

Node 原生 fetch 不会自动沿用 macOS 系统代理，这正是此前 V2EX、Hugging Face、Guardian、Import AI 空白的原因。2026-10-24 本机配置代理后，这四项均通过真实后端成功读取。`127.0.0.1` 指后端所在机器；部署到 VPS / 容器需改成部署环境可达的代理，不能照搬本机地址。没有代理时留空，只直连。

本轮新增来源按直连 → 本机代理实测筛选：Yahoo Finance 经代理仍返回 429；测试的 Reuters Agency 订阅地址返回 404；Politico 在真实 Node 后端直连和代理均返回 403，均未加入。不绕过验证码或付费墙。网络状态可能变化，详情以实际检查结果为准。

`/api/health` 提供各源最近成功 / 检查时间、直连或代理路径、HTTP / 超时 / DNS / 连接重置 / 解析错误等安全诊断，不输出代理凭据。页面状态悬停可看采集路径，首次无内容时显示具体失败原因。
后端每 10 分钟同步，前端每分钟读取缓存。同步进行中每 2.5 秒检查进度，各来源独立完成，故障互不阻塞。文章按 URL 去重，保留来源、原文链接、发布时间及上游真实提供的热度/讨论数据。

上游超时或失败时保留最后一次成功结果，显示 CACHED / OFFLINE。未成功采集时显示空状态，不用假新闻或虚构热度填充。Node 模式缓存原子写入 `.cache/feeds.json`，服务器重启后可继续阅读；Node 多实例部署应改用共享存储。Workers 模式已使用单一命名 Durable Object 共享存储。公共源可能限流、修改格式或停止服务，不保证可用性。

## 中文翻译

默认使用站点公共译文；个人翻译在页头「[设置]」中配置，无需登录。本地运行使用 Node 与磁盘缓存；Workers 运行使用 Durable Object 持久缓存。Workers 适配已部署上线。

### 站点翻译

当前使用腾讯 TokenHub 的 `hy-mt2-pro`，通过兼容的 `/chat/completions` 接口调用。复制 `.env.example` 为 `.env` 后填入自己的密钥；密钥和含令牌的 URL 只由后端读取，`.env` 已被 git 忽略，不传给浏览器。

- `TRANSLATION_PROVIDER=openai`：表示 OpenAI-compatible 协议，不限定实际服务商。
- `TRANSLATION_BASE_URL`、`TRANSLATION_MODEL`、`TRANSLATION_API_KEY`：服务根地址（含 `/v1`）、模型与密钥。
- `TRANSLATION_FORMAT=numbered`：翻译专用模型使用编号文本，严格检查每条译文对应的编号；通用模型可用 `json`，支持纯 JSON 或单层 Markdown JSON 包裹。
- `TRANSLATION_BATCH_SIZE=128`：每轮最多翻译 128 个新标题；`TRANSLATION_CHUNK_SIZE=16` 控制单次请求，`TRANSLATION_INTERVAL_MS=1000` 控制请求间隔。
- DeepLX 作为可选适配保留：设 `TRANSLATION_PROVIDER=deeplx` 并配置 `DEEPLX_URL`。不自动回退到其他服务，避免意外外发标题或费用。

**配置选定服务的凭据即启用自动翻译，原始公开文章标题会发送给配置的服务，并可能产生费用。** 没有该服务凭据时不发起请求。译文按原始标题 SHA256 缓存在 `.cache/translations.json`；相同标题不重复翻译。每批成功后立即保存，即使后续批次失败也保留已有译文。

默认优先显示中文，可切换原文并记住选择。未翻译标题暂显原文，不显示覆盖率；429 / 超时等故障保留缓存、至少间隔一分钟重试，并尊重服务的 `Retry-After`。浏览器轮询不会并发启动翻译任务。服务重启会取消正在进行的翻译请求，不阻塞开发服务器退出。

本地 Node 模式的预算仍是每轮上限，不是日消费限额；Workers 模式新增持久化的日标题尝试额度（默认 1000 条），详见 `DEPLOY.md`。两者都不是金额计费上限，应同时设置供应商侧预算与监控。

### 个人翻译

- 页头「[设置]」支持 OpenAI 兼容和 DeepLX；可 [测试连接]、[保存并启用]、清除配置；测试 / 保存按钮与列表使用同一文字按钮样式。OpenAI-compatible 填 HTTPS 基地址或完整 chat/completions 地址、模型和 Key；DeepLX 无需模型名，支持完整 HTTPS 翻译地址内含令牌（Key 留空），或填写接口地址及独立 API Key（通过 Authorization: Bearer 请求头发送）。不自动将 Key 拼入 URL，不进行两种鉴权方式的失败重试；使用请求头时接口的 CORS 还需允许 Authorization。
- 仅在站点服务未启用或明确报错、中文模式下，对当前实际可见且没有公共译文的标题按需补译。站点正常时即使配置了个人接口也不会自动消耗个人额度；「测试连接」始终单独请求一次。
- 浏览器直接请求配置的第三方接口，不经本站后端或 CF 转发，不携带本站 Cookie、不跟随重定向、不发送 Referer。接口必须支持浏览器 CORS（包括所需请求头）；不支持时明确报错，不偷偷走代理。
- 按用户最新选择，完整配置（类型、地址、模型、Key，包含 DeepLX 令牌地址）默认存于当前浏览器 localStorage，无需额外勾选。刷新、关闭后重开会自动恢复，不上传本站后端 / CF，不存 Cookie、服务端日志或数据库；不跨浏览器 / 设备同步。设置中可清除，清除后停止请求并删除已保存配置，同源其他标签页收到存储变化后同步停用。浏览器阻止存储时明确提示，不冒充保存成功；清除站点数据、无痕模式结束或浏览器自动清理仍可能丢失。队列和个人译文缓存仍只在内存中。
- 单请求串行、标题去重，站点恢复、切换原文或进入忽略页时取消个人请求；网络、认证或格式错误会暂停队列。已有站点译文始终优先，个人译文不进入公共缓存，也不影响其他读者。
- 测试和补译会将对应公开标题发给个人选择的服务，可能计费。密钥以明文存在用户设备的 localStorage，不是加密保险箱；同源脚本、恶意扩展或能访问浏览器资料的人可能读取。建议使用私人设备和独立、低额度、可撤销的 Key。不要把浏览器保存误认为服务器代管。

## 页面功能

- 工具栏左侧加入全部、AI、VPS、开发、数字生活、News、周刊、科技、产品分类，仅筛选来源并记住选择；来源内仍使用原来的卡片和展开方式
- Nav 纯文字品牌页头，名称不可点击，移除品牌说明；名称下、分类上增加居中的多引擎网页搜索，支持 Google / Bing / DuckDuckGo，记住引擎但不保存关键词，搜索在新标签页直达所选引擎；支持 / 聚焦、Esc 或清空按钮清除关键词，空白查询不提交，快捷键不干扰正在编辑的字段或设置弹窗；名称不带图形标识，设置在页头以 [设置] 显示，复用列表按钮的无边框文字样式；页尾应用名一行、关于 / 回到顶部一行，两行居中；移除顶部来源名称导航；左侧分类、右侧阅读控制；卡片 / 紧凑列表；有图 / 无图切换并记住选择，无图模式不渲染文章图片
- 「列表 / 卡片」旁提供「展开 / 收起」切换，一键控制当前分类的全部来源区块；在「全部」中控制所有未忽略来源。混合状态点击展开，其他分类和忽略来源的折叠状态不受影响；沿用浏览器折叠偏好保存。来源内「显示全部」仍单独控制文章数量。
- 默认优先显示中文译文；工具栏始终提供「中文翻译 / 原文」切换并记住选择。中文模式仅显示译文标题，悬停可看原文；没有译文时回退原文，不显示覆盖率提示。未配置站点服务且未启用个人接口时不请求翻译。
- 每个来源默认展示一排等高图文卡片及次排渐隐预览，可展开全部文章；按钮随中文 / 原文切换语言
- 来源官网域名链接、原文跳转、真实讨论入口；「全部」页在来源域名后弱化显示所属分类，分类页不重复显示
- 桌面与移动端自适应，键盘操作，减少动态效果偏好

### 排序与忽略

- 分类标签整体点击切换、拖动排序；鼠标移动 8px 后拖动，触屏长按 350ms 后拖动，Alt + 左右方向键调整。「全部」固定第一，【忽略】固定最后。
- 来源标题右侧的手柄上下拖动排序，也可通过「··· → 上移 / 下移」操作。聚焦手柄后支持上下方向键。
- 通过「··· → 加入忽略」隐藏来源；也可把来源手柄拖到【忽略】。操作后提供 8 秒撤销。
- 在【忽略】中点击「恢复」回到原分类与保存的位置。不删除订阅；后台采集和标题翻译不会因此暂停。
- 分类顺序、来源顺序和忽略列表保存于当前浏览器的 `signal:organization:v1`；没有账号或跨设备同步，清理站点数据会丢失。
- 来源排序在「全部」和各分类共用；在某分类中调整只交换该分类可见来源的槽位，不改变其他分类或被忽略来源的相对位置。
- 新增来源自动追加到既有顺序之后；无效 / 过期保存项会过滤。浏览器禁止本地保存时提示刷新可能丢失。

```sh
npm test
npm run check
```

测试覆盖 RSS / Atom / JSON / 官方新闻页面解析、URL 安全、去重、直连与代理回退、真实超时、错误脱敏、最多 4 路并发、独立刷新、缓存降级、翻译缓存、分类固定首尾、局部排序、忽略恢复与保存格式兼容、个人直连请求策略、清除中止 / 丢弃迟到结果、站点译文优先、浏览器完整配置持久化 / 恢复 / 清除、存储禁用与无效存储降级。

## 结构

- `src/App.tsx`、`src/styles.css`：自有聚合页面与独立 ASCII 衍生层
- `src/buzzing-base.css`：逐字提取的源站 CSS，禁止手改
- `public/baseline/index.html`、`reference/buzzing/`：原样学习基线与只读取证
- `tests/baseline.test.mjs`：独立文档字节 / CSS 校验
- `shared/sources.json`：前后端共享来源目录
- `src/organization.ts`、`src/DragHandle.tsx`、`src/SourceTools.tsx`：本地排序、拖动与来源操作
- `server/sources.mjs`：RSS / Atom / JSON / 官方新闻页面适配
- `server/feed-network.mjs`：HTTP(S) 代理连接与安全错误分类
- `server/feed-service.mjs`：限并发刷新调度与缓存降级
- `src/TranslationSettings.tsx`、`src/personal-translation.ts`：个人翻译设置与内存直连队列
- `src/personal-preferences.ts`：用户浏览器配置保存、校验与清除
- `server/translation.mjs`：站点公共翻译适配
- `server/index.mjs`：本地 Node API、磁盘缓存及生产静态服务
- `worker/index.mjs`、`worker/store.mjs`：Workers API、后台同步、共享存储与翻译额度
- `wrangler.jsonc`：云端静态资源、SQLite Durable Object 与 Cron 配置

不抓取文章全文、不绕过付费墙。文章与标题版权归原作者所有；公开部署前需核对各数据源使用条款、署名及适用要求。

分类标签为单一操作区域：点击切换；桌面移动超过 8px 拖动排序；手机长按 350ms 后拖动，长按前滑动仍滚动页面。Alt + 左右方向键排序，Escape 取消；「全部」固定最前、「忽略」固定最后。来源仍可拖入「忽略」，排序与忽略保持浏览器本地保存。

V2EX 使用官方 `https://www.v2ex.com/api/topics/hot.json` 热榜，保留官方顺序和回复数；每轮替换当前榜单，不用最新帖子补齐数量。仍按共享同步周期更新，直连失败后尝试已配置代理，失败保留上次热榜缓存。

### NodeSeek 热榜

保留数字生活分类下的一个 NodeSeek 来源，在来源标题旁通过 `[实时] [日榜] [周榜]` 切换，默认日榜。选择保存在当前浏览器的 `nav:nodeseek-ranking`，不改变其他读者；切换不触发浏览器直连或来源折叠。每榜最多展示前 24 条，保持第三方顺序，文章直达 NodeSeek，不用旧 RSS 补位，不将第三方评分当作点赞。

榜单由 bimg.eu.org 提供，非 NodeSeek 官方榜单。后端统一同步三个公开 JSON，按实时 1 分钟、日榜 5 分钟、周榜 60 分钟调度；其他来源仍为原来的 10 分钟周期。`server/nodeseek-rankings.mjs` 按榜单合并并发请求，单独写入 `.cache/nodeseek-rankings.json`；来源即使被某位读者忽略，后台仍正常更新。

状态以接口 `updated_at` 为依据，而不是 HTTP 请求成功时间。实时超过 10 分钟、日榜超过 30 分钟、周榜超过 3 小时视为缓存；失败保留对应榜单，较旧的上游响应不覆盖较新缓存。三个榜单互不冒充，旧 RSS 缓存不迁移为热榜；直连失败仍可使用后端已配置的代理。第三方停服或采集覆盖范围变化无法由本站保证。
