#!/usr/bin/env node
/* ==========================================================================
   publish.mjs · 一键发布：一个安装包 + 一个名字 = 网站上多一个软件
   --------------------------------------------------------------------------
   三种用法，挑一个顺手的：

     1) 拖拽（最省事）：把安装包拖到项目根目录的「发布软件.cmd」上，按提示输入名字
     2) 命令行：npm run publish -- "D:\下载\MyTool-1.2.3.exe" "我的工具"
     3) 全参数：
        npm run publish -- "D:\x\app.exe" "我的工具" --id my-tool --version 1.2.3 ^
            --category 工具 --platform Windows --arch x64 --notes "修复崩溃;新增导出" --push

   它会依次做这些事：
     复制安装包到 downloads/ → 算大小和 SHA256 → 写入（或更新）data/apps.json
     → 重新构建站点 → 自检 → 询问要不要 git push（加了 --push 就直接推）

   常用参数：
     --id <英文短名>      网址用的 id，例如 my-tool（已有同 id 时自动当成「更新这个软件」）
     --version <版本号>   默认 1.0.0
     --bump <patch|minor|major>   在已有版本号上自动 +1（例如 1.2.3 → 1.2.4）
     --category <分类>    默认按平台猜（Windows / Android / Linux / macOS / 工具 / 其他）
     --platform <平台>    Windows / macOS / Linux / Android / 全平台（默认按后缀猜）
     --arch <架构>        x64 / arm64 / x86 / universal（默认按文件名猜）
     --type <类型>        installer / portable / apk / dmg / deb / appimage / archive / file
     --tagline <一句话>   卡片上的一句话介绍
     --notes "a;b"        这次更新了什么（多条用分号隔开），会写进更新日志
     --featured           在首页置顶并加星标
     --push               发布后自动 git commit + git push
     --no-build           只改数据，不重新构建站点（一般用不到）
   ========================================================================== */

import { createInterface } from 'node:readline/promises';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectPackage, humanSize, packageFileName, sha256, slugify, toolVersion } from './files.mjs';
import { mergeDownload, nextBump, pushChangelog, recordHistory, validateApp } from './app-data.mjs';
import { spliceApp } from './json-style.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APPS_PATH = join(ROOT, 'data', 'apps.json');
const CATEGORIES_PATH = join(ROOT, 'data', 'categories.json');
const DOWNLOADS = join(ROOT, 'downloads');

const VALUE_FLAGS = new Set([
  'id',
  'name',
  'version',
  'category',
  'platform',
  'arch',
  'type',
  'tagline',
  'desc',
  'description',
  'notes',
  'note',
  'title',
  'bump',
]);
const BOOLEAN_FLAGS = new Set(['push', 'no-push', 'no-build', 'featured', 'help', 'h', 'yes', 'y']);

/* --------------------------------------------------------------------------
   参数解析
   -------------------------------------------------------------------------- */

/** 拖拽进来的路径两边会带引号，还会有多余空格 */
function stripQuotes(value) {
  return String(value ?? '')
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .replace(/^'(.*)'$/s, '$1')
    .trim();
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(stripQuotes(arg));
      continue;
    }
    const [rawKey, inline] = arg.slice(2).split('=');
    const key = rawKey.toLowerCase();
    if (inline !== undefined) options[key] = stripQuotes(inline);
    else if (VALUE_FLAGS.has(key)) options[key] = stripQuotes(argv[(i += 1)] ?? '');
    else if (BOOLEAN_FLAGS.has(key)) options[key] = true;
    else {
      options[key] = true;
      console.log(`  ! 不认识参数 --${key}，已忽略（用 --help 看用法）`);
    }
  }
  return { options, positional };
}

const { options, positional } = parseArgs(process.argv.slice(2));

if (options.help || options.h) {
  console.log(`
用法：npm run publish -- "安装包路径" "软件名字" [参数]

  例：npm run publish -- "D:\\下载\\MyTool-1.2.3.exe" "我的工具"
      npm run publish -- "D:\\下载\\MyTool-1.2.3.exe" "我的工具" --id my-tool --push

完整参数见 scripts/publish.mjs 顶部注释，或 README 的「一键发布」一节。
`);
  process.exit(0);
}

const today = new Date();
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
  today.getDate()
).padStart(2, '0')}`;

const rl = createInterface({ input: process.stdin, output: process.stdout });
const canAsk = Boolean(process.stdin.isTTY) && !options.yes;

async function ask(label, def = '', hint = '') {
  for (;;) {
    const answer = (await rl.question(`${label}${def ? `（默认 ${def}）` : ''}${hint ? ` ${hint}` : ''}: `)).trim();
    const value = answer || def;
    if (value) return value;
    console.log('  ↑ 这一项不能为空，请再输入一次。');
  }
}

function fail(message) {
  console.error(`\n\u2717 ${message}\n`);
  rl.close();
  process.exitCode = 1;
}

const log = (message = '') => console.log(message);

/** 跑一个子进程（不外抛异常，只返回退出码） */
function run(command, args, { cwd = ROOT } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', (error) => {
      console.error(`  ! 执行 ${command} 失败：${error.message}`);
      resolvePromise(-1);
    });
    child.on('close', (code) => resolvePromise(code ?? -1));
  });
}

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

/** 拼一个不会撞车的文件名：xxx.exe → xxx-2.exe → xxx-3.exe */
function uniqueDownloadName(fileName) {
  const ext = extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  let candidate = fileName;
  let index = 1;
  while (existsSync(join(DOWNLOADS, candidate))) {
    index += 1;
    candidate = `${base}-${index}${ext}`;
  }
  return candidate;
}

/** 把 --notes "a;b" 拆成数组 */
function splitNotes(raw) {
  return String(raw || '')
    .split(/[;；|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/* --------------------------------------------------------------------------
   主流程
   -------------------------------------------------------------------------- */
async function main() {
  log(`\n\u25b6 Xixi 发布工具 v${toolVersion(ROOT)} —— 安装包 + 名字 = 网站上多一个软件\n`);

  // 1. 安装包 ------------------------------------------------------------
  let fileArg = positional[0] || '';
  if (!fileArg) {
    if (!canAsk) return fail('没有告诉我要发布哪个安装包。用法：npm run publish -- "安装包路径" "软件名字"');
    fileArg = await ask('1/3 把安装包拖到这里，或输入完整路径');
  }
  const filePath = resolve(process.cwd(), fileArg);
  let fileInfo;
  try {
    fileInfo = await stat(filePath);
  } catch {
    return fail(`找不到这个文件：${fileArg}`);
  }
  if (!fileInfo.isFile()) return fail(`这不是一个文件：${fileArg}`);
  const originalName = basename(filePath);
  const guess = detectPackage(originalName);

  // 2. 名字 --------------------------------------------------------------
  let name = stripQuotes(options.name || positional[1] || '');
  if (!name) {
    if (!canAsk) return fail('没有告诉我要叫什么名字。用法：npm run publish -- "安装包路径" "软件名字"');
    name = await ask(`2/3 软件名字（网站上显示的，例如 ${originalName.replace(/\.[^.]+$/, '')}）`);
  }

  // 3. id（网址短名）----------------------------------------------------
  const idFromArgs = slugify(options.id);
  const idGuess = idFromArgs || slugify(name) || slugify(originalName);
  let id = idFromArgs;
  if (!id) {
    id = canAsk
      ? slugify(await ask('3/3 网址短名（只用小写字母、数字、短横线）', idGuess || `app-${todayIso.replace(/-/g, '')}`))
      : idGuess;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return fail(
      `「${id}」不能当网址短名：只允许小写字母、数字和短横线，例如 my-tool。可以加 --id my-tool 指定一个。`
    );
  }

  // 4. 数据（决定这是新增还是更新）--------------------------------------
  const appsFile = await readJson(APPS_PATH);
  const apps = Array.isArray(appsFile) ? appsFile : appsFile.apps || [];
  const categories = await readJson(CATEGORIES_PATH).catch(() => ({ items: [] }));
  const categoryNames = (categories.items || []).map((item) => item.name);
  const existing = apps.find((app) => app.id === id);

  // 先看命令行有没有指定；否则以后缀猜出来的为准（.apk → Android）；
  // 后缀猜不出来（例如 .bin）时才沿用已有条目的平台。
  const platform =
    stripQuotes(options.platform) ||
    (guess.platform !== '全平台' ? guess.platform : (existing && (existing.platforms || [])[0]) || guess.platform);
  const arch = stripQuotes(options.arch) || guess.arch;
  const type = stripQuotes(options.type) || guess.type;
  const version = stripQuotes(options.version) || (existing && existing.version) || '1.0.0';
  const category =
    stripQuotes(options.category) ||
    (categoryNames.includes(platform) ? platform : (existing && existing.category) || '工具');

  // 5. 复制安装包 --------------------------------------------------------
  await mkdir(DOWNLOADS, { recursive: true });
  const storedName = packageFileName(originalName, { id, version });
  let target = join(DOWNLOADS, storedName);
  if (resolve(target) !== filePath) {
    if (existsSync(target)) {
      const current = await stat(target).catch(() => null);
      // 同名但大小不一样（例如另一个软件的安装包重名）→ 自动换个名字，绝不覆盖别人的包
      const sameFile = current && current.size === fileInfo.size;
      if (!sameFile) target = join(DOWNLOADS, uniqueDownloadName(storedName));
    }
    await copyFile(filePath, target);
  }
  const size = humanSize(fileInfo.size);
  const digest = await sha256(target);
  const url = `downloads/${basename(target)}`;

  // 6. 写入 data/apps.json ----------------------------------------------
  const itemName =
    stripQuotes(options.title) || `${platform}${arch && arch !== 'universal' ? ` ${arch}` : ''} ${guess.label}`;
  const download = { name: itemName, url, size, platform, arch, type, sha256: digest };
  const notes = splitNotes(options.notes || options.note);
  const summary = [];
  /** @type {Record<string, unknown>} 这次要写进 apps.json 的那个软件 */
  let app;

  if (existing) {
    app = existing;
    // 改动前先留一份快照：等下要把老版本记进「历史版本」
    const previous = { ...existing, downloads: (existing.downloads || []).map((item) => ({ ...item })) };
    const merged = mergeDownload(existing, download);
    summary.push(
      merged.action === 'replace' ? `替换了已有的下载项「${merged.name}」` : `新增下载项「${merged.name}」`
    );
    if (!Array.isArray(existing.platforms)) existing.platforms = [];
    if (!existing.platforms.includes(platform)) existing.platforms.push(platform);
    existing.version = options.bump ? nextBump(previous.version, String(options.bump)) : version;
    existing.updated = todayIso;
    existing.releaseDate = existing.releaseDate || todayIso;
    if (existing.downloads.length === 1) existing.size = size;
    if (stripQuotes(options.tagline)) existing.tagline = stripQuotes(options.tagline);
    const description = stripQuotes(options.desc || options.description);
    if (description) existing.description = description;
    if (options.featured) existing.featured = true;
    if (options.bump) summary.push(`版本号自动 +1：${previous.version} → ${existing.version}`);
    if (recordHistory(existing, previous)) summary.push(`老版本 v${previous.version} 已记进历史版本`);
    pushChangelog(existing, existing.version, notes, todayIso);
  } else {
    const tagline = stripQuotes(options.tagline) || `${name} 安装包下载`;
    const description = stripQuotes(options.desc || options.description) || tagline;
    app = {
      id,
      name,
      tagline,
      description,
      icon: '',
      category,
      platforms: [platform],
      tags: [],
      version,
      releaseDate: todayIso,
      updated: todayIso,
      size,
      license: '',
      homepage: '',
      repo: '',
      requirements: [],
      featured: Boolean(options.featured),
      downloads: [download],
      changelog: [{ version, date: todayIso, notes: notes.length ? notes : ['首次收录。'] }],
      history: [],
    };
    summary.push(`新建了软件条目（分类：${category}）`);
  }

  // 只改写这一个软件的段落，其余部分一个字符都不动（见 scripts/json-style.mjs）
  const problems = validateApp(app);
  if (problems.length) return fail(`数据不完整：${problems.join(' ')}`);
  const nextText = spliceApp(await readFile(APPS_PATH, 'utf8'), app);
  if (!nextText) return fail('data/apps.json 的格式不符合预期（应该是 { "apps": [ ... ] }），请先修好它。');
  await writeFile(APPS_PATH, nextText, 'utf8');

  log(`\u2713 data/apps.json 已更新：${existing ? '更新' : '新增'} ${name}（${id}）`);
  summary.forEach((line) => log(`  · ${line}`));
  log(`  · 安装包：${url}（${size}）`);
  log(`  · SHA256：${digest}`);

  // 7. 构建 + 自检 -------------------------------------------------------
  if (!options['no-build']) {
    log('\n\u25b6 重新构建站点…');
    const buildCode = await run(process.execPath, [join(ROOT, 'scripts', 'build.mjs')]);
    if (buildCode !== 0) return fail('构建失败了（请看上面的报错）。');
    log('\n\u25b6 自检…');
    await run(process.execPath, [join(ROOT, 'scripts', 'check.mjs')]);
  }

  // 8. 提交 / 推送 -------------------------------------------------------
  const commitMessage = `${existing ? 'update' : 'add'}: ${name} v${version}`;
  let push = Boolean(options.push);
  if (!push && !options['no-push'] && canAsk) {
    const answer = (await rl.question('\n现在提交并推送到线上吗？(y/N): ')).trim().toLowerCase();
    push = answer === 'y' || answer === 'yes';
  }
  if (push) {
    log('\n\u25b6 提交并推送…');
    await run('git', ['add', '-A']);
    const commitCode = await run('git', ['commit', '-m', commitMessage]);
    if (commitCode !== 0) log('  ! git commit 没成功（可能没有改动，或还没配置 git 用户名 / 邮箱）。');
    const pushCode = await run('git', ['push']);
    log(
      pushCode === 0
        ? '\u2713 已推送，等 1～3 分钟线上就更新了。'
        : '  ! git push 没成功，可以手动在项目目录执行 git push。'
    );
  } else {
    log('\n下一步（想上线的话）：');
    log(`  git add -A && git commit -m "${commitMessage}" && git push`);
    log('  或者下次发布时加 --push，让它自己提交推送。');
  }

  log(`\n\u2713 完成：${name} v${version}`);
  log(`  本地预览：npm run dev      详情页：apps/${id}/index.html\n`);
  rl.close();
}

main().catch((error) => {
  console.error(`\n\u2717 出错了：${error.message || error}\n`);
  rl.close();
  process.exitCode = 1;
});
