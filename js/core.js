/* ==========================================================================
   core.js · 浏览器端通用逻辑
   --------------------------------------------------------------------------
   只做「与具体页面无关」的事情：数据加载、主题切换、站名/页脚填充、
   系统识别、滚动动画、URL 状态、轻提示。
   首页逻辑在 js/main.js，详情页逻辑在 js/app-page.js。
   ========================================================================== */

import { debounce } from './shared.js';

/** 站点根目录前缀。支持部署在子目录（例如 GitHub Pages 的 /你的仓库名/）。 */
export function siteRoot() {
  const path = decodeURIComponent(window.location.pathname || '/');
  const idx = path.lastIndexOf('/apps/');
  if (idx !== -1) return path.slice(0, idx + 1); // /repo/apps/7zip/ → /repo/
  return path.replace(/[^/]*$/, ''); // /repo/index.html → /repo/
}

export const ROOT = siteRoot();

/* --------------------------------------------------------------------------
   数据加载
   优先使用 data/apps.generated.js（构建时生成，一次请求，最快）；
   没有构建过时自动回退到 fetch data/apps.json，所以不跑构建也能用。
   -------------------------------------------------------------------------- */
export async function loadData() {
  if (window.SITE_DATA) return normalize(window.SITE_DATA);
  const base = ROOT;
  const [siteRes, catsRes, appsRes] = await Promise.all([
    fetch(`${base}data/site.json`, { cache: 'no-cache' }),
    fetch(`${base}data/categories.json`, { cache: 'no-cache' }),
    fetch(`${base}data/apps.json`, { cache: 'no-cache' }),
  ]);
  if (!appsRes.ok) throw new Error(`读取 data/apps.json 失败（HTTP ${appsRes.status}）`);
  const [site, categories, apps] = await Promise.all([
    siteRes.ok ? siteRes.json() : {},
    catsRes.ok ? catsRes.json() : { all: { slug: 'all', name: '全部' }, items: [] },
    appsRes.json(),
  ]);
  return normalize({ site, categories, apps });
}

function normalize(raw = {}) {
  const site = raw.site || {};
  let categories = raw.categories || {};
  if (Array.isArray(categories)) categories = { items: categories };
  const items = Array.isArray(categories.items) ? categories.items : [];
  const all = categories.all || { slug: 'all', name: '全部' };
  const appsRaw = Array.isArray(raw.apps) ? raw.apps : Array.isArray(raw) ? raw : [];
  const apps = appsRaw
    .filter((app) => app && app.id && app.name && !app.hidden)
    .map((app) => ({ ...app, downloads: app.downloads || [], platforms: app.platforms || [], tags: app.tags || [] }));
  return { site, categories: { all, items }, apps };
}

/* --------------------------------------------------------------------------
   主题（浅色 / 深色）
   -------------------------------------------------------------------------- */
const THEME_KEY = 'resource-site-theme';

export function currentTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncThemeMeta() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', dark ? '#080b12' : '#f4f6fb');
  });
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.innerHTML = document.documentElement.dataset.theme === 'dark'
      ? '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>'
      : '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>';
    btn.setAttribute('aria-label', document.documentElement.dataset.theme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
    btn.setAttribute('title', btn.getAttribute('aria-label'));
  });
}

export function initThemeToggle() {
  syncThemeMeta();
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
      syncThemeMeta();
    });
  });
  // 用户没手动选过时，跟随系统变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem(THEME_KEY)) {
      document.documentElement.dataset.theme = currentTheme();
      syncThemeMeta();
    }
  });
}

/** 把 data/site.json 里的主题色写到 CSS 变量上 */
export function applySiteTheme(site = {}) {
  const theme = site.theme || {};
  if (theme.accent) document.documentElement.style.setProperty('--accent', theme.accent);
  if (theme.accent2) document.documentElement.style.setProperty('--accent-2', theme.accent2);
}

/* --------------------------------------------------------------------------
   站点信息填充：Logo、站名、页脚、联系方式
   页面上写死的是默认文案，这里用 data/site.json 覆盖，保证「改 JSON 就生效」。
   -------------------------------------------------------------------------- */
export function initSiteChrome(site = {}) {
  const setText = (key, value) => {
    if (!value) return;
    document.querySelectorAll(`[data-site="${key}"]`).forEach((el) => {
      el.textContent = value;
    });
  };
  const setLink = (key, href, { hideWhenEmpty = true } = {}) => {
    document.querySelectorAll(`[data-site="${key}"]`).forEach((el) => {
      if (href) {
        el.setAttribute('href', href);
        el.hidden = false;
        el.style.removeProperty('display');
      } else if (hideWhenEmpty) {
        el.hidden = true;
        el.style.display = 'none';
      }
    });
  };
  setText('name', site.name);
  setText('nameCn', site.nameCn);
  setText('tagline', site.tagline);
  setText('description', site.description);
  setText('author', site.author);
  setText('note', site.footerNote);
  setText('year', String(new Date().getFullYear()));
  setLink('github', site.github);
  setLink('email', site.email ? `mailto:${site.email}` : '');
  // 注意：Logo 图片路径由每个页面自己写死（详情页在子目录里，前缀不同），
  // 想换 Logo 直接替换 assets/images/logo.svg 这个文件即可。

  if (site.description) {
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', site.description);
  }
}

/* --------------------------------------------------------------------------
   识别访客系统，用于「推荐适合你的安装包」
   -------------------------------------------------------------------------- */
export function detectPlatform() {
  const ua = navigator.userAgent || '';
  const nav = navigator.userAgentData;
  const probe = `${nav?.platform || ''} ${ua}`;
  if (/Android/i.test(probe)) return 'Android';
  if (/iPhone|iPad|iPod|iOS/i.test(probe)) return 'iOS';
  if (/Windows/i.test(probe)) return 'Windows';
  if (/Mac OS X|Macintosh|macOS/i.test(probe)) return 'macOS';
  if (/CrOS/i.test(probe)) return 'Linux';
  if (/Linux|X11|Ubuntu/i.test(probe)) return 'Linux';
  return '';
}

/* --------------------------------------------------------------------------
   轻提示
   -------------------------------------------------------------------------- */
let toastTimer = null;
export function toast(message, ms = 2200) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.dataset.visible = 'false';
  }, ms);
}

/* --------------------------------------------------------------------------
   滚动出现动画（只做一次，性能友好）
   -------------------------------------------------------------------------- */
export function initReveal(scope = document) {
  const nodes = scope.querySelectorAll('.reveal:not(.is-in)');
  if (!nodes.length) return;
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    nodes.forEach((n) => n.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -40px 0px', threshold: 0.05 }
  );
  nodes.forEach((n) => io.observe(n));

  // 兜底：极少数浏览器 / 内嵌 WebView 里 IntersectionObserver 可能一直不回调，
  // 那样卡片会停留在 opacity:0，看起来就是「一片空白」。1.2 秒后强制显示。
  setTimeout(() => nodes.forEach((n) => n.classList.add('is-in')), 1200);
}

/* --------------------------------------------------------------------------
   回到顶部按钮
   -------------------------------------------------------------------------- */
export function initToTop() {
  const btn = document.querySelector('[data-to-top]');
  if (!btn) return;
  const onScroll = debounce(() => {
    btn.dataset.visible = window.scrollY > 600 ? 'true' : 'false';
  }, 80);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* --------------------------------------------------------------------------
   手机端菜单
   -------------------------------------------------------------------------- */
export function initMenu() {
  const btn = document.querySelector('[data-menu-toggle]');
  const panel = document.querySelector('[data-menu-panel]');
  if (!btn || !panel) return;
  const close = () => {
    panel.dataset.open = 'false';
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => {
    const open = panel.dataset.open === 'true';
    panel.dataset.open = open ? 'false' : 'true';
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
  panel.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') close();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 860) close();
  });
}

/* --------------------------------------------------------------------------
   URL 状态：?q=搜索词&c=分类&sort=排序   —— 方便把筛选结果分享给别人
   -------------------------------------------------------------------------- */
export function readUrlState(defaults = {}) {
  const params = new URLSearchParams(window.location.search);
  const state = { ...defaults };
  ['q', 'c', 'sort', 'view'].forEach((key) => {
    const value = params.get(key);
    if (value) state[key] = value;
  });
  return state;
}

export function writeUrlState(state = {}) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.c && state.c !== 'all') params.set('c', state.c);
  if (state.sort && state.sort !== 'default') params.set('sort', state.sort);
  if (state.view && state.view !== 'grid') params.set('view', state.view);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  try {
    window.history.replaceState(null, '', url);
  } catch {
    // 直接双击打开（file://）时，部分浏览器不允许修改地址栏，忽略即可：
    // 搜索 / 筛选本身照常工作，只是筛选条件不会同步到地址里。
  }
}

/* --------------------------------------------------------------------------
   键盘快捷键：/ 或 Ctrl/Cmd + K 聚焦搜索框，Esc 清空
   -------------------------------------------------------------------------- */
export function initKeyboardShortcuts(searchInput) {
  if (!searchInput) return;
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if (e.key === 'Escape' && document.activeElement === searchInput && searchInput.value) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
      searchInput.blur();
    }
  });
}

/** 简单的本地存储读写（带异常保护，隐私模式下也不会崩） */
export const store = {
  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 忽略：隐私模式下无法写入 */
    }
  },
};
