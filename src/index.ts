export interface Env {
  NAV_KV: KVNamespace;
  NAV_DB: D1Database;
  NAV_VECTOR: VectorizeIndex;
  AI: any;
  AUTH_MODE?: string;
  ADMIN_EMAILS?: string;
  CORS_ORIGIN?: string;
  HEALTH_CHECK_BATCH_SIZE?: string;
}

// ================= 类型定义区域（彻底消灭 GitHub 报错）=================
type Json = Record<string, unknown> | unknown[];

interface SitePayload {
  id?: string;
  category_id?: string | null;
  title?: string;
  url?: string;
  description?: string;
  icon?: string;
  tags_text?: string;
  priority?: number;
  sort_order?: number;
  pinned?: number;
}

interface CategoryPayload {
  id?: string;
  parent_id?: string | null;
  name?: string;
  slug?: string;
  icon?: string;
  sort_order?: number;
}

interface TodoPayload {
  title?: string;
  done?: number;
  sort_order?: number;
}

const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
const CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runHealthCheck(env));
  }
};

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const corsHeaders = cors(env);

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (url.pathname === "/healthz") return json({ ok: true, edge: request.cf?.colo || "dev" }, corsHeaders);

  try {
    await assertAccess(request, env);
    const response = await route(request, env, ctx, url);
    corsHeaders.forEach((value, key) => response.headers.set(key, value));
    return response;
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, corsHeaders, status);
  }
}

async function route(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/api/bootstrap" && method === "GET") return getBootstrap(env);
  if (path === "/api/preferences" && method === "GET") return json(await getPrefs(env));
  if (path === "/api/preferences" && method === "PUT") return putPrefs(request, env);
  if (path === "/api/categories" && method === "GET") return listCategories(env);
  if (path === "/api/categories" && method === "POST") return createCategory(request, env);
  if (path.startsWith("/api/categories/") && method === "PUT") return updateCategory(request, env, idFrom(path));
  if (path.startsWith("/api/categories/") && method === "DELETE") return deleteRow(env, "categories", idFrom(path));
  if (path === "/api/sites" && method === "GET") return listSites(env);
  if (path === "/api/sites" && method === "POST") return createSite(request, env, ctx);
  if (path.match(/^\/api\/sites\/[^/]+\/visit$/) && method === "POST") return recordVisit(request, env, path.split("/")[3]);
  if (path.startsWith("/api/sites/") && method === "GET") return getSite(env, idFrom(path));
  if (path.startsWith("/api/sites/") && method === "PUT") return updateSite(request, env, ctx, idFrom(path));
  if (path.startsWith("/api/sites/") && method === "DELETE") return deleteSite(env, idFrom(path));
  if (path === "/api/search" && method === "GET") return searchSites(env, url);
  if (path === "/api/ai/add-site" && method === "POST") return aiAddSite(request, env, ctx);
  if (path === "/api/ai/organize" && method === "POST") return aiOrganize(env);
  if (path === "/api/ai/parse" && method === "POST") return aiParse(request, env);
  if (path === "/api/widgets" && method === "GET") return listWidgets(env);
  if (path === "/api/widgets" && method === "POST") return createWidget(request, env);
  if (path === "/api/todos" && method === "GET") return listTodos(env);
  if (path === "/api/todos" && method === "POST") return createTodo(request, env);
  if (path.startsWith("/api/todos/") && method === "PUT") return updateTodo(request, env, idFrom(path));
  if (path.startsWith("/api/todos/") && method === "DELETE") return deleteRow(env, "todos", idFrom(path));
  if (path === "/api/rules" && method === "GET") return listRules(env);
  if (path === "/api/rules" && method === "POST") return createRule(request, env);
  if (path === "/api/proxy" && method === "POST") return edgeProxy(request, env);
  if (path === "/api/health-check/run" && method === "POST") return manualHealthCheck(env, ctx);
  if (path === "/api/cf-status" && method === "GET") return cloudflareStatus(env);
  if (path === "/api/export" && method === "GET") return exportData(env);
  if (path === "/api/import" && method === "POST") return importData(request, env, ctx);

  throw new HttpError(404, "Route not found");
}

// ================= 核心业务逻辑 =================

async function getBootstrap(env: Env): Promise<Response> {
  const [prefs, categories, sites, widgets, todos, health] = await Promise.all([
    getPrefs(env),
    all(env, "SELECT * FROM categories ORDER BY parent_id, sort_order, name"),
    all(env, "SELECT * FROM sites ORDER BY pinned DESC, sort_order, priority DESC, title"),
    all(env, "SELECT * FROM widgets WHERE enabled = 1 ORDER BY y, x, created_at"),
    all(env, "SELECT * FROM todos ORDER BY done, sort_order, created_at DESC"),
    env.NAV_KV.get("health:snapshot", "json")
  ]);
  return json({ prefs, categories, sites, widgets, todos, health: health || {} });
}

async function getPrefs(env: Env): Promise<Record<string, unknown>> {
  return (await env.NAV_KV.get("prefs:global", "json")) as Record<string, unknown> || {
    theme: "dark",
    density: "compact",
    slogan: "37° Nav - 你的恒温个人数字入口，边缘原生，零维护永在线。"
  };
}

async function putPrefs(request: Request, env: Env): Promise<Response> {
  const prefs = await readJson<Record<string, unknown>>(request);
  await env.NAV_KV.put("prefs:global", JSON.stringify(prefs));
  return json({ ok: true, prefs });
}

function listCategories(env: Env): Promise<Response> {
  return dbJson(env, "SELECT * FROM categories ORDER BY parent_id, sort_order, name", "categories");
}

async function createCategory(request: Request, env: Env): Promise<Response> {
  const body = await readJson<CategoryPayload>(request);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.NAV_DB.prepare(`
    INSERT INTO categories (id, parent_id, name, slug, icon, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.parent_id || null,
    required(body.name, "name"),
    body.slug || slugify(String(body.name || "")),
    body.icon || "folder",
    Number(body.sort_order || 0),
    now,
    now
  ).run();
  return json({ ok: true, id }, undefined, 201);
}

async function updateCategory(request: Request, env: Env, id: string): Promise<Response> {
  const current = await first<CategoryPayload>(env, "SELECT * FROM categories WHERE id = ?", id);
  if (!current) throw new HttpError(404, "Category not found");
  const body = await readJson<CategoryPayload>(request);
  const updated_at = new Date().toISOString();
  
  await env.NAV_DB.prepare(`
    UPDATE categories SET parent_id = ?, name = ?, slug = ?, icon = ?, sort_order = ?, updated_at = ? WHERE id = ?
  `).bind(
    body.parent_id !== undefined ? body.parent_id : current.parent_id,
    body.name !== undefined ? body.name : current.name,
    body.slug !== undefined ? body.slug : current.slug,
    body.icon !== undefined ? body.icon : current.icon,
    body.sort_order !== undefined ? Number(body.sort_order) : Number(current.sort_order || 0),
    updated_at,
    id
  ).run();
  return json({ ok: true });
}

function listSites(env: Env): Promise<Response> {
  return dbJson(env, "SELECT * FROM sites ORDER BY pinned DESC, sort_order, priority DESC, title", "sites");
}

async function getSite(env: Env, id: string): Promise<Response> {
  const site = await first(env, "SELECT * FROM sites WHERE id = ?", id);
  if (!site) throw new HttpError(404, "Site not found");
  return json({ site });
}

async function createSite(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson<SitePayload>(request);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const site = normalizeSite({ ...(body as any), id, created_at: now, updated_at: now });
  await env.NAV_DB.prepare(`
    INSERT INTO sites (
      id, category_id, title, url, description, icon, tags_text, priority, sort_order, pinned,
      search_text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    site.category_id || null,
    site.title,
    site.url,
    site.description,
    site.icon,
    site.tags_text,
    site.priority,
    site.sort_order,
    site.pinned,
    site.search_text,
    now,
    now
  ).run();
  ctx.waitUntil(upsertSiteVector(env, id, String(site.search_text)));
  return json({ ok: true, id }, undefined, 201);
}

async function updateSite(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const current = await first<SitePayload>(env, "SELECT * FROM sites WHERE id = ?", id);
  if (!current) throw new HttpError(404, "Site not found");
  const body = await readJson<SitePayload>(request);
  const site = normalizeSite({ ...(current as any), ...(body as any), updated_at: new Date().toISOString() });
  await env.NAV_DB.prepare(`
    UPDATE sites SET
      category_id = ?, title = ?, url = ?, description = ?, icon = ?, tags_text = ?,
      priority = ?, sort_order = ?, pinned = ?, search_text = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    site.category_id || null,
    site.title,
    site.url,
    site.description,
    site.icon,
    site.tags_text,
    site.priority,
    site.sort_order,
    site.pinned,
    site.search_text,
    site.updated_at,
    id
  ).run();
  ctx.waitUntil(upsertSiteVector(env, id, String(site.search_text)));
  await env.NAV_KV.delete(`cache:site:${id}`);
  return json({ ok: true });
}

async function deleteSite(env: Env, id: string): Promise<Response> {
  await env.NAV_DB.prepare("DELETE FROM sites WHERE id = ?").bind(id).run();
  await Promise.all([
    env.NAV_KV.delete(`cache:site:${id}`),
    env.NAV_VECTOR.deleteByIds([`site:${id}`]).catch(() => undefined)
  ]);
  return json({ ok: true });
}

async function recordVisit(request: Request, env: Env, siteId: string): Promise<Response> {
  const now = new Date().toISOString();
  await env.NAV_DB.batch([
    env.NAV_DB.prepare(`
      INSERT INTO visits (id, site_id, visited_at, referrer, user_agent) VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), siteId, now, request.headers.get("referer") || "", request.headers.get("user-agent") || ""),
    env.NAV_DB.prepare("UPDATE sites SET access_count = access_count + 1 WHERE id = ?").bind(siteId)
  ]);
  return json({ ok: true });
}

async function searchSites(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return listSites(env);
  const like = `%${q.toLowerCase()}%`;
  const lexical = await all<Record<string, unknown>>(env, `
    SELECT * FROM sites
    WHERE lower(search_text) LIKE ? OR lower(title) LIKE ? OR lower(url) LIKE ?
    ORDER BY pinned DESC, access_count DESC, priority DESC
    LIMIT 40
  `, like, like, like);

  if (url.searchParams.get("semantic") !== "1") return json({ sites: rankLexical(lexical, q) });

  const vectors = await embed(env, q);
  const matches = await env.NAV_VECTOR.query(vectors[0], { topK: 16, returnMetadata: true });
  const ids = matches.matches.map((match) => String(match.id).replace(/^site:/, ""));
  const semantic = ids.length ? await sitesByIds(env, ids) : [];
  const merged = dedupe([...semantic, ...lexical]);
  return json({ sites: merged.slice(0, 40), vectorMatches: matches.matches.length });
}

// ================= AI 增强区域 =================

// 【加强版】智能识别函数
async function aiParse(request: Request, env: Env): Promise<Response> {
  const { prompt } = await readJson<{ prompt: string }>(request);
  
  // 提取网址并尝试抓取
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/);
  const targetUrl = urlMatch ? urlMatch[0] : prompt;
  let webContext = "";
  if (urlMatch) {
    webContext = await fetchUrlMeta(targetUrl);
  }

  const categories = await all<{slug: string}>(env, "SELECT id, name, slug FROM categories ORDER BY sort_order");
  const categorySlugs = categories.map((c) => c.slug).join(", ");

  const ai = await env.AI.run(CHAT_MODEL, {
    messages: [
      {
        role: "system",
        content: `你是高级导航网站整理专家。必须直接输出纯 JSON 对象，绝对不要包含任何 Markdown 代码块标签（如 \`\`\`json ）。不要输出任何废话。
需要生成的 JSON 字段: title(网站名), url(网址), description(网站简介), category_slug(分类标识), tags(3个短标签构成的数组), icon(1个emoji)。

【核心规则】：
1. 语言：所有内容必须被翻译成自然流畅的【中文简体】！描述请简练且专业，不超过 30 个字。
2. 容错：如果“网页抓取数据”为空、或者提示防火墙拦截（如 403, Cloudflare, IPv6, 验证码等），请立刻无视它！直接动用你作为大语言模型的广泛常识库，准确识别该网站（如看到 youtube.com 就知道是全球最大视频网站，看到 x.com 就知道是推特）。
3. 分类：category_slug 必须从以下候选中选择一个最合适的：[${categorySlugs}]。

【完美输出示例】：
{
  "title": "YouTube",
  "url": "https://www.youtube.com/",
  "description": "全球最大的高质量视频分享与流媒体创作者平台。",
  "category_slug": "tools",
  "tags": ["视频", "流媒体", "娱乐"],
  "icon": "▶️"
}`
      },
      { 
        role: "user", 
        // 放弃复杂的 JSON 嵌套，直接用大白话喂给模型，极大降低模型的理解难度
        content: `待解析网址/指令：${prompt}\n\n网页抓取数据：\n${webContext || "（抓取失败，请直接使用你自己的常识库准确识别该网站并生成中文介绍）"}` 
      }
    ]
  });
  return json({ parsed: parseAiJson(ai) });
}

// 【加强版】一键入库函数
async function aiAddSite(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { prompt } = await readJson<{ prompt: string }>(request);
  
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/);
  const fallbackUrl = urlMatch ? urlMatch[0] : prompt;
  let webContext = "";
  if (urlMatch) {
    webContext = await fetchUrlMeta(fallbackUrl);
  }

  const categories = await all<any>(env, "SELECT id, name, slug FROM categories ORDER BY sort_order");
  const categorySlugs = categories.map((c: any) => c.slug).join(", ");

  const ai = await env.AI.run(CHAT_MODEL, {
    messages: [
      {
        role: "system",
        content: `你是高级导航网站整理专家。必须直接输出纯 JSON 对象，绝对不要包含 Markdown 代码块标签。
需要生成的 JSON 字段: title, url, description, category_slug, tags(数组), icon(一个emoji), priority(1-5的数字)。

【核心规则】：
1. 语言：必须输出专业的【中文简体】，描述不超过 30 个字。
2. 容错：若抓取数据为空或报错，立刻无视它，利用你的常识库准确识别该网站（如 youtube.com 是视频平台）。
3. 分类：category_slug 必须从以下候选中选择：[${categorySlugs}]。

【完美输出示例】：
{
  "title": "YouTube",
  "url": "https://www.youtube.com/",
  "description": "全球最大的高质量视频分享与流媒体创作者平台。",
  "category_slug": "tools",
  "tags": ["视频", "流媒体", "娱乐"],
  "icon": "▶️",
  "priority": 5
}`
      },
      { 
        role: "user", 
        content: `待解析指令：${prompt}\n\n网页抓取数据：\n${webContext || "（空。请靠常识识别）"}` 
      }
    ]
  });
  const parsed = parseAiJson(ai);
  
  const category = categories.find((cat: any) => String(cat.slug) === String(parsed.category_slug));
  const fakeRequest = new Request("https://37-nav.local/api/sites", {
    method: "POST",
    body: JSON.stringify({
      title: parsed.title || "未命名站点",
      url: parsed.url || fallbackUrl,
      description: parsed.description || "AI 未能生成描述",
      category_id: category?.id || null,
      tags_text: Array.isArray(parsed.tags) ? parsed.tags.join(",") : "",
      icon: parsed.icon || "🧭",
      priority: Number(parsed.priority || 3)
    })
  });
  return createSite(fakeRequest, env, ctx);
}

async function aiOrganize(env: Env): Promise<Response> {
  const sites = await all(env, "SELECT id, title, url, description, tags_text FROM sites ORDER BY access_count DESC LIMIT 80");
  const categories = await all(env, "SELECT id, name, slug FROM categories ORDER BY sort_order");
  const ai = await env.AI.run(CHAT_MODEL, {
    messages: [
      { role: "system", content: "你是导航信息架构专家。只输出 JSON: {suggestions:[{site_id,category_slug,tags,reason}]}" },
      { role: "user", content: JSON.stringify({ sites, categories }) }
    ]
  });
  return json({ suggestions: parseAiJson(ai).suggestions || [] });
}

// ================= 其他业务逻辑 =================

function listWidgets(env: Env): Promise<Response> {
  return dbJson(env, "SELECT * FROM widgets WHERE enabled = 1 ORDER BY y, x, created_at", "widgets");
}

async function createWidget(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.NAV_DB.prepare(`
    INSERT INTO widgets (id, type, title, config_json, x, y, w, h, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    required(body.type, "type"),
    body.title || body.type,
    JSON.stringify(body.config || {}),
    Number(body.x || 0),
    Number(body.y || 0),
    Number(body.w || 4),
    Number(body.h || 2),
    body.enabled === 0 ? 0 : 1,
    now,
    now
  ).run();
  return json({ ok: true, id }, undefined, 201);
}

function listTodos(env: Env): Promise<Response> {
  return dbJson(env, "SELECT * FROM todos ORDER BY done, sort_order, created_at DESC", "todos");
}

async function createTodo(request: Request, env: Env): Promise<Response> {
  const body = await readJson<TodoPayload>(request);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.NAV_DB.prepare("INSERT INTO todos (id, title, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, required(body.title, "title"), Number(body.sort_order || 0), now, now)
    .run();
  return json({ ok: true, id }, undefined, 201);
}

async function updateTodo(request: Request, env: Env, id: string): Promise<Response> {
  const current = await first<TodoPayload>(env, "SELECT * FROM todos WHERE id = ?", id);
  if (!current) throw new HttpError(404, "Todo not found");
  const body = await readJson<TodoPayload>(request);
  const updated_at = new Date().toISOString();
  
  await env.NAV_DB.prepare("UPDATE todos SET title = ?, done = ?, sort_order = ?, updated_at = ? WHERE id = ?")
    .bind(
      body.title !== undefined ? body.title : current.title,
      body.done !== undefined ? Number(body.done) : Number(current.done || 0),
      body.sort_order !== undefined ? Number(body.sort_order) : Number(current.sort_order || 0),
      updated_at,
      id
    )
    .run();
  return json({ ok: true });
}

function listRules(env: Env): Promise<Response> {
  return dbJson(env, "SELECT * FROM api_rules ORDER BY created_at DESC", "rules");
}

async function createRule(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.NAV_DB.prepare(`
    INSERT INTO api_rules (id, name, base_url, allowed_methods, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    required(body.name, "name"),
    required(body.base_url, "base_url"),
    body.allowed_methods || "GET,POST",
    body.enabled === 0 ? 0 : 1,
    now,
    now
  ).run();
  return json({ ok: true, id }, undefined, 201);
}

async function edgeProxy(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ ruleId: string; path?: string; method?: string; headers?: Record<string, string>; body?: string }>(request);
  const rule = await first<Record<string, unknown>>(env, "SELECT * FROM api_rules WHERE id = ? AND enabled = 1", body.ruleId);
  if (!rule) throw new HttpError(404, "Proxy rule not found");
  const method = (body.method || "GET").toUpperCase();
  const allowed = String(rule.allowed_methods || "GET").split(",").map((item) => item.trim().toUpperCase());
  if (!allowed.includes(method)) throw new HttpError(403, "Method not allowed by rule");
  const target = new URL(body.path || "/", String(rule.base_url));
  return fetch(target, {
    method,
    headers: body.headers || {},
    body: method === "GET" || method === "HEAD" ? undefined : body.body
  });
}

async function manualHealthCheck(env: Env, ctx: ExecutionContext): Promise<Response> {
  ctx.waitUntil(runHealthCheck(env));
  return json({ ok: true, queued: true });
}

async function runHealthCheck(env: Env): Promise<void> {
  const limit = Number(env.HEALTH_CHECK_BATCH_SIZE || 25);
  const sites = await all<Record<string, string>>(env, `
    SELECT id, url FROM sites
    ORDER BY COALESCE(last_checked, ''), sort_order
    LIMIT ?
  `, limit);
  let ok = 0;
  let down = 0;
  let unknown = 0;

  for (const site of sites) {
    const started = Date.now();
    try {
      const res = await fetch(site.url, { method: "HEAD", redirect: "follow", cf: { cacheTtl: 0 } });
      const status = res.ok || res.status < 500 ? "ok" : "down";
      if (status === "ok") ok += 1;
      else down += 1;
      await updateHealth(env, site.id, status, Date.now() - started, `${res.status}`);
    } catch (error) {
      down += 1;
      await updateHealth(env, site.id, "down", Date.now() - started, error instanceof Error ? error.message : "fetch failed");
    }
  }

  const total = await first<{ count: number }>(env, "SELECT COUNT(*) AS count FROM sites");
  unknown = Math.max(0, Number(total?.count || 0) - ok - down);
  await env.NAV_KV.put("health:snapshot", JSON.stringify({
    ok,
    down,
    unknown,
    checked_at: new Date().toISOString()
  }));
}

async function updateHealth(env: Env, id: string, status: string, latency: number, reason: string): Promise<void> {
  await env.NAV_DB.prepare(`
    UPDATE sites SET health_status = ?, latency_ms = ?, fail_reason = ?, last_checked = ? WHERE id = ?
  `).bind(status, latency, reason.slice(0, 180), new Date().toISOString(), id).run();
}

async function cloudflareStatus(env: Env): Promise<Response> {
  const cached = await env.NAV_KV.get("cf:status", "json");
  if (cached) return json(cached as Json);
  const res = await fetch("https://www.cloudflarestatus.com/api/v2/summary.json", {
    headers: { accept: "application/json" }
  });
  const data = await res.json();
  await env.NAV_KV.put("cf:status", JSON.stringify(data), { expirationTtl: 120 });
  return json(data as Json);
}

async function exportData(env: Env): Promise<Response> {
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    prefs: await getPrefs(env),
    categories: await all(env, "SELECT * FROM categories ORDER BY sort_order"),
    sites: await all(env, "SELECT * FROM sites ORDER BY sort_order"),
    widgets: await all(env, "SELECT * FROM widgets ORDER BY y, x"),
    todos: await all(env, "SELECT * FROM todos ORDER BY sort_order"),
    rules: await all(env, "SELECT * FROM api_rules ORDER BY created_at")
  };
  return json(payload);
}

async function importData(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const data = await readJson<Record<string, unknown[] | Record<string, unknown>>>(request);
  if (data.prefs) await env.NAV_KV.put("prefs:global", JSON.stringify(data.prefs));
  const batches: D1PreparedStatement[] = [];
  for (const cat of (data.categories || []) as Record<string, unknown>[]) {
    batches.push(env.NAV_DB.prepare(`
      INSERT OR REPLACE INTO categories (id, parent_id, name, slug, icon, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(cat.id, cat.parent_id || null, cat.name, cat.slug, cat.icon, Number(cat.sort_order || 0), cat.created_at, new Date().toISOString()));
  }
  for (const raw of (data.sites || []) as Record<string, unknown>[]) {
    const site = normalizeSite(raw);
    batches.push(env.NAV_DB.prepare(`
      INSERT OR REPLACE INTO sites (
        id, category_id, title, url, description, icon, tags_text, priority, sort_order, pinned,
        access_count, health_status, last_checked, latency_ms, fail_reason, search_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      site.id,
      site.category_id || null,
      site.title,
      site.url,
      site.description,
      site.icon,
      site.tags_text,
      site.priority,
      site.sort_order,
      site.pinned,
      Number(raw.access_count || 0),
      raw.health_status || "unknown",
      raw.last_checked || null,
      raw.latency_ms || null,
      raw.fail_reason || null,
      site.search_text,
      raw.created_at || new Date().toISOString(),
      new Date().toISOString()
    ));
    ctx.waitUntil(upsertSiteVector(env, String(site.id), String(site.search_text)));
  }
  if (batches.length) await env.NAV_DB.batch(batches);
  return json({ ok: true, imported: batches.length });
}

async function upsertSiteVector(env: Env, id: string, text: string): Promise<void> {
  const vectors = await embed(env, text);
  await env.NAV_VECTOR.upsert([{ id: `site:${id}`, values: vectors[0], metadata: { kind: "site", siteId: id } }]);
}

async function embed(env: Env, text: string): Promise<number[][]> {
  const result = await env.AI.run(EMBEDDING_MODEL, { text: [text.slice(0, 4096)] }) as { data: number[][] };
  if (!result.data?.[0]) throw new HttpError(502, "Embedding failed");
  return result.data;
}

function normalizeSite(input: Record<string, unknown>): Record<string, string | number | null> {
  const url = normalizeUrl(String(required(input.url, "url")));
  const title = String(required(input.title, "title")).trim();
  const description = String(input.description || "");
  const tags = String(input.tags_text || "");
  const icon = String(input.icon || "");
  const priority = Math.max(1, Math.min(5, Number(input.priority || 3)));
  const sort = Number(input.sort_order || 0);
  const pinned = Number(input.pinned || 0);
  const search = buildSearchText([title, url, description, tags, hostOf(url), initials(title), initials(tags)].join(" "));
  return {
    id: String(input.id || crypto.randomUUID()),
    category_id: input.category_id ? String(input.category_id) : null,
    title,
    url,
    description,
    icon,
    tags_text: tags,
    priority,
    sort_order: sort,
    pinned,
    search_text: search,
    updated_at: String(input.updated_at || new Date().toISOString())
  };
}

function rankLexical(sites: Record<string, unknown>[], q: string): Record<string, unknown>[] {
  const needle = q.toLowerCase();
  return sites
    .map((site) => ({ site, score: scoreSite(site, needle) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.site);
}

function scoreSite(site: Record<string, unknown>, needle: string): number {
  const hay = String(site.search_text || "").toLowerCase();
  let score = Number(site.pinned || 0) * 10 + Number(site.priority || 0) + Math.log(Number(site.access_count || 0) + 1);
  if (String(site.title || "").toLowerCase().includes(needle)) score += 20;
  if (hay.includes(needle)) score += 8;
  if (isSubsequence(needle, hay)) score += 3;
  return score;
}

function buildSearchText(text: string): string {
  return text.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

function initials(text: string): string {
  return String(text)
    .split(/[\s,._/-]+/)
    .filter(Boolean)
    .map((part) => PINYIN_INITIALS[part] || part[0])
    .join("")
    .toLowerCase();
}

const PINYIN_INITIALS: Record<string, string> = {
  工具: "gj",
  导航: "dh",
  文档: "wd",
  阅读: "yd",
  设计: "sj",
  图片: "tp",
  压缩: "ys",
  开发: "kf",
  部署: "bs",
  控制台: "kzt",
  监控: "jk",
  搜索: "ss"
};

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) if (char === needle[index]) index += 1;
  return index === needle.length;
}

async function sitesByIds(env: Env, ids: string[]): Promise<Record<string, unknown>[]> {
  const rows = await Promise.all(ids.map((id) => first<Record<string, unknown>>(env, "SELECT * FROM sites WHERE id = ?", id)));
  return rows.filter(Boolean) as Record<string, unknown>[];
}

function dedupe(sites: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set();
  return sites.filter((site) => {
    if (seen.has(site.id)) return false;
    seen.add(site.id);
    return true;
  });
}

async function dbJson(env: Env, query: string, key: string): Promise<Response> {
  return json({ [key]: await all(env, query) });
}

async function all<T = Record<string, unknown>>(env: Env, query: string, ...binds: unknown[]): Promise<T[]> {
  const stmt = env.NAV_DB.prepare(query);
  const res = await (binds.length ? stmt.bind(...binds) : stmt).all<T>();
  return res.results || [];
}

async function first<T = Record<string, unknown>>(env: Env, query: string, ...binds: unknown[]): Promise<T | null> {
  return env.NAV_DB.prepare(query).bind(...binds).first<T>();
}

async function deleteRow(env: Env, table: "categories" | "todos", id: string): Promise<Response> {
  await env.NAV_DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function json(data: Json | Record<string, unknown>, headers = new Headers(), status = 200): Response {
  const out = new Headers(headers);
  out.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: out });
}

function cors(env: Env): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", env.CORS_ORIGIN || "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,cf-access-jwt-assertion");
  headers.set("access-control-max-age", "86400");
  return headers;
}

async function assertAccess(request: Request, env: Env): Promise<void> {
  if ((env.AUTH_MODE || "none") !== "access") return;

  const method = request.method.toUpperCase();
  if (method === "GET" || method === "OPTIONS" || method === "HEAD") return;

  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) throw new HttpError(401, "Cloudflare Access 身份验证失败，请使用管理员邮箱登录");
  const allowed = (env.ADMIN_EMAILS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) throw new HttpError(403, "抱歉，您的邮箱没有管理员权限");
}

function required(value: unknown, name: string): string {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new HttpError(400, `${name} is required`);
  }
  return String(value);
}

function idFrom(path: string): string {
  return decodeURIComponent(path.split("/")[3] || "");
}

function normalizeUrl(value: string): string {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(withProtocol).toString();
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-") || crypto.randomUUID();
}

function parseAiJson(result: unknown): Record<string, any> {
  let content = typeof result === "object" && result && "response" in result
    ? String((result as { response: unknown }).response)
    : typeof result === "object" && result && "choices" in result
      ? String((result as { choices: { message?: { content?: string } }[] }).choices?.[0]?.message?.content || "{}")
      : JSON.stringify(result || {});
  
  content = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}