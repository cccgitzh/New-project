# 37° Nav

37° Nav - 你的恒温个人数字入口，边缘原生，零维护永在线。

这是一个 100% Cloudflare 原生的个人导航控制台：Cloudflare Pages 托管前端，Cloudflare Workers 承载 API、AI、代理与定时任务，Cloudflare D1 存结构化数据，Cloudflare KV 存高频偏好与快照，Cloudflare Vectorize 存站点语义向量，Workers AI 负责自然语言入库、语义搜索与智能整理。

更完整的架构说明见 `docs/ARCHITECTURE.md`，使用与扩展手册见 `docs/USAGE.md`。

## 架构设计

```text
Browser
  │
  ├─ Cloudflare Pages: public/index.html, style.css, app.js
  │     └─ 纯静态、全球边缘分发、无第三方统计、无前端框架
  │
  └─ Cloudflare Workers: src/index.ts
        ├─ API Router: /api/sites /api/search /api/export /api/proxy ...
        ├─ Access Guard: 可选 Cloudflare Zero Trust Access Header 校验
        ├─ Cron Trigger: scheduled() 定时巡检站点健康
        ├─ Workers AI: 文本嵌入、自然语言站点入库、智能分类建议
        ├─ D1: 分类、站点、标签、访问记录、Widget、Todo、代理规则
        ├─ KV: 偏好、主题、健康快照、快捷命令、短缓存
        └─ Vectorize: site:{id} 站点语义向量，用于自然语言搜索
```

职责边界：

- Pages 只做静态资源托管，负责首屏速度与响应式 UI。
- Workers 是唯一业务逻辑层，负责鉴权、路由、数据处理、Cron、AI 与 API 反向代理。
- D1 保存强结构化、可查询、可导入导出的核心数据。
- KV 保存读多写少的偏好、健康快照和短生命周期缓存。
- Vectorize 保存站点描述、标签、功能属性的嵌入向量。
- Workers AI 只调用 Cloudflare 原生模型，不调用第三方 AI。

## 项目结构

```text
37-nav/
  public/
    config.js          # 前端 API 地址配置
    index.html         # 纯 HTML 控制台
    style.css          # 极客深色控制台样式
    app.js             # 原生 JS 交互
  src/
    index.ts           # Workers API、Cron、D1/KV/Vectorize/AI 逻辑
  .github/workflows/
    deploy.yml         # GitHub Actions 自动部署
  schema.sql           # D1 建表与初始化数据
  wrangler.toml        # Worker、KV、D1、Vectorize、AI、Cron 绑定
  wrangler.pages.toml  # Pages 前端项目配置
  package.json
  tsconfig.json
  .gitignore
```

## 功能

- 无限层级分类、站点 CRUD、拖拽排序、自定义图标、标签、备注、优先级。
- 导入/导出完整 JSON 备份，数据完全在你的 Cloudflare 账号内。
- Workers Cron 定时站点健康巡检，KV 保存健康快照。
- 拼音首字母、模糊匹配、访问频率和优先级加权的快速搜索。
- Workers AI + Vectorize 语义搜索，例如“找能在线压缩图片的工具”。
- 自然语言添加站点，AI 自动提取标题、分类、标签、图标和优先级。
- 模块化 Widget 基础：健康快照、待办、快捷命令，可继续扩展天气、RSS、GitHub 动态。
- Edge API Proxy：通过 D1 中的 `api_rules` 限定目标与方法，Workers 边缘转发。
- 可选 Cloudflare Zero Trust Access 免密鉴权。

## 保姆级部署指南

### 1. 准备 Cloudflare 账号与本地环境

1. 注册或登录 Cloudflare。
2. 安装 Node.js 22+。
3. 安装依赖并登录 Wrangler。

```bash
npm install
npx wrangler login
```

### 2. 创建 Cloudflare 资源

创建 KV：

```bash
npx wrangler kv namespace create NAV_KV
npx wrangler kv namespace create NAV_KV --preview
```

创建 D1：

```bash
npx wrangler d1 create 37-nav-db
```

创建 Vectorize 索引。`@cf/baai/bge-small-en-v1.5` 输出 384 维向量：

```bash
npx wrangler vectorize create 37-nav-sites --dimensions=384 --metric=cosine
```

把命令输出的 KV `id`、`preview_id`、D1 `database_id` 填入 `wrangler.toml`。

### 3. 初始化数据库

```bash
npx wrangler d1 execute 37-nav-db --remote --file=./schema.sql
```

本地开发可使用：

```bash
npm run db:apply:local
npm run dev
```

### 4. 部署 Worker API

```bash
npm run deploy:worker
```

部署后你会得到类似：

```text
https://37-nav-api.<your-subdomain>.workers.dev
```

把这个地址写入 `public/config.js`：

```js
window.__NAV_CONFIG__ = {
  apiBase: "https://37-nav-api.<your-subdomain>.workers.dev"
};
```

如果你用 Cloudflare 路由把 Pages 的 `/api/*` 反代到 Worker，也可以保持 `apiBase: ""`。

### 5. 部署 Pages 前端

```bash
npx wrangler pages project create 37-nav --production-branch main
npm run deploy:pages
```

打开 Pages URL 即可使用。

## GitHub 托管与自动部署

初始化仓库并推送公开 GitHub 仓库：

```bash
git init
git add .
git commit -m "Initial 37 Nav"
git branch -M main
git remote add origin https://github.com/<your-name>/37-nav.git
git push -u origin main
```

在 GitHub 仓库 `Settings -> Secrets and variables -> Actions` 添加：

- `CLOUDFLARE_API_TOKEN`: 需要 Workers Scripts Edit、D1 Edit、Pages Edit、Vectorize Edit 权限。
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Account ID。

之后每次推送 `main`，`.github/workflows/deploy.yml` 会自动执行：

```text
npm ci -> typecheck -> D1 schema -> deploy Worker -> deploy Pages
```

## 安全与鉴权

默认 `AUTH_MODE = "none"`，适合个人内网或初次部署体验。

推荐生产环境使用 Cloudflare Zero Trust Access：

1. 在 Zero Trust 创建 Access Application，保护 Worker 或你的自定义域名。
2. 设置允许的邮箱或 GitHub 身份。
3. 修改 `wrangler.toml`：

```toml
[vars]
AUTH_MODE = "access"
ADMIN_EMAILS = "you@example.com"
CORS_ORIGIN = "https://37-nav.pages.dev"
```

Worker 会读取 `Cf-Access-Authenticated-User-Email`，只允许白名单邮箱访问 API。身份系统仍完全由 Cloudflare 原生能力托管。

## API 快速参考

- `GET /api/bootstrap`: 获取偏好、分类、站点、Widget、Todo、健康快照。
- `POST /api/sites`: 新增站点。
- `PUT /api/sites/:id`: 更新站点。
- `DELETE /api/sites/:id`: 删除站点。
- `POST /api/sites/:id/visit`: 记录访问。
- `GET /api/search?q=keyword`: 模糊搜索。
- `GET /api/search?q=keyword&semantic=1`: Workers AI + Vectorize 语义搜索。
- `POST /api/ai/add-site`: 自然语言添加站点。
- `POST /api/ai/organize`: 生成智能分类整理建议。
- `POST /api/health-check/run`: 手动触发巡检。
- `GET /api/export`: 全量备份。
- `POST /api/import`: 全量恢复。
- `POST /api/proxy`: 按 D1 `api_rules` 执行边缘代理。

## KV 存储结构

- `prefs:global`: 主题、密度、口号、默认布局。
- `health:snapshot`: Cron 生成的站点健康聚合。
- `shortcuts:global`: 快捷命令面板数据。
- `cache:site:{siteId}`: 站点详情短缓存预留。
- `cf:status`: Cloudflare 状态短缓存，默认 120 秒。

## Vectorize 说明

索引名称：`37-nav-sites`

向量维度：384

写入格式：

```ts
await env.NAV_VECTOR.upsert([
  {
    id: `site:${id}`,
    values: embedding,
    metadata: { kind: "site", siteId: id }
  }
]);
```

查询逻辑：

1. Workers AI 使用 `@cf/baai/bge-small-en-v1.5` 生成查询向量。
2. Vectorize 取 TopK 语义相近站点。
3. D1 按 ID 取回完整站点数据。
4. 与 D1 模糊搜索结果去重合并，兼顾语义与高频使用。

## Workers AI Prompt 设计

自然语言添加站点采用严格 JSON Prompt：

```text
你是 37° Nav 的边缘导航整理助手。
只输出 JSON，不要 Markdown。
字段: title,url,description,category_slug,tags,icon,priority。
priority 为 1-5，tags 是短标签数组，icon 用一个简洁 emoji 或空字符串。
优先复用已有分类 slug。
```

分类整理采用建议型 Prompt，不直接改库，避免 AI 自动破坏个人信息架构。

## 二次开发指南

新增 Widget：

1. 在 D1 `widgets` 写入 `type` 和 `config_json`。
2. 在 `public/app.js` 的 `renderWidgets()` 添加渲染分支。
3. 如需边缘数据处理，在 `src/index.ts` 增加 `/api/widgets/<type>` 路由。

新增外部 API 代理：

1. 调用 `POST /api/rules` 创建规则，限定 `base_url` 与 `allowed_methods`。
2. 前端或脚本调用 `POST /api/proxy`，传入 `ruleId`、`path`、`method`。
3. 不建议开放任意 URL 代理，避免成为公共跳板。

增强搜索：

- 在 `normalizeSite()` 中追加更多业务字段到 `search_text`。
- 在 `scoreSite()` 中调整访问频率、Pinned、优先级的权重。
- 中文全拼可通过 AI 入库时把拼音关键词写入 `tags_text` 或描述字段。

备份策略：

- D1 是主数据源，`/api/export` 可随时导出全量 JSON。
- KV 仅保存偏好与快照，丢失也不会影响导航主数据。
- GitHub 保存代码与 schema，Cloudflare 保存运行时数据，权责清晰。

## 零维护原则

- 无服务器、无容器、无自建数据库。
- 无第三方 CDN、无第三方 AI、无广告、无统计上报。
- 定时巡检交给 Workers Cron。
- 全球分发交给 Pages 与 Workers Runtime。
- 数据全部在你自己的 Cloudflare 账号中。
