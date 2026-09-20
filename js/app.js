/* 由 scripts/bundle.mjs 自动生成，请不要直接修改这个文件。
   源码在 js/ 目录下（shared.js → render.js → core.js → 页面脚本），改完源码后运行 npm run build 会重新生成。 */
(function () {
  'use strict';

/* ---------- js/shared.js ---------- */
/* ==========================================================================
   shared.js · 纯函数工具
   --------------------------------------------------------------------------
   这个文件不依赖浏览器环境（不碰 document / window），
   所以浏览器页面和 scripts/build.mjs 都可以直接 import 使用。
   ========================================================================== */

/** HTML 转义：所有来自 JSON 的文本都必须先经过它，避免 XSS。 */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 转义后用于 HTML 属性里的 URL（只允许安全协议）。 */
function safeUrl(url) {
  const raw = String(url == null ? '' : url).trim();
  if (/^\s*javascript:/i.test(raw) || /^\s*data:text\/html/i.test(raw)) return '#';
  return escapeHtml(raw);
}

/** 日期格式化：2026-09-19 → 2026年9月19日 / 2026-09-19 */
function formatDate(iso, style = 'zh') {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return style === 'iso' ? `${y}-${pad(m)}-${pad(day)}` : `${y}年${m}月${day}日`;
}

/** 相对时间：刚刚 / 3 天前 / 2024年5月1日 */
function relativeDate(iso) {
  if (!iso) return '—';
  const then = new Date(`${String(iso).slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(then)) return String(iso);
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days < 0) return formatDate(iso);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return formatDate(iso);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 防抖 */
function debounce(fn, wait = 220) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** 字符串 → 稳定的色相值（0-359），用来给「首字母图标」生成配色 */
function hashHue(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/** 取名称缩写：中文取第一个字，英文取前两个单词首字母 */
function initials(name, fallback = '') {
  const source = String(name || fallback || '').trim();
  if (!source) return '?';
  const cleaned = source.replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const cjk = cleaned.match(/[\u3400-\u9FFF]/);
  if (cjk) return cjk[0];
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

/** 版本号比较（1.10.0 > 1.9.2），返回正数表示 a 更新 */
function compareVersion(a, b) {
  const pa = String(a || '').split(/[.+\-_]/).filter(Boolean);
  const pb = String(b || '').split(/[.+\-_]/).filter(Boolean);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    // 缺少的段按 0 处理（2.5 == 2.5.0），非数字段（beta / rc）直接跳过
    const na = parseInt(pa[i] ?? '0', 10);
    const nb = parseInt(pb[i] ?? '0', 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) continue;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** 判断下载地址是「站内文件」还是「外部链接」 */
function isExternalUrl(url) {
  return /^(https?:)?\/\//i.test(String(url || '')) || /^[a-z][a-z0-9+.-]*:/i.test(String(url || ''));
}

/**
 * 把数据里的下载地址解析成当前页面可用的地址。
 * - https://...            外部链接，原样返回
 * - /downloads/a.exe       以 / 开头 = 站点根目录
 * - downloads/a.exe        相对路径 = 站点根目录
 * root 由调用方传入：浏览器是 location 推导出来的前缀，构建脚本里是 '../../' 之类。
 */
function resolveDownloadUrl(url, root = '') {
  const raw = String(url == null ? '' : url).trim();
  if (!raw) return '#';
  if (isExternalUrl(raw)) return raw;
  if (raw.startsWith('#')) return raw;
  if (raw.startsWith('/')) return `${root}${raw.slice(1)}`;
  return `${root}${raw.replace(/^\.\//, '')}`;
}

/** 单个下载项的名字（用于按钮 title） */
function downloadLabel(item) {
  const parts = [item.platform, item.arch, item.type].filter(Boolean);
  return item.name ? `${item.name}` : parts.join(' · ');
}

/** 平台中文/英文键：用于把下载项按平台分组 */
function platformKey(item) {
  return item.platform || '其他';
}

/**
 * 按平台分组下载项，并把你当前使用的系统排在最前面。
 * 返回：[{ platform, items: [...] }, ...]
 */
function groupDownloads(downloads = [], preferredPlatform = '') {
  const order = [];
  const map = new Map();
  downloads.forEach((item) => {
    const key = platformKey(item);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key).push(item);
  });
  if (preferredPlatform) {
    const idx = order.indexOf(preferredPlatform);
    if (idx > 0) {
      order.splice(idx, 1);
      order.unshift(preferredPlatform);
    }
  }
  return order.map((platform) => ({ platform, items: map.get(platform) }));
}

/** 找出最适合当前设备的下载项（没有就返回第一个） */
function pickBestDownload(downloads = [], platform = '') {
  if (!downloads.length) return null;
  const byPlatform = downloads.filter((d) => !platform || platformKey(d) === platform);
  const pool = byPlatform.length ? byPlatform : downloads;
  const preferredTypes = ['installer', 'apk', 'dmg', 'deb', 'appimage', 'portable', 'archive', 'file'];
  for (const type of preferredTypes) {
    const hit = pool.find((d) => (d.type || '') === type);
    if (hit) return hit;
  }
  return pool[0];
}

/** 搜索用的「可检索文本」，结果缓存在 WeakMap 里避免每次重算 */
const haystackCache = new WeakMap();
function haystack(app) {
  if (haystackCache.has(app)) return haystackCache.get(app);
  const parts = [
    app.id,
    app.name,
    app.tagline,
    app.description,
    app.category,
    app.license,
    (app.platforms || []).join(' '),
    (app.tags || []).join(' '),
    (app.downloads || []).map((d) => `${d.name || ''} ${d.platform || ''} ${d.arch || ''} ${d.type || ''}`).join(' '),
    (app.changelog || []).map((c) => c.version).join(' '),
    (app.history || []).map((h) => h.version).join(' '),
  ];
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  haystackCache.set(app, text);
  return text;
}

/** 搜索匹配：空格分词，所有关键词都要命中 */
function matchQuery(app, query) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return true;
  const text = haystack(app);
  return tokens.every((t) => text.includes(t));
}

/** 分类筛选：slug = all 时全部通过 */
function matchCategory(app, category, allSlug = 'all') {
  if (!category || category.slug === allSlug) return true;
  const name = category.name;
  const platforms = (app.platforms || []).map((p) => p.toLowerCase());
  const tags = (app.tags || []).map((t) => t.toLowerCase());
  return (
    app.category === name ||
    platforms.includes(name.toLowerCase()) ||
    tags.includes(name.toLowerCase()) ||
    category.slug === 'all'
  );
}

/** 排序模式 */
const SORT_MODES = [
  { value: 'default', label: '推荐排序' },
  { value: 'updated', label: '最近更新' },
  { value: 'name', label: '名称' },
  { value: 'version', label: '版本号' },
];

function sortApps(list, mode = 'default') {
  const arr = [...list];
  const byUpdated = (a, b) => String(b.updated || b.releaseDate || '').localeCompare(String(a.updated || a.releaseDate || ''));
  if (mode === 'updated') return arr.sort(byUpdated);
  if (mode === 'name') return arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
  if (mode === 'version') {
    return arr.sort((a, b) => compareVersion(b.version, a.version) || byUpdated(a, b));
  }
  // 推荐排序：featured 优先，其次按更新时间
  return arr.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || byUpdated(a, b));
}

/** 统计所有安装包数量 */
function countPackages(apps = []) {
  return apps.reduce((sum, app) => sum + (app.downloads || []).length, 0);
}

/** 站点最近一次更新时间（取所有软件里最新的） */
function latestUpdate(apps = []) {
  return apps
    .map((a) => a.updated || a.releaseDate || '')
    .filter(Boolean)
    .sort()
    .pop() || '';
}

/** 简易 Markdown 渲染（先转义，再替换，保证安全） */
function renderMarkdown(text) {
  const source = String(text == null ? '' : text);
  if (!source.trim()) return '';
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n');
      // 列表
      if (lines.every((l) => /^\s*[-*]\s+/.test(l) || !l.trim())) {
        const items = lines
          .filter((l) => l.trim())
          .map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      // 引用
      if (lines.every((l) => /^\s*>\s?/.test(l) || !l.trim())) {
        const inner = lines
          .filter((l) => l.trim())
          .map((l) => inline(l.replace(/^\s*>\s?/, '')))
          .join('<br>');
        return `<blockquote><p>${inner}</p></blockquote>`;
      }
      // 标题
      if (/^#{2,4}\s+/.test(block.trim())) {
        const level = block.trim().match(/^#+/)[0].length;
        return `<h${level}>${inline(block.trim().replace(/^#+\s+/, ''))}</h${level}>`;
      }
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    })
    .join('');
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label, url) => {
    return `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return out;
}

/* ---------- js/render.js ---------- */
/* ==========================================================================
   render.js · 用数据生成 HTML 字符串
   --------------------------------------------------------------------------
   纯字符串拼接，不访问 DOM，因此：
     - 浏览器里（js/main.js、js/app-page.js）用它渲染页面
     - Node 里（scripts/build.mjs）用它预渲染静态详情页
   所有用户可见的文本都会先 escapeHtml / renderMarkdown，避免 XSS。
   ========================================================================== */














/* --------------------------------------------------------------------------
   图标（内联 SVG，避免额外请求）
   -------------------------------------------------------------------------- */
const ICONS = {
  download: '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>',
  github:
    '<path fill="currentColor" stroke="none" d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.03 10.03 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z"/>',
  external:
    '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  tag: '<path d="M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a1 1 0 0 1 0 1.4Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  arrowUp: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1 1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1-1"/>',
  shield: '<path d="m12 3 7 3v6c0 4.4-3 8.1-7 9-4-.9-7-4.6-7-9V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
  star: '<path d="m12 4 2.4 5.1 5.6.8-4 3.9.9 5.6-4.9-2.7-4.9 2.7.9-5.6-4-3.9 5.6-.8L12 4Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v5h5"/><path d="M12 8v4.5l3 1.8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  searchOff: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/><path d="M8 11h6"/>',
};

/** 生成一个内联 SVG 图标 */
function icon(name, className = 'ico') {
  const path = ICONS[name] || ICONS.info;
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
}

/* --------------------------------------------------------------------------
   软件图标：数据里给了 icon 就用图片，否则自动生成「首字母方块」
   -------------------------------------------------------------------------- */
function monoIconHtml(app, className = 'app-icon') {
  const hue = hashHue(app.id || app.name);
  const hue2 = (hue + 42) % 360;
  const text = initials(app.name, app.id);
  return `<span class="${className} app-icon-mono" style="background:linear-gradient(135deg,hsl(${hue} 68% 56%),hsl(${hue2} 70% 58%))" aria-hidden="true">${escapeHtml(
    text
  )}</span>`;
}

function appIconHtml(app, className = 'app-icon') {
  if (app.icon) {
    return `<img class="${className}" src="${safeUrl(app.icon)}" alt="" loading="lazy" decoding="async" data-icon-fallback="${escapeHtml(
      initials(app.name, app.id)
    )}" data-icon-hue="${hashHue(app.id || app.name)}">`;
  }
  return monoIconHtml(app, className);
}

/** 图片加载失败时（例如图标路径写错了）自动换成首字母方块 */
function hydrateIcons(scope = document) {
  scope.querySelectorAll('img[data-icon-fallback]').forEach((img) => {
    img.addEventListener(
      'error',
      () => {
        const hue = Number(img.dataset.iconHue || 210);
        const span = document.createElement('span');
        span.className = `${img.className} app-icon-mono`;
        span.style.background = `linear-gradient(135deg,hsl(${hue} 68% 56%),hsl(${(hue + 42) % 360} 70% 58%))`;
        span.setAttribute('aria-hidden', 'true');
        span.textContent = img.dataset.iconFallback || '?';
        img.replaceWith(span);
      },
      { once: true }
    );
  });
}

/* --------------------------------------------------------------------------
   小工具
   -------------------------------------------------------------------------- */
function platformsText(app) {
  return (app.platforms || []).filter(Boolean).join(' · ');
}

/** 卡片上的平台文字：最多两个，其余折叠成 +N，手机上不会太长 */
function platformsTextShort(app) {
  const list = (app.platforms || []).filter(Boolean);
  if (list.length <= 2) return list.join(' · ');
  return `${list.slice(0, 2).join(' · ')} +${list.length - 2}`;
}

function updatedText(app) {
  return relativeDate(app.updated || app.releaseDate);
}

function detailHref(app, root) {
  // 直接指向 index.html：这样在静态服务器（GitHub Pages / Cloudflare）和
  // 直接双击打开的 file:// 环境下都能点得开（指向目录在 file:// 下会变成目录列表）
  return `${root}apps/${encodeURIComponent(app.id)}/index.html`;
}

/** 主下载按钮：优先挑与访客系统匹配的安装包 */
function primaryDownload(app, platform) {
  return pickBestDownload(app.downloads || [], platform);
}

/* --------------------------------------------------------------------------
   首页：软件卡片
   -------------------------------------------------------------------------- */
function cardHtml(app, ctx = {}) {
  const { root = './' } = ctx;
  const best = primaryDownload(app, app.__platform || '');
  const href = detailHref(app, root);
  const tags = (app.tags || []).slice(0, 3);
  const repoBtn = app.repo
    ? `<a class="btn btn-soft btn-icon" href="${safeUrl(app.repo)}" target="_blank" rel="noopener noreferrer" title="项目源码 / GitHub" aria-label="项目源码">${icon(
        'github'
      )}</a>`
    : '';
  const homeBtn = !app.repo && app.homepage
    ? `<a class="btn btn-soft btn-icon" href="${safeUrl(app.homepage)}" target="_blank" rel="noopener noreferrer" title="项目主页" aria-label="项目主页">${icon(
        'globe'
      )}</a>`
    : '';
  const downloadBtn = best
    ? `<a class="btn btn-primary" href="${safeUrl(resolveDownloadUrl(best.url, root))}" title="下载：${escapeHtml(
        best.name
      )}"${best.url && best.url.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${icon(
        'download'
      )} 下载</a>`
    : `<a class="btn btn-primary" href="${href}">${icon('info')} 查看详情</a>`;

  return `<article class="app-card reveal" data-id="${escapeHtml(app.id)}" data-category="${escapeHtml(
    app.category || ''
  )}">
  <div class="card-head">
    ${appIconHtml(app)}
    <div class="card-title">
      <h3>
        <a href="${href}">${escapeHtml(app.name)}</a>
        ${app.featured ? `<span class="fav-star" title="推荐">${icon('star')}</span>` : ''}
      </h3>
      <p class="card-tagline">${escapeHtml(app.tagline || '')}</p>
    </div>
  </div>
  <div class="card-meta">
    <span class="badge badge-accent">v${escapeHtml(app.version || '—')}</span>
    ${app.size ? `<span class="badge">${escapeHtml(app.size)}</span>` : ''}
    ${
      platformsTextShort(app)
        ? `<span class="badge">${icon('cpu')} ${escapeHtml(platformsTextShort(app))}</span>`
        : ''
    }
    <span class="badge" title="更新时间：${escapeHtml(formatDate(app.updated || app.releaseDate, 'iso'))}">${icon(
      'clock'
    )} ${escapeHtml(updatedText(app))}</span>
    ${app.category ? `<span class="tag">${escapeHtml(app.category)}</span>` : ''}
    ${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
  </div>
  <div class="card-foot">
    <a class="btn btn-soft" href="${href}">详情</a>
    ${downloadBtn}
    ${repoBtn}
    ${homeBtn}
  </div>
</article>`;
}

/* --------------------------------------------------------------------------
   详情页：下载区
   -------------------------------------------------------------------------- */
function downloadRowHtml(item, ctx = {}) {
  const { root = '../../' } = ctx;
  const url = resolveDownloadUrl(item.url, root);
  const external = /^https?:/i.test(url);
  const bits = [item.arch, item.type, item.size].filter(Boolean).join(' · ');
  return `<div class="dl-row" data-platform="${escapeHtml(item.platform || '')}" data-arch="${escapeHtml(
    item.arch || ''
  )}">
  <div class="dl-info">
    <div class="dl-name">
      ${escapeHtml(item.name || '下载')}
      <span class="dl-rec badge badge-accent" hidden>推荐给你</span>
    </div>
    <div class="dl-sub">${escapeHtml(bits)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</div>
  </div>
  <div class="dl-side">
    ${item.sha256 ? `<span class="dl-size" title="SHA256">SHA256 已提供</span>` : ''}
    <a class="btn btn-primary" href="${safeUrl(url)}"${
      external ? ' target="_blank" rel="noopener noreferrer"' : ' download'
    }>${icon('download')} 下载${item.size && item.size !== '-' ? ` · ${escapeHtml(item.size)}` : ''}</a>
  </div>
</div>`;
}

function downloadsHtml(app, ctx = {}) {
  const downloads = app.downloads || [];
  if (!downloads.length) {
    return `<p class="muted">暂时还没有提供下载，请稍后再来，或到项目主页查看。</p>`;
  }
  const groups = groupDownloads(downloads, ctx.platform || '');
  return groups
    .map(
      (group) => `<div class="dl-group-label">${
        group.platform ? `${escapeHtml(group.platform)}` : '通用'
      }</div>
  <div class="dl-list">${group.items.map((item) => downloadRowHtml(item, ctx)).join('')}</div>`
    )
    .join('');
}

/* --------------------------------------------------------------------------
   详情页：更新日志 / 历史版本
   -------------------------------------------------------------------------- */
function changelogHtml(app) {
  const list = app.changelog || [];
  if (!list.length) return `<p class="muted">暂无更新日志。</p>`;
  return `<ul class="timeline">${list
    .map(
      (entry) => `<li>
    <div class="tl-head">
      <span class="tl-version">v${escapeHtml(entry.version || '—')}</span>
      ${entry.date ? `<span class="badge">${icon('calendar')} ${escapeHtml(formatDate(entry.date))}</span>` : ''}
      ${entry.version && app.version === entry.version ? '<span class="badge badge-accent">当前版本</span>' : ''}
    </div>
    ${
      (entry.notes || []).length
        ? `<ul class="tl-notes">${entry.notes.map((n) => `<li>${renderMarkdown(String(n))}</li>`).join('')}</ul>`
        : ''
    }
  </li>`
    )
    .join('')}</ul>`;
}

function historyHtml(app, ctx = {}) {
  const list = app.history || [];
  if (!list.length) return `<p class="muted">没有更早的历史版本记录。</p>`;
  return list
    .map(
      (entry) => `<details class="accordion">
    <summary>
      <span class="tl-version">v${escapeHtml(entry.version || '—')}</span>
      ${entry.date ? `<span class="badge">${escapeHtml(formatDate(entry.date))}</span>` : ''}
      ${entry.size ? `<span class="badge">${escapeHtml(entry.size)}</span>` : ''}
      <span class="chev">${icon('chevron')}</span>
    </summary>
    <div class="accordion-body">
      ${
        (entry.notes || []).length
          ? `<ul class="tl-notes" style="margin-bottom:10px">${entry.notes.map((n) => `<li>${renderMarkdown(String(n))}</li>`).join('')}</ul>`
          : ''
      }
      ${
        (entry.downloads || []).length
          ? `<div class="dl-list">${entry.downloads.map((item) => downloadRowHtml(item, ctx)).join('')}</div>`
          : `<p class="muted" style="margin:0">该版本未提供下载，建议使用最新版本。</p>`
      }
    </div>
  </details>`
    )
    .join('');
}

/* --------------------------------------------------------------------------
   详情页：信息 / 系统要求 / 同类软件
   -------------------------------------------------------------------------- */
function specHtml(app, ctx = {}) {
  const { site = {} } = ctx;
  const updated = app.updated || app.releaseDate;
  const updatedLabel = updated
    ? relativeDate(updated) === formatDate(updated)
      ? formatDate(updated)
      : `${formatDate(updated)}（${relativeDate(updated)}）`
    : '—';
  const rows = [
    ['当前版本', app.version ? `v${app.version}` : '—'],
    ['发布时间', app.releaseDate ? formatDate(app.releaseDate) : '—'],
    ['更新时间', updatedLabel],
    ['文件大小', app.size || '—'],
    ['支持平台', platformsText(app) || '—'],
    ['分类', app.category || '其他'],
    ['授权协议', app.license || '未标注'],
    ['安装包数量', `${(app.downloads || []).length} 个`],
  ];
  return `<dl class="spec-list">${rows
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('')}</dl>${
    site.author ? `<p class="muted" style="margin:14px 0 0;font-size:0.82rem">整理 / 上传：${escapeHtml(site.author)}</p>` : ''
  }`;
}

function requirementsHtml(app) {
  const reqs = Array.isArray(app.requirements) ? app.requirements : app.requirements ? [app.requirements] : [];
  if (!reqs.length) return `<p class="muted">未特别说明，请参考项目主页。</p>`;
  return `<ul class="tl-notes" style="padding-left:1.1em">${reqs.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`;
}

function relatedHtml(app, ctx = {}) {
  const { apps = [], root = '../../' } = ctx;
  const platforms = new Set((app.platforms || []).map((p) => p.toLowerCase()));
  const related = apps
    .filter((other) => other.id !== app.id)
    .map((other) => {
      let score = 0;
      if (other.category && other.category === app.category) score += 2;
      score += (other.platforms || []).filter((p) => platforms.has(p.toLowerCase())).length;
      return { other, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.other.updated || '').localeCompare(String(a.other.updated || '')))
    .slice(0, 5)
    .map(
      ({ other }) => `<a href="${detailHref(other, root)}">
      ${appIconHtml(other)}
      <span>${escapeHtml(other.name)}</span>
      <span class="aside-meta">v${escapeHtml(other.version || '—')}</span>
    </a>`
    )
    .join('');
  if (!related) return '';
  return `<div class="detail-card">
    <h2>${icon('layers')} 相关软件</h2>
    <nav class="aside-list">${related}</nav>
  </div>`;
}

/**
 * 详情页主体内容（<main> 内部）。
 * 构建脚本会把它预渲染进静态 HTML；浏览器里同一份代码也会用来自动渲染。
 */
function detailContentHtml(app, ctx = {}) {
  const { root = '../../', site = {}, categories = {} } = ctx;
  const best = primaryDownload(app, ctx.platform || '');
  const repoBtn = app.repo
    ? `<a class="btn" href="${safeUrl(app.repo)}" target="_blank" rel="noopener noreferrer">${icon('github')} 源码 / GitHub</a>`
    : '';
  const homeBtn = app.homepage
    ? `<a class="btn" href="${safeUrl(app.homepage)}" target="_blank" rel="noopener noreferrer">${icon('globe')} 项目主页</a>`
    : '';
  const findCategoryLink = () => {
    const items = categories.items || [];
    const hit = items.find((c) => c.name === app.category);
    return hit ? `${root}index.html?c=${encodeURIComponent(hit.slug)}` : `${root}index.html`;
  };

  return `<nav class="breadcrumb" aria-label="面包屑">
    <a href="${root}index.html">${icon('arrowLeft')} 首页</a>
    <span>/</span>
    <a href="${findCategoryLink()}">${escapeHtml(app.category || '其他')}</a>
    <span>/</span>
    <span>${escapeHtml(app.name)}</span>
  </nav>

  <header class="detail-hero">
    <div class="detail-head">
      ${appIconHtml(app, 'app-icon detail-icon')}
      <div>
        <h1>${escapeHtml(app.name)}</h1>
        <p class="detail-tagline">${escapeHtml(app.tagline || '')}</p>
        <div class="detail-badges">
          <span class="badge badge-accent">v${escapeHtml(app.version || '—')}</span>
          ${app.size ? `<span class="badge">${escapeHtml(app.size)}</span>` : ''}
          ${platformsText(app) ? `<span class="badge">${escapeHtml(platformsText(app))}</span>` : ''}
          <span class="badge">${icon('clock')} ${escapeHtml(updatedText(app))}更新</span>
          ${app.license ? `<span class="badge">${escapeHtml(app.license)}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="detail-actions">
      <a class="btn btn-primary" href="#downloads">${icon('download')} 立即下载${
        best && best.size && best.size !== '-' ? `（${escapeHtml(best.size)}）` : ''
      }</a>
      ${repoBtn}
      ${homeBtn}
      <button class="btn btn-ghost" type="button" data-copy-link>${icon('link')} 复制本页链接</button>
      <button class="btn btn-ghost" type="button" data-share-app>${icon('external')} 分享</button>
    </div>
  </header>

  <div class="detail-layout">
    <div>
      <section class="detail-card">
        <h2>${icon('info')} 软件介绍</h2>
        <div class="prose">${renderMarkdown(app.description || app.tagline || '暂无介绍。')}</div>
      </section>

      <section class="detail-card" id="downloads">
        <h2>${icon('download')} 下载（v${escapeHtml(app.version || '—')}）</h2>
        <p class="muted" style="font-size:0.85rem;margin-top:-6px">下载前请确认系统与架构（x64 / ARM64 / 32 位）。如果某个链接无法访问，可以在软件主页找到官方地址。</p>
        ${downloadsHtml(app, ctx)}
        <p class="muted" style="font-size:0.8rem;margin:14px 0 0">${
          site.footerNote ? escapeHtml(site.footerNote) : '文件版权归原作者所有。'
        }</p>
      </section>

      <section class="detail-card" id="changelog">
        <h2>${icon('history')} 更新日志</h2>
        ${changelogHtml(app)}
      </section>

      <section class="detail-card" id="history">
        <h2>${icon('layers')} 历史版本</h2>
        ${historyHtml(app, ctx)}
      </section>
    </div>

    <aside>
      <div class="aside-sticky">
        <div class="detail-card">
          <h2>${icon('box')} 软件信息</h2>
          ${specHtml(app, ctx)}
        </div>
        <div class="detail-card">
          <h2>${icon('shield')} 系统要求</h2>
          ${requirementsHtml(app)}
        </div>
        ${relatedHtml(app, ctx)}
      </div>
    </aside>
  </div>`;
}

/* --------------------------------------------------------------------------
   详情页的 SEO 结构化数据（JSON-LD）
   -------------------------------------------------------------------------- */
function jsonLd(app, site = {}) {
  const base = String(site.url || '').replace(/\/$/, '');
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: app.name,
    description: app.tagline || app.description || '',
    applicationCategory: app.category || 'UtilitiesApplication',
    operatingSystem: (app.platforms || []).join(', '),
    softwareVersion: app.version || '',
    datePublished: app.releaseDate || undefined,
    dateModified: app.updated || app.releaseDate || undefined,
    license: app.license || undefined,
    url: base ? `${base}/apps/${app.id}/` : undefined,
    downloadUrl: (app.downloads || []).filter((d) => /^https?:/i.test(d.url || ''))[0]?.url,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
    author: site.author ? { '@type': 'Person', name: site.author } : undefined,
  };
  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
  return JSON.stringify(data, null, 2);
}

/* ---------- js/core.js ---------- */
/* ==========================================================================
   core.js · 浏览器端通用逻辑
   --------------------------------------------------------------------------
   只做「与具体页面无关」的事情：数据加载、主题切换、站名/页脚填充、
   系统识别、滚动动画、URL 状态、轻提示。
   首页逻辑在 js/main.js，详情页逻辑在 js/app-page.js。
   ========================================================================== */



/** 站点根目录前缀。支持部署在子目录（例如 GitHub Pages 的 /你的仓库名/）。 */
function siteRoot() {
  const path = decodeURIComponent(window.location.pathname || '/');
  const idx = path.lastIndexOf('/apps/');
  if (idx !== -1) return path.slice(0, idx + 1); // /repo/apps/7zip/ → /repo/
  return path.replace(/[^/]*$/, ''); // /repo/index.html → /repo/
}

const ROOT = siteRoot();

/* --------------------------------------------------------------------------
   数据加载
   优先使用 data/apps.generated.js（构建时生成，一次请求，最快）；
   没有构建过时自动回退到 fetch data/apps.json，所以不跑构建也能用。
   -------------------------------------------------------------------------- */
async function loadData() {
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

function currentTheme() {
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

function initThemeToggle() {
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
function applySiteTheme(site = {}) {
  const theme = site.theme || {};
  if (theme.accent) document.documentElement.style.setProperty('--accent', theme.accent);
  if (theme.accent2) document.documentElement.style.setProperty('--accent-2', theme.accent2);
}

/* --------------------------------------------------------------------------
   站点信息填充：Logo、站名、页脚、联系方式
   页面上写死的是默认文案，这里用 data/site.json 覆盖，保证「改 JSON 就生效」。
   -------------------------------------------------------------------------- */
function initSiteChrome(site = {}) {
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
function detectPlatform() {
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
function toast(message, ms = 2200) {
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
function initReveal(scope = document) {
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
function initToTop() {
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
function initMenu() {
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
function readUrlState(defaults = {}) {
  const params = new URLSearchParams(window.location.search);
  const state = { ...defaults };
  ['q', 'c', 'sort', 'view'].forEach((key) => {
    const value = params.get(key);
    if (value) state[key] = value;
  });
  return state;
}

function writeUrlState(state = {}) {
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
function initKeyboardShortcuts(searchInput) {
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
const store = {
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

/* ---------- js/app-page.js ---------- */
/* ==========================================================================
   app-page.js · 软件详情页逻辑
   --------------------------------------------------------------------------
   详情页的内容在构建时就已经写进静态 HTML（SEO 友好、无白屏），
   这里负责：主题/站名填充、「适合你的版本」推荐、复制链接、分享、跳转等交互。
   如果页面里没有预渲染内容（例如手动打开 app.html?id=xxx），也会用同一份
   render.js 现场渲染出来。
   ========================================================================== */
















const rootNode = document.querySelector('[data-app-root]');
const platform = detectPlatform();

// 同 main.js：标记 JS 可用（CSS 用来显示需要 JS 的交互元素）
document.documentElement.classList.add('js');

async function main() {
  initThemeToggle();
  initMenu();

  let data;
  try {
    data = await loadData();
  } catch (error) {
    renderFatal(`数据加载失败：${error.message || error}`);
    return;
  }

  const { site, categories, apps } = data;
  applySiteTheme(site);
  initSiteChrome(site);

  const appId =
    (rootNode && rootNode.dataset.appId) ||
    document.querySelector('meta[name="app-id"]')?.content ||
    new URLSearchParams(window.location.search).get('id') ||
    '';
  const app = apps.find((item) => item.id === appId);

  if (!app) {
    renderFatal(`找不到 id 为 <code>${escapeHtml(appId || '(空)')}</code> 的软件，可能已经被删除或改名。`);
    return;
  }

  // 没有预渲染内容时，现场渲染（同一份代码，保证两种方式结果一致）
  const hasPrerender = rootNode && rootNode.dataset.prerendered === 'true';
  if (!hasPrerender && rootNode) {
    rootNode.innerHTML = detailContentHtml(app, {
      root: ROOT,
      site,
      categories,
      apps,
      platform,
    });
  } else {
    // 预渲染页面：把「相关软件」等依赖平台的信息补上（这里只需 hydrate 图标）
    hydrateIcons(rootNode || document);
  }

  enhanceDownloads(app);
  initActions(app);
  initReveal(document);
  initToTop();
  document.body.dataset.ready = 'true';
}

/* --------------------------------------------------------------------------
   推荐最合适的下载项 + 把你所在平台的安装包排到最前
   -------------------------------------------------------------------------- */
function enhanceDownloads(app) {
  const section = document.querySelector('#downloads');
  if (!section) return;

  const groups = [...section.querySelectorAll('.dl-group-label')].map((label) => ({
    label,
    list: label.nextElementSibling,
    platforms: [...(label.nextElementSibling?.querySelectorAll('.dl-row') || [])].map((r) => r.dataset.platform),
  }));

  if (platform) {
    const mine = groups.filter((group) => group.platforms.includes(platform));
    const rest = groups.filter((group) => !group.platforms.includes(platform));
    if (mine.length && groups.length > 1) {
      [...mine, ...rest].forEach((group) => {
        if (!group.list) return;
        section.append(group.label, group.list); // 把「你的系统」那一组移到最前面
      });
    }
  }

  // 标记「最适合你」的那一个
  const rows = [...section.querySelectorAll('.dl-row')];
  const best = pickBestDownload(app.downloads || [], platform);
  if (best && rows.length) {
    // 优先高亮「你的系统」里的第一个安装包，否则高亮默认首选项
    const target =
      (platform && rows.find((row) => row.dataset.platform === platform)) ||
      rows.find((row) => row.dataset.platform === (best.platform || '')) ||
      rows[0];
    target.dataset.recommended = 'true';
    const badge = target.querySelector('.dl-rec');
    if (badge) badge.hidden = false;
  }
}

/* --------------------------------------------------------------------------
   复制链接 / 分享 / 锚点定位
   -------------------------------------------------------------------------- */
function initActions(app) {
  const copyBtn = document.querySelector('[data-copy-link]');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const url = window.location.href;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(url);
        } else {
          const input = document.createElement('input');
          input.value = url;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          input.remove();
        }
        copyBtn.innerHTML = `${icon('check')} 已复制`;
        toast('链接已复制到剪贴板');
        setTimeout(() => {
          copyBtn.innerHTML = `${icon('link')} 复制本页链接`;
        }, 1800);
      } catch {
        toast('复制失败，请手动复制地址栏链接');
      }
    });
  }

  const shareBtn = document.querySelector('[data-share-app]');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const shareData = {
        title: `${app.name} v${app.version || ''}`.trim(),
        text: app.tagline || '',
        url: window.location.href,
      };
      if (navigator.share) {
        try {
          await navigator.share(shareData);
        } catch {
          /* 用户取消分享，忽略 */
        }
      } else {
        try {
          await navigator.clipboard.writeText(window.location.href);
          toast('当前浏览器不支持系统分享，链接已复制');
        } catch {
          toast('请手动复制地址栏链接');
        }
      }
    });
  }

  // 详情页内的锚点跳转（#downloads 等）
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 顺便把对应的折叠面板打开（例如点了「历史版本」）
      target.querySelectorAll('details').forEach((d) => (d.open = true));
    });
  });

  // 页面底部显示构建时间（便于确认线上是不是最新)
  const buildNode = document.querySelector('[data-build-date]');
  if (buildNode && buildNode.textContent.trim() === '') {
    buildNode.textContent = formatDate(new Date().toISOString(), 'iso');
  }
}

/* --------------------------------------------------------------------------
   找不到软件 / 数据出错
   -------------------------------------------------------------------------- */
function renderFatal(message) {
  if (!rootNode) return;
  rootNode.innerHTML = `<div class="alert" style="margin:24px 0">
    <b>${icon('info')} 无法显示这个页面</b>
    <p style="margin:8px 0 0">${message}</p>
    <p style="margin:8px 0 0"><a href="${ROOT}index.html">${icon('arrowLeft')} 返回首页</a></p>
  </div>`;
}

main();
})();
