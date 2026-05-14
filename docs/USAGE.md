# 37° Nav 使用手册与二次开发指南

## 日常使用

### 添加站点

方式一：点击“新增站点”，填写标题、URL、描述、标签和分类。

方式二：在“自然语言添加站点”中输入：

```text
添加 https://squoosh.app 在线图片压缩工具，放到工具分类。
```

Worker 会调用 Workers AI，自动生成标题、描述、分类、标签、图标和优先级，然后写入 D1，并把站点语义向量写入 Vectorize。

### 搜索站点

普通搜索：

- 支持标题、URL、描述、标签、首字母、轻量模糊匹配。
- 排序综合 Pinned、访问次数和优先级。

语义搜索：

- 输入自然语言，例如“找能在线压缩图片的工具”。
- 点击“语义搜索”。
- Worker 用 Workers AI 生成 embedding，再从 Vectorize 召回语义相近站点。

### 拖拽排序

在导航卡片区域拖动站点卡片，系统会更新 `sort_order`。排序写入 D1，多端刷新后保持一致。

### 健康巡检

点击“巡检”可手动触发。生产环境中 `wrangler.toml` 已配置：

```toml
[triggers]
crons = ["*/30 * * * *"]
```

Worker 每 30 分钟批量检查站点，将明细写入 D1，将聚合快照写入 KV。

### 备份与恢复

点击“导出备份”下载 JSON。点击“导入备份”上传 JSON，Worker 会恢复分类和站点，并异步重建 Vectorize 向量。

## 极客扩展

### 新增 Widget

1. 在 `schema.sql` 的 `widgets` 表中复用 `type` 和 `config_json`。
2. 调用 `POST /api/widgets` 写入组件配置。
3. 在 `public/app.js` 的 `renderWidgets()` 中按 `type` 渲染 UI。
4. 如组件需要边缘数据聚合，在 `src/index.ts` 增加 API 路由。

适合扩展：

- RSS 聚合：Worker 拉取 RSS，KV 短缓存。
- GitHub 动态：Worker 调 GitHub API，KV 短缓存。
- 天气：Worker 调公开天气数据源，前端只读 Worker 结果。
- Cloudflare 服务状态：当前已提供 `/api/cf-status`。

### 扩展 AI 工具

当前 AI 能力集中在：

- `aiAddSite()`: 自然语言入库。
- `aiOrganize()`: 分类整理建议。
- `embed()`: 文本嵌入。

推荐原则：

- 自动写库前必须保守。
- 批量整理先生成建议，再由用户确认。
- Prompt 要求 JSON 输出，避免前端解析 Markdown。

### 扩展搜索

搜索入口在 `searchSites()`：

1. D1 LIKE 负责极速关键词召回。
2. `rankLexical()` 做个人化排序。
3. `semantic=1` 时叠加 Vectorize 语义召回。

如果你想增强中文拼音：

- 可以在 AI 入库时把全拼写入 `tags_text`。
- 可以在 `PINYIN_INITIALS` 中加入高频词。
- 可以增加一个 `keywords` 字段并纳入 `search_text`。

### 扩展 Edge Proxy

代理入口是 `POST /api/proxy`。它只允许调用 D1 `api_rules` 中预先登记的 `base_url`，并校验 `allowed_methods`。

新增规则示例：

```bash
curl -X POST "$API/api/rules" \
  -H "content-type: application/json" \
  -d '{
    "name": "GitHub API",
    "base_url": "https://api.github.com",
    "allowed_methods": "GET"
  }'
```

调用代理：

```bash
curl -X POST "$API/api/proxy" \
  -H "content-type: application/json" \
  -d '{
    "ruleId": "<rule-id>",
    "path": "/repos/cloudflare/workers-sdk",
    "method": "GET"
  }'
```

不要改成任意 URL 代理。那样会让 Worker 变成公共跳板，既不优雅，也不安全。

## 推荐工程化习惯

- 所有结构化变更先写 `schema.sql`。
- 所有运行时绑定只放 `wrangler.toml`。
- 前端配置只改 `public/config.js`。
- 生产鉴权优先用 Cloudflare Access，不自研密码系统。
- 任何 AI 批处理都先输出建议，不直接覆盖用户数据。

