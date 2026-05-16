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
    name: `${cat.icon || ""} ${cat.name}`.trim(),
    count: counts[cat.id] || 0
  }))];

  const categoryListEl = $("#categoryList");
  if (!categoryListEl) return;

  categoryListEl.innerHTML = rows.map((cat) => `
    <div class="category ${state.selectedCategory === cat.id ? "active" : ""}" 
         data-cat="${cat.id}" 
         ${isAdminPage && cat.id !== 'all' ? `draggable="true" data-cat-drag="${cat.id}"` : ''}>
      <span>${escapeHtml(cat.name)}</span>
      <div class="cat-right">
        ${isAdminPage && cat.id !== 'all' ? `
          <div class="cat-actions">
            <button type="button" class="edit-cat" data-id="${cat.id}" title="编辑">✎</button>
            <button type="button" class="delete-cat" data-id="${cat.id}" title="删除">×</button>
          </div>
        ` : ''}
        <span>${cat.count}</span>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".category").forEach((btn) => {
    btn.onclick = (e) => {
      if (e.target.closest('.cat-actions')) return; // 点操作按钮时不切换分类
      state.selectedCategory = btn.dataset.cat;
      renderSites(state.sites);
      renderCategories();
    };
  });

  if (isAdminPage) {
    document.querySelectorAll(".edit-cat").forEach(btn => {
      btn.onclick = () => openCategoryDialog(state.categories.find(c => c.id === btn.dataset.id));
    });
    document.querySelectorAll(".delete-cat").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("确定删除此分类吗？该分类下的站点将被标记为未分类。")) return;
        await api(`/api/categories/${btn.dataset.id}`, { method: "DELETE" });
        await refresh();
      };
    });
    wireCategoryDragSort(); // 激活拖拽排序
  }
}

// 新增分类拖拽排序功能
function wireCategoryDragSort() {
  let sourceId = null;
  document.querySelectorAll(".category[data-cat-drag]").forEach((item) => {
    item.ondragstart = () => { sourceId = item.dataset.catDrag; };
    item.ondragover = (e) => e.preventDefault();
    item.ondrop = async () => {
      if (!sourceId || sourceId === item.dataset.catDrag) return;
      const ids = [...document.querySelectorAll(".category[data-cat-drag]")].map((n) => n.dataset.catDrag);
      const from = ids.indexOf(sourceId);
      const to = ids.indexOf(item.dataset.catDrag);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      await Promise.all(ids.map((id, index) => api(`/api/categories/${id}`, {
        method: "PUT", body: JSON.stringify({ sort_order: index * 10 })
      })));
      await refresh();
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
    
  // 【自动提取网址的域名】
    let domain = "";
    try { domain = new URL(site.url).hostname; } catch(e) {}
    
    // 【图标生成逻辑升级：支持强制覆盖】
    let iconContent = "";
    if (site.icon && site.icon.startsWith("http")) {
      // 优先级 1：如果你在图标框里填了具体的网络图片链接，直接强制使用！
      iconContent = `<img src="${escapeAttr(site.icon)}" alt="logo" style="width: 100%; height: 100%; border-radius: 8px; object-fit: contain;">`;
    } else if (domain) {
      // 优先级 2：自动调用 Google API 抓取域名图标
      iconContent = `<img src="https://s2.googleusercontent.com/s2/favicons?domain=${domain}&sz=128" alt="logo" style="width: 100%; height: 100%; border-radius: 8px; object-fit: contain;" onerror="this.outerHTML='<span>${site.icon || '🧭'}</span>'">`;
    } else {
      // 优先级 3：如果都没有，兜底显示 Emoji
      iconContent = `<span>${site.icon || "🧭"}</span>`;
    }

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

let editingCategory = null;

function openCategoryDialog(cat = null) {
  if (!isAdminPage) return;
  editingCategory = cat;
  const form = $("#categoryDialog form");
  $("#catDialogTitle").textContent = cat ? "编辑分类" : "新建分类";
  form.name.value = cat?.name || "";
  form.icon.value = cat?.icon || "";
  form.slug.value = cat?.slug || "";
  $("#categoryDialog").showModal();
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
  form.icon.value = site?.icon || "";
  $("#aiParseInput").value = ""; // 每次打开清空AI框

  // 删除按钮逻辑
  const delBtn = $("#deleteSiteBtn");
  if (site) {
    delBtn.style.display = "block";
    delBtn.onclick = async () => {
      if (!confirm(`警告：确定要永久删除 [ ${site.title} ] 吗？`)) return;
      await api(`/api/sites/${site.id}`, { method: "DELETE" });
      $("#siteDialog").close();
      await refresh();
    };
  } else {
    delBtn.style.display = "none";
  }

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
  // 绑定分类相关的弹窗按钮
  const addCatBtn = $("#addCatBtn");
  if (addCatBtn) addCatBtn.onclick = () => openCategoryDialog();
  const cancelCatBtn = $("#cancelCatBtn");
  if (cancelCatBtn) cancelCatBtn.onclick = () => $("#categoryDialog").close();

  const catForm = $("#categoryDialog form");
  if (catForm) {
    catForm.onsubmit = async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      const path = editingCategory ? `/api/categories/${editingCategory.id}` : "/api/categories";
      const method = editingCategory ? "PUT" : "POST";
      await api(path, { method, body: JSON.stringify(payload) });
      $("#categoryDialog").close();
      await refresh();
    };
  }

  // 绑定 AI 智能填表按钮
  const aiParseBtn = $("#aiParseBtn");
  if (aiParseBtn) {
    aiParseBtn.onclick = async () => {
      const prompt = $("#aiParseInput").value.trim();
      if (!prompt) return alert("请在输入框内粘贴网址或介绍文字");

      const originalText = aiParseBtn.textContent;
      aiParseBtn.textContent = "AI 解析中...";
      aiParseBtn.disabled = true;

      try {
        const result = await api("/api/ai/parse", { method: "POST", body: JSON.stringify({ prompt }) });
        const p = result.parsed || {};
        const form = $("#siteDialog form");

        if (p.title) form.title.value = p.title;
        if (p.url) form.url.value = p.url;
        if (p.description) form.description.value = p.description;
        if (p.icon) form.icon.value = p.icon;
        if (p.tags && Array.isArray(p.tags)) form.tags_text.value = p.tags.join(", ");
        if (p.category_slug) {
          const cat = state.categories.find(c => c.slug === p.category_slug);
          if (cat) form.category_id.value = cat.id;
        }
      } catch (e) {
        console.error(e);
        alert("AI 识别失败，请检查网址是否可达或稍后再试");
      } finally {
        aiParseBtn.textContent = originalText;
        aiParseBtn.disabled = false;
      }
    };
  }
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