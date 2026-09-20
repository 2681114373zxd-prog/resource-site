/* ==========================================================================
   render.js · 用数据生成 HTML 字符串
   --------------------------------------------------------------------------
   纯字符串拼接，不访问 DOM，因此：
     - 浏览器里（js/main.js、js/app-page.js）用它渲染页面
     - Node 里（scripts/build.mjs）用它预渲染静态详情页
   所有用户可见的文本都会先 escapeHtml / renderMarkdown，避免 XSS。
   ========================================================================== */

import {
  escapeHtml,
  safeUrl,
  formatDate,
  relativeDate,
  hashHue,
  initials,
  resolveDownloadUrl,
  groupDownloads,
  pickBestDownload,
  renderMarkdown,
} from './shared.js';

/* --------------------------------------------------------------------------
   图标（内联 SVG，避免额外请求）
   -------------------------------------------------------------------------- */
export const ICONS = {
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
export function icon(name, className = 'ico') {
  const path = ICONS[name] || ICONS.info;
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
}

/* --------------------------------------------------------------------------
   软件图标：数据里给了 icon 就用图片，否则自动生成「首字母方块」
   -------------------------------------------------------------------------- */
export function monoIconHtml(app, className = 'app-icon') {
  const hue = hashHue(app.id || app.name);
  const hue2 = (hue + 42) % 360;
  const text = initials(app.name, app.id);
  return `<span class="${className} app-icon-mono" style="background:linear-gradient(135deg,hsl(${hue} 68% 56%),hsl(${hue2} 70% 58%))" aria-hidden="true">${escapeHtml(
    text
  )}</span>`;
}

export function appIconHtml(app, className = 'app-icon') {
  if (app.icon) {
    return `<img class="${className}" src="${safeUrl(app.icon)}" alt="" loading="lazy" decoding="async" data-icon-fallback="${escapeHtml(
      initials(app.name, app.id)
    )}" data-icon-hue="${hashHue(app.id || app.name)}">`;
  }
  return monoIconHtml(app, className);
}

/** 图片加载失败时（例如图标路径写错了）自动换成首字母方块 */
export function hydrateIcons(scope = document) {
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
export function cardHtml(app, ctx = {}) {
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

export function downloadsHtml(app, ctx = {}) {
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
export function changelogHtml(app) {
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

export function historyHtml(app, ctx = {}) {
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
export function detailContentHtml(app, ctx = {}) {
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
export function jsonLd(app, site = {}) {
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
