/* ==========================================================================
   new-app.mjs · 交互式添加一个新软件
   --------------------------------------------------------------------------
   用法：npm run new
   它会问你几个问题，然后把新软件追加到 data/apps.json 末尾。
   之后你只要：把安装包丢进 downloads/ → npm run build → git push
   ========================================================================== */

import { createInterface } from 'node:readline/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APPS_PATH = join(ROOT, 'data', 'apps.json');

const rl = createInterface({ input: process.stdin, output: process.stdout });

const today = new Date();
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
  today.getDate()
).padStart(2, '0')}`;

async function ask(label, { def = '', required = false, hint = '' } = {}) {
  for (;;) {
    const prefix = def ? `（默认 ${def}）` : '';
    const answer = (await rl.question(`${label}${prefix}${hint ? ` ${hint}` : ''}: `)).trim();
    const value = answer || def;
    if (!value && required) {
      console.log('  ↑ 这一项必填，请再输入一次。');
      continue;
    }
    return value;
  }
}

async function askList(label, { def = '', hint = '' } = {}) {
  const raw = await ask(label, { def, hint: hint || '（多个用逗号分隔）' });
  return raw
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

async function main() {
  const file = JSON.parse((await readFile(APPS_PATH, 'utf8')).replace(/^\uFEFF/, ''));
  const apps = Array.isArray(file) ? file : file.apps || [];
  const categories = JSON.parse((await readFile(join(ROOT, 'data', 'categories.json'), 'utf8')).replace(/^\uFEFF/, ''));

  console.log('\n添加新软件（不想填的项直接回车跳过；随时按 Ctrl + C 取消）\n');

  const idRaw = await ask('1/10 软件 id（英文短名，用于网址，例如 my-app）', { required: true });
  const id = slugify(idRaw);
  if (apps.some((app) => app.id === id)) {
    console.log(`\n\u2717 已经存在 id 为 ${id} 的软件了，请换一个。\n`);
    rl.close();
    process.exitCode = 1;
    return;
  }

  const name = await ask('2/10 软件名称', { required: true });
  const tagline = await ask('3/10 一句话介绍', { required: true });
  const categoryNames = (categories.items || []).map((c) => c.name);
  const category = await ask('4/10 分类', {
    def: categoryNames[0] || '工具',
    hint: `可选：${categoryNames.join(' / ')}`,
  });
  const platforms = await askList('5/10 支持的平台', { def: 'Windows', hint: '例如 Windows,macOS,Linux,Android' });
  const version = await ask('6/10 版本号', { def: '1.0.0' });
  const releaseDate = await ask('7/10 发布日期', { def: todayIso, hint: '格式 YYYY-MM-DD' });
  const size = await ask('8/10 文件总大小', { def: '' , hint: '例如 50 MB'});
  const description = await ask('9/10 软件介绍（可稍后到 apps.json 里补充换行/列表）', { def: tagline });
  const homepage = await ask('10/10 项目主页', { def: '' });
  const repo = await ask('     源码仓库', { def: '' });
  const requirements = await askList('     系统要求', { def: '', hint: '例如 Windows 10 及以上' });

  // 下载项
  const downloads = [];
  console.log('\n接下来添加下载项（按钮）。全部添加完后，在「名称」处直接回车结束。');
  for (;;) {
    const dlName = await ask(`  下载项 ${downloads.length + 1} 名称`, { def: '' });
    if (!dlName) break;
    const url = await ask('    下载地址（https://… 或 downloads/文件名）', { required: true });
    const dlSize = await ask('    文件大小', { def: size });
    const platform = await ask('    平台', { def: platforms[0] || 'Windows' });
    const arch = await ask('    架构', { def: 'x64', hint: 'x64 / arm64 / x86 / universal' });
    const type = await ask('    类型', { def: 'installer', hint: 'installer / portable / apk / dmg / deb / appimage / archive' });
    downloads.push({ name: dlName, url, size: dlSize, platform, arch, type });
    console.log('    \u2713 已添加\n');
  }

  const changelogNote = await ask('这次更新了什么？（多条用分号 ; 分隔）', { def: '' });

  const app = {
    id,
    name,
    tagline,
    description,
    icon: '',
    category,
    platforms,
    tags: [],
    version,
    releaseDate,
    updated: releaseDate,
    size,
    license: '',
    homepage,
    repo,
    requirements,
    featured: false,
    downloads,
    changelog: changelogNote
      ? [
          {
            version,
            date: releaseDate,
            notes: changelogNote.split(/[;；]/).map((n) => n.trim()).filter(Boolean),
          },
        ]
      : [],
    history: [],
  };

  if (Array.isArray(file)) file.push(app);
  else file.apps = [...apps, app];
  await writeFile(APPS_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf8');

  console.log(`\n\u2713 已写入 data/apps.json：${name}（${id}）`);
  console.log('\n接下来：');
  console.log('  1. 把安装包放进 downloads/（如果用外部链接就跳过这步）');
  console.log('  2. npm run build        生成详情页');
  console.log('  3. npm run dev          本地预览检查');
  console.log('  4. git add . && git commit -m "add ' + id + '" && git push\n');
  rl.close();
}

main().catch((error) => {
  console.error('\n\u2717 出错了：', error.message || error);
  rl.close();
  process.exitCode = 1;
});
