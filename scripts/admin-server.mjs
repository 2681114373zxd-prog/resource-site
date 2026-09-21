#!/usr/bin/env node
/* ==========================================================================
   admin-server.mjs · Xixi 本地后台（在自己电脑上跑的网站管理界面）
   --------------------------------------------------------------------------
   双击项目里的「Xixi后台.cmd」就能用：浏览器打开一个管理界面，
   把安装包拖进去、填个名字和版本号、点保存，再点「一键上传到 GitHub」，
   网站上就多了一个软件。

   设计上的几个取舍：
     · 零依赖：只用 Node 自带模块，不用 npm install
     · 只监听 127.0.0.1：外网访问不到，密码存在 data/admin.json（已在 .gitignore）
     · 改数据是「局部改写」：不会把 data/apps.json 整个重排（见 scripts/json-style.mjs）
     · 上传的安装包直接进 downloads/，和命令行发布 npm run publish 共用同一套逻辑

   用法：
     npm run admin                  默认 http://127.0.0.1:8787/admin/
     npm run admin -- --port 9000   换端口
     npm run admin -- --open        启动后自动打开浏览器
     npm run admin -- --password 你的密码   重设后台密码
   ========================================================================== */

import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, existsSync, openSync } from 'node:fs';
import { mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

import { argValue, humanSize, packageFileName, parsePort, sha256, toolVersion } from './files.mjs';
import { nextBump, pushChangelog, recordHistory, validateApp } from './app-data.mjs';
import { removeApp, setTopLevelValue, spliceApp } from './json-style.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const APPS_PATH = join(DATA_DIR, 'apps.json');
const SITE_PATH = join(DATA_DIR, 'site.json');
const CATEGORIES_PATH = join(DATA_DIR, 'categories.json');
const CONFIG_PATH = join(DATA_DIR, 'admin.json');
const DOWNLOADS = join(ROOT, 'downloads');

const HOST = '127.0.0.1';
const SESSION_COOKIE = 'xixi_admin';
const SESSION_MS = 12 * 60 * 60 * 1000; // 登录 12 小时内免密
const MAX_UPLOAD = 4 * 1024 * 1024 * 1024; // 单个安装包上限 4 GB
const BLOCKED = [/^\.git\//, /^scripts\//, /^node_modules\//, /^dist\//, /^\.github\//, /^\.wrangler\//, /^data\/admin\.json$/, /^package(-lock)?\.json$/, /^\.env/];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
  '.exe': 'application/octet-stream',
  '.msi': 'application/octet-stream',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.dmg': 'application/octet-stream',
  '.deb': 'application/vnd.debian.binary-package',
};

/* --------------------------------------------------------------------------
   0. 命令行参数
   -------------------------------------------------------------------------- */
const argv = process.argv.slice(2);
const PORT_TEXT = process.env.XIXI_ADMIN_PORT || argValue(argv, 'port', '8787');
const PORT = parsePort(PORT_TEXT);
if (PORT === null) {
  console.error(`\n\u2717 端口号 \u201c${PORT_TEXT}\u201d 不合法，要 1-65535 之间的数字。\u4f8b\u5982\uff1anpm run admin -- --port 9000\n`);
  process.exit(1);
}
const OPEN_BROWSER = argv.includes('--open');
const NEW_PASSWORD = argValue(argv, 'password', '');
const ADMIN_URL = `http://${HOST}:${PORT}/admin/`;

/* --------------------------------------------------------------------------
   1. 小工具
   -------------------------------------------------------------------------- */
const log = (...args) => console.log(...args);

function isoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

async function loadApps() {
  const file = await readJson(APPS_PATH);
  return { file, apps: Array.isArray(file) ? file : file.apps || [] };
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, code, data, headers = {}) {
  send(res, code, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', ...headers });
}

function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求内容太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit = 8 * 1024 * 1024) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  return JSON.parse(raw.toString('utf8'));
}

/**
 * 跑一条命令并把输出收集起来（给「一键上传到 GitHub」和构建用）。
 * 这里刻意不用管道：把子进程的 stdout/stderr 直接指向一个临时文件，
 * 跑完再读回来。好处是输出顺序和终端里一模一样（stdout/stderr 交替也不乱）。
 */
function runCapture(command, args) {
  return new Promise((resolvePromise) => {
    const logFile = join(tmpdir(), `xixi-cmd-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
    let fd;
    try {
      fd = openSync(logFile, 'w');
    } catch (error) {
      resolvePromise({ code: -1, output: `无法创建临时文件：${error.message}` });
      return;
    }

    let child;
    try {
      child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', fd, fd] });
    } catch (error) {
      closeSync(fd);
      unlink(logFile).catch(() => {});
      resolvePromise({ code: -1, output: String(error.message || error) });
      return;
    }

    const finish = async (code, extra = '') => {
      closeSync(fd);
      const output = await readFile(logFile, 'utf8').catch(() => '');
      unlink(logFile).catch(() => {});
      resolvePromise({ code, output: `${output}${extra}` });
    };

    child.on('error', (error) => finish(-1, `${error.message}\n`));
    child.on('close', (code) => finish(code ?? -1));
  });
}

async function buildSite() {
  const build = await runCapture(process.execPath, [join(ROOT, 'scripts', 'build.mjs')]);
  const check = await runCapture(process.execPath, [join(ROOT, 'scripts', 'check.mjs')]);
  return {
    ok: build.code === 0,
    checkOk: check.code === 0,
    output: `${build.output}\n${check.output}`.trim(),
  };
}

/* --------------------------------------------------------------------------
   2. 密码 / 登录状态
   -------------------------------------------------------------------------- */
let config = null;

async function loadConfig() {
  try {
    config = JSON.parse((await readFile(CONFIG_PATH, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    config = null;
  }
  const resetPassword = Boolean(NEW_PASSWORD);
  if (!config || !config.password || !config.secret || resetPassword) {
    config = {
      password: resetPassword ? NEW_PASSWORD : `xixi-${randomBytes(3).toString('hex')}`,
      secret: randomBytes(24).toString('hex'),
      updatedAt: new Date().toISOString(),
      note: '本地后台的登录密码（只存在你自己电脑上，不会提交到 GitHub）。改密码：npm run admin -- --password 新密码',
    };
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return { created: true, reset: resetPassword };
  }
  return { created: false, reset: false };
}

function digest(value) {
  return createHmac('sha256', config.secret).update(String(value)).digest();
}

function passwordMatches(input) {
  const given = digest(input);
  const expected = digest(config.password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function makeToken() {
  const expires = Date.now() + SESSION_MS;
  return `${expires}.${createHmac('sha256', config.secret).update(String(expires)).digest('hex')}`;
}

function verifyToken(token) {
  const [expires, mac] = String(token || '').split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  const expected = createHmac('sha256', config.secret).update(String(expires)).digest('hex');
  if (mac.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(mac, 'utf8'), Buffer.from(expected, 'utf8'));
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '')
    .split(';')
    .forEach((part) => {
      const index = part.indexOf('=');
      if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    });
  return out;
}

const sessionCookie = (value, maxAge) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/* --------------------------------------------------------------------------
   3. 静态文件
   -------------------------------------------------------------------------- */
function mimeOf(path) {
  return MIME[extname(path).toLowerCase()] || 'application/octet-stream';
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return Boolean(rel) && !rel.startsWith('..') && !rel.includes(':');
}

function blockedPath(rel) {
  return BLOCKED.some((pattern) => pattern.test(rel));
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/admin') {
    res.writeHead(302, { location: '/admin/' });
    return res.end();
  }
  if (rel.endsWith('/')) rel += 'index.html';
  if (rel === '/') return send(res, 302, '', { location: '/index.html' });

  const clean = rel.replace(/^\/+/, '');
  if (blockedPath(clean)) return send(res, 403, '这个文件不通过后台提供。');

  const filePath = resolve(ROOT, clean);
  if (!isInside(ROOT, filePath)) return send(res, 403, '路径不合法。');

  let info;
  try {
    info = await stat(filePath);
  } catch {
    return send(res, 404, `找不到 ${rel}`);
  }
  if (info.isDirectory()) {
    res.writeHead(302, { location: `${pathname.replace(/\/?$/, '/')}index.html` });
    return res.end();
  }

  res.writeHead(200, {
    'content-type': mimeOf(filePath),
    'content-length': info.size,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  return pipeline(createReadStream(filePath), res).catch(() => res.end());
}

/* --------------------------------------------------------------------------
   4. 上传安装包：浏览器把文件直接 PUT 过来，服务器边收边写盘
   -------------------------------------------------------------------------- */
async function handleUpload(req, res, url) {
  const original = String(url.searchParams.get('name') || 'package.bin');
  const id = String(url.searchParams.get('id') || '');
  const version = String(url.searchParams.get('version') || '');
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_UPLOAD) return sendJson(res, 413, { ok: false, error: '文件太大了（上限 4 GB）。' });

  await mkdir(DOWNLOADS, { recursive: true });
  const wanted = packageFileName(original, { id, version });
  let target = join(DOWNLOADS, wanted);
  if (existsSync(target)) {
    // 后台不覆盖已有文件：重名就加个 -2、-3
    const ext = extname(wanted);
    const base = ext ? wanted.slice(0, -ext.length) : wanted;
    let index = 1;
    while (existsSync(target)) {
      index += 1;
      target = join(DOWNLOADS, `${base}-${index}${ext}`);
    }
  }

  let written = 0;
  let tooBig = false;
  req.on('data', (chunk) => {
    written += chunk.length;
    if (written > MAX_UPLOAD) {
      tooBig = true;
      req.destroy();
    }
  });

  try {
    await pipeline(req, createWriteStream(target));
  } catch (error) {
    await unlink(target).catch(() => {});
    return sendJson(res, 500, { ok: false, error: `写入文件失败：${error.message}` });
  }

  if (tooBig) {
    await unlink(target).catch(() => {});
    return sendJson(res, 413, { ok: false, error: '文件太大了（上限 4 GB）。' });
  }

  const info = await stat(target);
  if (!info.size) {
    await unlink(target).catch(() => {});
    return sendJson(res, 400, { ok: false, error: '收到的文件是空的，请重新选择安装包。' });
  }

  const name = basename(target);
  return sendJson(res, 200, {
    ok: true,
    file: name,
    url: `downloads/${name}`,
    size: humanSize(info.size),
    bytes: info.size,
    sha256: await sha256(target),
  });
}

/* --------------------------------------------------------------------------
   5. API 路由
   -------------------------------------------------------------------------- */
async function handleApi(req, res, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/api';
  const method = req.method || 'GET';

  if (path === '/api/session' && method === 'GET') {
    const loggedIn = verifyToken(parseCookies(req)[SESSION_COOKIE]);
    const site = await readJson(SITE_PATH).catch(() => ({}));
    const { apps } = await loadApps().catch(() => ({ apps: [] }));
    return sendJson(res, 200, {
      ok: true,
      loggedIn,
      tool: { name: 'Xixi 本地后台', version: toolVersion(ROOT) },
      site: { name: site.name || '', url: site.url || '', brandSub: site.tagline || '' },
      counts: { apps: apps.length, packages: apps.reduce((sum, app) => sum + (app.downloads || []).length, 0) },
      url: ADMIN_URL,
    });
  }

  if (path === '/api/login' && method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    if (!passwordMatches(body.password)) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 400)); // 稍微拖一下，挡暴力破解
      return sendJson(res, 401, { ok: false, error: '密码不对。密码存在 data/admin.json 里。' });
    }
    return sendJson(res, 200, { ok: true }, { 'set-cookie': sessionCookie(makeToken(), SESSION_MS / 1000) });
  }

  if (path === '/api/logout' && method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });
  }

  // 下面这些都要登录
  if (!verifyToken(parseCookies(req)[SESSION_COOKIE])) {
    return sendJson(res, 401, { ok: false, error: '请先登录。' });
  }
  // 改数据的请求必须带上这个自定义头：浏览器里的第三方网站发不出来，等于顺手挡掉 CSRF
  if (method !== 'GET' && req.headers['x-xixi-admin'] !== '1') {
    return sendJson(res, 403, { ok: false, error: '请求缺少标记头，已拒绝。' });
  }

  if (path === '/api/data' && method === 'GET') {
    const { apps } = await loadApps();
    const site = await readJson(SITE_PATH).catch(() => ({}));
    const categories = await readJson(CATEGORIES_PATH).catch(() => ({ items: [] }));
    return sendJson(res, 200, { ok: true, apps, site, categories });
  }

  if (path === '/api/git' && method === 'GET') {
    return sendJson(res, 200, { ok: true, git: await gitSummary() });
  }

  if (path === '/api/site' && method === 'POST') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body || typeof body.fields !== 'object') return sendJson(res, 400, { ok: false, error: '提交的数据看不懂。' });
    let text = await readFile(SITE_PATH, 'utf8');
    const site = JSON.parse(text);
    const skipped = [];
    const simple = ['name', 'nameCn', 'tagline', 'description', 'url', 'author', 'email', 'github', 'footerNote'];
    for (const key of simple) {
      const value = body.fields[key];
      if (typeof value !== 'string') continue;
      const next = setTopLevelValue(text, key, value);
      if (next) {
        text = next;
        site[key] = value;
      } else {
        skipped.push(key);
      }
    }
    const theme = { ...(site.theme || {}) };
    let themeChanged = false;
    if (typeof body.fields.accent === 'string' && /^#[0-9a-f]{3,8}$/i.test(body.fields.accent)) {
      theme.accent = body.fields.accent;
      themeChanged = true;
    }
    if (typeof body.fields.accent2 === 'string' && /^#[0-9a-f]{3,8}$/i.test(body.fields.accent2)) {
      theme.accent2 = body.fields.accent2;
      themeChanged = true;
    }
    if (themeChanged) {
      const next = setTopLevelValue(text, 'theme', theme);
      if (next) text = next;
      else skipped.push('theme');
    }
    if (typeof body.fields.keywords === 'string') {
      const list = body.fields.keywords.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
      const next = setTopLevelValue(text, 'keywords', list);
      if (next) text = next;
      else skipped.push('keywords');
    }
    await writeFile(SITE_PATH, text, 'utf8');
    const build = body.build === false ? null : await buildSite();
    return sendJson(res, 200, { ok: true, skipped, build });
  }

  if (path === '/api/apps' && method === 'POST') {
    return handleSaveApp(req, res);
  }

  if (path === '/api/apps' && method === 'DELETE') {
    const id = String(url.searchParams.get('id') || '');
    const withFiles = url.searchParams.get('files') === '1';
    if (!id) return sendJson(res, 400, { ok: false, error: '没有指定要删除哪个软件。' });
    const { apps } = await loadApps();
    const target = apps.find((app) => app.id === id);
    if (!target) return sendJson(res, 404, { ok: false, error: `找不到 id 为 ${id} 的软件。` });

    const nextText = removeApp(await readFile(APPS_PATH, 'utf8'), id);
    if (!nextText) return sendJson(res, 500, { ok: false, error: 'data/apps.json 格式不符合预期。' });
    await writeFile(APPS_PATH, nextText, 'utf8');

    let removedFiles = [];
    // 顺手删掉它的静态详情页目录（构建脚本不会清理已删除软件留下的旧目录）
    const pageDir = join(ROOT, 'apps', id);
    if (isInside(join(ROOT, 'apps'), pageDir)) {
      await rm(pageDir, { recursive: true, force: true }).catch(() => {});
    }
    if (withFiles) {
      const others = apps.filter((app) => app.id !== id);
      const usedElsewhere = new Set(
        others.flatMap((app) => [...(app.downloads || []), ...(app.history || []).flatMap((h) => h.downloads || [])])
          .map((item) => String(item.url || ''))
      );
      for (const item of target.downloads || []) {
        const rel = String(item.url || '');
        if (!rel.startsWith('downloads/') || usedElsewhere.has(rel)) continue;
        const file = join(DOWNLOADS, rel.replace('downloads/', ''));
        if (!isInside(DOWNLOADS, file)) continue;
        await unlink(file).then(() => removedFiles.push(rel)).catch(() => {});
      }
    }
    const build = await buildSite();
    return sendJson(res, 200, { ok: true, removed: id, removedFiles, build });
  }

  if (path === '/api/upload' && method === 'PUT') {
    return handleUpload(req, res, url);
  }

  if (path === '/api/build' && method === 'POST') {
    return sendJson(res, 200, { ok: true, build: await buildSite() });
  }

  if (path === '/api/publish' && method === 'POST') {
    return handlePublish(req, res);
  }

  return sendJson(res, 404, { ok: false, error: `没有这个接口：${method} ${path}` });
}

/** 新增 / 更新一个软件（后台的主要接口） */
async function handleSaveApp(req, res) {
  const body = await readJsonBody(req).catch(() => null);
  if (!body || typeof body.app !== 'object' || !body.app) {
    return sendJson(res, 400, { ok: false, error: '提交的数据看不懂。' });
  }

  const today = isoToday();
  const incoming = body.app;
  const { apps } = await loadApps();
  const previous = apps.find((app) => app.id === incoming.id) || null;
  const mode = body.mode === 'update' ? 'update' : previous ? 'update' : 'create';

  if (mode === 'create' && previous) {
    return sendJson(res, 409, {
      ok: false,
      error: `已经有网址短名是「${incoming.id}」的软件了，改一个短名，或者用「更新」的方式发布。`,
    });
  }
  if (mode === 'update' && !previous) {
    return sendJson(res, 404, { ok: false, error: `找不到要更新的软件「${incoming.id}」。` });
  }

  const app = previous
    ? { ...previous }
    : {
        id: '',
        name: '',
        tagline: '',
        description: '',
        icon: '',
        category: '工具',
        platforms: [],
        tags: [],
        version: '1.0.0',
        releaseDate: today,
        updated: today,
        size: '',
        license: '',
        homepage: '',
        repo: '',
        requirements: [],
        featured: false,
        downloads: [],
        changelog: [],
        history: [],
      };

  Object.assign(app, incoming);
  app.id = String(app.id || '').trim();
  app.name = String(app.name || '').trim();
  app.version = String(app.version || previous?.version || '1.0.0').trim();
  if (previous && body.bump) app.version = nextBump(previous.version, String(body.bump));
  app.downloads = Array.isArray(app.downloads) ? app.downloads : [];
  app.updated = today;
  app.releaseDate = app.releaseDate || today;

  // 平台列表根据下载项自动补齐，省得用户手填
  const platforms = new Set([...(Array.isArray(app.platforms) ? app.platforms : []), ...app.downloads.map((item) => item.platform)].filter(Boolean));
  app.platforms = [...platforms];

  const problems = validateApp(app);
  if (problems.length) return sendJson(res, 400, { ok: false, error: problems.join(' ') });

  const historyAdded = previous ? recordHistory(app, previous) : false;
  const notes = Array.isArray(body.notes) ? body.notes.map((item) => String(item).trim()).filter(Boolean) : [];
  if (notes.length || !previous || previous.version !== app.version) pushChangelog(app, app.version, notes, today);

  const nextText = spliceApp(await readFile(APPS_PATH, 'utf8'), app);
  if (!nextText) return sendJson(res, 500, { ok: false, error: 'data/apps.json 格式不符合预期，请先检查这个文件。' });
  await writeFile(APPS_PATH, nextText, 'utf8');

  const build = body.build === false ? null : await buildSite();
  return sendJson(res, 200, { ok: true, mode, app, historyAdded, build });
}

/* --------------------------------------------------------------------------
   6. 一键上传到 GitHub
   -------------------------------------------------------------------------- */
async function gitSummary() {
  const inside = await runCapture('git', ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0) {
    return { ok: false, error: '这个目录还不是 git 仓库，或者电脑上没有装 git。' };
  }
  const branch = (await runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).output.trim();
  const remote = (await runCapture('git', ['remote', 'get-url', 'origin'])).output.trim();
  const status = (await runCapture('git', ['status', '--porcelain'])).output.trim();
  const last = (await runCapture('git', ['log', '-1', '--pretty=%h · %ad · %s', '--date=short'])).output.trim();
  return {
    ok: true,
    branch,
    remote,
    last,
    clean: !status,
    changes: status ? status.split('\n').length : 0,
    status: status.split('\n').slice(0, 50).join('\n'),
  };
}

async function handlePublish(req, res) {
  const body = await readJsonBody(req).catch(() => ({}));
  const steps = [];
  const record = async (title, command, args) => {
    const result = await runCapture(command, args);
    steps.push({ title, command: `${command} ${args.join(' ')}`, code: result.code, output: result.output.trim() });
    return result;
  };

  const built = await record('重新构建站点', process.execPath, [join(ROOT, 'scripts', 'build.mjs')]);
  if (built.code !== 0) {
    return sendJson(res, 500, { ok: false, error: '构建失败，先修好报错再上传。', steps });
  }

  const added = await record('暂存改动（git add -A）', 'git', ['add', '-A']);
  if (added.code !== 0) {
    return sendJson(res, 500, {
      ok: false,
      error: 'git add 失败：通常是 .git 目录被占用或没有写入权限（例如同时开着 Git 图形工具）。关掉它再试一次。',
      steps,
    });
  }
  const status = await runCapture('git', ['status', '--porcelain']);
  if (!status.output.trim()) {
    return sendJson(res, 200, {
      ok: true,
      nothing: true,
      steps,
      hint: '没有需要上传的改动：本地文件和 GitHub 上的一致。',
    });
  }

  const message = String(body.message || '').trim() || `update: 更新站点内容（${isoToday()}）`;
  const committed = await record('提交（git commit）', 'git', ['commit', '-m', message]);
  if (committed.code !== 0) {
    const output = committed.output || '';
    let hint = 'git commit 失败，请看下面的日志。';
    if (/index\.lock|Permission denied|being used by another process/i.test(output)) {
      hint = 'git 的临时文件被占用了：关掉正在运行的 Git 工具 / 编辑器，再点一次「一键上传」。';
    } else if (/Please tell me who you are|user\.email|empty ident/i.test(output)) {
      hint =
        '电脑上的 git 还没配置身份，先在这个项目目录里执行：\n  git config --global user.name "你的名字"\n  git config --global user.email "你的邮箱"';
    } else if (/nothing to commit/i.test(output)) {
      hint = '没有需要提交的改动：本地文件和 GitHub 上的一致。';
    }
    return sendJson(res, 500, {
      ok: false,
      error: hint,
      steps,
    });
  }

  let pushed = await record('上传到 GitHub（git push）', 'git', ['push']);
  if (pushed.code !== 0) {
    const branch = (await runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).output.trim() || 'main';
    pushed = await record(`再试一次：git push -u origin ${branch}`, 'git', ['push', '-u', 'origin', branch]);
  }

  return sendJson(res, pushed.code === 0 ? 200 : 500, {
    ok: pushed.code === 0,
    steps,
    message,
    hint:
      pushed.code === 0
        ? '已经上传到 GitHub，等 1～3 分钟线上就能看到（Cloudflare / GitHub Pages 会自动更新）。'
        : '传不上去：如果提示 Authentication failed / Permission denied，请先在这个项目目录里手动执行一次 git push，把 GitHub 账号密码或 token 填好，之后后台就能一键上传了。',
    error: pushed.code === 0 ? undefined : 'git push 失败，请看下面的日志。',
  });
}

/* --------------------------------------------------------------------------
   7. 启动
   -------------------------------------------------------------------------- */
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', ADMIN_URL);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, url.pathname);
    return send(res, 405, '不支持的请求方法。');
  } catch (error) {
    console.error('\u2717 处理请求出错：', error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(error.message || error) });
    return undefined;
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n\u2717 端口 ${PORT} 被占用了。换一个：npm run admin -- --port 8788\n`);
    process.exit(1);
  }
  throw error;
});

const { created, reset } = await loadConfig();

server.listen(PORT, HOST, () => {
  const version = toolVersion(ROOT);
  log(`\n\u25b6 Xixi 本地后台 v${version}`);
  log(`  地址：${ADMIN_URL}`);
  log(`  密码：${config.password}${created && !reset ? '   ← 第一次运行自动生成（也在 data/admin.json 里）' : ''}`);
  log(`  ${reset ? '（密码刚刚被 --password 参数改过）' : '改密码：npm run admin -- --password 新密码'}`);
  log('  只监听本机 127.0.0.1，外网访问不到；关掉这个窗口 = 关掉后台。\n');
  if (OPEN_BROWSER) openBrowser(ADMIN_URL);
});

function openBrowser(target) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}
