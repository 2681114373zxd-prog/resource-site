#!/usr/bin/env node
/* ==========================================================================
   test.mjs · 自检脚本（零依赖，用 Node 自带断言）
   --------------------------------------------------------------------------
   用法：npm test
   检查的是「真正会跑的核心逻辑」：数据校验、搜索筛选、排序、下载地址解析、
   Markdown 渲染与 XSS 转义、卡片/详情页 HTML 生成。
   ========================================================================== */

import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
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
  }
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
const detailText = await readFile(new URL('../apps/7zip/index.html', import.meta.url), 'utf8').catch(() => '');

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
  assert.ok(detailText, 'apps/7zip/index.html 不存在，请先运行 npm run build');
  assert.match(detailText, /data-prerendered="true"/);
  assert.match(detailText, /<h1>7-Zip<\/h1>/);
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
  assert.equal(home, homeBundle, 'js/home.js 与源码不一致，请运行 npm run build');
  assert.equal(app, appBundle, 'js/app.js 与源码不一致，请运行 npm run build');
  assert.equal(adminLib, adminLibBundle, 'js/admin-lib.js 与源码不一致，请运行 npm run build');
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
  // 用构建生成的数据文件喂给页面（顺便验证它是合法 JS）
  new Function('window', await readSource('data/apps.generated.js'))(dom.window);
  await runScript(homeBundle, dom);

  const cards = (grid.innerHTML.match(/class="app-card/g) || []).length;
  assert.equal(cards, dom.window.SITE_DATA.apps.length, `卡片数量不对（${cards}）`);
  assert.match(grid.innerHTML, /data-id="7zip"/, '没渲染出 7-Zip 卡片');
  assert.match(grid.innerHTML, /href="[^"]*apps\/7zip\/index\.html"/, '卡片链接不对');
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
  new Function('window', await readSource('data/apps.generated.js'))(dom.window);
  await runScript(homeBundle, dom);

  const link = /href="([^"]*apps\/7zip\/index\.html)"/.exec(grid.innerHTML);
  assert.ok(link, '没有渲染出卡片链接');
  assert.equal(
    new URL(link[1], dom.location.href).href,
    'file:///C:/resource-site/apps/7zip/index.html',
    'file:// 下卡片链接解析不对'
  );

  // 详情页里的站内下载链接同样是相对路径，在 file:// 下也能下载
  // （notepad-plus-plus 里有一个指向 downloads/ 的站内文件）
  const detail = await readFile(join(ROOT, 'apps', 'notepad-plus-plus', 'index.html'), 'utf8');
  const download = /href="([^"]*downloads\/[^"]+)"/.exec(detail);
  assert.ok(download, '详情页里没有站内下载链接');
  assert.match(
    new URL(download[1], 'file:///C:/resource-site/apps/notepad-plus-plus/index.html').href,
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
  assert.equal(cards(), 6, '首屏应该把全部软件都渲染出来');

  // 搜索：输入 ocr 应该只剩 Umi-OCR（输入框有 140ms 防抖，所以等一会儿）
  search.value = 'ocr';
  search.dispatchEvent('input');
  await sleep(280);
  assert.equal(cards(), 1, `搜索 ocr 应该只剩 1 个结果，实际 ${cards()} 个`);
  assert.match(grid.innerHTML, /data-id="umi-ocr"/);

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
  assert.equal(cards(), 6, '清空搜索后应该恢复全部软件');
});

await test('file:// 下不会因为改地址栏而崩（history.replaceState 有异常保护）', async () => {
  const core = await readSource('js/core.js');
  assert.match(core, /try \{\s*window\.history\.replaceState/, 'writeUrlState 需要 try/catch');
});

await test('详情页脚本能跑通：预渲染页面 + ?id= 兜底渲染', async () => {
  // 情况一：构建好的静态详情页（内容已预渲染）
  const prerendered = makeElement('main');
  prerendered.dataset.appId = '7zip';
  prerendered.dataset.prerendered = 'true';
  const dom1 = createDom({ pathname: '/apps/7zip/index.html', elements: { '[data-app-root]': prerendered } });
  new Function('window', await readSource('data/apps.generated.js'))(dom1.window);
  await runScript(appBundle, dom1);
  assert.ok(dom1.documentElement.classList.contains('js'));
  assert.equal(dom1.document.body.dataset.ready, 'true', '详情页脚本没有跑完');

  // 情况二：通用兜底页 apps/app.html?id=localsend（需要现场渲染）
  const dynamic = makeElement('main');
  dynamic.dataset.appId = '';
  dynamic.dataset.prerendered = 'false';
  const dom2 = createDom({
    pathname: '/apps/app.html',
    search: '?id=localsend',
    elements: { '[data-app-root]': dynamic },
  });
  new Function('window', await readSource('data/apps.generated.js'))(dom2.window);
  await runScript(appBundle, dom2);
  assert.match(dynamic.innerHTML, /LocalSend/, '兜底页没有渲染出对应软件');
  assert.match(dynamic.innerHTML, /id="downloads"/, '兜底页没有下载区');
});

await test('端到端：详情页也按 HTML 里写的顺序加载脚本，file:// 下能跑通', async () => {
  for (const id of ['7zip', 'notepad-plus-plus']) {
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

const { site, categories, apps } = await loadProject(ROOT);

await test('data/*.json 能正常解析', () => {
  assert.ok(site && typeof site === 'object');
  assert.ok(Array.isArray(categories.items));
  assert.ok(Array.isArray(apps) && apps.length > 0, 'apps.json 里至少要有一个软件');
});

await test('每个软件都有 id / name / downloads 字段', () => {
  apps.forEach((app) => {
    assert.ok(app.id, `${app.name || '?'} 缺少 id`);
    assert.ok(app.name, `${app.id} 缺少 name`);
    assert.ok(Array.isArray(app.downloads), `${app.id} 的 downloads 不是数组`);
  });
});

await test('id 不重复', () => {
  const ids = apps.map((app) => app.id);
  assert.equal(new Set(ids).size, ids.length, '存在重复的 id');
});

await test('每个下载地址都是 http(s) 或站内路径', () => {
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

const pathExists = (target) => stat(target).then(() => true, () => false);

await test('构建产物：密码和缓存不会进 dist，在线后台页面会进 dist', async () => {
  const dist = join(ROOT, 'dist');
  if (!(await pathExists(join(dist, 'index.html')))) return; // 还没构建过就先跳过
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
  assert.equal(dom.document.querySelector('[data-count-apps]').textContent, '6');

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
  // 原有软件不能被弄丢或重排
  assert.equal(committed.apps.length, 7);
  assert.ok(committed.apps.slice(0, 6).every((app, index) => app.id === JSON.parse(appsJson).apps[index].id));
});

/* ---------------- 汇总 ---------------- */
console.log(`\n${failed ? '\u2717' : '\u2713'} 通过 ${passed} 项${failed ? `，失败 ${failed} 项` : '，全部通过'}\n`);
if (failed) process.exitCode = 1;
