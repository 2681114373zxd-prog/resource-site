/* ==========================================================================
   check.mjs · 只检查数据，不生成文件
   --------------------------------------------------------------------------
   用法：npm run check
   提交前跑一遍：检查 id 重复、下载链接写错、downloads/ 里的文件不存在等。
   ========================================================================== */

import { fileURLToPath } from 'node:url';
import { loadProject, validateProject } from './validate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const { site, apps } = await loadProject(ROOT);
const { errors, warnings } = await validateProject(ROOT, { site, apps });

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
