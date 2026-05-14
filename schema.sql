PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT DEFAULT 'folder',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_parent_sort ON categories(parent_id, sort_order);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  tags_text TEXT DEFAULT '',
  priority INTEGER DEFAULT 3,
  sort_order INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  access_count INTEGER DEFAULT 0,
  health_status TEXT DEFAULT 'unknown',
  last_checked TEXT,
  latency_ms INTEGER,
  fail_reason TEXT,
  search_text TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sites_category_sort ON sites(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sites_access_priority ON sites(access_count DESC, priority DESC);
CREATE INDEX IF NOT EXISTS idx_sites_health ON sites(health_status, last_checked);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#7dd3fc',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_tags (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (site_id, tag_id)
);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  visited_at TEXT NOT NULL,
  referrer TEXT DEFAULT '',
  user_agent TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_visits_site_time ON visits(site_id, visited_at DESC);

CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  config_json TEXT DEFAULT '{}',
  x INTEGER DEFAULT 0,
  y INTEGER DEFAULT 0,
  w INTEGER DEFAULT 4,
  h INTEGER DEFAULT 2,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  allowed_methods TEXT DEFAULT 'GET,POST',
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO categories (id, parent_id, name, slug, icon, sort_order, created_at, updated_at)
VALUES
  ('cat-tools', NULL, '工具', 'tools', 'terminal', 10, datetime('now'), datetime('now')),
  ('cat-cloudflare', NULL, 'Cloudflare', 'cloudflare', 'edge', 20, datetime('now'), datetime('now')),
  ('cat-reading', NULL, '阅读', 'reading', 'rss', 30, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO sites (
  id, category_id, title, url, description, icon, tags_text, priority, sort_order, pinned,
  health_status, search_text, created_at, updated_at
) VALUES
  (
    'site-cloudflare-dashboard', 'cat-cloudflare', 'Cloudflare Dashboard',
    'https://dash.cloudflare.com/', 'Cloudflare 控制台入口', '☁️',
    'cloudflare,edge,workers,pages,d1,kv', 5, 10, 1, 'unknown',
    'cloudflare dashboard 控制台 edge workers pages d1 kv cf cfdashboard',
    datetime('now'), datetime('now')
  ),
  (
    'site-workers-docs', 'cat-cloudflare', 'Workers Docs',
    'https://developers.cloudflare.com/workers/', 'Cloudflare Workers 官方文档', '⚙',
    'cloudflare,workers,docs,serverless', 4, 20, 0, 'unknown',
    'workers docs cloudflare serverless edge 文档 wd',
    datetime('now'), datetime('now')
  );
