#!/usr/bin/env node
/* ==========================================================================
   test.mjs · 自检脚本（零依赖，用 Node 自带断言）
   --------------------------------------------------------------------------
   用法：npm test
   检查的是「真正会跑的核心逻辑」：数据校验、搜索筛选、排序、下载地址解析、
   Markdown 渲染与 XSS 转义、卡片/详情页 HTML 生成。
   ========================================================================== */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
import { buildBundleCode, transformModule } from './bundle.mjs';
import { createDom, makeElement, runScript } from './dom-stub.mjs';

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
    site: { name: 'DevShelf', url: 'https://example.com' },
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

await test('js/home.js 与 js/app.js 是最新的（提交前记得 npm run build）', async () => {
  const home = await readSource('js/home.js').catch(() => '');
  const app = await readSource('js/app.js').catch(() => '');
  assert.equal(home, homeBundle, 'js/home.js 与源码不一致，请运行 npm run build');
  assert.equal(app, appBundle, 'js/app.js 与源码不一致，请运行 npm run build');
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

/* ---------------- 汇总 ---------------- */
console.log(`\n${failed ? '\u2717' : '\u2713'} 通过 ${passed} 项${failed ? `，失败 ${failed} 项` : '，全部通过'}\n`);
if (failed) process.exitCode = 1;
