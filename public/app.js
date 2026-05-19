const config = window.__NAV_CONFIG__ || {};
const apiBase = (config.apiBase || "").replace(/\/$/, "");
const isAdminPage = window.location.pathname.includes("admin");

const state = {
  sites: [],
  categories: [],
  selectedCategory: "all",
  editingSite: null,
};

const $ = (sel) => document.querySelector(sel);

function setStatus(msg, isError = false) {
  const el = $("#syncStatus");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "#ff0055" : "#00ff88";
  el.style.borderColor = isError ? "rgba(255, 0, 85, 0.4)" : "rgba(0, 255, 136, 0.4)";
}

function escapeHtml(unsafe) {
  return (unsafe || "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(unsafe) {
  return (unsafe || "").toString().replace(/"/g, "&quot;");
}

async function api(path, options = {}) {
  setStatus("Syncing...");
  try {
    const res = await fetch(`${apiBase}${path}`, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    setStatus("System OK");
    return data;
  } catch (err) {
    setStatus("Sync Error", true);
    console.error(err);
    throw err;
  }
}

async function refresh() {
  try {
    // 【核心修复】：精准匹配后端的 /api/bootstrap 接口
    const data = await api("/api/bootstrap");
    state.sites = data.sites || [];
    state.categories = data.categories || [];
    
    const catSelect = $("select[name='category_id']");
    if (catSelect) {
      catSelect.innerHTML = `<option value="">未分类</option>` + 
        state.categories.map(c => `<option value="${c.id}">${c.icon || ''} ${escapeHtml(c.name)}</option>`).join("");
    }
    
    renderCategories();
    renderSites(state.sites);
  } catch (e) {
    console.error("加载数据失败", e);
  }
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
    <div class="category ${String(state.selectedCategory) === String(cat.id) ? "active" : ""}" 
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
      if (e.target.closest('.cat-actions')) return; 
      state.selectedCategory = btn.dataset.cat;
      renderSites(state.sites);
      renderCategories();
    };
  });

  if (isAdminPage) {
    document.querySelectorAll(".edit-cat").forEach(btn => {
      btn.onclick = () => openCategoryDialog(state.categories.find(c => String(c.id) === String(btn.dataset.id)));
    });
    document.querySelectorAll(".delete-cat").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("确定删除此分类吗？该分类下的站点将被安全隔离为未分类。")) return;
        await api(`/api/categories/${btn.dataset.id}`, { method: "DELETE" });
        await refresh();
      };
    });
    wireCategoryDragSort();
  }
}

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
    : sites.filter((site) => String(site.category_id) === String(state.selectedCategory));

  const sitesGridEl = $("#sitesGrid");
  if (!sitesGridEl) return;

  sitesGridEl.innerHTML = filtered.map((site) => {
    const healthClass = site.health_status === "ok" ? "health-ok" : site.health_status === "down" ? "health-bad" : "";
    const tags = (site.tags_text || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    
  // 【自动提取网址的域名】
    let domain = "";
    try { domain = new URL(site.url).hostname; } catch(e) {}
    
    // 【新增魔法】：常用大厂网站的“特权图标名单”，专治各种抓取不到的疑难杂症
    const iconOverrides = {
      "mail.google.com": "https://api.iconify.design/logos:google-gmail.svg",
      "gmail.com": "https://api.iconify.design/logos:google-gmail.svg",
      "github.com": "https://api.iconify.design/mdi:github.svg?color=%23ffffff",
      "youtube.com": "https://api.iconify.design/logos:youtube-icon.svg",
      "chatgpt.com": "https://api.iconify.design/logos:openai-icon.svg",
      "x.com": "https://api.iconify.design/ri:twitter-x-fill.svg?color=%23ffffff",
      "twitter.com": "https://api.iconify.design/ri:twitter-x-fill.svg?color=%23ffffff"
    };
    
    let iconContent = "";
    if (site.icon && site.icon.startsWith("http")) {
      // 优先级 1：手动指定的图片
      iconContent = `<img src="${escapeAttr(site.icon)}" alt="logo" style="width: 100%; height: 100%; border-radius: 8px; object-fit: contain;">`;
    } else if (domain) {
      // 优先级 2：检查是否在“特权名单”中
      const overrideIcon = iconOverrides[domain] || iconOverrides[domain.replace("www.", "")];
      if (overrideIcon) {
        iconContent = `<img src="${overrideIcon}" alt="logo" style="width: 100%; height: 100%; border-radius: 8px; object-fit: contain;">`;
      } else {
        // 优先级 3：自动调用 Favicon 抓取
        iconContent = `<img src="https://s2.googleusercontent.com/s2/favicons?domain=${domain}&sz=128" alt="logo" style="width: 100%; height: 100%; border-radius: 8px; object-fit: contain;" onerror="this.outerHTML='<span>${site.icon || '🧭'}</span>'">`;
      }
    } else {
      // 兜底 Emoji
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
  }).join("") || `<p class="tagline" style="margin-top: 20px;">矩阵暂无数据，请等待指挥官入库操作。</p>`;

  document.querySelectorAll("[data-visit]").forEach((link) => {
    link.addEventListener("click", () => {
      api(`/api/sites/${link.dataset.visit}/visit`, { method: "POST" }).catch(()=>{});
    });
  });

  if (isAdminPage) {
    document.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.onclick = () => openSiteDialog(state.sites.find((s) => String(s.id) === String(btn.dataset.edit)));
    });
  }
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
  $("#aiParseInput").value = ""; 
  
  const delBtn = $("#deleteSiteBtn");
  if (site) {
    delBtn.style.display = "block";
    delBtn.onclick = async () => {
      if (!confirm(`警告：确定要永久抹除 [ ${site.title} ] 吗？该操作不可逆！`)) return;
      await api(`/api/sites/${site.id}`, { method: "DELETE" });
      $("#siteDialog").close();
      await refresh();
    };
  } else {
    delBtn.style.display = "none";
  }
  
  $("#siteDialog").showModal();
}

async function init() {
  await refresh();
  
  const searchInput = $("#searchInput");
  const searchBtn = $("#searchBtn") || $("#semanticBtn"); // 兼容访客页和管理页
  if (searchBtn && searchInput) {
    searchBtn.onclick = async () => {
      const q = searchInput.value.trim();
      if (!q) return renderSites(state.sites);
      const res = await api(`/api/search?q=${encodeURIComponent(q)}&semantic=1`);
      renderSites(res.sites || []);
    };
    searchInput.onkeyup = (e) => {
      if (e.key === "Enter") searchBtn.click();
    };
  }

  if (isAdminPage) {
    const addSiteBtn = $("#addSiteBtn"); 
    if (addSiteBtn) addSiteBtn.onclick = () => openSiteDialog();
    const cancelSiteBtn = $("#cancelSiteBtn");
    if (cancelSiteBtn) cancelSiteBtn.onclick = () => $("#siteDialog").close();

    const siteForm = $("#siteDialog form");
    if (siteForm) {
      siteForm.onsubmit = async (e) => {
        e.preventDefault();
        const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
        const path = state.editingSite ? `/api/sites/${state.editingSite.id}` : "/api/sites";
        const method = state.editingSite ? "PUT" : "POST";
        await api(path, { method, body: JSON.stringify(payload) });
        $("#siteDialog").close();
        await refresh();
      };
    }

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

    const healthBtn = $("#healthBtn");
    if (healthBtn) {
      healthBtn.onclick = async () => {
        setStatus("站点健康巡检中...");
        await api("/api/health-check/run", { method: "POST" });
        await refresh();
        setStatus("巡检指令已发送");
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
        setStatus("数据恢复中...");
        const data = JSON.parse(await file.text());
        await api("/api/import", { method: "POST", body: JSON.stringify(data) });
        await refresh();
        setStatus("数据恢复完成");
      };
    }

    const aiParseBtn = $("#aiParseBtn");
    if (aiParseBtn) {
      aiParseBtn.onclick = async () => {
        const prompt = $("#aiParseInput").value.trim();
        if (!prompt) return alert("警告：空指令。请在输入框内粘贴网址或介绍文字。");
        
        const originalText = aiParseBtn.textContent;
        aiParseBtn.textContent = "量子解析中...";
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
          alert("AI 识别链路断开，请检查网址连通性或稍后再试。");
        } finally {
          aiParseBtn.textContent = originalText;
          aiParseBtn.disabled = false;
        }
      };
    }
  }
}

// 【新增】外部搜索引擎跳转逻辑
  document.querySelectorAll(".engine-btn").forEach(btn => {
    btn.onclick = () => {
      const q = $("#searchInput").value.trim();
      if (!q) {
        alert("请先在左侧输入你要搜索的内容！");
        return $("#searchInput").focus();
      }
      
      const engine = btn.dataset.engine;
      const urls = {
        google: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        bing: `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
        github: `https://github.com/search?q=${encodeURIComponent(q)}`
      };
      
      if (urls[engine]) {
        window.open(urls[engine], "_blank");
      }
    };
  });
init();