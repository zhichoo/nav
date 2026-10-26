# Nav

按来源阅读的文章聚合站，汇集 AI、开发、VPS、科技、产品与互联网生活资讯。

**在线访问：[nav.zhichoo.com](https://nav.zhichoo.com)**

## 功能

- 27 个独立公开来源，后台定时更新，标题直达原文。
- 默认中文译文，可切换原文；支持配置个人翻译接口，无需登录。
- 卡片 / 列表、有图 / 无图、来源批量展开 / 收起。
- 分类与来源拖动排序、忽略与恢复，偏好保存在浏览器。
- 多引擎搜索、V2EX 热议、NodeSeek 实时 / 日榜 / 周榜。
- 适配桌面和手机，支持 Node.js 或 Cloudflare Workers 部署。

## 本地运行

Node.js 22.16+，推荐 24。

```sh
npm ci
npm run dev
```

访问 http://127.0.0.1:5186 。生产运行：`npm run build && npm start`，默认端口 4318。

## 配置与部署

- 来源：编辑 `shared/sources.json`，前后端共享配置。
- 站点翻译：Node 模式参考 `.env.example`；Workers 模式使用 Secret，详见 [部署文档](DEPLOY.md)。支持 OpenAI 兼容接口和 DeepLX，调用可能产生费用。
- 个人翻译：在页面 `[设置]` 中配置；接口与密钥保存在本机浏览器，直连需支持 CORS，请使用独立、低额度的密钥。
- 检查：`npm run check`；Cloudflare 部署预检：`npm run cf:check`。
- Cloudflare 部署步骤、域名与额度说明：[DEPLOY.md](DEPLOY.md)。

## 说明

布局参考 [Buzzing](https://www.buzzing.cc/)，为独立非官方项目，不使用其数据接口。内容来自公开 RSS / API / 新闻页面，仅聚合标题与链接，不抓取付费全文；版权归原作者，来源可能限流或失效。

[第三方声明](THIRD_PARTY_NOTICES.md) · [安全说明](SECURITY.md)
