/* ==========================================================================
   hash.mjs · 计算安装包的大小与 SHA256（可选，但推荐）
   --------------------------------------------------------------------------
   用法：
     npm run hash                         列出 downloads/ 里的文件
     npm run hash -- downloads/app.exe    计算大小 + SHA256，并给出可粘贴的 JSON
   ========================================================================== */

import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { humanSize, sha256 } from './files.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOWNLOADS = join(ROOT, 'downloads');

const files = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));

if (!files.length) {
  const entries = await readdir(DOWNLOADS, { withFileTypes: true }).catch(() => []);
  const list = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const info = await stat(join(DOWNLOADS, entry.name));
    list.push(`${humanSize(info.size).padStart(9)}  downloads/${entry.name}`);
  }
  console.log('\ndownloads/ 目录：');
  console.log(list.length ? list.join('\n') : '  （空 —— 把安装包放进来，然后在 data/apps.json 里写 downloads/文件名）');
  console.log('\n用法：npm run hash -- downloads/你的文件.exe\n');
} else {
  for (const file of files) {
    const path = file.startsWith('downloads') ? join(ROOT, file) : join(DOWNLOADS, file);
    try {
      const info = await stat(path);
      const digest = await sha256(path);
      const size = humanSize(info.size);
      console.log(`\n文件：${relative(ROOT, path).replace(/\\/g, '/')}`);
      console.log(`大小：${size}（${info.size} 字节）`);
      console.log(`SHA256：${digest}`);
      console.log('\n可粘贴进 data/apps.json 的写法：');
      console.log(
        JSON.stringify(
          {
            name: 'Windows x64 安装版',
            url: relative(ROOT, path).replace(/\\/g, '/'),
            size,
            platform: 'Windows',
            arch: 'x64',
            type: 'installer',
            sha256: digest,
          },
          null,
          2
        )
      );
      console.log('');
    } catch (error) {
      console.error(`\u2717 读不到文件：${file}（${error.code || error.message}）`);
      process.exitCode = 1;
    }
  }
}
