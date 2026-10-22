#!/usr/bin/env node
/* ==========================================================================
   test.mjs · 自检脚本（零依赖，用 Node 自带断言）
   --------------------------------------------------------------------------
   用法：npm test
   检查的是「真正会跑的核心逻辑」：数据校验、搜索筛选、排序、下载地址解析、
   Markdown 渲染与 XSS 转义、卡片/详情页 HTML 生成。
   ========================================================================== */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  escapeHtml,
  safeUrl,
  resolveDownloadUrl,
  compareVersion,
  groupDownloads,
  pickBestDownload,
  matchQuery,
  matchCategory,
  sortApps,
  renderMarkdown,
  initials,
  formatDate,
  countPackages,
} from '../js/shared.js';
import { cardHtml, detailContentHtml, jsonLd, ICONS } from '../js/render.js';
import { loadProject, validateProject } from './validate.mjs';
import { createCanvas, drawText, drawMark, encodePng } from './make-icons.mjs';
import { buildBundleCode, exportedNames, transformModule } from './bundle.mjs';
import { createDom, makeElement, runScript } from './dom-stub.mjs';
import { argValue, detectPackage, humanSize, parsePort, slugify } from './files.mjs';
import { removeApp, spliceApp, setTopLevelValue } from './json-style.mjs';
import { mergeDownload, nextBump, pushChangelog, recordHistory, validateApp } from './app-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  \u2717 ${name}\n      ${error.message}`);
    // 默认只打一行信息；要看清调用栈时用 VERBOSE=1 npm test
    if (process.env.VERBOSE === '1' && error.stack) console.log(error.stack);
  }
}

/* --------------------------------------------------------------------------
   数据前置
   --------------------------------------------------------------------------
   以前这里是模块顶层的 `const { site, apps } = await loadProject(ROOT)`，
   没有 try/catch：data/apps.json 一坏，未捕获异常直接把进程打死，后面
   （含数据校验、发布工具、本地/在线后台、构建产物）的用例全部不执行，
   但汇总行也不会打印 —— 看日志的人只看到「跑了几个就没了」。

   现在改成：抛错只记下来，所有用例照常跑，靠 requireData() 让依赖数据的
   用例明确变红。用例总数恒定，失败时一个都不会少。
   -------------------------------------------------------------------------- */
let project = null;
let projectError = null;
try {
  project = await loadProject(ROOT);
} catch (error) {
  projectError = error;
  process.exitCode = 1; // 数据坏了，退出码必须非 0
}
const site = project?.site || {};
const categories = project?.categories || { items: [] };
const apps = project?.apps || [];
const visibleApps = apps.filter((app) => !app.hidden);
const appIds = visibleApps.map((app) => app.id);

/** 依赖 apps.json 的用例先调这个：数据坏了要红得明明白白，而不是空转通过 */
function requireData() {
  assert.ok(!projectError, `data/*.json 加载失败，本用例无法执行：${projectError && projectError.message}`);
  assert.ok(visibleApps.length > 0, 'data/apps.json 里没有任何可见软件，本用例无法执行');
}

/** 按 apps.json 组装页面要的 window.SITE_DATA（与 build.mjs 产出的结构一致） */
function siteDataFromJson() {
  requireData();
  return { generatedAt: '', site, categories, apps: visibleApps };
}

/**
 * 给页面喂数据：数据来源必须是 apps.json，不能是构建产物 data/apps.generated.js。
 * 以前喂的是生成物 —— 生成物陈旧时用例照样绿，等于什么都没测。
 */
function injectSiteData(dom) {
  const json = JSON.stringify(siteDataFromJson()).replace(/</g, '\\u003c');
  new Function('window', `window.SITE_DATA = ${json};`)(dom.window);
}

/**
 * 比较两段长文本。
 * assert.equal 撞上两个 50KB 的产物会吐出 4 万字符的逐行 diff，把终端刷没；
 * 这里只报「首个差异的位置 + 前后各 80 字符」，全文留给 VERBOSE=1。
 */
function assertSameText(actual, expected, label, hint) {
  const a = String(actual);
  const b = String(expected);
  if (a === b) return;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const line = a.slice(0, i).split('\n').length;
  const from = Math.max(0, i - 80);
  const detail = [
    `${label} 不一致（第 ${line} 行、第 ${i} 个字符起）`,
    `  磁盘：${JSON.stringify(a.slice(from, i + 80))}`,
    `  生成：${JSON.stringify(b.slice(from, i + 80))}`,
    `  长度：磁盘 ${a.length} 字符 / 生成 ${b.length} 字符${hint ? `　${hint}` : ''}`,
  ].join('\n');
  if (process.env.VERBOSE === '1') {
    console.log(`\n---- 磁盘全文（${a.length} 字符）----\n${a}\n---- 生成全文（${b.length} 字符）----\n${b}\n`);
  }
  assert.fail(detail);
}

/** 跑一个 node 脚本，拿回 { code, stdout, stderr }；extraEnv 用于覆盖 TZ / SOURCE_DATE_EPOCH */
function runNode(scriptPath, cwd, extraEnv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      windowsHide: true,
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => done({ code, stdout, stderr }));
    child.on('error', (error) => done({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
  });
}

const pathExists = (target) => stat(target).then(() => true, () => false);

/**
 * dist 不存在就先构建一次：绝对不能让「没构建」被当成「检查通过」。
 * 副作用说明：这一步会在**仓库根目录**真跑一次 build —— 会重写 dist/（已在 .gitignore 里）
 * 以及被 git 跟踪的生成物（幂等，正常情况写出来的字节与提交的一致，git status 不会变脏）。
 * 只在 dist 缺失时才会触发（干净 clone / CI 一定走这条路），所以会打印一行提示，不静默。
 */
async function ensureDist() {
  if (await pathExists(join(ROOT, 'dist', 'index.html'))) return;
  console.log('      （dist/ 不存在，先在本仓库构建一次）');
  const result = await runNode(join(ROOT, 'scripts', 'build.mjs'), ROOT);
  assert.equal(result.code, 0, `dist 不存在，尝试构建也失败了：${result.stderr || result.stdout}`);
  assert.ok(await pathExists(join(ROOT, 'dist', 'index.html')), '构建声称成功，但 dist/index.html 还是没有');
}

/** 目录下所有文件的 「路径 + 大小 + sha256」 清单，用来做字节级比较 */
async function treeManifest(dir) {
  const files = (await readdir(dir, { recursive: true }))
    .map((item) => String(item).replace(/\\/g, '/'))
    .sort();
  const manifest = [];
  for (const file of files) {
    const full = join(dir, file);
    const info = await stat(full);
    if (!info.isFile()) continue;
    const digest = createHash('sha256').update(await readFile(full)).digest('hex');
    manifest.push(`${file}\t${info.size}\t${digest}`);
  }
  return manifest;
}

const demoApp = {
  id: 'demo-app',
  name: 'Demo App',
  tagline: '一个示例软件',
  description: '第一段\n\n- 列表一\n- 列表二\n\n**加粗** 与 `代码` 与 [链接](https://example.com)',
  category: '工具',
  platforms: ['Windows', 'Android'],
  tags: ['演示', 'demo'],
  version: '1.10.0',
  releaseDate: '2026-01-02',
  updated: '2026-01-02',
  size: '10 MB',
  downloads: [
    { name: 'Windows x64', url: 'downloads/demo-x64.exe', size: '10 MB', platform: 'Windows', arch: 'x64', type: 'installer' },
    { name: 'Android APK', url: 'https://example.com/demo.apk', size: '8 MB', platform: 'Android', arch: 'arm64', type: 'apk' },
  ],
  changelog: [{ version: '1.10.0', date: '2026-01-02', notes: ['首个版本'] }],
  history: [],
};

console.log('\n\u25b6 运行自检（npm test）\n');

/* ---------------- 基础工具 ---------------- */
console.log('基础工具：');

await test('escapeHtml 会转义 HTML 特殊字符', () => {
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

await test('safeUrl 会拦掉 javascript: 协议', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('https://example.com/a.exe'), 'https://example.com/a.exe');
});

await test('resolveDownloadUrl 会按页面深度补前缀', () => {
  assert.equal(resolveDownloadUrl('downloads/a.exe', ''), 'downloads/a.exe');
  assert.equal(resolveDownloadUrl('downloads/a.exe', '../../'), '../../downloads/a.exe');
  assert.equal(resolveDownloadUrl('/downloads/a.exe', '../../'), '../../downloads/a.exe');
  assert.equal(resolveDownloadUrl('https://cdn.example.com/a.exe', '../../'), 'https://cdn.example.com/a.exe');
});

await test('compareVersion 能正确比较 1.10.0 与 1.9.2', () => {
  assert.ok(compareVersion('1.10.0', '1.9.2') > 0);
  assert.ok(compareVersion('1.0.0', '1.0.1') < 0);
  assert.equal(compareVersion('2.5', '2.5.0'), 0);
});

await test('formatDate / initials 正常工作', () => {
  assert.equal(formatDate('2026-09-19'), '2026年9月19日');
  assert.equal(formatDate('2026-09-19', 'iso'), '2026-09-19');
  assert.equal(initials('7-Zip', 'x'), '7Z');
  assert.equal(initials('Umi-OCR'), 'UO');
  assert.equal(initials('压缩工具'), '压');
});

/* ---------------- 搜索 / 筛选 / 排序 ---------------- */
console.log('\n搜索、筛选与排序：');

await test('搜索支持空格分词，多个关键词都要命中', () => {
  assert.equal(matchQuery(demoApp, 'demo'), true);
  assert.equal(matchQuery(demoApp, 'DEMO windows'), true);
  assert.equal(matchQuery(demoApp, 'demo linux'), false);
  assert.equal(matchQuery(demoApp, ''), true);
});

await test('搜索能命中标签和分类', () => {
  assert.equal(matchQuery(demoApp, '演示'), true);
  assert.equal(matchQuery(demoApp, '工具'), true);
});

await test('分类筛选支持分类名与平台名', () => {
  assert.equal(matchCategory(demoApp, { slug: 'all', name: '全部' }), true);
  assert.equal(matchCategory(demoApp, { slug: 'tools', name: '工具' }), true);
  assert.equal(matchCategory(demoApp, { slug: 'android', name: 'Android' }), true);
  assert.equal(matchCategory(demoApp, { slug: 'linux', name: 'Linux' }), false);
});

await test('排序：最近更新 / 名称 / 版本号', () => {
  const older = { ...demoApp, id: 'older', name: 'Aaa', version: '9.0.0', updated: '2025-01-01' };
  const newer = { ...demoApp, id: 'newer', name: 'Zzz', version: '1.0.0', updated: '2026-08-01' };
  assert.equal(sortApps([older, newer], 'updated')[0].id, 'newer');
  assert.equal(sortApps([newer, older], 'name')[0].id, 'older');
  assert.equal(sortApps([older, newer], 'version')[0].id, 'older');
});

await test('countPackages 统计安装包数量', () => {
  assert.equal(countPackages([demoApp, { downloads: [{}] }]), 3);
});

/* ---------------- 下载项 ---------------- */
console.log('\n下载项处理：');

await test('groupDownloads 会把你所在平台排到最前面', () => {
  const groups = groupDownloads(demoApp.downloads, 'Android');
  assert.equal(groups[0].platform, 'Android');
  assert.equal(groups.length, 2);
});

await test('pickBestDownload 优先挑安装版', () => {
  const best = pickBestDownload(demoApp.downloads, 'Windows');
  assert.equal(best.name, 'Windows x64');
  const fallback = pickBestDownload(demoApp.downloads, 'Linux');
  assert.ok(fallback);
});

await test('没有下载项时返回 null', () => {
  assert.equal(pickBestDownload([], 'Windows'), null);
});

/* ---------------- Markdown / XSS ---------------- */
console.log('\n内容渲染与安全：');

await test('renderMarkdown 支持列表、加粗、行内代码、链接', () => {
  const html = renderMarkdown(demoApp.description);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<code>代码<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com"/);
});

await test('renderMarkdown 不会执行注入的 HTML / 脚本', () => {
  const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
});

await test('renderMarkdown 会拦掉 javascript: 链接', () => {
  const html = renderMarkdown('[点我](javascript:alert(1))');
  assert.ok(!/href="javascript:/i.test(html));
});

/* ---------------- HTML 生成 ---------------- */
console.log('\n页面生成：');

await test('cardHtml 生成卡片并带上下载按钮与详情链接', () => {
  const html = cardHtml(demoApp, { root: '' });
  assert.match(html, /data-id="demo-app"/);
  assert.match(html, /href="apps\/demo-app\/index\.html"/);
  assert.match(html, /downloads\/demo-x64\.exe/);
  assert.match(html, /v1\.10\.0/);
});

await test('cardHtml 对软件名里的 HTML 做转义（防 XSS）', () => {
  const evil = { ...demoApp, name: '<img src=x onerror=alert(1)>' };
  const html = cardHtml(evil, { root: '' });
  assert.ok(!/<img/i.test(html));
  assert.ok(html.includes('&lt;img'));
});

await test('cardHtml 在没有下载项时给出「查看详情」', () => {
  const html = cardHtml({ ...demoApp, downloads: [] }, { root: '' });
  assert.match(html, /查看详情/);
});

await test('detailContentHtml 生成完整详情页结构', () => {
  const html = detailContentHtml(demoApp, {
    root: '../../',
    site: { name: 'Xixi', url: 'https://example.com' },
    categories: { all: { slug: 'all', name: '全部' }, items: [{ slug: 'tools', name: '工具' }] },
    apps: [demoApp],
    platform: 'Windows',
  });
  assert.match(html, /<h1>Demo App<\/h1>/);
  assert.match(html, /id="downloads"/);
  assert.match(html, /更新日志/);
  assert.match(html, /历史版本/);
  assert.match(html, /\.\.\/\.\.\/downloads\/demo-x64\.exe/);
  assert.match(html, /系统要求/);
});

await test('detailContentHtml 在没有下载项时给出友好提示', () => {
  const html = detailContentHtml({ ...demoApp, downloads: [] }, { root: '../../', apps: [], categories: {} });
  assert.match(html, /暂时还没有提供下载/);
});

await test('jsonLd 生成合法的 SoftwareApplication 结构化数据', () => {
  const data = JSON.parse(jsonLd(demoApp, { url: 'https://example.com/', author: 'Me' }));
  assert.equal(data['@type'], 'SoftwareApplication');
  assert.equal(data.name, 'Demo App');
  assert.equal(data.offers.price, '0');
});

await test('所有图标都有对应的 SVG 路径', () => {
  Object.entries(ICONS).forEach(([key, value]) => {
    assert.ok(typeof value === 'string' && value.length > 5, `图标 ${key} 为空`);
  });
});

/* ---------------- 图标生成 ---------------- */
console.log('\n图标生成（scripts/make-icons.mjs）：');

await test('drawText 会画出非空像素且不会越界', () => {
  const canvas = createCanvas(200, 40);
  drawText(canvas, 'DEV', 10, 5, 4, [255, 255, 255], 1);
  let painted = 0;
  for (let i = 3; i < canvas.data.length; i += 4) if (canvas.data[i] > 0) painted += 1;
  assert.ok(painted > 100, `画出来的像素太少（${painted}）`);
  for (let y = 0; y < 40; y += 1) {
    assert.equal(canvas.data[(y * canvas.width + 199) * 4 + 3], 0, '画到了画布右边界之外');
  }
});

await test('drawText 传小数坐标也不会画砸（内部会先取整）', () => {
  const canvas = createCanvas(400, 60);
  drawText(canvas, 'AB', 20.4, 10.7, 5.2, [255, 255, 255], 1);
  let painted = 0;
  for (let i = 3; i < canvas.data.length; i += 4) if (canvas.data[i] > 0) painted += 1;
  assert.ok(painted > 100, `小数坐标下画出来的像素太少（${painted}）`);
});

await test('encodePng 生成合法的 PNG（签名 + 尺寸正确）', () => {
  const canvas = createCanvas(16, 16);
  drawMark(canvas, 0, 0, 16, [[79, 124, 255], [124, 92, 255]]);
  const png = encodePng(16, 16, canvas.data);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG 签名不对');
  assert.equal(png.readUInt32BE(16), 16, 'PNG 宽度不对');
  assert.equal(png.readUInt32BE(20), 16, 'PNG 高度不对');
});

/* ---------------- 真实数据 ---------------- */
console.log('\n真实数据（data/*.json）：');

/* ---------------- 直接双击打开（无 JS）时的回归检查 ---------------- */
console.log('\n无 JS / file:// 场景回归检查：');

const cssText = await readFile(new URL('../assets/css/style.css', import.meta.url), 'utf8');
const indexText = await readFile(new URL('../index.html', import.meta.url), 'utf8');
// 详情页取 apps.json 里的第一条，而不是写死某个软件 —— 软件被下线后这里不该跟着烂
const primaryApp = visibleApps[0] || null;
const primaryId = primaryApp ? primaryApp.id : '';
const detailText = primaryId
  ? await readFile(join(ROOT, 'apps', primaryId, 'index.html'), 'utf8').catch(() => '')
  : '';

await test('样式表里 .reveal 默认必须是可见的（否则预渲染的卡片会一片空白）', () => {
  const block = cssText.match(/^\.reveal \{([^}]*)\}/m);
  assert.ok(block, '找不到 .reveal 规则');
  assert.match(block[1], /opacity:\s*1/, '.reveal 默认应为 opacity: 1');
  assert.ok(!/opacity:\s*0/.test(block[1]), '.reveal 默认不能是 opacity: 0');
});

await test('入场动画只在 JS 渲染时启用（data-animate="true"）', () => {
  assert.match(cssText, /\.app-grid\[data-animate="true"\] \.reveal/);
});

await test('没有 JS 时会隐藏搜索、筛选等交互组件', () => {
  assert.match(cssText, /html:not\(\.js\) \.toolbar/);
  assert.match(cssText, /html:not\(\.js\) \.search-box/);
});

await test('首页卡片链接指向 apps/<id>/index.html（file:// 下也能点开）', () => {
  assert.match(indexText, /href="apps\/[a-z0-9-]+\/index\.html"/, '卡片链接应指向 index.html');
  assert.ok(
    !/href="apps\/(?!app\.html)[a-z0-9-]+\/"/.test(indexText),
    '不应再出现指向目录（以 / 结尾）的链接——在 file:// 下会变成目录列表'
  );
});

await test('首页加载的是打包后的普通脚本（直接双击打开也能跑）', () => {
  assert.match(indexText, /<script defer src="js\/home\.js">/, '首页应引用 js/home.js');
  assert.ok(!/type="module"/.test(indexText), '不应再引用 ES 模块（file:// 下会被浏览器拦截）');
  // 只要脚本能跑，就应该标记 html.js；禁用 JS 时这段内联脚本不会执行，页面自动降级。
  assert.match(indexText, /documentElement\.classList\.add\('js'\)/);
  assert.ok(!/location\.protocol !== 'file:'/.test(indexText), '不应再为 file:// 单独降级');
});

await test('详情页有预渲染内容 + 主题初始化 + 相对路径正确', () => {
  requireData();
  assert.ok(detailText, `apps/${primaryId}/index.html 不存在，请先运行 npm run build`);
  assert.match(detailText, /data-prerendered="true"/);
  assert.ok(
    detailText.includes(`<h1>${escapeHtml(primaryApp.name)}</h1>`),
    `apps/${primaryId}/index.html 的标题应该是「${primaryApp.name}」（读不到 name 字段？）`
  );
  assert.match(detailText, /href="\.\.\/\.\.\/assets\/css\/style\.css"/);
  assert.match(detailText, /data-theme/);
  assert.match(detailText, /<script defer src="\.\.\/\.\.\/js\/app\.js">/, '详情页应引用打包后的 js/app.js');
  assert.ok(!/type="module"/.test(detailText), '详情页不应再引用 ES 模块');
});

/* ---------------- 打包成普通脚本 ---------------- */
console.log('\n打包成普通脚本（file:// 下也能跑）：');

const readSource = (file) => readFile(join(ROOT, file), 'utf8');

async function bundleFromSources(pageFile) {
  const parts = [];
  for (const file of ['js/shared.js', 'js/render.js', 'js/core.js', pageFile]) {
    parts.push(`/* ---------- ${file} ---------- */\n${transformModule(await readSource(file), file)}`);
  }
  return buildBundleCode(parts);
}

const homeBundle = await bundleFromSources('js/main.js');
const appBundle = await bundleFromSources('js/app-page.js');

await test('打包结果里没有残留的 import / export', () => {
  [homeBundle, appBundle].forEach((code) => {
    assert.ok(!/^\s*export\s/m.test(code), '还有 export 关键字');
    assert.ok(!/^\s*import\s/m.test(code), '还有 import 语句');
  });
});

await test('打包结果是可编译的普通脚本（浏览器 file:// 也能执行）', () => {
  assert.doesNotThrow(() => new Function(homeBundle), '首页脚本编译失败');
  assert.doesNotThrow(() => new Function(appBundle), '详情页脚本编译失败');
});

/** js/admin-lib.js 的源码是 scripts/json-style.mjs + scripts/app-data.mjs */
async function bundleAdminLib() {
  const parts = [];
  const names = [];
  for (const file of ['scripts/json-style.mjs', 'scripts/app-data.mjs']) {
    const code = await readSource(file);
    names.push(...exportedNames(code));
    parts.push(`/* ---------- ${file} ---------- */\n${transformModule(code, file)}`);
  }
  return buildBundleCode(parts, { global: 'XIXI_DATA', names });
}

const adminLibBundle = await bundleAdminLib();

await test('js/home.js、js/app.js、js/admin-lib.js 都是最新的（提交前记得 npm run build）', async () => {
  const home = await readSource('js/home.js').catch(() => '');
  const app = await readSource('js/app.js').catch(() => '');
  const adminLib = await readSource('js/admin-lib.js').catch(() => '');
  assertSameText(home, homeBundle, 'js/home.js', '与源码不一致，请运行 npm run build');
  assertSameText(app, appBundle, 'js/app.js', '与源码不一致，请运行 npm run build');
  assertSameText(adminLib, adminLibBundle, 'js/admin-lib.js', '与源码不一致，请运行 npm run build');
});

await test('首页脚本能在无浏览器环境下跑通并渲染出卡片', async () => {
  const grid = makeElement('div');
  const chips = makeElement('div');
  const resultBar = makeElement('div');
  const viewButtons = [makeElement('button'), makeElement('button')];
  viewButtons[0].dataset.viewBtn = 'grid';
  viewButtons[1].dataset.viewBtn = 'list';
  const dom = createDom({
    pathname: '/index.html',
    elements: {
      '[data-app-grid]': grid,
      '[data-category-chips]': chips,
      '[data-result-bar]': resultBar,
      '[data-empty-state]': makeElement('div'),
      '[data-search-input]': makeElement('input'),
      '[data-search-clear]': makeElement('button'),
      '[data-sort]': makeElement('select'),
      '[data-reset-filters]': makeElement('button'),
      '[data-to-top]': makeElement('button'),
      '[data-view-btn]': viewButtons,
    },
  });
  // 数据直接来自 apps.json（不是陈旧的 data/apps.generated.js），
  // 这样 apps.json 烂掉时这个用例必须跟着红
  injectSiteData(dom);
  await runScript(homeBundle, dom);

  const cards = (grid.innerHTML.match(/class="app-card/g) || []).length;
  assert.equal(cards, visibleApps.length, `卡片数量不对（${cards}，应为 ${visibleApps.length}）`);
  assert.ok(
    grid.innerHTML.includes(`data-id="${primaryId}"`),
    `没渲染出 ${primaryId} 的卡片`
  );
  assert.ok(
    new RegExp(`href="[^"]*apps/${primaryId}/index\\.html"`).test(grid.innerHTML),
    '卡片链接不对'
  );
  assert.match(chips.innerHTML, /data-category="all"/, '分类按钮没渲染');
  assert.match(chips.innerHTML, /data-category="windows"/, '分类按钮没渲染');
  assert.match(resultBar.innerHTML, /个结果/, '统计信息没渲染');
  assert.equal(grid.dataset.animate, 'true', '应给网格加上入场动画标记');
  assert.ok(dom.documentElement.classList.contains('js'), '应给 html 加上 .js 标记');
});

await test('直接双击打开（file://）时，卡片与下载链接都能正常解析', async () => {
  // 模拟 Windows 上双击 index.html 的真实情况：路径形如 /C:/resource-site/index.html
  const grid = makeElement('div');
  const dom = createDom({
    pathname: '/C:/resource-site/index.html',
    protocol: 'file:',
    elements: { '[data-app-grid]': grid },
  });
  injectSiteData(dom);
  await runScript(homeBundle, dom);

  const link = new RegExp(`href="([^"]*apps/${primaryId}/index\\.html)"`).exec(grid.innerHTML);
  assert.ok(link, '没有渲染出卡片链接');
  assert.equal(
    new URL(link[1], dom.location.href).href,
    `file:///C:/resource-site/apps/${primaryId}/index.html`,
    'file:// 下卡片链接解析不对'
  );

  // 站内下载链接（downloads/…）在详情页里也是相对路径，file:// 下必须能落到本地文件。
  // 现有数据里全是外链，所以拿第一条真实软件 + 一个 downloads/ 目录项现场渲染一遍，
  // 而不是去读某个已经下线软件的旧快照。
  const withLocalDownload = {
    ...primaryApp,
    downloads: [
      { name: '站内安装包', url: `downloads/${primaryId}-test.exe`, size: '1 MB', platform: 'Windows', arch: 'x64', type: 'installer' },
      ...(primaryApp.downloads || []),
    ],
  };
  const rendered = detailContentHtml(withLocalDownload, {
    root: '../../',
    site,
    categories,
    apps: visibleApps,
    platform: 'Windows',
  });
  const download = /href="([^"]*downloads\/[^"]+)"/.exec(rendered);
  assert.ok(download, '详情页里没渲染出站内下载链接');
  assert.match(
    new URL(download[1], `file:///C:/resource-site/apps/${primaryId}/index.html`).href,
    /^file:\/\/\/C:\/resource-site\/downloads\//,
    `file:// 下下载链接解析不对：${download[1]}`
  );
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await test('端到端：按 index.html 里的顺序加载脚本，搜索能真正筛出结果', async () => {
  // 完全模拟浏览器：读出 index.html 里写的 <script src>，按顺序执行，
  // 然后像用户一样在搜索框里输入，确认列表真的会被筛掉。
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script([^>]*?)\ssrc="([^"]+)"/g)].map((m) => ({ attrs: m[1], src: m[2] }));
  assert.ok(scripts.length >= 2, 'index.html 里应该至少引用两个外链脚本');
  scripts.forEach((item) => {
    assert.ok(!/type="module"/.test(item.attrs), `${item.src} 不该是 ES 模块（file:// 下会被浏览器拦截）`);
  });

  const grid = makeElement('div');
  const search = makeElement('input');
  const empty = makeElement('div');
  const resultBar = makeElement('div');
  const dom = createDom({
    pathname: '/C:/resource-site/index.html',
    protocol: 'file:',
    elements: {
      '[data-app-grid]': grid,
      '[data-search-input]': search,
      '[data-empty-state]': empty,
      '[data-result-bar]': resultBar,
    },
  });

  for (const item of scripts) {
    await runScript(await readFile(join(ROOT, item.src), 'utf8'), dom);
  }

  const cards = () => (grid.innerHTML.match(/class="app-card/g) || []).length;
  assert.equal(cards(), visibleApps.length, `首屏应该把全部软件都渲染出来（应为 ${visibleApps.length} 个）`);

  // 搜索：用一个能命中、但命中不了全部的「常规词」。期望值从 apps.json 现算，
  // 不写死「等于 1」—— 那样加一个软件就得改测试，改的时候很容易顺手放宽断言。
  const needle = 'ocr';
  const hits = visibleApps.filter((app) => matchQuery(app, needle));
  assert.ok(
    hits.length > 0 && hits.length < visibleApps.length,
    `搜索词「${needle}」应该只命中一部分（实际 ${hits.length}/${visibleApps.length}），否则证明不了筛选真的生效`
  );
  search.value = needle;
  search.dispatchEvent('input');
  await sleep(280);
  assert.equal(cards(), hits.length, `搜索 ${needle} 应该剩 ${hits.length} 个结果，实际 ${cards()} 个`);
  hits.forEach((app) => {
    assert.ok(grid.innerHTML.includes(`data-id="${app.id}"`), `搜索结果里应该有 ${app.id}`);
  });

  // 搜不到时显示空状态，而不是留一片空白让人以为坏了
  search.value = 'zzz-不存在的软件';
  search.dispatchEvent('input');
  await sleep(280);
  assert.equal(cards(), 0, '搜不到时不应该还有卡片');
  assert.equal(empty.dataset.visible, 'true', '应该显示「没有找到」的空状态提示');

  // 清空搜索后恢复全部
  search.value = '';
  search.dispatchEvent('input');
  await sleep(280);
  assert.equal(cards(), visibleApps.length, '清空搜索后应该恢复全部软件');
});

await test('file:// 下不会因为改地址栏而崩（history.replaceState 有异常保护）', async () => {
  const core = await readSource('js/core.js');
  assert.match(core, /try \{\s*window\.history\.replaceState/, 'writeUrlState 需要 try/catch');
});

await test('详情页脚本能跑通：预渲染页面 + ?id= 兜底渲染', async () => {
  // 情况一：构建好的静态详情页（内容已预渲染）
  const prerendered = makeElement('main');
  prerendered.dataset.appId = primaryId;
  prerendered.dataset.prerendered = 'true';
  const dom1 = createDom({ pathname: `/apps/${primaryId}/index.html`, elements: { '[data-app-root]': prerendered } });
  injectSiteData(dom1);
  await runScript(appBundle, dom1);
  assert.ok(dom1.documentElement.classList.contains('js'));
  assert.equal(dom1.document.body.dataset.ready, 'true', '详情页脚本没有跑完');

  // 情况二：通用兜底页 apps/app.html?id=<真实软件>（需要现场渲染）
  const dynamic = makeElement('main');
  dynamic.dataset.appId = '';
  dynamic.dataset.prerendered = 'false';
  const dom2 = createDom({
    pathname: '/apps/app.html',
    search: `?id=${primaryId}`,
    elements: { '[data-app-root]': dynamic },
  });
  injectSiteData(dom2);
  await runScript(appBundle, dom2);
  assert.ok(
    dynamic.innerHTML.includes(escapeHtml(primaryApp.name)),
    `兜底页没有渲染出 ${primaryApp.name}`
  );
  assert.match(dynamic.innerHTML, /id="downloads"/, '兜底页没有下载区');
});

await test('端到端：详情页也按 HTML 里写的顺序加载脚本，file:// 下能跑通', async () => {
  requireData();
  // 遍历 apps.json 里所有可见软件，而不是写死两个（写死的那个软件已经下线了）
  assert.ok(appIds.length > 0, '至少要有一个可见软件');
  for (const id of appIds) {
    const html = await readFile(join(ROOT, 'apps', id, 'index.html'), 'utf8');
    assert.ok(!/type="module"/.test(html), `apps/${id} 不应引用 ES 模块`);
    const scripts = [...html.matchAll(/<script([^>]*?)\ssrc="([^"]+)"/g)].map((m) => ({ src: m[2] }));
    assert.ok(scripts.length >= 2, `apps/${id}/index.html 里应该至少引用两个外链脚本`);

    const main = makeElement('main');
    main.dataset.appId = id;
    main.dataset.prerendered = 'true';
    const dom = createDom({
      pathname: `/C:/resource-site/apps/${id}/index.html`,
      protocol: 'file:',
      elements: { '[data-app-root]': main },
    });
    for (const item of scripts) {
      // 详情页里的路径是 ../../ 开头的相对路径
      await runScript(await readFile(join(ROOT, item.src.replace(/^(\.\.\/)+/, '')), 'utf8'), dom);
    }
    assert.equal(dom.document.body.dataset.ready, 'true', `apps/${id} 的详情页脚本没有跑完`);
  }
});

await test('data/*.json 能正常解析', () => {
  // 这条用例就是那个「数据闸门」：数据坏了要在这里红，
  // 而不是在模块顶层抛异常把后面几十个用例一起打掉。
  requireData();
  assert.ok(site && typeof site === 'object');
  assert.ok(Array.isArray(categories.items));
  assert.ok(Array.isArray(apps) && apps.length > 0, 'apps.json 里至少要有一个软件');
});

await test('每个软件都有 id / name / downloads 字段', () => {
  requireData();
  apps.forEach((app) => {
    assert.ok(app.id, `${app.name || '?'} 缺少 id`);
    assert.ok(app.name, `${app.id} 缺少 name`);
    assert.ok(Array.isArray(app.downloads), `${app.id} 的 downloads 不是数组`);
  });
});

await test('id 不重复', () => {
  requireData();
  const ids = apps.map((app) => app.id);
  assert.equal(new Set(ids).size, ids.length, '存在重复的 id');
});

await test('每个下载地址都是 http(s) 或站内路径', () => {
  requireData();
  apps.forEach((app) => {
    (app.downloads || []).forEach((item) => {
      assert.ok(
        /^(https?:)?\/\//i.test(item.url) || String(item.url).startsWith('downloads/'),
        `${app.id} 的下载地址不合法：${item.url}`
      );
    });
  });
});

await test('数据校验没有致命错误', async () => {
  requireData();
  const { errors } = await validateProject(ROOT, { site, apps });
  assert.equal(errors.length, 0, errors.join(' / '));
});

/* ---------------- 一键发布工具（scripts/publish.mjs 依赖的逻辑）---------------- */
await test('发布工具：按文件后缀猜出平台 / 架构 / 类型', () => {
  const portable = detectPackage('MyTool-1.2.3-x64-portable.exe');
  assert.equal(portable.platform, 'Windows');
  assert.equal(portable.arch, 'x64');
  assert.equal(portable.type, 'portable');

  const apk = detectPackage('MyTool-1.3.0-arm64.apk');
  assert.equal(apk.platform, 'Android');
  assert.equal(apk.arch, 'arm64');
  assert.equal(apk.type, 'apk');

  assert.equal(detectPackage('Xixi_1.0_amd64.deb').platform, 'Linux');
  assert.equal(detectPackage('Xixi-1.0.dmg').platform, 'macOS');
  assert.equal(detectPackage('某软件-免安装版.zip').type, 'portable');
  assert.equal(detectPackage('未知文件.bin').platform, '全平台');
});

await test('发布工具：软件名 → 网址短名', () => {
  assert.equal(slugify('My Tool 1.2.3.exe'), 'my-tool-1-2-3');
  assert.equal(slugify('Xixi-Player_v2.exe'), 'xixi-player-v2');
  assert.equal(slugify('我的工具'), '', '纯中文名没法做网址，应该返回空字符串让用户手动指定');
});

await test('发布工具：文件大小显示', () => {
  assert.equal(humanSize(512), '512 B');
  assert.equal(humanSize(1024 * 1024 * 42), '42 MB');
  assert.equal(humanSize(1536), '1.5 KB');
});

await test('发布工具：更新已有软件只改那一段', async () => {
  const text = await readFile(join(ROOT, 'data', 'apps.json'), 'utf8');
  const data = JSON.parse(text);
  const nextText = spliceApp(text, { ...data.apps[0], version: '9.9.9' });
  assert.ok(nextText, 'spliceApp 应该返回新的文件文本');

  const next = JSON.parse(nextText);
  assert.equal(next.apps.length, data.apps.length, '替换不应该改变软件数量');
  assert.equal(next.apps[0].version, '9.9.9');

  const untouchedBefore = data.apps.slice(1).map((app) => JSON.stringify(app));
  const untouchedAfter = next.apps.slice(1).map((app) => JSON.stringify(app));
  assert.deepEqual(untouchedAfter, untouchedBefore, '其他软件的文本不应该被改动');
  assert.equal(spliceApp(nextText, { ...data.apps[0], version: '9.9.9' }), nextText, '重复写入应该是稳定的');
});

await test('发布工具：新增软件是追加，不重排整个文件', async () => {
  const text = await readFile(join(ROOT, 'data', 'apps.json'), 'utf8');
  const count = JSON.parse(text).apps.length;
  const added = spliceApp(text, { id: 'test-only-app', name: '测试软件', downloads: [] });
  assert.equal(JSON.parse(added).apps.length, count + 1);

  const before = text.split('\n');
  const after = added.split('\n');
  let prefix = 0;
  while (prefix < before.length && before[prefix] === after[prefix]) prefix += 1;
  // 唯一允许被改动的，是「最后一个条目的收尾大括号」多了一个逗号
  assert.ok(prefix >= before.length - 4, `新条目应该只追加在末尾（共同前缀 ${prefix}/${before.length} 行）`);
  assert.equal(before[prefix], after[prefix].replace(/,$/, ''), `第 ${prefix + 1} 行不应该被改成别的内容`);
  assert.equal(after.slice(-3).join('\n'), '  ]\n}\n', '文件结尾应该是 apps 数组 + 根对象的收尾');
  assert.ok(added.includes('"id": "test-only-app"'), '新条目应该写进了文件');
});

await test('发布工具：改站点信息只动那一个字段', async () => {
  const text = await readFile(join(ROOT, 'data', 'site.json'), 'utf8');
  const next = setTopLevelValue(text, 'name', '测试站名');
  const parsed = JSON.parse(next);
  assert.equal(parsed.name, '测试站名');
  assert.equal(parsed.url, JSON.parse(text).url, '其他字段应该保持原样');
  assert.ok(next.split('\n').length <= text.split('\n').length + 1, '单行字段的修改不应该让文件变大太多');
});

await test('发布工具：下载项合并规则（同平台同架构替换，否则追加）', () => {
  const app = {
    downloads: [{ name: 'Windows x64 安装版', url: 'downloads/a.exe', platform: 'Windows', arch: 'x64' }],
  };
  const replaced = mergeDownload(app, { name: 'Windows x64 安装版', url: 'downloads/b.exe', platform: 'Windows', arch: 'x64' });
  assert.equal(replaced.action, 'replace');
  assert.equal(app.downloads.length, 1, '同平台同架构应该替换，而不是追加');
  assert.equal(app.downloads[0].url, 'downloads/b.exe');

  const added = mergeDownload(app, { name: 'Android APK', url: 'downloads/c.apk', platform: 'Android', arch: 'universal' });
  assert.equal(added.action, 'add');
  assert.equal(app.downloads.length, 2, '换平台应该新增一个下载项');
});

await test('发布工具：版本号 +1', () => {
  assert.equal(nextBump('1.2.3', 'patch'), '1.2.4');
  assert.equal(nextBump('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextBump('1.2.3', 'major'), '2.0.0');
  assert.equal(nextBump('v1.0', 'patch'), 'v1.0.1');
  assert.equal(nextBump('', 'patch'), '1.0.0');
  assert.equal(nextBump('随便写的', 'patch'), '随便写的', '看不懂的版本号应该原样返回，不要瞎改');
});

await test('发布工具：更新版本时把老版本记进历史版本', () => {
  const app = { version: '2.0.0', downloads: [{ name: 'Windows x64', url: 'downloads/new.exe' }], changelog: [{ version: '2.0.0', date: '2026-01-01', notes: ['上一版说明'] }] };
  const previous = { version: '1.9.0', updated: '2025-12-01', size: '10 MB', downloads: [{ name: 'Windows x64（旧）', url: 'downloads/old.exe' }], changelog: [{ version: '1.9.0', date: '2025-12-01', notes: ['老版本'] }] };
  assert.equal(recordHistory(app, previous), true);
  assert.equal(app.history.length, 1);
  assert.equal(app.history[0].version, '1.9.0');
  assert.equal(app.history[0].downloads[0].url, 'downloads/old.exe', '历史版本要带上当时的下载地址');
  assert.equal(recordHistory(app, previous), false, '同一个版本不应该重复记录');

  const sameVersion = { ...app, version: '1.9.0' };
  assert.equal(recordHistory(sameVersion, previous), false, '版本号没变就不该记历史版本');
});

await test('发布工具：更新日志同一版本同一天只留一条', () => {
  const app = { changelog: [] };
  pushChangelog(app, '1.0.0', ['第一次', '第二次'], '2026-01-01');
  pushChangelog(app, '1.0.0', ['第二次', '第三次'], '2026-01-01');
  assert.equal(app.changelog.length, 1);
  assert.deepEqual(app.changelog[0].notes, ['第一次', '第二次', '第三次']);
});

await test('发布工具：数据校验能挑出明显的问题', () => {
  assert.deepEqual(validateApp({ id: 'ok-app', name: '正常', downloads: [{ url: 'downloads/a.exe' }] }), []);
  assert.ok(validateApp({ id: '大写ID', name: 'x', downloads: [{ url: 'downloads/a.exe' }] }).length > 0);
  assert.ok(validateApp({ id: 'no-download', name: 'x', downloads: [] }).length > 0);
  assert.ok(validateApp({ id: 'no-name', downloads: [{ url: 'downloads/a.exe' }] }).length > 0);
  assert.ok(validateApp({ id: 'no-url', name: 'x', downloads: [{}] }).length > 0);
});

await test('本地后台：界面脚本用到的元素在 admin/index.html 里都存在', async () => {
  const html = await readFile(join(ROOT, 'admin', 'index.html'), 'utf8');
  const js = await readFile(join(ROOT, 'js', 'admin.js'), 'utf8');

  // 收集 $('...') / $$('...') 以及 field() 里用到的 [data-xxx="yy"] 选择器
  const attributes = new Set();
  const collect = (text) => {
    for (const match of String(text).matchAll(/\[(data-[a-z0-9-]+)(?:="([a-z0-9-]*)")?\]/gi)) {
      attributes.add(match[2] ? `${match[1]}="${match[2]}"` : match[1]);
    }
  };
  for (const match of js.matchAll(/\$\$?\(\s*'([^']+)'/g)) collect(match[1]);
  for (const match of js.matchAll(/\$\$?\(\s*`([^`]+)`/g)) collect(match[1]);
  const fieldSelector = /const field = \(name\) => \$\('([^']+)'\)/.exec(js);
  if (fieldSelector) collect(fieldSelector[1]);

  assert.ok(attributes.size > 10, `应该收集到一堆选择器，实际只有 ${attributes.size} 个`);
  const missing = [...attributes].filter((selector) => {
    const [name, value] = selector.split('=');
    return value ? !html.includes(`${name}="${value}"`) : !html.includes(name);
  });
  assert.deepEqual(missing, [], `admin/index.html 里缺少这些元素：${missing.join('、')}`);
});

await test('命令行参数：--port 9000 和 --port=9000 两种写法都认', () => {
  assert.equal(argValue(['--port', '9000'], 'port', '8787'), '9000');
  assert.equal(argValue(['--port=9000'], 'port', '8787'), '9000');
  assert.equal(argValue(['--open', '--port=9000'], 'port', '8787'), '9000');
  assert.equal(argValue([], 'port', '8787'), '8787');
  assert.equal(argValue(['--port'], 'port', '8787'), '8787');
  assert.equal(argValue(['--port', '--open'], 'port', '8787'), '8787');
  assert.equal(argValue(['--port='], 'port', '8787'), '8787');
});

await test('本地后台：端口号填错要拦住，不能静默换端口', () => {
  assert.equal(parsePort('8791'), 8791);
  assert.equal(parsePort(' 8791 '), 8791);
  assert.equal(parsePort(''), 8787);
  assert.equal(parsePort(undefined), 8787);
  assert.equal(parsePort('abc'), null);
  assert.equal(parsePort('0'), null);
  assert.equal(parsePort('-1'), null);
  assert.equal(parsePort('70000'), null);
  assert.equal(parsePort('80.5'), null);
});

await test('本地后台：页面引用的文件都真实存在', async () => {
  const html = await readFile(join(ROOT, 'admin', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\.\.?\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(refs.length >= 3, `admin/index.html 应该引用样式和脚本，实际只有 ${refs.length} 个`);

  const missing = [];
  for (const ref of refs) {
    const target = resolve(join(ROOT, 'admin', ref));
    try {
      await stat(target);
    } catch {
      missing.push(ref);
    }
  }
  assert.deepEqual(missing, [], `admin/index.html 引用了不存在的文件：${missing.join('、')}`);
});

/* ---------------- 在线后台（页面部署在公网，直接调 GitHub API） ---------------- */

/** 假的 fetch 响应（只实现 js/admin-github.js 用到的那几个属性） */
function fakeResponse(status, payload) {
  const text = payload === undefined ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/** 假 fetch：按 URL 片段路由，并记下每次请求（路由先后 = 匹配优先级） */
function makeFetcher(routes) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const call = { url, method: options.method || 'GET', headers: options.headers || {}, body: options.body };
    calls.push(call);
    for (const [needle, handler] of routes) {
      if (url.includes(needle)) return handler(url, call, calls);
    }
    return fakeResponse(404, { message: 'Not Found' });
  };
  fetcher.calls = calls;
  return fetcher;
}

/** 在 DOM 替身里跑 js/admin-github.js，拿到 window.XIXI_GITHUB */
async function loadGithub(fetcher) {
  const dom = createDom({ pathname: '/admin/index.html' });
  dom.fetch = fetcher || makeFetcher([]);
  await runScript(await readSource('js/admin-github.js'), dom);
  return dom;
}

/** 在 DOM 替身里跑 js/admin-lib.js，拿到 window.XIXI_DATA */
async function loadLib() {
  const dom = createDom({ pathname: '/admin/index.html' });
  await runScript(adminLibBundle, dom);
  return dom.window.XIXI_DATA;
}

await test('在线后台：仓库地址怎么填都认得', async () => {
  const { window } = await loadGithub();
  const { parseRepo } = window.XIXI_GITHUB;
  assert.deepEqual(parseRepo('2681114373zxd-prog/resource-site'), {
    owner: '2681114373zxd-prog',
    repo: 'resource-site',
  });
  assert.deepEqual(parseRepo('https://github.com/2681114373zxd-prog/resource-site'), {
    owner: '2681114373zxd-prog',
    repo: 'resource-site',
  });
  assert.deepEqual(parseRepo('https://github.com/2681114373zxd-prog/resource-site.git'), {
    owner: '2681114373zxd-prog',
    repo: 'resource-site',
  });
  // 多带了路径（比如复制了分支页面的网址）也只取前两段
  assert.deepEqual(parseRepo('a/b/tree/main'), { owner: 'a', repo: 'b' });
  assert.equal(parseRepo('resource-site'), null);
  assert.equal(parseRepo('a b/c'), null);
  assert.equal(parseRepo(''), null);
});

await test('在线后台：中文内容转 base64 不丢字', async () => {
  const { window } = await loadGithub();
  const { toBase64, fromBase64 } = window.XIXI_GITHUB;
  const text = '{"name":"我的工具箱","note":"中文 · 符号 & emoji 🎉"}';
  // 和 Node 的 UTF-8 编码对齐（btoa 直接吃中文会报错，所以必须过 TextEncoder）
  assert.equal(toBase64(text), Buffer.from(text, 'utf8').toString('base64'));
  assert.equal(fromBase64(toBase64(text)), text);
  // GitHub 返回的 base64 带换行，也要能解
  assert.equal(fromBase64(toBase64(text).replace(/(.{20})/g, '$1\n')), text);
});

await test('在线后台：GitHub 的每种报错都翻成了能照着做的话', async () => {
  const { window } = await loadGithub();
  const { explain } = window.XIXI_GITHUB;
  assert.match(explain(401), /令牌/);
  assert.match(explain(403), /权限/);
  assert.match(explain(404), /勾选/);
  assert.match(explain(409), /冲突/);
  assert.match(explain(422), /不接受/);
  assert.match(explain(429), /限流/);
  for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502]) {
    assert.ok(explain(status).length > 6, `HTTP ${status} 应该有看得懂的中文说明`);
  }
});

const CONFIG = { token: 'tok', owner: 'o', repo: 'r', branch: 'main' };

await test('在线后台：从仓库读文件能拿到内容和 sha', async () => {
  const text = '{\n  "name": "Xixi"\n}\n';
  const fetcher = makeFetcher([
    ['/contents/data/site.json', () => fakeResponse(200, { sha: 'abc123', content: Buffer.from(text, 'utf8').toString('base64') })],
  ]);
  const { window } = await loadGithub(fetcher);
  const result = await window.XIXI_GITHUB.readFile(CONFIG, 'data/site.json');
  assert.equal(result.ok, true);
  assert.equal(result.sha, 'abc123');
  assert.equal(result.text, text);
  assert.match(fetcher.calls[0].url, /\/repos\/o\/r\/contents\/data\/site\.json\?ref=main$/);
  assert.equal(fetcher.calls[0].headers.authorization, 'Bearer tok');
});

await test('在线后台：仓库里没有的文件算「缺失」，不是报错', async () => {
  const fetcher = makeFetcher([['/contents/', () => fakeResponse(404, { message: 'Not Found' })]]);
  const { window } = await loadGithub(fetcher);
  const result = await window.XIXI_GITHUB.readFile(CONFIG, 'data/nope.json');
  assert.equal(result.ok, true);
  assert.equal(result.missing, true);
});

await test('在线后台：提交文件时带上 sha、分支和 UTF-8 内容', async () => {
  const fetcher = makeFetcher([
    ['/contents/', () => fakeResponse(200, { commit: { sha: 'c0ffee', html_url: 'https://github.com/o/r/commit/c0ffee' } })],
  ]);
  const { window } = await loadGithub(fetcher);
  const result = await window.XIXI_GITHUB.commitFile(CONFIG, 'data/apps.json', '{"name":"中文"}', 'add: 我的工具箱', 'sha1');
  assert.equal(result.ok, true);
  assert.equal(result.sha, 'c0ffee');
  assert.match(result.url, /commit\/c0ffee$/);
  const body = JSON.parse(fetcher.calls[0].body);
  assert.equal(body.message, 'add: 我的工具箱');
  assert.equal(body.branch, 'main');
  assert.equal(body.sha, 'sha1');
  assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), '{"name":"中文"}');
});

await test('在线后台：提交撞车（409）会自动重读再试一次', async () => {
  let puts = 0;
  const text = '{ "apps": [] }';
  const fetcher = makeFetcher([
    [
      '/contents/',
      (url, call) => {
        if (call.method === 'PUT') {
          puts += 1;
          return puts === 1
            ? fakeResponse(409, { message: 'sha does not match' })
            : fakeResponse(200, { commit: { sha: 'ok' } });
        }
        return fakeResponse(200, { sha: `s${puts}`, content: Buffer.from(text, 'utf8').toString('base64') });
      },
    ],
  ]);
  const { window } = await loadGithub(fetcher);
  const result = await window.XIXI_GITHUB.updateFile(CONFIG, 'data/apps.json', () => '{ "apps": [1] }', 'add: x');
  assert.equal(result.ok, true, result.error);
  assert.equal(puts, 2, '第一次撞车后应该重读再写一次');
});

await test('在线后台：上传前会自动建 Release，已存在就直接复用', async () => {
  const releases = [];
  const fetcher = makeFetcher([
    [
      '/releases/tags/',
      () =>
        releases.length
          ? fakeResponse(200, { id: 9, upload_url: 'https://uploads.github.com/x{?name,label}' })
          : fakeResponse(404, { message: 'Not Found' }),
    ],
    [
      '/releases',
      (url, call) => {
        releases.push(JSON.parse(call.body));
        return fakeResponse(201, { id: 9, upload_url: 'https://uploads.github.com/x{?name,label}' });
      },
    ],
  ]);
  const { window } = await loadGithub(fetcher);
  const first = await window.XIXI_GITHUB.ensureRelease(CONFIG, 'v1.2.0', '我的工具箱 1.2.0');
  assert.equal(first.ok, true);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].tag_name, 'v1.2.0');
  assert.equal(releases[0].draft, false);
  // 第二次：tag 已经查得到了，不该再建一个
  const second = await window.XIXI_GITHUB.ensureRelease(CONFIG, 'v1.2.0', '我的工具箱 1.2.0');
  assert.equal(second.ok, true);
  assert.equal(releases.length, 1, '不该重复创建 release');
});

await test('在线后台：附件名里的空格和路径分隔符会被清掉', async () => {
  const { window } = await loadGithub();
  const { assetName } = window.XIXI_GITHUB;
  assert.equal(assetName('我的 工具 v1.0.exe'), '我的-工具-v1.0.exe');
  assert.equal(assetName('a/b\\c.exe'), 'a-b-c.exe');
});

await test('在线后台：浏览器里的 JSON 改写逻辑和本地后台逐字一致', async () => {
  const source = await readSource('data/apps.json');
  const lib = await loadLib();
  assert.ok(lib, 'js/admin-lib.js 要把函数挂到 window.XIXI_DATA 上');
  for (const name of ['spliceApp', 'removeApp', 'setTopLevelValue', 'mergeDownload', 'nextBump', 'recordHistory']) {
    assert.equal(typeof lib[name], 'function', `window.XIXI_DATA.${name} 应该存在`);
  }

  // 同一份数据、同一个操作，两边结果必须一模一样，否则线上和本地的 apps.json 会不一样
  const changed = { ...JSON.parse(source).apps[0], version: '99.1.2', tagline: '改过的简介' };
  assert.equal(lib.spliceApp(source, changed), spliceApp(source, changed), 'spliceApp 结果不一致');
  assert.equal(lib.removeApp(source, 'termux'), removeApp(source, 'termux'), 'removeApp 结果不一致');
  assert.equal(
    lib.setTopLevelValue(source, 'github', 'https://github.com/a/b'),
    setTopLevelValue(source, 'github', 'https://github.com/a/b'),
    'setTopLevelValue 结果不一致'
  );
});

await test('构建产物：密码和缓存不会进 dist，在线后台页面会进 dist', async () => {
  const dist = join(ROOT, 'dist');
  // 以前是「dist 不存在就 return」—— 没构建过的仓库上这条会记成 ✓，
  // 等于什么都没检查。现在前置强制构建，构建不出来就是失败。
  await ensureDist();
  assert.equal(await pathExists(join(dist, 'data', 'admin.json')), false, 'dist 里绝不能有后台密码');
  assert.equal(await pathExists(join(dist, '.wrangler')), false, 'dist 里不该有 wrangler 缓存');
  assert.equal(await pathExists(join(dist, 'scripts')), false, 'dist 里不该有构建脚本');
  assert.equal(await pathExists(join(dist, 'admin', 'index.html')), true, '在线后台要跟着一起部署');
});

await test('构建脚本：始终把 data/admin.json 排除在 dist 之外', async () => {
  const source = await readSource('scripts/build.mjs');
  assert.match(source, /skipPaths[\s\S]{0,140}data\/admin\.json/, 'build.mjs 必须排除 data/admin.json');
  assert.match(source, /\.wrangler/, 'build.mjs 必须排除 .wrangler');
});

await test('后台页面：脚本按依赖顺序加载，而且不被搜索引擎收录', async () => {
  const html = await readSource('admin/index.html');
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ['../js/admin-lib.js', '../js/admin-github.js', '../js/admin.js']);
  assert.match(html, /name="robots" content="noindex/);
});

const settle = async (times = 12) => {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** 造一个够跑 js/admin.js 的 DOM 替身：元素按脚本里用到的选择器自动补齐 */
async function stubAdminDom() {
  const source = await readSource('js/admin.js');
  const elements = {};
  for (const match of source.matchAll(/\$\$?\(\s*'(\[data-[^']+)'/g)) {
    if (!(match[1] in elements)) elements[match[1]] = makeElement('div');
  }
  const select = (name, values) => {
    const el = makeElement('select');
    el.dataset.field = name;
    el.options = values.map((value) => ({ value }));
    el.value = values[0];
    return el;
  };
  // field(name) 用的是模板字符串，上面的正则收不到，手动补
  for (const name of ['name', 'id', 'version', 'tagline', 'notes', 'featured']) {
    elements[`[data-field="${name}"]`] = makeElement('input');
  }
  elements['[data-field="category"]'] = select('category', ['Windows', '工具']);
  elements['[data-field="platform"]'] = select('platform', ['Windows', 'macOS', 'Linux', 'Android', '全平台']);
  elements['[data-field="arch"]'] = select('arch', ['x64', 'arm64', 'x86', 'universal']);
  elements['[data-field="type"]'] = select('type', ['installer', 'portable', 'apk', 'archive']);
  // 状态区要能 querySelector('code') / ('strong')，不然刷新 git 状态时会炸
  const gitBox = makeElement('div');
  gitBox.querySelectorAll = () => [makeElement('code'), makeElement('code'), makeElement('code')];
  gitBox.querySelector = () => makeElement('strong');
  elements['[data-git-box]'] = gitBox;
  const dom = createDom({ pathname: '/admin/index.html', elements });
  // 渲染软件列表时会给每个条目填子节点，替身要能返回可写的小元素
  dom.document.createElement = () => {
    const el = makeElement('div');
    el.querySelector = () => makeElement('span');
    el.querySelectorAll = (selector) => (selector === '.admin-tag' ? [makeElement('span'), makeElement('span')] : []);
    return el;
  };
  // 和真实页面一样：json 共用逻辑 → GitHub 客户端 → 界面脚本
  await runScript(adminLibBundle, dom);
  await runScript(await readSource('js/admin-github.js'), dom);
  return dom;
}

await test('本地后台：选安装包 → 保存并上传，提交的数据和以前一致', async () => {
  const dom = await stubAdminDom();
  const requests = [];
  dom.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes('/api/session')) {
      return fakeResponse(200, { loggedIn: true, tool: { version: '9.9.9' }, site: { name: 'Xixi' } });
    }
    if (url.includes('/api/data')) {
      return fakeResponse(200, { ok: true, apps: [], site: {}, categories: { items: [] } });
    }
    if (url.includes('/api/apps')) return fakeResponse(200, { ok: true, mode: 'create', build: { output: '' } });
    if (url.includes('/api/git')) return fakeResponse(200, { ok: true, git: { ok: true, branch: 'main' } });
    if (url.includes('/api/publish')) return fakeResponse(200, { ok: true, steps: [], hint: '' });
    return fakeResponse(404, {});
  };
  // 假的上传：模拟服务端把文件写进 downloads/ 后的返回
  dom.XMLHttpRequest = class {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.responseText = '';
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader() {}
    send() {
      this.status = 200;
      this.responseText = JSON.stringify({
        ok: true,
        file: 'xixiregression-1.2.3-x64.exe',
        url: 'downloads/xixiregression-1.2.3-x64.exe',
        size: '40 KB',
        bytes: 40960,
        sha256: 'abc123',
      });
      if (this.onload) this.onload();
    }
  };

  await runScript(await readSource('js/admin.js'), dom);
  await settle();
  assert.equal(dom.document.body.dataset.ready, 'true', '应该认出本地后台并进入界面');
  assert.equal(dom.document.querySelector('[data-mode]').textContent, '本地后台');

  // 选安装包 → 名字 / 短名 / 版本 / 平台 应该自动填好
  const fileInput = dom.document.querySelector('[data-file]');
  fileInput.files = [{ name: 'XixiRegression-1.2.3-x64.exe', size: 40960 }];
  fileInput.dispatchEvent('change');
  assert.equal(dom.document.querySelector('[data-field="version"]').value, '1.2.3');
  assert.equal(dom.document.querySelector('[data-field="platform"]').value, 'Windows');

  dom.document.querySelector('[data-save-push]').dispatchEvent('click');
  await settle();

  const posted = requests.find((item) => item.url.includes('/api/apps'));
  const statusText = dom.document.querySelector('[data-status]').textContent;
  assert.ok(
    posted,
    `应该向 /api/apps 提交数据（状态栏：${statusText}｜请求：${requests.map((item) => item.url).join(', ')}）`
  );
  const body = JSON.parse(posted.options.body);
  assert.equal(body.mode, 'create');
  assert.equal(body.app.version, '1.2.3');
  assert.equal(body.app.platforms.join('/'), 'Windows');
  assert.equal(body.app.downloads.length, 1);
  assert.equal(body.app.downloads[0].url, 'downloads/xixiregression-1.2.3-x64.exe');
  assert.equal(body.app.downloads[0].size, '40 KB');
  assert.equal(body.app.downloads[0].sha256, 'abc123');
  assert.equal(body.app.downloads[0].platform, 'Windows');
  assert.equal(body.app.downloads[0].arch, 'x64');
  assert.equal(body.app.size, '40 KB');
  // 「保存并一键上传」还要接着调 /api/publish
  assert.ok(requests.some((item) => item.url.includes('/api/publish')), '应该接着一键上传到 GitHub');
});

await test('在线后台：连上之后发布软件，安装包进 Releases、apps.json 直接提交', async () => {
  const dom = await stubAdminDom();
  const calls = [];
  const appsJson = await readSource('data/apps.json');
  const siteJson = await readSource('data/site.json');
  const pkgJson = await readSource('package.json');

  dom.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, method, body: options.body });
    if (url.includes('../package.json')) return fakeResponse(200, pkgJson);
    if (url.includes('../data/site.json')) return fakeResponse(200, siteJson);
    if (url.includes('/contents/data/site.json')) return fakeResponse(200, { sha: 's1', content: Buffer.from(siteJson, 'utf8').toString('base64') });
    if (url.includes('/contents/data/categories.json')) return fakeResponse(200, { sha: 's2', content: Buffer.from('{"items":[]}', 'utf8').toString('base64') });
    if (url.includes('/contents/data/apps.json')) {
      if (method === 'PUT') return fakeResponse(200, { commit: { sha: 'newsha', html_url: 'https://github.com/o/r/commit/newsha' } });
      return fakeResponse(200, { sha: 's3', content: Buffer.from(appsJson, 'utf8').toString('base64') });
    }
    if (url.includes('/releases/tags/')) {
      return fakeResponse(404, { message: 'Not Found' });
    }
    if (url.endsWith('/releases')) {
      return fakeResponse(201, { id: 7, upload_url: 'https://uploads.github.com/repos/o/r/releases/7/assets{?name,label}' });
    }
    if (url.includes('/commits')) return fakeResponse(200, []);
    if (url.includes('/repos/o/r')) {
      return fakeResponse(200, { full_name: 'o/r', default_branch: 'main', permissions: { push: true } });
    }
    return fakeResponse(404, { message: 'Not Found' });
  };

  // 假的上传：模拟 release 附件传完后的返回
  dom.XMLHttpRequest = class {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.responseText = '';
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this[name] = value;
    }
    send() {
      this.status = 201;
      this.responseText = JSON.stringify({
        name: 'xixi-online-1.0.0-x64.exe',
        size: 40960,
        browser_download_url: 'https://github.com/o/r/releases/download/v1.0.0/xixi-online-1.0.0-x64.exe',
      });
      if (this.onload) this.onload();
    }
  };

  await runScript(await readSource('js/admin.js'), dom);
  await settle();
  assert.equal(dom.document.querySelector('[data-mode]').textContent, '在线后台 · GitHub API');
  // 没存过令牌 → 应该显示连接表单，仓库地址从 data/site.json 自动填好
  const connectPanel = dom.document.querySelector('[data-connect]');
  assert.equal(connectPanel.hidden, false, '没连接时应该显示「连接 GitHub」');
  assert.equal(dom.document.querySelector('[data-github-repo]').value, '2681114373zxd-prog/resource-site');

  // 填令牌 + 仓库，提交
  dom.document.querySelector('[data-github-token]').value = 'github_pat_test';
  dom.document.querySelector('[data-github-repo]').value = 'o/r';
  dom.document.querySelector('[data-connect-form]').dispatchEvent({ type: 'submit', preventDefault() {} });
  await settle();
  assert.equal(connectPanel.hidden, true, '连接成功后应该收起连接表单');
  assert.equal(dom.document.body.dataset.ready, 'true');
  // 数量按 apps.json 现算：写死 6 的后果是「删掉一个软件就有一条无关用例变红」
  const existingCount = JSON.parse(appsJson).apps.length;
  assert.equal(dom.document.querySelector('[data-count-apps]').textContent, String(existingCount));

  // 选安装包 → 保存并提交
  const fileInput = dom.document.querySelector('[data-file]');
  fileInput.files = [{ name: 'Xixi-Online-1.0.0-x64.exe', size: 40960 }];
  fileInput.dispatchEvent('change');
  // 名字和短名照用户会填的那样写死，别用文件名推出来的那串
  dom.document.querySelector('[data-field="name"]').value = 'Xixi Online';
  dom.document.querySelector('[data-field="id"]').value = 'xixi-online';
  dom.document.querySelector('[data-save-push]').dispatchEvent('click');
  await settle(30);

  // 应该建了 release
  const release = calls.find((item) => item.method === 'POST' && String(item.url).endsWith('/releases'));
  assert.ok(release, '应该自动建 Release');
  assert.equal(JSON.parse(release.body).tag_name, 'v1.0.0');

  // 应该提交了 data/apps.json，而且写的是 Release 直链
  const put = calls.find((item) => item.method === 'PUT' && String(item.url).includes('/contents/data/apps.json'));
  assert.ok(put, '应该提交 data/apps.json');
  const body = JSON.parse(put.body);
  assert.equal(body.branch, 'main');
  assert.equal(body.sha, 's3');
  assert.match(body.message, /^add: /);
  const committed = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
  const added = committed.apps.find((app) => app.id === 'xixi-online');
  assert.ok(added, `提交的 apps.json 里应该多出这个软件（现有：${committed.apps.map((app) => app.id).join(', ')}）`);
  assert.equal(added.downloads.length, 1);
  assert.equal(added.downloads[0].url, 'https://github.com/o/r/releases/download/v1.0.0/xixi-online-1.0.0-x64.exe');
  assert.equal(added.downloads[0].platform, 'Windows');
  assert.equal(added.downloads[0].arch, 'x64');
  assert.equal(added.version, '1.0.0');
  // 原有软件不能被弄丢或重排（数量按源文件现算，不写死 7 这种历史事实）
  const originalApps = JSON.parse(appsJson).apps;
  assert.equal(committed.apps.length, originalApps.length + 1, '提交后应该只多出 1 个软件');
  assert.ok(
    committed.apps.slice(0, originalApps.length).every((app, index) => app.id === originalApps[index].id),
    '原有软件的顺序不该被改动'
  );
});

/* ==========================================================================
   数据契约与构建确定性防线
   --------------------------------------------------------------------------
   这 6 条是本次事故（数据字段被翻成中文、生成物与源数据脱节、构建不确定）
   暴露出来、但一层测试都没守着的空白。它们全部对着「真实产物 / 真实进程」
   断言，不依赖 dom-stub。
   ========================================================================== */
console.log('\n数据契约与构建确定性防线：');

const FIXTURES = join(ROOT, 'scripts', 'fixtures');

/**
 * 把 check.mjs / validate.mjs / 真实 data/ 拷进一个临时目录，写入指定的 apps.json，
 * 然后跑真正的 node 进程。全程不碰仓库里的文件：用例失败、中途崩溃都不会留下脏工作区。
 */
async function withTempCheck(writeApps) {
  const dir = await mkdtemp(join(tmpdir(), 'xixi-check-'));
  try {
    await mkdir(join(dir, 'scripts'), { recursive: true });
    await mkdir(join(dir, 'data'), { recursive: true });
    // scripts/ 下的 .mjs 全拷：check.mjs 依赖 validate.mjs，而 validate.mjs 又会 import
    // app-data.mjs（PLATFORM_VALUES 等）。只拷两个文件的话，上游一加依赖这里就 ENOENT，
    // 但那不是被测代码的问题，是我这个替身的漏洞 —— 所以整个目录平铺拷过去。
    const scriptFiles = (await readdir(join(ROOT, 'scripts'))).filter((file) => file.endsWith('.mjs'));
    for (const file of scriptFiles) {
      await copyFile(join(ROOT, 'scripts', file), join(dir, 'scripts', file));
    }
    for (const file of ['site.json', 'categories.json']) {
      await copyFile(join(ROOT, 'data', file), join(dir, 'data', file));
    }
    await writeApps(join(dir, 'data', 'apps.json'));
    const result = await runNode(join(dir, 'scripts', 'check.mjs'), dir);
    const output = `${result.stdout}${result.stderr}`;
    // 环境自检：临时项目里的模块解析失败，说明是我这个替身没拷全（例如上游新增了
    // scripts/lib/ 之类的依赖），不是被测逻辑坏了。必须大声说清楚，否则下一个人会
    // 顺着「check.mjs 报错」去查一段本来没问题的代码。
    assert.ok(
      !/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package/.test(output),
      `测试替身不完整：临时目录里的 check.mjs 解析不到依赖模块（不是被测代码的问题）。\n` +
        `  请检查 withTempCheck 是否漏拷文件。原始输出：\n${output.trim()}`
    );
    return { code: result.code, output };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 用 scripts/fixtures/ 里的一份坏数据替换 apps.json */
const checkWithAppsFixture = (fixture) => withTempCheck((dest) => copyFile(join(FIXTURES, fixture), dest));

/** 直接给一条软件记录（省掉一堆只用一次的小 fixture 文件） */
const checkWithAppsData = (apps) =>
  withTempCheck((dest) => writeFile(dest, JSON.stringify({ apps }, null, 2), 'utf8'));

await test('防线 1／app 集合一致性：data/apps.generated.js 的软件集合必须和 apps.json 一模一样', async () => {
  requireData();
  const text = await readSource('data/apps.generated.js');
  const win = {};
  new Function('window', text)(win);
  const generated = (win.SITE_DATA && win.SITE_DATA.apps) || [];
  assert.ok(
    Array.isArray(generated) && generated.length > 0,
    'data/apps.generated.js 里读不到 SITE_DATA.apps，请先 npm run build'
  );

  const generatedIds = generated.map((app) => app.id).sort();
  const sourceIds = visibleApps.map((app) => app.id).sort();
  const onlyInGenerated = generatedIds.filter((id) => !sourceIds.includes(id));
  const onlyInSource = sourceIds.filter((id) => !generatedIds.includes(id));
  assert.deepEqual(
    { onlyInGenerated, onlyInSource },
    { onlyInGenerated: [], onlyInSource: [] },
    `生成物与 apps.json 不同步（生成物多出：${onlyInGenerated.join('、') || '无'}；缺少：${onlyInSource.join('、') || '无'}），请重新 npm run build`
  );
});

await test('防线 2／中文键：apps.json 出现「名称 / 版本 / 下载」时 check.mjs 必须失败并点名', async () => {
  const { code, output } = await checkWithAppsFixture('apps-chinese-keys.json');
  assert.notEqual(code, 0, `中文键必须让 check.mjs 非 0 退出，实际退出码 ${code}\n${output}`);
  assert.match(output, /未知字段/, `错误信息要说明遇到了「未知字段」：\n${output}`);
  for (const key of ['名称', '版本', '下载']) {
    assert.ok(output.includes(key), `错误信息里应该点名中文键「${key}」：\n${output}`);
  }
});

const LF_ONLY_FILES = ['js/home.js', 'js/app.js', 'js/admin-lib.js', 'data/apps.generated.js'];

await test('防线 3／换行符：dist 下所有 .js/.html 与 4 个关键产物必须是纯 LF', async () => {
  const dirty = [];
  const blame = (file, text) => {
    const hit = text.split('\n').findIndex((line) => line.includes('\r'));
    const cr = (text.match(/\r/g) || []).length;
    const lf = (text.match(/\n/g) || []).length;
    const kind = cr === lf ? '全 CRLF' : 'CRLF/LF 混用';
    // 换行是从哪里漏进来的，直接写在报错里，省得下次有人从头查
    const hint = file.endsWith('dist/index.html')
      ? '　→ build.mjs 读入 index.html 时没做 \\r\\n 归一'
      : /dist\/apps\/.*\.html$/.test(file)
        ? '　→ build.mjs 读入 scripts/templates/detail.html 时没做 \\r\\n 归一'
        : file.startsWith('dist/')
          ? '　→ build.mjs 生成/写出时没归一'
          : '　→ bundle.mjs / build.mjs 生成时没归一';
    dirty.push(`${file}（${cr} 个 \\r / ${lf} 行，${kind}，首个在第 ${hit + 1} 行）${hint}`);
  };

  // 1) 关键产物：这几个是 bundle.mjs / build.mjs 直接拼出来的
  for (const file of LF_ONLY_FILES) {
    const text = await readSource(file);
    if (text.includes('\r')) blame(file, text);
  }

  // 2) dist 下「构建产出的」页面：首页（build 原地重写 index.html 后由 copyTree 拷进 dist）、
  //    apps/ 下所有详情页（模板渲染）、sitemap/feed/robots（build 直接生成）。
  //    目录级断言比写死几个文件名更抗未来（新增软件、新增页面自动覆盖）。
  //    **不覆盖**的是 copyTree 原样拷贝、换行由 .gitattributes（* text=auto eol=lf）负责的那批：
  //      · 404.html、admin/index.html
  //      · assets/css/*.css、assets/**/*.svg
  //      · data/*.json
  //      · js/ 下的源 ES 模块（js/shared.js、js/render.js…；浏览器实际加载的是 bundle
  //        js/home.js / js/app.js，源模块只是被一起拷进 dist）
  //    这些在「.gitattributes 生效前签出的旧工作树」里会带 CR，属于过渡态、不是 bug；
  //    所以本仓库的口径是「构建产出的页面跨平台可复现」，不是「dist 里所有文件都可复现」。
  //    别把这条断言顺手扩到 dist 全量 —— 那会让每个 Windows 开发者天天红。
  await ensureDist();
  const dist = join(ROOT, 'dist');
  const detailPages = (await readdir(join(dist, 'apps'), { recursive: true }))
    .map((item) => `apps/${String(item).replace(/\\/g, '/')}`)
    .filter((file) => /\.html$/i.test(file));
  const targets = ['index.html', 'sitemap.xml', 'feed.xml', 'robots.txt', ...detailPages].sort();
  assert.ok(detailPages.length >= 1, 'dist/apps 下没有详情页，构建看起来没跑完');
  for (const file of targets) {
    const text = await readFile(join(dist, file), 'utf8');
    if (text.includes('\r')) blame(`dist/${file}`, text);
  }

  assert.deepEqual(
    dirty.slice(0, 8),
    [],
    `这些文件里混进了 CRLF，本机构建与 CI 构建会产出不同字节（共 ${dirty.length} 个文件，前 8 个）：\n        ${dirty
      .slice(0, 8)
      .join('\n        ')}`
  );
});

/** 递归复制目录（用于给构建造一份干净副本，绝不碰工作区） */
async function copyTree(from, to, skip) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(src, dest, skip);
    else await copyFile(src, dest);
  }
}

await test('防线 4／构建幂等：在干净副本里连跑两次 build，产物必须逐字节相同', async () => {
  // 为什么在临时副本里跑：一来不会动工作区（dist/ 反复重建、用例中途失败都不会留脏），
  // 二来顺便验证「clone 下来直接 build」也能从零构建成功。
  const dir = await mkdtemp(join(tmpdir(), 'xixi-build-'));
  try {
    const skip = new Set(['.git', 'dist', 'node_modules', '.wrangler', '.cache', '.shots']);
    await copyTree(ROOT, dir, skip);

    const first = await runNode(join(dir, 'scripts', 'build.mjs'), dir);
    assert.equal(first.code, 0, `第一次构建就失败了：${first.stderr || first.stdout}`);
    assert.ok(await pathExists(join(dir, 'dist', 'index.html')), '第一次构建没产出 dist/index.html');
    const before = await treeManifest(dir);

    const second = await runNode(join(dir, 'scripts', 'build.mjs'), dir);
    assert.equal(second.code, 0, `第二次构建失败了：${second.stderr || second.stdout}`);
    const after = await treeManifest(dir);

    const toMap = (list) =>
      new Map(
        list.map((line) => {
          const [file, size, hash] = line.split('\t');
          return [file, `${size}/${hash}`];
        })
      );
    const a = toMap(before);
    const b = toMap(after);
    const changed = [];
    for (const [file, signature] of a) {
      if (!b.has(file)) changed.push(`${file}：第二次构建后不见了`);
      else if (b.get(file) !== signature) changed.push(`${file}：两次构建内容不同`);
    }
    for (const file of b.keys()) {
      if (!a.has(file)) changed.push(`${file}：第二次构建才出现`);
    }
    assert.deepEqual(
      changed.slice(0, 10),
      [],
      `两次构建的产物不一致（共 ${changed.length} 个文件，前 10 个）：\n        ${changed.slice(0, 10).join('\n        ')}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test('防线 5／坏数据友好报错：非法 JSON 时 check.mjs 必须非 0、点名 apps.json、不甩堆栈', async () => {
  const { code, output } = await checkWithAppsFixture('apps-invalid.json');
  assert.notEqual(code, 0, `非法 JSON 必须让 check.mjs 非 0 退出，实际退出码 ${code}\n${output}`);
  assert.match(output, /apps\.json/, `错误信息里要出现文件名 apps.json：\n${output}`);
  assert.ok(!/\n\s+at\s/.test(output), `不该把 Node 的原始调用栈甩给用户：\n${output}`);
  const lines = output.split('\n').filter((line) => line.trim());
  assert.ok(lines.length <= 4, `报错应该收敛成几行中文，实际 ${lines.length} 行：\n${output}`);
});

await test('防线 5／坏数据友好报错：字段类型写错（changelog / history 写成字符串）也必须给中文提示', async () => {
  // 语法错只是坏数据的一种。类型写错（把 chanelog 写成一句话）时，
  // validate.mjs 先 push 一条「必须是数组」，紧接着又对字符串调 .entries() 抛 TypeError，
  // 而 check.mjs 的 try/catch 只包了 loadProject —— 用户看到的是英文堆栈。
  for (const fixture of ['apps-changelog-string.json', 'apps-history-string.json']) {
    const { code, output } = await checkWithAppsFixture(fixture);
    assert.notEqual(code, 0, `${fixture}：类型写错必须让 check.mjs 非 0 退出，实际 ${code}\n${output}`);
    assert.match(output, /必须是数组/, `${fixture}：应该给「必须是数组」的中文提示：\n${output}`);
    assert.ok(!/\n\s+at\s/.test(output), `${fixture}：不该把 Node 的原始调用栈甩给用户：\n${output}`);
  }
});

await test('防线 6／空站：apps.json 一条软件都没有时 check.mjs 必须失败', async () => {
  const { code, output } = await checkWithAppsFixture('apps-empty.json');
  assert.notEqual(code, 0, `空数据必须让 check.mjs 非 0 退出，实际退出码 ${code}\n${output}`);
  assert.match(output, /没有任何软件/, `错误信息要说明「没有任何软件」：\n${output}`);
});

await test('防线 7／下载项类型写错不许静默残站：downloads 是字符串时必须报错，不能只给一句提醒', async () => {
  // 这跟「写成空数组」是两件事，必须分两档：
  //   downloads: []          → 提醒（真的还没上传包，属正常状态）
  //   downloads: "https://…" → 错误（用户以为配好了，实际所有下载按钮都会消失）
  // 如果只把 (app.downloads || []) 换成 Array.isArray(...) ? ... : []，
  // 第二种就变成「一条提醒 + 静默残站 + 退出码 0」，正是本次事故要防的那类问题。
  const { code, output } = await checkWithAppsFixture('apps-downloads-string.json');
  assert.notEqual(
    code,
    0,
    `downloads 是字符串必须让 check.mjs 非 0 退出（否则会构建出没有下载按钮的残站），实际退出码 ${code}\n${output}`
  );
  assert.match(output, /必须是数组/, `应该明确说是类型错了「必须是数组」，而不是「没有写 downloads」：\n${output}`);
  assert.ok(!/\n\s+at\s/.test(output), `不该把 Node 的原始调用栈甩给用户：\n${output}`);
});

await test('防线 8／平台字段：合法值要放行（含 全平台 / iOS），写错要拦，下载项也不能瞎写', async () => {
  // 口径（lead 定案，依据是函数级证据，不是下拉的视觉位置）：
  //   js/admin.js 里同一个 form.platform 被三处消费 ——
  //     :610  platform: form.platform    （下载项平台）
  //     :682  platforms: [form.platform] （新建软件的 platforms 数组）
  //     :729  app.platforms = [...合并 downloads 的平台]
  //   所以作者发布一个 .zip（files.mjs:99-104 判成「全平台」）或 .ipa（判成「iOS」），
  //   落盘就是 platforms: ["全平台"] / ["iOS"]。校验要是拦它，下一次 CI 就红 ——
  //   等于把我们要消灭的 bug 换了个入口重演。所以这两个值必须放行。
  //
  // 那数据质量靠谁守？靠合并函数（mergePlatforms 的单测「A2」）：
  //   validate       判断「值是否合法」   → 全平台/iOS 合法；Linuxx 非法
  //   mergePlatforms 判断「合并后留哪个」 → 有具体 OS 时丢掉通配值
  // 校验放宽 ≠ 允许污染；两层职责不同，别把「校验放行」读成「数据可以脏」。
  const demoApp = (patch) => ({
    id: 'demo-tool',
    name: '演示工具',
    downloads: [{ name: '安装包', url: 'https://example.com/demo-tool-1.0.0.exe' }],
    ...patch,
  });
  const cases = [
    { label: 'platforms: ["Linuxx"]（错别字，唯一的下限守卫）', app: demoApp({ platforms: ['Linuxx'] }), expectZero: false },
    { label: 'platforms: ["全平台"]（后台发布 .zip 就会写成这样）', app: demoApp({ platforms: ['全平台'] }), expectZero: true },
    { label: 'platforms: ["Windows","全平台"]（混写最多提醒，不拦）', app: demoApp({ platforms: ['Windows', '全平台'] }), expectZero: true },
    { label: 'platforms: ["iOS"]（.ipa 的结果）', app: demoApp({ platforms: ['iOS'] }), expectZero: true },
    {
      label: 'downloads[].platform: "全平台"（合法通配）',
      app: demoApp({ downloads: [{ name: '全部下载', url: 'https://example.com/demo-tool', platform: '全平台' }] }),
      expectZero: true,
    },
    {
      label: 'downloads[].platform: "not-a-platform"（下载项也不能瞎写）',
      app: demoApp({ downloads: [{ name: '安装包', url: 'https://example.com/a.exe', platform: 'not-a-platform' }] }),
      expectZero: false,
    },
  ];
  const wrong = [];
  for (const item of cases) {
    const { code, output } = await checkWithAppsData([item.app]);
    const expected = item.expectZero ? '0' : '非 0';
    if ((code === 0) !== item.expectZero) {
      const tail = output.trim().split('\n').filter((line) => line.trim()).slice(-2).join(' / ');
      wrong.push(`${item.label}：期望退出码 ${expected}，实际 ${code} → ${tail}`);
      continue;
    }
    if (!item.expectZero && /\n\s+at\s/.test(output)) {
      wrong.push(`${item.label}：拦是拦住了，但甩出了 Node 调用栈 → ${output.trim()}`);
    }
  }
  assert.deepEqual(wrong, [], `平台字段的判定不符合预期：\n        ${wrong.join('\n        ')}`);
});

await test('防线 9／updated 日期：缺失只提醒，写了但不合法必须拦（含「格式像但解析失败」）', async () => {
  // updated 不只是显示：sortApps 排序、sitemap.xml 的 lastmod、feed.xml 的 pubDate 都吃它。
  // 档位（lead 定）：字段存在但不可解析 → error；字段缺失 → warning（可选字段，别拦发布）。
  // 规则是「格式 ∧ 可解析」，缺一不可：
  //   · 只查格式   → 2026-13-01 / 2026-09-32 蒙混过关，最后页脚 © NaN
  //   · 只查可解析 → 2026/09/03 被 V8 解析成功，混进 sitemap 的 lastmod
  // "2026"（只写年份）必须放行：这是作者真实写过的历史写法（Termux 原文就是 "2026"），
  // 断言成红就等于把「历史数据的合法写法」钉成错误 —— 本条专防这种误报，别删。
  const demoApp = (patch) => ({
    id: 'demo-tool',
    name: '演示工具',
    downloads: [{ name: '安装包', url: 'https://example.com/demo-tool-1.0.0.exe' }],
    ...patch,
  });
  const cases = [
    { label: 'updated: "2026"（只写年份，历史写法）', app: demoApp({ updated: '2026' }), expectZero: true },
    { label: 'updated: "2026-09"', app: demoApp({ updated: '2026-09' }), expectZero: true },
    { label: 'updated: "2026-09-03"', app: demoApp({ updated: '2026-09-03' }), expectZero: true },
    { label: 'updated 缺失（可选字段，只提醒）', app: demoApp({}), expectZero: true },
    { label: 'updated: "2026-9-3"（缺前导零）', app: demoApp({ updated: '2026-9-3' }), expectZero: false },
    { label: 'updated: "2026/09/03"（斜杠不是 ISO）', app: demoApp({ updated: '2026/09/03' }), expectZero: false },
    { label: 'updated: "2026年9月3日"（中文日期）', app: demoApp({ updated: '2026年9月3日' }), expectZero: false },
    { label: 'updated: "待更新"（占位文本）', app: demoApp({ updated: '待更新' }), expectZero: false },
    { label: 'updated: "2026-13-01"（格式像但解析失败）', app: demoApp({ updated: '2026-13-01' }), expectZero: false },
    { label: 'updated: "2026-09-32"（格式像但解析失败）', app: demoApp({ updated: '2026-09-32' }), expectZero: false },
    // 格式合法、Date 也「能解析」，但会静默滚成 2026-03-02：sitemap 的 lastmod 和 feed 的
    // pubDate 都会变成 3 月 2 日，比格式错误更隐蔽。必须靠往返校验才拦得住。
    { label: 'updated: "2026-02-30"（日期不存在，会滚成 03-02）', app: demoApp({ updated: '2026-02-30' }), expectZero: false },
  ];
  const wrong = [];
  for (const item of cases) {
    const { code, output } = await checkWithAppsData([item.app]);
    const expected = item.expectZero ? '0' : '非 0';
    if ((code === 0) !== item.expectZero) {
      const tail = output.trim().split('\n').filter((line) => line.trim()).slice(-2).join(' / ');
      wrong.push(`${item.label}：期望退出码 ${expected}，实际 ${code} → ${tail}`);
      continue;
    }
    if (item.expectZero) continue;
    // 报错要能定位：既说字段名，也说哪条记录
    if (!/updated/.test(output)) wrong.push(`${item.label}：错误信息里没有字段名 updated → ${output.trim()}`);
    if (!/demo-tool/.test(output)) wrong.push(`${item.label}：错误信息里没有记录 id demo-tool → ${output.trim()}`);
    if (/\n\s+at\s/.test(output)) wrong.push(`${item.label}：甩出了 Node 调用栈 → ${output.trim()}`);
  }
  assert.deepEqual(wrong, [], `updated 日期的判定不符合预期：\n        ${wrong.join('\n        ')}`);
});

await test('防线 12／子结构里的日期也要拦：changelog[].date 与 history[].date 写错必须报错', async () => {
  // updated 只是软件级的日期。更新日志和历史版本里的 date 会被 feed/详情页直接拿去显示，
  // 写错了同样是「看起来正常、实际是错日期」，而且这两处以前没有任何校验。
  const demoApp = (patch) => ({
    id: 'demo-tool',
    name: '演示工具',
    downloads: [{ name: '安装包', url: 'https://example.com/demo-tool-1.0.0.exe' }],
    ...patch,
  });
  const cases = [
    {
      label: 'changelog[0].date = "2026-02-30"（日期不存在）',
      app: demoApp({ changelog: [{ version: '1.0.0', date: '2026-02-30' }] }),
      expectZero: false,
      mustMention: [/更新日志/, /demo-tool/],
    },
    {
      label: 'history[0].date = "2026/09/03"（斜杠不是 ISO）',
      app: demoApp({ history: [{ version: '0.9.0', date: '2026/09/03' }] }),
      expectZero: false,
      mustMention: [/历史版本/, /demo-tool/],
    },
    {
      label: 'changelog[0].date = "2026-09-03"（合法，不能误伤）',
      app: demoApp({ changelog: [{ version: '1.0.0', date: '2026-09-03' }] }),
      expectZero: true,
    },
  ];
  const wrong = [];
  for (const item of cases) {
    const { code, output } = await checkWithAppsData([item.app]);
    const expected = item.expectZero ? '0' : '非 0';
    if ((code === 0) !== item.expectZero) {
      const tail = output.trim().split('\n').filter((line) => line.trim()).slice(-2).join(' / ');
      wrong.push(`${item.label}：期望退出码 ${expected}，实际 ${code} → ${tail}`);
      continue;
    }
    if (item.expectZero) continue;
    for (const pattern of item.mustMention || []) {
      if (!pattern.test(output)) wrong.push(`${item.label}：错误信息里缺少 ${pattern} → ${output.trim()}`);
    }
    if (/\n\s+at\s/.test(output)) wrong.push(`${item.label}：甩出了 Node 调用栈 → ${output.trim()}`);
  }
  assert.deepEqual(wrong, [], `子结构日期的判定不符合预期：\n        ${wrong.join('\n        ')}`);
});

await test('防线 10／页脚年份必须是「数据的年份」，且不随构建机器的时区变化', async () => {
  // 背景：页脚年份以前取 new Date().getFullYear() —— 跨年那天全站页脚会集体变一次，
  // 产生一堆和内容无关的 diff，而「连跑两次 build」的幂等用例当天根本测不出来。
  // 现在改成从 buildDate（由 SOURCE_DATE_EPOCH 或数据里最新的 updated 派生）取 UTC 年份。
  //
  // 为什么要在两个时区各跑一次（这两条各自能抓住不同的退化，UTC 环境下两条都抓不到）：
  //   ① TZ=Asia/Shanghai + epoch=2023-12-31T20:00Z
  //      → 若有人改成「从 epoch 这个 Date 对象取本地年份」，+08:00 已是 2024-01-01，页脚变 2024
  //   ② TZ=America/New_York + epoch=2024-01-01T00:00Z
  //      → 若有人把 getUTCFullYear() 写回 getFullYear()，-05:00 还是 2023-12-31，页脚掉回 2023
  //   两条断言值分别是 2023 / 2024：任何一条被写错，就有一条会红。
  const runs = [
    {
      tz: 'Asia/Shanghai',
      epoch: '1704052800',
      expect: '2023',
      why: '这个时刻在 +08:00 已经是 2024-01-01，用本地年份派生会变成 2024',
    },
    {
      tz: 'America/New_York',
      epoch: '1704067200',
      expect: '2024',
      why: 'buildDate 是 2024-01-01，用本地年份派生在 -05:00 会掉回 2023',
    },
  ];
  requireData();
  const dir = await mkdtemp(join(tmpdir(), 'xixi-year-'));
  try {
    const skip = new Set(['.git', 'dist', 'node_modules', '.wrangler', '.cache', '.shots']);
    await copyTree(ROOT, dir, skip);
    const seen = {};
    for (const item of runs) {
      const result = await runNode(join(dir, 'scripts', 'build.mjs'), dir, {
        SOURCE_DATE_EPOCH: item.epoch,
        TZ: item.tz,
      });
      assert.equal(result.code, 0, `TZ=${item.tz} 构建失败：${result.stderr || result.stdout}`);
      const html = await readFile(join(dir, 'dist', 'apps', primaryId, 'index.html'), 'utf8');
      const match = /©\s*(\d{4})/.exec(html);
      assert.ok(match, `TZ=${item.tz} 的详情页里找不到页脚年份`);
      seen[item.tz] = match[1];
      assert.equal(match[1], item.expect, `TZ=${item.tz} 页脚年份应为 ${item.expect}（${item.why}），实际 ${match[1]}`);
    }
    assert.deepEqual(
      Object.values(seen).sort(),
      Array.from(new Set(runs.map((item) => item.expect))).sort(),
      `不同时区构建出的页脚年份不一致：${JSON.stringify(seen)}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test('防线 11／mergePlatforms：合并时丢掉通配值，只剩通配时才保留（守住写入端）', async () => {
  // 校验层放行「全平台」之后，数据质量全靠这个函数：
  //   validate       判断「值是否合法」   → 全平台/iOS 合法
  //   mergePlatforms 判断「合并后留哪个」 → 有具体 OS 就丢掉通配值
  // 后台 admin.js:729/775 把下载项平台并进 app.platforms 时走它，
  // 否则「Windows + 全平台」会变成混写，详情页显示「Windows · 全平台」、分类也匹配不到。
  // 用动态 import：万一函数还没实现，这里只红一条，不会把整个测试文件加载搞崩。
  const appData = await import('./app-data.mjs');
  assert.equal(typeof appData.mergePlatforms, 'function', 'scripts/app-data.mjs 需要导出 mergePlatforms(list)');
  const cases = [
    { input: ['Windows', '全平台'], expect: ['Windows'], why: '有具体 OS 时丢掉通配' },
    { input: ['全平台'], expect: ['全平台'], why: '只剩通配时保留（别把作者唯一的选择删光）' },
    { input: ['Windows'], expect: ['Windows'], why: '单个具体 OS 原样返回' },
    { input: ['Windows', 'Linux', 'Windows'], expect: ['Windows', 'Linux'], why: '去重且保持顺序' },
    { input: [], expect: [], why: '空数组还是空数组' },
  ];
  const wrong = [];
  for (const item of cases) {
    const actual = appData.mergePlatforms(item.input);
    try {
      assert.deepEqual(actual, item.expect);
    } catch {
      wrong.push(`mergePlatforms(${JSON.stringify(item.input)})：期望 ${JSON.stringify(item.expect)}，实际 ${JSON.stringify(actual)}（${item.why}）`);
    }
  }
  assert.deepEqual(wrong, [], `mergePlatforms 的行为不符合预期：\n        ${wrong.join('\n        ')}`);
});

await test('防线 13／首页年份要和详情页一致、由数据派生，且固定 SDE 下连跑两次一致', async () => {
  // G 项：首页 index.html 的 © 年份以前是写死的 2026，并且被 js/core.js 用访客本机年份
  // 在运行时覆盖 —— 于是「静态产物」和「用户看到的」都不是数据年份，只是恰好都等于今年。
  // 现在改为 <!-- YEAR:START --> … <!-- YEAR:END --> 替换块，由 build.mjs 按 buildDate 注入。
  //
  // 两条都要，缺一条就能被绕过：
  //   ① 源码里必须还有这个标记 —— 标记被删掉时构建压根不替换，而写死的值可能恰好等于
  //      期望年份（今天 2026 正好是这种最坏情况），只查产物会漏；
  //   ② 产物里首页年份 == 详情页年份 == 2023，且 != 写死的 2026 —— SDE 必须取「非今年」，
  //      否则注入值与写死值分不出来。
  const source = await readSource('index.html');
  assert.match(
    source,
    /<!--\s*YEAR:START\s*-->[\s\S]*<!--\s*YEAR:END\s*-->/,
    'index.html 里必须保留 <!-- YEAR:START --> … <!-- YEAR:END --> 替换块（删了它年份就不会被构建替换）'
  );

  const footerYear = (html, label) => {
    const match = /©[\s\S]{0,120}?(\d{4})/.exec(html);
    assert.ok(match, `${label} 里找不到页脚年份`);
    return match[1];
  };

  requireData();
  const dir = await mkdtemp(join(tmpdir(), 'xixi-home-year-'));
  try {
    await copyTree(ROOT, dir, new Set(['.git', 'dist', 'node_modules', '.wrangler', '.cache', '.shots']));
    const env = { SOURCE_DATE_EPOCH: '1704052800', TZ: 'Asia/Shanghai' };
    const build = async (round) => {
      const result = await runNode(join(dir, 'scripts', 'build.mjs'), dir, env);
      assert.equal(result.code, 0, `第 ${round} 次构建失败：${result.stderr || result.stdout}`);
    };

    await build(1);
    const homeYear = footerYear(await readFile(join(dir, 'dist', 'index.html'), 'utf8'), 'dist/index.html');
    const detailYear = footerYear(
      await readFile(join(dir, 'dist', 'apps', primaryId, 'index.html'), 'utf8'),
      `dist/apps/${primaryId}/index.html`
    );
    assert.equal(homeYear, '2023', `首页页脚年份应为数据年份 2023，实际 ${homeYear}`);
    assert.equal(detailYear, '2023', `详情页页脚年份应为 2023，实际 ${detailYear}`);
    assert.equal(homeYear, detailYear, `首页(${homeYear})与详情页(${detailYear})的年份必须一致`);
    assert.notEqual(homeYear, '2026', '首页年份仍是写死的 2026 —— 说明它没有被构建替换');

    // F 项注入了墙钟（buildNow = epoch ?? new Date()），所以固定 SDE 之后
    // 「连跑两次一致」才真正成立；否则只能证明同一天内稳定，跨零点会抖。
    const before = await treeManifest(join(dir, 'dist'));
    await build(2);
    const after = await treeManifest(join(dir, 'dist'));
    assert.deepEqual(after, before, '固定 SOURCE_DATE_EPOCH 下连跑两次，dist 必须逐字节一致');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ---------------- 汇总 ---------------- */
console.log(`\n${failed ? '\u2717' : '\u2713'} 通过 ${passed} 项${failed ? `，失败 ${failed} 项` : '，全部通过'}\n`);
if (failed) process.exitCode = 1;
