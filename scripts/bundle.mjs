/* ==========================================================================
   bundle.mjs · 把 ES 模块打包成「普通脚本」（构建步骤，不是给你手改的）
   --------------------------------------------------------------------------
   为什么要这么做？
   js/ 目录下的源码用 ES 模块写（结构清晰，Node 端的构建脚本也能直接 import）。
   但浏览器在 file:// 协议下会以安全为由**拒绝加载 ES 模块**，那样直接双击
   index.html 就只有静态内容、搜索和筛选全失效。
  所以构建时把模块按依赖顺序拼成一个普通 <script> 能跑的文件：
     js/shared.js + js/render.js + js/core.js + js/main.js      → js/home.js
     js/shared.js + js/render.js + js/core.js + js/app-page.js  → js/app.js
     scripts/json-style.mjs + scripts/app-data.mjs              → js/admin-lib.js
  最后一个（admin-lib）是给后台页面用的：把「局部改写 apps.json」这套逻辑原样搬给
  浏览器，这样在线后台和本地后台改出来的文件格式完全一致。它用 expose 把函数挂到
  window.XIXI_DATA 上，别的 <script> 就能直接用。
  转换规则很简单（本项目源码风格统一）：
     1. 去掉 import 语句（依赖顺序已经排好，同一作用域内直接可见）
     2. 去掉 export 关键字
     3. 整体包进一个立即执行函数，避免污染全局
   这样 http(s) 和 file:// 两种情况都能正常跑，不需要任何构建工具。
   ========================================================================== */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** 匹配 import 语句（支持跨多行的写法） */
const IMPORT_RE = /^[ \t]*import\s+[\s\S]*?from\s*['"][^'"]+['"];?[ \t]*$/gm;

const SHARED = ['js/shared.js', 'js/render.js', 'js/core.js'];

export const BUNDLES = [
  { out: 'js/home.js', files: [...SHARED, 'js/main.js'], label: '首页' },
  { out: 'js/app.js', files: [...SHARED, 'js/app-page.js'], label: '详情页' },
  {
    out: 'js/admin-lib.js',
    files: ['scripts/json-style.mjs', 'scripts/app-data.mjs'],
    label: '后台共用逻辑',
    expose: 'XIXI_DATA',
  },
];

/** 收集一个模块里 `export ...` 出来的名字（admin-lib 挂到 window 上用） */
export function exportedNames(code) {
  const names = [];
  const re = /^[ \t]*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;
  for (const match of String(code).matchAll(re)) names.push(match[1]);
  return names;
}

/** 处理单个源文件：去掉 import / export */
export function transformModule(code, file = '') {
  const withoutImports = code.replace(IMPORT_RE, (match) => match.replace(/[^\n]/g, ''));
  const withoutExports = withoutImports.replace(/^([ \t]*)export\s+/gm, '$1');
  if (/^\s*(import|export)\s/m.test(withoutExports)) {
    throw new Error(`${file} 里还有没处理干净的 import / export 语句`);
  }
  return withoutExports.trim();
}

/**
 * 生成一个包的完整代码。
 * expose 传 { global, names } 时，会在结尾把这些函数挂到 window[global] 上，
 * 供另一个 <script> 使用（整个包在 IIFE 里，不加这一步外面看不见）。
 */
export function buildBundleCode(parts, expose = null) {
  const unique = expose ? [...new Set(expose.names)].sort() : [];
  const tail =
    expose && unique.length
      ? `
  // 挂到全局，供后台页面（js/admin.js）直接调用
  window.${expose.global} = { ${unique.join(', ')} };
`
      : '';
  return `/* 由 scripts/bundle.mjs 自动生成，请不要直接修改这个文件。
   源码在 js/ 目录下（shared.js → render.js → core.js → 页面脚本），改完源码后运行 npm run build 会重新生成。 */
(function () {
  'use strict';

${parts.join('\n\n')}
${tail}})();
`;
}

/** 打包所有入口，写入 js/*.js */
export async function bundleAll(root) {
  const results = [];
    for (const item of BUNDLES) {
      const parts = [];
      const names = [];
      for (const file of item.files) {
        const code = await readFile(join(root, file), 'utf8');
        names.push(...exportedNames(code));
        parts.push(`/* ---------- ${file} ---------- */\n${transformModule(code, file)}`);
      }
      const out = buildBundleCode(parts, item.expose ? { global: item.expose, names } : null);
    await mkdir(dirname(join(root, item.out)), { recursive: true });
    await writeFile(join(root, item.out), out, 'utf8');
    results.push({ ...item, size: Buffer.byteLength(out, 'utf8') });
  }
  return results;
}
