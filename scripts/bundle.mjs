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
];

/** 处理单个源文件：去掉 import / export */
export function transformModule(code, file = '') {
  const withoutImports = code.replace(IMPORT_RE, (match) => match.replace(/[^\n]/g, ''));
  const withoutExports = withoutImports.replace(/^([ \t]*)export\s+/gm, '$1');
  if (/^\s*(import|export)\s/m.test(withoutExports)) {
    throw new Error(`${file} 里还有没处理干净的 import / export 语句`);
  }
  return withoutExports.trim();
}

/** 生成一个包的完整代码 */
export function buildBundleCode(parts) {
  return `/* 由 scripts/bundle.mjs 自动生成，请不要直接修改这个文件。
   源码在 js/ 目录下（shared.js → render.js → core.js → 页面脚本），改完源码后运行 npm run build 会重新生成。 */
(function () {
  'use strict';

${parts.join('\n\n')}
})();
`;
}

/** 打包所有入口，写入 js/*.js */
export async function bundleAll(root) {
  const results = [];
  for (const item of BUNDLES) {
    const parts = [];
    for (const file of item.files) {
      const code = await readFile(join(root, file), 'utf8');
      parts.push(`/* ---------- ${file} ---------- */\n${transformModule(code, file)}`);
    }
    const out = buildBundleCode(parts);
    await mkdir(dirname(join(root, item.out)), { recursive: true });
    await writeFile(join(root, item.out), out, 'utf8');
    results.push({ ...item, size: Buffer.byteLength(out, 'utf8') });
  }
  return results;
}
