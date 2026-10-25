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
   发布清单（白名单）
   --------------------------------------------------------------------------
   dist/ 是要原样发布到公网的，所以默认策略必须是「不发布」，而不是
   「除黑名单以外全发布」：黑名单只认得你已经想到的东西，哪天根目录多出
   .env / 备份文件 / 临时脚本，就会被静默复制上线。

     PUBLISH_ENTRIES —— 允许进 dist/ 的根级条目（站点实际引用到的资源）
     DEV_ONLY_ENTRIES —— 明确的版本控制 / 开发工具条目，不进 dist 也不算异常
     两者都不在 → 构建报错（fail-closed），强制你为新文件做一次「发不发布」的决定
   -------------------------------------------------------------------------- */
const PUBLISH_ENTRIES = new Set([
  '.nojekyll', // GitHub Pages 用：关掉 Jekyll，否则 _ 开头的文件会被忽略
  '404.html',
  'admin', // 在线后台页面（跟着网站一起部署，用 GitHub 令牌调 API）
  'apps', // 每个软件的静态详情页 apps/<id>/index.html + 通用 apps/app.html
  'assets', // 样式、图标、favicon
  'data', // site.json / categories.json / apps.json / apps.generated.js（页面要用）
  'downloads', // 站内下载文件（apps.json 里以 downloads/ 开头的地址）
  'feed.xml',
  'index.html',
  'js', // 页面脚本（含 bundle 出来的 home.js / app.js / admin 系列）
  'robots.txt',
  'sitemap.xml',
]);

const DEV_ONLY_ENTRIES = new Set([
  '.git',
  '.github', // CI 配置
  '.gitattributes',
  '.gitignore',
  '.wrangler', // Cloudflare 本地缓存
  '.cache',
  '.shots',
  'node_modules',
  'dist', // 输出目录自身
  'scripts', // 构建 / 发布工具，公网上用不到
  'README.md',
  'CHANGELOG.md',
  'package.json', // 只是 npm scripts 的说明，站点不引用
  // Windows 本地开发工具
  'Xixi后台.cmd',
  '发布软件.cmd',
  '启动预览.cmd',
  '一键提交到GitHub.cmd',
  // 系统 / 临时文件
  '.DS_Store',
  'Thumbs.db',
  '_measure.html',
  '_probe.html',
]);

/* dist/ 内部还要单独排除的路径：data/admin.json 是本地后台的明文密码
   （本地服务器会拦，静态托管可不会） */
const skipPaths = new Set(['data/admin.json']);

/* --------------------------------------------------------------------------
   小工具
   -------------------------------------------------------------------------- */
const log = (...args) => console.log(...args);
const ok = (msg) => console.log(`  \u2713 ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);

/**
 * 构建时间戳。
 * 默认不写「现在几点」：那样每次构建都会产生一堆只改了时间戳的 diff，
 * 你本地跑一次、CI 再跑一次就永远对不上。
 *   · 设了 SOURCE_DATE_EPOCH（可复现构建的通用约定）→ 用它
 *   · 否则用「数据里最新的 updated」，产物只随数据变化而变化
 */
function sourceDateEpoch() {
  const raw = Number(process.env.SOURCE_DATE_EPOCH);
  return Number.isFinite(raw) && raw > 0 ? new Date(raw * 1000) : null;
}
function rfc822(iso) {
  const date = iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString();
}
/** 放进 <script> 里的 JSON：把 < 转义掉，避免出现 </script>（也接受已经序列化好的字符串） */
function jsonForScript(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return json.replace(/</g, '\\u003c');
}
function renderTemplate(template, vars) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}
/** 在生成的 HTML 顶部加一行说明：这个文件是自动生成的，别手改 */
function withGeneratedHeader(html, label, stamp) {
  const note = `<!-- 由 scripts/build.mjs 自动生成（${label}，数据更新于 ${stamp}）。请修改 data/apps.json 后重新运行 npm run build。 -->`;
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

  const visibleApps = apps.filter((app) => !app.hidden);
  // 构建日期同样不取「今天」：默认用数据里最新的 updated，保证同样的数据两次构建完全一致
  const epoch = sourceDateEpoch();
  const latestIso = latestUpdate(visibleApps);
  const buildDate = epoch ? epoch.toISOString().slice(0, 10) : String(latestIso || '').slice(0, 10) || '1970-01-01';
  const generatedAt = epoch ? epoch.toISOString() : latestIso ? `${String(latestIso).slice(0, 10)}T00:00:00.000Z` : '';
  // buildDate 管「日期标签」（lastmod / generatedAt / 头注释），buildNow 管「多久以前」。
  // 两者不能混：buildDate 在没有 SOURCE_DATE_EPOCH 时就等于数据最新更新日，
  // 拿它算「最近更新」永远是 0 天、永远显示「今天」。
  // 有 SDE 时用 SDE（产物可复现），没有时退回当前时刻（本地构建的正常表现）。
  const buildNow = epoch ?? new Date();

  // 2. data/apps.generated.js ---------------------------------------------
  const bundle = {
    generatedAt,
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
  // 读入的 HTML 先归一到 LF：模板和 index.html 在 Windows 工作树里是 CRLF（core.autocrlf=true），
  // 而干净 clone / CI 里是 LF。不归一的话，同一份代码在两边构建出的字节不同，
  // dist 里的 HTML 也会带着 CR 一起发布，跟 bundle.mjs 对 JS 的处理保持一致。
  const template = (await readFile(join(ROOT, 'scripts', 'templates', 'detail.html'), 'utf8')).replace(
    /\r\n/g,
    '\n'
  );
  const ogImage = absolute(site, site.ogImage || 'assets/images/og-cover.png');

  const commonVars = {
    SITE_NAME: site.name || '资源站',
    SITE_TAGLINE: site.tagline || '',
    SITE_AUTHOR: site.author || '',
    SITE_GITHUB: site.github || '#',
    SITE_EMAIL_HREF: site.email ? `mailto:${site.email}` : '#',
    SITE_NOTE: site.footerNote || '',
    OG_IMAGE: ogImage,
    // 年份也从 buildDate 派生（UTC）：
    // 直接取 new Date().getFullYear() 的话，跨年那天全站页脚的年份会集体变一次，
    // 产生一堆和内容无关的 diff；而幂等测试在当天是跑不出来的。
    YEAR: String(new Date(`${buildDate}T00:00:00Z`).getUTCFullYear()),
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
      JSONLD: jsonForScript(jsonLd(app, site)),
      CONTENT: detailContentHtml(app, {
        root: '../../',
        site,
        categories,
        apps: visibleApps,
        platform: '',
        now: buildNow,
      }),
    });
    await write(
      join(ROOT, 'apps', app.id, 'index.html'),
      withGeneratedHeader(html, `apps/${app.id}/ · ${app.name}`, buildDate)
    );
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
  await write(join(ROOT, 'apps', 'app.html'), withGeneratedHeader(generic, 'apps/app.html · 通用详情页', buildDate));

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
    <lastBuildDate>${rfc822(epoch ? epoch.toISOString() : latestIso)}</lastBuildDate>
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
  let indexHtml = (await readFile(indexPath, 'utf8')).replace(/\r\n/g, '\n');
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
  const statsBlock = [
    `<span><b data-stat="apps">${visibleApps.length}</b> 个软件</span>`,
    `<span><b data-stat="packages">${countPackages(visibleApps)}</b> 个安装包</span>`,
    `<span>最近更新 <b data-stat="updated" data-stat-updated-date${
      latestIso ? ` title="最近更新：${formatDate(latestIso, 'iso')}"` : ''
    }>${latestIso ? relativeDate(latestIso, buildNow) : '—'}</b></span>`,
  ].join('\n        ');
  const listBlock = sortApps(visibleApps, 'default')
    .map((app) => cardHtml(app, { root: '', now: buildNow }))
    .join('\n')
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
  const resultBlock = `<span>共 <b>${visibleApps.length}</b> 个软件 · <b>${countPackages(
    visibleApps
  )}</b> 个安装包</span><span class="muted">选择分类或搜索可以快速筛选</span>`;

  const blocks = [
    // 首页页脚的年份：以前写死 2026，且 js/core.js 运行时会用 new Date() 覆盖，
    // 导致首页与详情页年份不一致（详情页是构建时注入的）。现在两边都从 buildDate 派生。
    ['YEAR', commonVars.YEAR],
    // 首页页脚的「构建于」：以前是空 span，由 js/app.js / js/app-page.js 在访客浏览器里
    // 用 new Date() 填上「今天」，于是这个本该说明「线上是不是最新」的字段永远等于打开
    // 页面的那天，跟实际构建时间无关。现在改为构建时注入，与详情页一致；运行时那段
    // 只在内容为空时才兜底，注入非空后它自然不会触发。
    ['BUILD_DATE', commonVars.BUILD_DATE],
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
  if (missing.length) {
    // 标记没了 = 首页的软件列表永远不会被填进去 = 部署一个空站，
    // 所以这里必须让 CI 变红，而不是打一行提醒就继续上传产物。
    console.error(`\n\u2717 index.html 里没有找到这些标记：${missing.join(', ')}`);
    console.error('  首页的 <!-- APPS:START --> … <!-- APPS:END --> 这类标记被删掉或改名了，');
    console.error('  页面不会被填进软件列表，部署上去就是空站。请恢复标记后重新构建。\n');
    process.exitCode = 1;
    return;
  }

  // 6. 复制到 dist/ --------------------------------------------------------
  // 先按白名单核对根目录：出现既不在发布清单、也不在开发工具清单里的条目就报错，
  // 在动 dist/ 之前就停下（不会留下一个「缺东西」的半成品目录）。
  const rootEntries = await readdir(ROOT, { withFileTypes: true });
  const unknownEntries = rootEntries
    .map((entry) => entry.name)
    .filter((name) => !PUBLISH_ENTRIES.has(name) && !DEV_ONLY_ENTRIES.has(name));
  if (unknownEntries.length) {
    console.error(`\n\u2717 仓库根目录新增了 ${unknownEntries.length} 个文件/目录，不知道要不要发布：`);
    unknownEntries.forEach((name) => console.error(`    · ${name}`));
    console.error('\n  dist/ 会原样发布到公网，所以这里不做默认决定：');
    console.error('    要发布  → 加到 scripts/build.mjs 的 PUBLISH_ENTRIES');
    console.error('    不发布  → 加到 DEV_ONLY_ENTRIES（开发工具 / 本地文件）');
    console.error('    顺手删掉 → 直接删了这个文件\n');
    process.exitCode = 1;
    return;
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  for (const entry of rootEntries) {
    if (!PUBLISH_ENTRIES.has(entry.name)) continue;
    const src = join(ROOT, entry.name);
    const dest = join(DIST, entry.name);
    if (entry.isDirectory()) {
      await mkdir(dest, { recursive: true });
      await copyTree(src, dest, entry.name);
    } else {
      await copyFile(src, dest);
    }
  }
  ok(`dist/（白名单 ${PUBLISH_ENTRIES.size} 个根级条目，可直接作为部署输出目录）`);

  const seconds = ((Date.now() - started) / 1000).toFixed(2);
  log(`\n\u2713 构建完成：${visibleApps.length} 个软件，用时 ${seconds}s`);
  log('  本地预览：npm run dev      部署：见 README.md\n');
}

/**
 * 递归复制一个目录（只用于白名单命中的根级目录）。
 *   rel —— 相对仓库根目录的路径，用来查 skipPaths（例如 data/admin.json）
 */
async function copyTree(from, to, rel = '') {
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (skipPaths.has(relPath)) continue;
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      await mkdir(dest, { recursive: true });
      await copyTree(src, dest, relPath);
    } else {
      await copyFile(src, dest);
    }
  }
}

build().catch((error) => {
  console.error('\n\u2717 构建失败：', error);
  process.exitCode = 1;
});
