/* ==========================================================================
   check.mjs · 只检查数据，不生成文件
   --------------------------------------------------------------------------
   用法：npm run check
   提交前跑一遍：检查 id 重复、下载链接写错、downloads/ 里的文件不存在等。
   ========================================================================== */

import { fileURLToPath } from 'node:url';
import { loadProject, validateProject } from './validate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let project;
try {
  project = await loadProject(ROOT);
} catch (error) {
  // JSON 语法错误、顶层键写错之类的问题会直接抛到这里：
  // 只打一行能看懂的中文，不甩一串 stack，但退出码仍然是 1（CI 照样会红）。
  console.error(`\n\u2717 ${error.message}\n`);
  process.exit(1);
}

const { site, apps, categories } = project;
const { errors, warnings } = await validateProject(ROOT, { site, apps, categories });

console.log(`\n检查 data/ ：${apps.length} 个软件\n`);
warnings.forEach((message) => console.log(`  ! ${message}`));
errors.forEach((message) => console.log(`  \u2717 ${message}`));

if (errors.length) {
  console.log(`\n\u2717 发现 ${errors.length} 个错误，必须先修好。\n`);
  process.exitCode = 1;
} else if (warnings.length) {
  console.log(`\n\u2713 没有错误，${warnings.length} 条提醒（可以忽略，也可以顺手修一修）。\n`);
} else {
  console.log('\u2713 一切正常，可以提交了。\n');
}
