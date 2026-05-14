# 37° Nav 架构设计文档

## 设计原则

37° Nav 的核心信条是 Cloudflare 原生 Serverless：无服务器、无容器、无自建数据库、无第三方 CDN、无第三方 AI。系统把“个人导航”拆成静态体验、边缘业务、结构化存储、高频缓存、语义索引和 AI 推理六层，每一层都由 Cloudflare 产品承担。

## 产品职责边界

```text
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│  - 原生 HTML/CSS/JS                                         │
│  - 无框架、无统计、无广告                                   │
└───────────────┬───────────────────────────────┬─────────────┘
                │                               │
                ▼                               ▼
┌─────────────────────────────┐   ┌───────────────────────────┐
│ Cloudflare Pages            │   │ Cloudflare Workers         │
│  - public 静态资源托管      │   │  - /api/* 路由             │
│  - 全球边缘分发             │   │  - Access Header 鉴权      │
│  - 首屏极轻量               │   │  - Cron scheduled 巡检     │
└─────────────────────────────┘   │  - AI / Proxy / Import     │
                                  └───────┬──────┬──────┬─────┘
                                          │      │      │
                        ┌─────────────────┘      │      └────────────────┐
                        ▼                        ▼                       ▼
                ┌──────────────┐        ┌────────────────┐       ┌──────────────┐
                │ Cloudflare D1│        │ Cloudflare KV  │       │ Workers AI   │
                │ 结构化主库   │        │ 偏好与快照缓存 │       │ NLP/Embedding│
                └──────┬───────┘        └────────────────┘       └──────┬───────┘
                       │                                                 │
                       ▼                                                 ▼
                ┌────────────────────────────────────────────────────────────┐
                │ Cloudflare Vectorize                                      │
                │ site:{id} -> 384 维站点语义向量，用于自然语言搜索与推荐  │
                └────────────────────────────────────────────────────────────┘
```

## 数据流

1. 浏览器从 Pages 加载静态控制台。
2. 前端读取 `public/config.js` 的 `apiBase`，调用 Worker `/api/bootstrap`。
3. Worker 并行读取 D1 分类/站点/Widget/Todo、KV 偏好和健康快照。
4. 用户新增站点时，Worker 写入 D1，并异步调用 Workers AI 生成 embedding 后写入 Vectorize。
5. 用户搜索时，Worker 先做 D1 模糊检索；若开启语义搜索，再调用 Workers AI 生成查询向量，并从 Vectorize 召回相似站点。
6. Cron Trigger 定时执行 `scheduled()`，Worker 批量巡检站点可用性，结果写 D1 明细与 KV 聚合快照。
7. 导入/导出均通过 Worker 操作 D1/KV，保证数据完全掌握在用户自己的 Cloudflare 账号内。

## 存储模型

D1 是主数据源：

- `categories`: 无限层级分类。
- `sites`: 导航站点元数据、排序、健康状态、搜索文本。
- `tags` / `site_tags`: 标签体系预留。
- `visits`: 访问记录与频次排序依据。
- `widgets`: 仪表盘组件配置。
- `todos`: 极简待办。
- `api_rules`: 边缘代理白名单规则。

KV 是读多写少缓存：

- `prefs:global`: 用户主题、密度、Slogan 等偏好。
- `health:snapshot`: 巡检聚合快照。
- `shortcuts:global`: 快捷命令面板预留。
- `cache:site:{siteId}`: 站点详情短缓存预留。
- `cf:status`: Cloudflare 状态短缓存。

Vectorize 存储语义向量：

- Index: `37-nav-sites`
- Dimensions: `384`
- Metric: `cosine`
- ID: `site:{siteId}`
- Metadata: `{ kind: "site", siteId }`

## 鉴权模型

默认 `AUTH_MODE = "none"` 便于首次部署。生产推荐 Cloudflare Zero Trust Access：

1. Access 在 Cloudflare 边缘完成登录、身份校验和策略执行。
2. Worker 只读取 `Cf-Access-Authenticated-User-Email`。
3. 如配置 `ADMIN_EMAILS`，Worker 再做邮箱白名单判断。

这样避免自研密码、Session、OAuth 回调和用户表，降低维护面。

## 故障与维护边界

- Pages/Workers/D1/KV/Vectorize/AI 都是 Cloudflare 托管能力，用户无需维护服务器。
- Cron 巡检是渐进式批量检查，避免一次性请求过多站点。
- AI 分类整理只返回建议，不直接批量重写数据，避免不可逆破坏。
- Edge Proxy 必须先写入 `api_rules`，不开放任意 URL，避免公共代理风险。

