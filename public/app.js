const config = window.__NAV_CONFIG__ || {};
const apiBase = (config.apiBase || "").replace(/\/$/, "");

const state = {
  categories: [],
  sites: [],
  widgets: [],
  todos: [],
  selectedCategory: "all",
  editingSite: null
};

const $ = (selector) => document.querySelector(selector);
const api = async (path, options = {}) => {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.headers.get("content-type")?.includes("application/json") ? res.json() : res.text();
};

const setStatus = (text, ok = true) => {
  const el = $("#syncStatus");
  el.textContent = text;
  el.style.color = ok ? "var(--ok)" : "var(--bad)";
};

async function boot() {
  try {
    const data = await api("/api/bootstrap");
    Object.assign(state, data);
    render();
    setStatus("边缘已同步");
  } catch (error) {
    console.error(error);
    setStatus("连接 Worker 失败", false);
  }
}

function render() {
  renderCategories();
  renderSites(state.sites);
  renderWidgets();
  fillCategorySelect();
}

function renderCategories() {
  const counts = state.sites.reduce((acc, site) => {
    acc[site.category_id || "none"] = (acc[site.category_id || "none"] || 0) + 1;
    return acc;
  }, {});
  const rows = [{ id: "all", name: "全部", count: state.sites.length }, ...state.categories.map((cat) => ({
    id: cat.id,
    name: `${cat.icon || "·"} ${cat.name}`,
    count: counts[cat.id] || 0
  }))];
  $("#categoryList").innerHTML = rows.map((cat) => `
    <button class="category ${state.selectedCategory === cat.id ? "active" : ""}" data-cat="${cat.id}">
      <span>${cat.name}</span><span>${cat.count}</span>
    </button>
  `).join("");
  document.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.onclick = () => {
      state.selectedCategory = btn.dataset.cat;
      renderSites(state.sites);
      renderCategories();
    };
  });
}

function renderSites(sites) {
  const filtered = state.selectedCategory === "all"
    ? sites
    : sites.filter((site) => site.category_id === state.selectedCategory);

  $("#sitesGrid").innerHTML = filtered.map((site) => {
    const healthClass = site.health_status === "ok" ? "health-ok" : site.health_status === "down" ? "health-bad" : "";
    const tags = (site.tags_text || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    return `
      <article class="site-card" draggable="true" data-site="${site.id}">
        <div class="site-top">
          <a href="${escapeAttr(site.url)}" target="_blank" rel="noreferrer" data-visit="${site.id}">
            ${site.icon || "↗"} ${escapeHtml(site.title)}
          </a>
          <button class="ghost" data-edit="${site.id}" title="编辑">编辑</button>
        </div>
        <p>${escapeHtml(site.description || "无备注")}</p>
        <div class="meta">
          <span class="${healthClass}">● ${site.health_status || "unknown"}</span>
          <span>访问 ${site.access_count || 0}</span>
        </div>
        <div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      </article>
    `;
  }).join("") || `<p class="tagline">这里还没有站点。让 AI 先帮你塞一枚小火种。</p>`;

  document.querySelectorAll("[data-visit]").forEach((link) => {
    link.addEventListener("click", () => api(`/api/sites/${link.dataset.visit}/visit`, { method: "POST" }).catch(console.error));
  });
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.onclick = () => openSiteDialog(state.sites.find((site) => site.id === btn.dataset.edit));
  });
  wireDragSort();
}

function renderWidgets() {
  const health = state.health || {};
  $("#widgetList").innerHTML = `
    <section class="widget">
      <strong>健康快照</strong>
      <p class="tagline">OK ${health.ok || 0} · Down ${health.down || 0} · Unknown ${health.unknown || 0}</p>
    </section>
    <section class="widget">
      <strong>待办清单</strong>
      <div id="todoList">${state.todos.map((todo) => `
        <label class="todo-row">
          <input type="checkbox" data-todo="${todo.id}" ${todo.done ? "checked" : ""} />
          <span>${escapeHtml(todo.title)}</span>
        </label>
      `).join("") || `<p class="tagline">今天很清爽，没有待办。</p>`}</div>
    </section>
    <section class="widget">
      <strong>快捷命令</strong>
      <p class="tagline">wrangler deploy --config wrangler.toml</p>
    </section>
  `;
  document.querySelectorAll("[data-todo]").forEach((box) => {
    box.onchange = async () => {
      await api(`/api/todos/${box.dataset.todo}`, {
        method: "PUT",
        body: JSON.stringify({ done: box.checked ? 1 : 0 })
      });
      await refresh();
    };
  });
}

function fillCategorySelect() {
  const select = $("#siteDialog select[name='category_id']");
  select.innerHTML = `<option value="">未分类</option>` + state.categories
    .map((cat) => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`)
    .join("");
}

function openSiteDialog(site = null) {
  state.editingSite = site;
  const form = $("#siteDialog form");
  $("#dialogTitle").textContent = site ? "编辑站点" : "新增站点";
  form.title.value = site?.title || "";
  form.url.value = site?.url || "";
  form.description.value = site?.description || "";
  form.tags_text.value = site?.tags_text || "";
  form.category_id.value = site?.category_id || "";
  $("#siteDialog").showModal();
}

async function refresh() {
  const data = await api("/api/bootstrap");
  Object.assign(state, data);
  render();
}

function wireDragSort() {
  let sourceId = null;
  document.querySelectorAll(".site-card").forEach((card) => {
    card.ondragstart = () => {
      sourceId = card.dataset.site;
    };
    card.ondragover = (event) => event.preventDefault();
    card.ondrop = async () => {
      if (!sourceId || sourceId === card.dataset.site) return;
      const ids = [...document.querySelectorAll(".site-card")].map((node) => node.dataset.site);
      const from = ids.indexOf(sourceId);
      const to = ids.indexOf(card.dataset.site);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      await Promise.all(ids.map((id, index) => api(`/api/sites/${id}`, {
        method: "PUT",
        body: JSON.stringify({ sort_order: index * 10 })
      })));
      await refresh();
    };
  });
}

$("#searchInput").addEventListener("input", debounce(async (event) => {
  const q = event.target.value.trim();
  if (!q) return renderSites(state.sites);
  const result = await api(`/api/search?q=${encodeURIComponent(q)}`);
  renderSites(result.sites);
}, 160));

$("#semanticBtn").onclick = async () => {
  const q = $("#searchInput").value.trim();
  if (!q) return;
  setStatus("Workers AI 检索中");
  const result = await api(`/api/search?q=${encodeURIComponent(q)}&semantic=1`);
  renderSites(result.sites);
  setStatus("语义搜索完成");
};

$("#newSiteBtn").onclick = () => openSiteDialog();
$("#cancelSiteBtn").onclick = () => $("#siteDialog").close();
$("#siteDialog form").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  const path = state.editingSite ? `/api/sites/${state.editingSite.id}` : "/api/sites";
  const method = state.editingSite ? "PUT" : "POST";
  await api(path, { method, body: JSON.stringify(payload) });
  $("#siteDialog").close();
  await refresh();
};

$("#aiAddBtn").onclick = async () => {
  const prompt = $("#aiInput").value.trim();
  if (!prompt) return;
  setStatus("AI 正在整理站点");
  await api("/api/ai/add-site", { method: "POST", body: JSON.stringify({ prompt }) });
  $("#aiInput").value = "";
  await refresh();
  setStatus("AI 入库完成");
};

$("#healthBtn").onclick = async () => {
  setStatus("巡检中");
  await api("/api/health-check/run", { method: "POST" });
  await refresh();
  setStatus("巡检完成");
};

$("#addTodoBtn").onclick = async () => {
  const title = prompt("新增待办");
  if (!title) return;
  await api("/api/todos", { method: "POST", body: JSON.stringify({ title }) });
  await refresh();
};

$("#exportBtn").onclick = async () => {
  const data = await api("/api/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `37-nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

$("#importFile").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  await api("/api/import", { method: "POST", body: JSON.stringify(data) });
  await refresh();
};

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

boot();
