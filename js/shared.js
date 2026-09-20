/* ==========================================================================
   shared.js · 纯函数工具
   --------------------------------------------------------------------------
   这个文件不依赖浏览器环境（不碰 document / window），
   所以浏览器页面和 scripts/build.mjs 都可以直接 import 使用。
   ========================================================================== */

/** HTML 转义：所有来自 JSON 的文本都必须先经过它，避免 XSS。 */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 转义后用于 HTML 属性里的 URL（只允许安全协议）。 */
export function safeUrl(url) {
  const raw = String(url == null ? '' : url).trim();
  if (/^\s*javascript:/i.test(raw) || /^\s*data:text\/html/i.test(raw)) return '#';
  return escapeHtml(raw);
}

/** 日期格式化：2026-09-19 → 2026年9月19日 / 2026-09-19 */
export function formatDate(iso, style = 'zh') {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return style === 'iso' ? `${y}-${pad(m)}-${pad(day)}` : `${y}年${m}月${day}日`;
}

/** 相对时间：刚刚 / 3 天前 / 2024年5月1日 */
export function relativeDate(iso) {
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
export function debounce(fn, wait = 220) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** 字符串 → 稳定的色相值（0-359），用来给「首字母图标」生成配色 */
export function hashHue(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/** 取名称缩写：中文取第一个字，英文取前两个单词首字母 */
export function initials(name, fallback = '') {
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
export function compareVersion(a, b) {
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
export function isExternalUrl(url) {
  return /^(https?:)?\/\//i.test(String(url || '')) || /^[a-z][a-z0-9+.-]*:/i.test(String(url || ''));
}

/**
 * 把数据里的下载地址解析成当前页面可用的地址。
 * - https://...            外部链接，原样返回
 * - /downloads/a.exe       以 / 开头 = 站点根目录
 * - downloads/a.exe        相对路径 = 站点根目录
 * root 由调用方传入：浏览器是 location 推导出来的前缀，构建脚本里是 '../../' 之类。
 */
export function resolveDownloadUrl(url, root = '') {
  const raw = String(url == null ? '' : url).trim();
  if (!raw) return '#';
  if (isExternalUrl(raw)) return raw;
  if (raw.startsWith('#')) return raw;
  if (raw.startsWith('/')) return `${root}${raw.slice(1)}`;
  return `${root}${raw.replace(/^\.\//, '')}`;
}

/** 单个下载项的名字（用于按钮 title） */
export function downloadLabel(item) {
  const parts = [item.platform, item.arch, item.type].filter(Boolean);
  return item.name ? `${item.name}` : parts.join(' · ');
}

/** 平台中文/英文键：用于把下载项按平台分组 */
export function platformKey(item) {
  return item.platform || '其他';
}

/**
 * 按平台分组下载项，并把你当前使用的系统排在最前面。
 * 返回：[{ platform, items: [...] }, ...]
 */
export function groupDownloads(downloads = [], preferredPlatform = '') {
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
export function pickBestDownload(downloads = [], platform = '') {
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
export function haystack(app) {
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
export function matchQuery(app, query) {
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
export function matchCategory(app, category, allSlug = 'all') {
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
export const SORT_MODES = [
  { value: 'default', label: '推荐排序' },
  { value: 'updated', label: '最近更新' },
  { value: 'name', label: '名称' },
  { value: 'version', label: '版本号' },
];

export function sortApps(list, mode = 'default') {
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
export function countPackages(apps = []) {
  return apps.reduce((sum, app) => sum + (app.downloads || []).length, 0);
}

/** 站点最近一次更新时间（取所有软件里最新的） */
export function latestUpdate(apps = []) {
  return apps
    .map((a) => a.updated || a.releaseDate || '')
    .filter(Boolean)
    .sort()
    .pop() || '';
}

/** 简易 Markdown 渲染（先转义，再替换，保证安全） */
export function renderMarkdown(text) {
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
