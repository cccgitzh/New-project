const config = window.__NAV_CONFIG__ || {};
const apiBase = (config.apiBase || "").replace(/\/$/, "");
const isAdminPage = window.location.pathname.includes('admin');

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
  if (!el) return;
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
  if (isAdminPage) fillCategorySelect();
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
  
  const categoryListEl = $("#categoryList");
  if (!categoryListEl) return;
  
  categoryListEl.innerHTML = rows.map((cat) => `
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

  const sitesGridEl = $("#sitesGrid");
  if (!sitesGridEl) return;

  sitesGridEl.innerHTML = filtered.map((site) => {
    const healthClass = site.health_status === "ok" ? "health-ok" : site.health_status === "down" ? "health-bad" : "";
    const tags = (site.tags_text || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    
    // 【新增魔法】自动提取网址的域名
    let domain = "";
    try { domain = new URL(site.url).hostname; } catch(e) {}
    
    // 【新增魔法】调用 Google API 获取 128px 高清 LOGO。
    // 如果网站太小众没抓到，onerror 会自动触发，让它退化回原先的 Emoji
    const iconContent = domain 
        ? `<img src="https://s2.googleusercontent.com/s2/favicons?domain=${domain}&sz=128" alt="logo" style="width: 100%; height: 100%; border-radius: 8px; object-fit: contain;" onerror="this.outerHTML='<span>${site.icon || '🧭'}</span>'">`
        : `<span>${site.icon || "🧭"}</span>`;

    return `
      <article class="site-card" draggable="${isAdminPage ? 'true' : 'false'}" data-site="${site.id}">
        <div class="site-top">
          <div class="site-icon-box" style="padding: 4px; background: rgba(0, 0, 0, 0.6);">
            ${iconContent}
          </div>
          <div class="site-info">
            <a href="${escapeAttr(site.url)}" target="_blank" rel="noreferrer" data-visit="${site.id}">
              ${escapeHtml(site.title)}
            </a>
            <div class="site-desc">${escapeHtml(site.description || "暂无描述")}</div>
          </div>
          <div>
            ${isAdminPage ? `<button class="edit-btn" data-edit="${site.id}" title="编辑">✎</button>` : '<span class="arrow-icon">↗</span>'}
          </div>
        </div>
        <div class="site-bottom">
          <div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
          <div class="meta">
            <span class="${healthClass}">●</span> ${site.access_count || 0} 次访问
          </div>
        </div>
      </article>
    `;
  }).join("") || `<p class="tagline">这里还没有站点。让 AI 先帮你塞一枚小火种。</p>`;

  document.querySelectorAll("[data-visit]").forEach((link) => {
    link.addEventListener("click", () => api(`/api/sites/${link.dataset.visit}/visit`, { method: "POST" }).catch(console.error));
  });
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.onclick = () => openSiteDialog(state.sites.find((site) => site.id === btn.dataset.edit));
  });
  if (isAdminPage) {
    wireDragSort();
  }
}

function renderWidgets() {
  const health = state.health || {};
  const widgetListEl = $("#widgetList");
  if (!widgetListEl) return;
  
  widgetListEl.innerHTML = `
    <section class="widget">
      <strong>健康快照</strong>
      <p class="tagline">OK ${health.ok || 0} · Down ${health.down || 0} · Unknown ${health.unknown || 0}</p>
    </section>
    <section class="widget">
      <strong>待办清单</strong>
      <div id="todoList">${state.todos.map((todo) => `
        <label class="todo-row">
          <input type="checkbox" data-todo="${todo.id}" ${todo.done ? "checked" : ""} ${isAdminPage ? "" : "disabled"} />
          <span>${escapeHtml(todo.title)}</span>
        </label>
      `).join("") || `<p class="tagline">今天很清爽，没有待办。</p>`}</div>
    </section>
    <section class="widget">
      <strong>快捷命令</strong>
      <p class="tagline">wrangler deploy --config wrangler.toml</p>
    </section>
  `;
  if (isAdminPage) {
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
}

function fillCategorySelect() {
  const select = $("#siteDialog select[name='category_id']");
  if (!select) return;
  select.innerHTML = `<option value="">未分类</option>` + state.categories
    .map((cat) => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`)
    .join("");
}

function openSiteDialog(site = null) {
  if (!isAdminPage) return;
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

const searchInput = $("#searchInput");
if (searchInput) {
  searchInput.addEventListener("input", debounce(async (event) => {
    const q = event.target.value.trim();
    if (!q) return renderSites(state.sites);
    const result = await api(`/api/search?q=${encodeURIComponent(q)}`);
    renderSites(result.sites);
  }, 160));
}

const semanticBtn = $("#semanticBtn");
if (semanticBtn) {
  semanticBtn.onclick = async () => {
    const q = $("#searchInput").value.trim();
    if (!q) return;
    setStatus("Workers AI 检索中");
    const result = await api(`/api/search?q=${encodeURIComponent(q)}&semantic=1`);
    renderSites(result.sites);
    setStatus("语义搜索完成");
  };
}

if (isAdminPage) {
  const newSiteBtn = $("#newSiteBtn");
  if (newSiteBtn) newSiteBtn.onclick = () => openSiteDialog();
  
  const cancelSiteBtn = $("#cancelSiteBtn");
  if (cancelSiteBtn) cancelSiteBtn.onclick = () => $("#siteDialog").close();
  
  const siteDialogForm = $("#siteDialog form");
  if (siteDialogForm) {
    siteDialogForm.onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      const path = state.editingSite ? `/api/sites/${state.editingSite.id}` : "/api/sites";
      const method = state.editingSite ? "PUT" : "POST";
      await api(path, { method, body: JSON.stringify(payload) });
      $("#siteDialog").close();
      await refresh();
    };
  }

  const aiAddBtn = $("#aiAddBtn");
  if (aiAddBtn) {
    aiAddBtn.onclick = async () => {
      const prompt = $("#aiInput").value.trim();
      if (!prompt) return;
      setStatus("AI 正在整理站点");
      await api("/api/ai/add-site", { method: "POST", body: JSON.stringify({ prompt }) });
      $("#aiInput").value = "";
      await refresh();
      setStatus("AI 入库完成");
    };
  }

  const healthBtn = $("#healthBtn");
  if (healthBtn) {
    healthBtn.onclick = async () => {
      setStatus("巡检中");
      await api("/api/health-check/run", { method: "POST" });
      await refresh();
      setStatus("巡检完成");
    };
  }

  const addTodoBtn = $("#addTodoBtn");
  if (addTodoBtn) {
    addTodoBtn.onclick = async () => {
      const title = prompt("新增待办");
      if (!title) return;
      await api("/api/todos", { method: "POST", body: JSON.stringify({ title }) });
      await refresh();
    };
  }

  const exportBtn = $("#exportBtn");
  if (exportBtn) {
    exportBtn.onclick = async () => {
      const data = await api("/api/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `37-nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  const importFile = $("#importFile");
  if (importFile) {
    importFile.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const data = JSON.parse(await file.text());
      await api("/api/import", { method: "POST", body: JSON.stringify(data) });
      await refresh();
    };
  }
}

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