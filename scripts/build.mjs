#!/usr/bin/env node
/* ==========================================================================
   build.mjs · 静态站点构建（零依赖，只需 Node 18+）
   --------------------------------------------------------------------------
   做的事情：
     1. 读取 data/*.json 并校验
     2. 生成 data/apps.generated.js            （页面一次性加载全部数据）
     3. 生成 apps/<id>/index.html              （每个软件一个静态详情页，利于 SEO）
        以及 apps/app.html                      （通用详情页，用于兜底/预览）
     4. 生成 sitemap.xml / robots.txt / feed.xml
     5. 更新 index.html 里的 SEO 区块（title / description / OG）
     6. 复制一份到 dist/（给 Cloudflare Pages 之类的「输出目录」用）
   用法：npm run build
   ========================================================================== */

import { mkdir, writeFile, copyFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadProject, validateProject } from './validate.mjs';
import { cardHtml, detailContentHtml, jsonLd } from '../js/render.js';
import { formatDate, relativeDate, sortApps, countPackages, latestUpdate } from '../js/shared.js';
import { bundleAll } from './bundle.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

/* --------------------------------------------------------------------------
   小工具
   -------------------------------------------------------------------------- */
const log = (...args) => console.log(...args);
const ok = (msg) => console.log(`  \u2713 ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);

function pad(n) {
  return String(n).padStart(2, '0');
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function rfc822(iso) {
  const date = iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}
/** 放进 <script> 里的 JSON：把 < 转义掉，避免出现 </script> */
function jsonForScript(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}
function renderTemplate(template, vars) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}
/** 在生成的 HTML 顶部加一行说明：这个文件是自动生成的，别手改 */
function withGeneratedHeader(html, label) {
  const note = `<!-- 由 scripts/build.mjs 自动生成（${label}，${new Date().toISOString()}）。请修改 data/apps.json 后重新运行 npm run build。 -->`;
  return `${html.replace('<!doctype html>', `<!doctype html>\n${note}`).trim()}\n`;
}
/**
 * 替换 <!-- X:START --> … <!-- X:END --> 之间的内容。
 * 结束标记的缩进会重新对齐开始标记，这样重复构建不会因为空白差异产生无意义的改动。
 */
function replaceBlock(html, name, content) {
  const pattern = new RegExp(`([ \\t]*<!-- ${name}:START[\\s\\S]*?-->)([\\s\\S]*?)[ \\t]*(<!-- ${name}:END -->)`);
  if (!pattern.test(html)) return { html, replaced: false };
  const next = html.replace(pattern, (match, open, _body, close) => {
    const indent = (open.match(/^[ \t]*/) || [''])[0];
    return `${open}\n${content}\n${indent}${close}`;
  });
  return { html: next, replaced: true };
}
async function write(path, content) {
  await mkdir(dirname(path), { recursive: true });
  // 内容没变就不写：既省事，也避免开发模式（npm run dev）里
  // 「构建 → 文件被改写 → 又触发构建」这种死循环。
  if (existsSync(path)) {
    const current = await readFile(path, 'utf8').catch(() => null);
    if (current === content) return;
  }
  await writeFile(path, content, 'utf8');
}
function safeText(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
function baseUrl(site) {
  return String(site.url || '').replace(/\/+$/, '');
}
function absolute(site, path) {
  const base = baseUrl(site);
  return base ? `${base}/${String(path).replace(/^\/+/, '')}` : String(path).replace(/^\/+/, '');
}

/* --------------------------------------------------------------------------
   主流程
   -------------------------------------------------------------------------- */
async function build() {
  const started = Date.now();
  log('\n\u25b6 构建资源站…\n');

  // 1. 读取 + 校验 ---------------------------------------------------------
  const { site, categories, apps } = await loadProject(ROOT);
  const { errors, warnings } = await validateProject(ROOT, { site, apps });
  if (warnings.length) {
    log(`检查数据（${warnings.length} 条提醒）`);
    warnings.forEach(warn);
    log('');
  }
  if (errors.length) {
    console.error('\u2717 数据有错误，构建已停止：\n');
    errors.forEach((message) => console.error(`  \u2717 ${message}`));
    console.error('\n修好 data/apps.json 之后再运行 npm run build。\n');
    process.exitCode = 1;
    return;
  }

  const buildDate = today();
  const visibleApps = apps.filter((app) => !app.hidden);

  // 2. data/apps.generated.js ---------------------------------------------
  const bundle = {
    generatedAt: new Date().toISOString(),
    site,
    categories,
    apps: visibleApps,
  };
  await write(
    join(ROOT, 'data', 'apps.generated.js'),
    `/* 由 scripts/build.mjs 自动生成，请勿手动修改。
   数据来源：data/site.json + data/categories.json + data/apps.json
   生成时间：${bundle.generatedAt} */
window.SITE_DATA = ${jsonForScript(bundle)};
`
  );
  ok(`data/apps.generated.js（${visibleApps.length} 个软件）`);

  // 2.5 打包浏览器脚本 ------------------------------------------------------
  // js/ 下的源码是 ES 模块（Node 端也能直接 import），但浏览器在 file:// 协议下
  // 会拒绝加载 ES 模块。这里把它们拼成普通脚本 js/home.js、js/app.js，
  // 这样「双击 index.html 直接打开」和线上部署两种情况都能正常运行。
  const bundles = await bundleAll(ROOT);
  bundles.forEach((item) => ok(`${item.out}（${item.label}，${(item.size / 1024).toFixed(1)} KB）`));

  // 3. 静态详情页 ----------------------------------------------------------
  const template = await readFile(join(ROOT, 'scripts', 'templates', 'detail.html'), 'utf8');
  const ogImage = absolute(site, site.ogImage || 'assets/images/og-cover.png');

  const commonVars = {
    SITE_NAME: site.name || '资源站',
    SITE_TAGLINE: site.tagline || '',
    SITE_AUTHOR: site.author || '',
    SITE_GITHUB: site.github || '#',
    SITE_EMAIL_HREF: site.email ? `mailto:${site.email}` : '#',
    SITE_NOTE: site.footerNote || '',
    OG_IMAGE: ogImage,
    YEAR: String(new Date().getFullYear()),
    BUILD_DATE: buildDate,
  };

  for (const app of visibleApps) {
    const canonical = absolute(site, `apps/${app.id}/`);
    const title = safeText(`${app.name} v${app.version || ''} 下载 · ${site.name}`, 60);
    const description = safeText(
      [
        app.tagline,
        app.version ? `版本 v${app.version}` : '',
        app.size ? `大小 ${app.size}` : '',
        (app.platforms || []).length ? `支持 ${app.platforms.join(' / ')}` : '',
        app.updated ? `更新于 ${formatDate(app.updated)}` : '',
        `在 ${site.name} 查看 ${app.name} 的下载地址与更新日志。`,
      ]
        .filter(Boolean)
        .join('｜'),
      160
    );
    const html = renderTemplate(template, {
      ...commonVars,
      ROOT: '../../',
      APP_ID: app.id,
      PRERENDERED: 'true',
      SEO_TITLE: title,
      SEO_DESCRIPTION: description,
      SEO_CANONICAL: canonical,
      JSONLD: jsonLd(app, site),
      CONTENT: detailContentHtml(app, { root: '../../', site, categories, apps: visibleApps, platform: '' }),
    });
    await write(join(ROOT, 'apps', app.id, 'index.html'), withGeneratedHeader(html, `apps/${app.id}/ · ${app.name}`));
  }
  ok(`apps/<id>/index.html（${visibleApps.length} 个详情页）`);

  // 通用详情页：地址里带 ?id=xxx 即可打开，用于跳转兜底
  const generic = renderTemplate(template, {
    ...commonVars,
    ROOT: '../',
    APP_ID: '',
    PRERENDERED: 'false',
    SEO_TITLE: safeText(`软件详情 · ${site.name}`, 60),
    SEO_DESCRIPTION: safeText(site.description || '', 160),
    SEO_CANONICAL: absolute(site, 'apps/app.html'),
    // 通用页没有对应软件，保持 noindex，避免被搜索引擎收录成重复内容
    JSONLD: jsonForScript({ '@context': 'https://schema.org', '@type': 'WebPage', name: '软件详情' }),
    CONTENT: `<div class="alert" style="margin:24px 0">正在加载软件信息…如果你的浏览器禁用了 JavaScript，请从<a href="../index.html">首页</a>进入对应的软件页面。</div>`,
  }).replace('<meta name="app-id"', '<meta name="robots" content="noindex">\n  <meta name="app-id"');
  await write(join(ROOT, 'apps', 'app.html'), withGeneratedHeader(generic, 'apps/app.html · 通用详情页'));

  // 4. sitemap / robots / feed --------------------------------------------
  const urls = [
    { loc: absolute(site, ''), lastmod: buildDate, priority: '1.0', changefreq: 'daily' },
    ...visibleApps.map((app) => ({
      loc: absolute(site, `apps/${app.id}/`),
      lastmod: app.updated || app.releaseDate || buildDate,
      priority: '0.8',
      changefreq: 'weekly',
    })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${url.loc}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;
  await write(join(ROOT, 'sitemap.xml'), sitemap);
  ok(`sitemap.xml（${urls.length} 个地址）`);

  const robots = `# ${site.name || '资源站'}
User-agent: *
Allow: /

# 说明：不要屏蔽 /js/ 与 /data/ —— 搜索引擎需要用它们渲染页面（本站是纯静态站）

# 后台页面不收录：它只是个连 GitHub API 的界面，没有令牌什么也做不了
Disallow: /admin/

Sitemap: ${absolute(site, 'sitemap.xml')}
`;
  await write(join(ROOT, 'robots.txt'), robots);
  ok('robots.txt');

  const feedItems = visibleApps
    .map((app) => {
      const entry = (app.changelog || [])[0] || {};
      return {
        title: `${app.name} v${app.version || entry.version || ''}`.trim(),
        link: absolute(site, `apps/${app.id}/`),
        date: app.updated || app.releaseDate || entry.date || buildDate,
        description: [app.tagline, ...(entry.notes || [])].filter(Boolean).join(' / '),
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 20);

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${site.name || '资源站'} · 更新日志</title>
    <link>${absolute(site, '')}</link>
    <description>${site.description || ''}</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${absolute(site, 'feed.xml')}" rel="self" type="application/rss+xml"/>
${feedItems
  .map(
    (item) => `    <item>
      <title>${item.title}</title>
      <link>${item.link}</link>
      <guid isPermaLink="true">${item.link}</guid>
      <pubDate>${rfc822(item.date)}</pubDate>
      <description>${item.description.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</description>
    </item>`
  )
  .join('\n')}
  </channel>
</rss>
`;
  await write(join(ROOT, 'feed.xml'), feed);
  ok(`feed.xml（${feedItems.length} 条更新）`);

  // 5. 更新 index.html 的 SEO 区块 ----------------------------------------
  const indexPath = join(ROOT, 'index.html');
  let indexHtml = await readFile(indexPath, 'utf8');
  const seoBlock = `  <title>${safeText(`${site.name} · ${site.tagline}`, 60)}</title>
  <meta name="description" content="${safeText(site.description || site.tagline || '', 160)}">
  <meta name="keywords" content="${(site.keywords || []).join(', ')}">
  <meta name="author" content="${site.author || ''}">
  <link rel="canonical" href="${absolute(site, '')}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${site.name || ''}">
  <meta property="og:title" content="${safeText(`${site.name} · ${site.tagline}`, 60)}">
  <meta property="og:description" content="${safeText(site.description || site.tagline || '', 160)}">
  <meta property="og:url" content="${absolute(site, '')}">
  <meta property="og:image" content="${ogImage}">
  <meta name="twitter:card" content="summary_large_image">`;
  const latestIso = latestUpdate(visibleApps);
  const statsBlock = [
    `<span><b data-stat="apps">${visibleApps.length}</b> 个软件</span>`,
    `<span><b data-stat="packages">${countPackages(visibleApps)}</b> 个安装包</span>`,
    `<span>最近更新 <b data-stat="updated" data-stat-updated-date${
      latestIso ? ` title="最近更新：${formatDate(latestIso, 'iso')}"` : ''
    }>${latestIso ? relativeDate(latestIso) : '—'}</b></span>`,
  ].join('\n        ');
  const listBlock = sortApps(visibleApps, 'default')
    .map((app) => cardHtml(app, { root: '' }))
    .join('\n')
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
  const resultBlock = `<span>共 <b>${visibleApps.length}</b> 个软件 · <b>${countPackages(
    visibleApps
  )}</b> 个安装包</span><span class="muted">选择分类或搜索可以快速筛选</span>`;

  const blocks = [
    ['SEO', seoBlock],
    ['STATS', statsBlock],
    ['RESULT', resultBlock],
    ['APPS', listBlock],
  ];
  const missing = [];
  blocks.forEach(([name, content]) => {
    const result = replaceBlock(indexHtml, name, content);
    if (!result.replaced) missing.push(name);
    indexHtml = result.html;
  });
  await write(indexPath, `${indexHtml.trimEnd()}\n`);
  ok('index.html（SEO、统计、软件列表已预渲染）');
  if (missing.length) warn(`index.html 里没有找到这些标记：${missing.join(', ')}（已跳过）`);

  // 6. 复制到 dist/ --------------------------------------------------------
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  // dist/ 会原样发布到公网，所以下面这些东西绝不能进去：
  //   · data/admin.json —— 本地后台的明文密码（本地服务器会拦，静态托管可不会）
  //   · .wrangler/ —— wrangler 的本地缓存
  //   · scripts/ —— 构建 / 发布工具，公网上用不到
  //   · .git / .github / node_modules / dist 自身
  // admin/ 现在要进 dist/：A 方案下它跟着网站一起部署，用 GitHub 令牌直接调 API，
  // 不需要本机跑 Node 服务（见 README 的「在线后台」一节）。
  const skip = new Set(['.git', '.github', '.wrangler', 'node_modules', 'dist', 'scripts']);
  const skipPaths = new Set(['data/admin.json']);
  await copyTree(ROOT, DIST, skip, skipPaths);
  ok('dist/（可直接作为部署输出目录）');

  const seconds = ((Date.now() - started) / 1000).toFixed(2);
  log(`\n\u2713 构建完成：${visibleApps.length} 个软件，用时 ${seconds}s`);
  log('  本地预览：npm run dev      部署：见 README.md\n');
}

/**
 * 递归复制。
 *   skip      —— 按「名字」跳过（任何一层目录里叫这个名字的都不复制）
 *   skipPaths —— 按「相对根目录的路径」跳过，用于 data/admin.json 这种同名的文件
 */
async function copyTree(from, to, skip, skipPaths = new Set(), rel = '') {
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (skip.has(entry.name) || skipPaths.has(relPath)) continue;
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      await mkdir(dest, { recursive: true });
      await copyTree(src, dest, skip, skipPaths, relPath);
    } else {
      await copyFile(src, dest);
    }
  }
}

build().catch((error) => {
  console.error('\n\u2717 构建失败：', error);
  process.exitCode = 1;
});
