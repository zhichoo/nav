# Cloudflare Workers 部署

已提供可构建的 Workers 适配，尚未部署到 Cloudflare。GitHub 仓库按用户要求公开；保留 noindex。公开代码不代表已经上线，也不代表第三方内容获得重新授权。

## 架构

- React / Vite 产物由 Workers Static Assets 托管，`/api/*` 交给 Worker。
- 一个固定名称的 SQLite Durable Object 保存公共订阅与译文，所有读者共享；不依赖本地文件或某个进程一直存活。部署迁移会自动创建对象，不用手动创建 KV / D1。
- Cron 每分钟调用内部同步入口；普通来源每 10 分钟、NodeSeek 实时 / 日榜 / 周榜分别每 1 / 5 / 60 分钟更新。各来源的检查时间持久化，冷启动不会重置限频。最多 4 路采集，失败保留该来源自己的缓存。
- 读者只读取缓存，没有公开的强制刷新或翻译接口。忽略列表、排序、图片与语言偏好仍各自保存在浏览器，不影响后台更新。
- 站点翻译由服务端 Secret 配置；个人接口依旧由浏览器直接访问，不经 Workers 转发，Key 只保存在读者自己的浏览器。
- Workers 只直接连接订阅源，不使用本机 `127.0.0.1` 代理。`FEED_PROXY_URL` 仅对原 Node 后端有效；云端受限的来源保持缓存 / 故障状态，不绕过验证。

## 本地检查

要求 Node.js 22.16+，推荐 Node 24。

```sh
npm ci
npm run check
npm run cf:check
npm run cf:dev
```

`cf:check` 编译前端并运行 Wrangler dry-run，不上传、不部署。`cf:dev` 默认使用本机 8787 端口，测试定时任务入口只存在于本地模拟器。

Wrangler 本地开发会读取 `.dev.vars`；不存在时也可能读取 `.env`。需要隔离时，复制 `.dev.vars.example` 为 `.dev.vars`，仅填测试凭据。公开仓库不包含任何真实凭据。普通 API GET 不触发采集 / 翻译；本地手动触发下面的测试路由会采集所有来源，并在配置服务凭据后消耗翻译额度：

```sh
curl 'http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*'
```

本地不会自动运行 Cron，需手动调用测试路由。线上由 Cron 自动触发，不开放此手动同步功能。

## 首次上线

1. 登录你的 Cloudflare 账号：`npx wrangler login`。
2. 确认 `wrangler.jsonc` 中 Worker 名称和翻译配置。默认使用 OpenAI-compatible 协议、腾讯 TokenHub 地址、`hy-mt2-pro` 模型和编号格式；不会提交或自动复制本机 `.env` 中的 Key。
3. 部署：`npm run cf:deploy`。首次创建 SQLite Durable Object。无 Secret 时正常提供原文，不调用站点翻译。
4. 在 Cloudflare 控制台为 Worker 添加 Secret `TRANSLATION_API_KEY`，或运行：

```sh
npx wrangler secret put TRANSLATION_API_KEY
```

Key 通过交互输入，不写入 `wrangler.jsonc`、GitHub、浏览器代码或 shell 命令参数。不要把 API Key 填入 `VITE_*` 环境变量。

如使用 DeepLX，在配置中将 `TRANSLATION_PROVIDER` 改为 `deeplx`，使用 Secret `DEEPLX_URL` 保存完整接口地址（可能含令牌）；无需模型名。不自动在供应商之间回退。更换配置后重新部署，已有译文缓存保留。

首次 Cron 配置传播可能需要几分钟（Cloudflare 提示最长约 15 分钟）；首次采集和翻译也需要时间。刚部署短暂出现空列表不等于 RSS 失效。通过 `/api/health` 的 `lastSyncAt` 与各来源状态检查后台是否已经运行。此健康检查公开但不输出凭据。

## 自定义二级域名

默认部署会提供 `<worker>.<account>.workers.dev`，不要求先准备域名。要使用自己的二级域名：Cloudflare 控制台 → Workers & Pages → Nav → Settings → Domains & Routes → Add → Custom Domain，例如 `nav.example.com`。通常需要该主域名在同一 Cloudflare 账号中托管 DNS，由 Cloudflare 创建记录和证书，不需要购买 VPS。

也可在 `wrangler.jsonc` 中显式设置：

```json
"routes": [{ "pattern": "nav.example.com", "custom_domain": true }]
```

将示例替换成自己的域名；不要照抄示例部署。若不需要同时开放 workers.dev，再设置 `workers_dev: false`。

## GitHub 自动部署

已提交 GitHub Actions 检查流程，不自动部署。最简单的持续部署方式是在 Cloudflare 的 Workers & Pages 中导入 GitHub 的 `zhichoo/nav`：

- 安装命令：`npm ci`（或平台默认依赖安装）。
- Build command：`npm run build`。
- Deploy command：`npx wrangler deploy`。
- Root directory：仓库根目录；Node 版本选 24。
- 站点翻译 Key 添加到 Worker 的运行时 Secrets，不要放进仓库或构建变量中的 `VITE_*`。

Cloudflare 导入页的 Worker 名称要与 `wrangler.jsonc` 的 `name` 一致。域名、账号和运行时 Secrets 仍由你在 Cloudflare 中配置。

## 翻译预算和运行边界

- Workers 默认每分钟最多处理 16 个缺失标题，每 UTC 日最多尝试 1000 个；调整 `TRANSLATION_BATCH_SIZE`（最大 24）和 `TRANSLATION_DAILY_LIMIT`（最大 10000）。这只是标题尝试次数上限，不是人民币 / Token 的精确计费上限，仍应在服务商设置消费限额。
- 请求前持久化预留额度，即使失败也计入，以避免重启 / 错误循环超额；尊重供应商 `Retry-After`。成功译文独立持久化，最多保留最近 5000 条，超出后淘汰最早项。
- 三个 NodeSeek 榜单都参与翻译，按原文标题去重。日额度耗尽 / 服务异常时保留已有译文，其余显示原文；读者可自行配置个人接口。
- SQLite Durable Objects 支持 Free 计划，但 Workers / 对象请求量、运行时长、存储读写和翻译服务各有额度，不能承诺多人使用完全免费。正式上线后观察实际 Cloudflare 用量和源站可达性。
- 本地 `.cache` 不自动导入云端；首次上线重新采集和生成译文。清理或更换 Durable Object 名称会得到另一份缓存；不要随意重命名对象、类或删迁移。
- 保留页面及响应的 noindex；这不是访问控制。公开部署仍可直接访问。移除 noindex 是另一项发布决定。

## 公开内容范围

`.env*`（示例除外）、`.dev.vars*`（示例除外）、缓存、依赖、构建产物、原站完整参考快照不上传 GitHub。Vite 生产构建仅复制显式允许的静态资产，Workers 上传规则额外排除 `/baseline/**`。本机基线文件不删除、不修改；全量对照测试仅在有私有参考文件的机器执行，公开仓库会明确跳过那两项，仍校验基线 CSS 哈希。

关于页保留 Buzzing 学习来源及独立非官方说明。`src/buzzing-base.css` 是已有学习提取的 CSS，未确认单独的再分发许可，不将其冒充为自有代码或统一 MIT 授权。其他文章、图片及服务标识归各自权利人；仅聚合公开标题和原文链接，不抓付费全文。详见 `THIRD_PARTY_NOTICES.md`。

## 官方参考

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
