/* ==========================================================================
   admin.js · Xixi 后台的界面逻辑（两种运行方式共用同一套界面）
   --------------------------------------------------------------------------
   1. 本地后台：由 scripts/admin-server.mjs 提供（http://127.0.0.1:8787/admin/）。
      页面把安装包交给本机服务器，服务器写 downloads/、改 data/apps.json、
      重新构建，再走 git add / commit / push。接口都在 scripts/admin-server.mjs 里。
   2. 在线后台：admin/ 跟着网站一起部署到公网（…/admin/），没有 Node 服务，
      页面直接调 GitHub API —— 安装包传进 Releases，data/apps.json 直接提交，
      随后由仓库里的 GitHub Actions 自动重建、重新部署。见 js/admin-github.js。

   两种方式改数据用的是同一套逻辑（js/admin-lib.js 来自 scripts/json-style.mjs
   和 scripts/app-data.mjs），所以手写风格的 apps.json 不会被整体重排。
   打开页面时自动探测：有 /api/session 就是本地后台，否则进在线模式。
   ========================================================================== */

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** 在线模式的两个依赖：分别由 js/admin-lib.js、js/admin-github.js 提供 */
const DATA = window.XIXI_DATA || null;
const ONLINE = window.XIXI_GITHUB || null;

const state = {
  apps: [],
  site: {},
  categories: [],
  file: null,
  editing: '',
  mode: 'local', // 'local' = 本机 Node 后台；'online' = 公网页面直接调 GitHub API
  github: null, // 在线模式：{ token, owner, repo, branch, fullName, canPush }
};

const isOnline = () => state.mode === 'online';

/* --------------------------------------------------------------------------
   和后端说话
   -------------------------------------------------------------------------- */
async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (method !== 'GET') headers['x-xixi-admin'] = '1'; // 后端用它挡 CSRF
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const response = await fetch(`../api${path}`, { method, headers, body, credentials: 'same-origin' });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text.slice(0, 200) || `HTTP ${response.status}` };
  }
  if (!response.ok && !data.error) data.error = `HTTP ${response.status}`;
  data.httpStatus = response.status;
  return data;
}

/** 上传安装包：用 XHR 才能拿到进度 */
function uploadFile(file, { id, version }, onProgress) {
  return new Promise((resolvePromise, rejectPromise) => {
    const query = new URLSearchParams({ name: file.name, id: id || '', version: version || '' });
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `../api/upload?${query.toString()}`);
    xhr.setRequestHeader('x-xixi-admin', '1');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = {};
      }
      if (xhr.status >= 400 || !data.ok) rejectPromise(new Error(data.error || `上传失败（HTTP ${xhr.status}）`));
      else resolvePromise(data);
    };
    xhr.onerror = () => rejectPromise(new Error('上传被打断了，请再试一次'));
    xhr.send(file);
  });
}

/* --------------------------------------------------------------------------
   在线模式（页面部署在公网，直接调 GitHub API，不需要本机服务器）
   -------------------------------------------------------------------------- */
/** 打开页面时先探一下有没有本机后台：能拿到 /api/session 就是本地模式 */
async function probeLocalBackend() {
  try {
    const result = await api('/session');
    if (result && typeof result.loggedIn === 'boolean') return result;
  } catch {
    /* 静态托管上没有 /api/，fetch 会失败，这很正常 */
  }
  return null;
}

/** 按模式把界面切到该有的样子 */
function applyMode() {
  const online = isOnline();
  $('[data-mode]').textContent = online ? '在线后台 · GitHub API' : '本地后台';
  $('[data-footer-hint]').textContent = online
    ? '页面直接调 GitHub API，关掉浏览器即退出'
    : '只监听 127.0.0.1，关掉窗口即关闭';
  $$('[data-local-only]').forEach((node) => {
    node.hidden = online;
  });
  $('[data-online-note]').hidden = !online;
  $('[data-direct-url-box]').hidden = !online;
  $('[data-upload-hint]').textContent = online
    ? '支持 .exe / .msi / .apk / .dmg / .deb / .zip 等；单个文件建议不超过 2 GB'
    : '支持 .exe / .msi / .apk / .dmg / .deb / .zip 等；上限 4 GB';
  $('[data-save-push]').textContent = online ? '保存并提交到 GitHub' : '保存并一键上传到 GitHub';
  $('[data-save]').textContent = online ? '只保存，先不提交' : '保存并构建';
}

/** 在线模式：把工具自己的版本号显示出来（package.json 就在站点根目录） */
async function readToolVersion() {
  try {
    const response = await fetch('../package.json', { cache: 'no-store' });
    if (!response.ok) return '';
    const pkg = await response.json();
    return pkg.version || '';
  } catch {
    return '';
  }
}

/** 在线模式：读仓库里的一个 JSON 文件 */
async function readRepoJson(path) {
  const result = await ONLINE.readFile(state.github, path);
  if (!result.ok) throw new Error(result.error || `读 ${path} 失败。`);
  if (result.missing) throw new Error(`仓库里找不到 ${path}，先在本地把它提交上去。`);
  try {
    return JSON.parse(result.text);
  } catch {
    throw new Error(`${path} 不是合法 JSON，先在本地检查一下这个文件。`);
  }
}

/**
 * 在线模式：改仓库里的一个 JSON 文件。
 * build 收到文件原文，返回改好的新文本（用 DATA 里的函数做「局部改写」）。
 */
async function writeRepoJson(path, build, message) {
  const result = await ONLINE.updateFile(state.github, path, build, message);
  if (!result.ok) throw new Error(result.error || `写 ${path} 失败。`);
  return result;
}

/** 在线模式：用上次保存的令牌连 GitHub；没存过就先显示连接表单 */
async function startOnline() {
  const error = $('[data-connect-error]');
  if (!ONLINE || !DATA) {
    error.textContent =
      '后台脚本没加载全（缺 js/admin-lib.js 或 js/admin-github.js）。强制刷新一下页面，还不行就重新部署一次。';
    error.hidden = false;
    $('[data-connect]').hidden = false;
    document.body.dataset.ready = 'login';
    return;
  }

  const saved = ONLINE.loadConfig();
  // 仓库地址没存过就从 data/site.json 的 github 字段猜一个，省得手打
  if (!saved.repo) {
    try {
      const response = await fetch('../data/site.json', { cache: 'no-store' });
      if (response.ok) {
        const site = await response.json();
        const parsed = ONLINE.parseRepo(site.github || '');
        if (parsed) saved.repo = `${parsed.owner}/${parsed.repo}`;
      }
    } catch {
      /* 读不到就算了，让用户自己填 */
    }
  }

  if (!saved.token || !saved.repo) {
    showConnect(saved, '');
    return;
  }

  const parsed = ONLINE.parseRepo(saved.repo);
  if (!parsed) {
    showConnect(saved, '上次保存的仓库地址看不懂，重新填一次。');
    return;
  }

  $('[data-connect-status]').textContent = '正在用上次保存的令牌连接 GitHub…';
  const verified = await connectGithub({ ...saved, owner: parsed.owner, repo: parsed.repo });
  if (!verified.ok) {
    showConnect(saved, verified.error);
    return;
  }
}

/** 拿 token + 仓库去验证并进入后台；失败返回 { ok: false, error } */
async function connectGithub({ token, owner, repo, branch }) {
  const config = { token, owner, repo, branch: branch || '' };
  const verified = await ONLINE.verify(config);
  if (!verified.ok) return verified;
  state.github = {
    ...config,
    branch: verified.branch,
    fullName: verified.fullName,
    canPush: verified.canPush,
  };
  $('[data-actions-link]').href = `https://github.com/${state.github.fullName}/actions`;
  await enterAdmin({
    online: true,
    tool: { version: await readToolVersion() },
    site: { name: state.github.fullName },
  });
  if (!verified.canPush) {
    setStatus($('[data-status]'), `连上了 ${verified.fullName}，但这个令牌没有写权限：只能看，不能发布。`, 'err');
  }
  return { ok: true };
}

/** 显示「连接 GitHub」表单 */
function showConnect(saved = {}, message = '') {
  $('[data-connect]').hidden = false;
  $('[data-login]').hidden = true;
  $('[data-app]').hidden = true;
  $('[data-github-repo]').value = saved.repo || '';
  $('[data-github-branch]').value = saved.branch || '';
  $('[data-disconnect]').hidden = !ONLINE.loadConfig().token;
  $('[data-connect-status]').textContent = message ? '' : '还没连接 GitHub。填好上面的信息后点「连接」。';
  $('[data-connect-error]').textContent = message;
  $('[data-connect-error]').hidden = !message;
  document.body.dataset.ready = 'login';
}

/* --------------------------------------------------------------------------
   小工具（和服务端 scripts/files.mjs 保持一致）
   -------------------------------------------------------------------------- */
function slugify(value) {
  return String(value || '')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function nextVersion(version, kind = 'patch') {
  const match = /^(v?)(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(version || '').trim());
  if (!match) return String(version || '1.0.0');
  let [major, minor, patch] = [Number(match[2]), Number(match[3] || 0), Number(match[4] || 0)];
  if (kind === 'major') [major, minor, patch] = [major + 1, 0, 0];
  else if (kind === 'minor') [minor, patch] = [minor + 1, 0];
  else patch += 1;
  return `${match[1]}${major}.${minor}.${patch}`;
}

const EXT_RULES = [
  ['.msi', { platform: 'Windows', type: 'installer', label: 'MSI 安装版' }],
  ['.exe', { platform: 'Windows', type: 'installer', label: '安装版' }],
  ['.apk', { platform: 'Android', type: 'apk', label: 'APK 安装包' }],
  ['.xapk', { platform: 'Android', type: 'apk', label: 'XAPK 安装包' }],
  ['.dmg', { platform: 'macOS', type: 'dmg', label: 'dmg 安装镜像' }],
  ['.pkg', { platform: 'macOS', type: 'installer', label: 'pkg 安装包' }],
  ['.deb', { platform: 'Linux', type: 'deb', label: 'deb 安装包' }],
  ['.rpm', { platform: 'Linux', type: 'archive', label: 'rpm 安装包' }],
  ['.appimage', { platform: 'Linux', type: 'appimage', label: 'AppImage' }],
  ['.zip', { platform: '全平台', type: 'archive', label: '压缩包' }],
  ['.7z', { platform: '全平台', type: 'archive', label: '压缩包' }],
  ['.tar.gz', { platform: '全平台', type: 'archive', label: '压缩包' }],
];

function detectPackage(fileName) {
  const lower = String(fileName || '').toLowerCase();
  const rule = EXT_RULES.find(([ext]) => lower.endsWith(ext));
  const platform = rule ? rule[1].platform : '全平台';
  let arch = 'x64';
  if (/arm64|aarch64|apple[-\s]?silicon/.test(lower)) arch = 'arm64';
  else if (/x86|win32|32bit|i386/.test(lower)) arch = 'x86';
  else if (platform === 'Android' || platform === 'macOS') arch = 'universal';
  const portable = /portable|green|免安装|便携/i.test(lower);
  return {
    platform,
    arch,
    type: portable ? 'portable' : rule ? rule[1].type : 'file',
    label: portable ? '免安装版' : rule ? rule[1].label : '文件',
  };
}

function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function setStatus(node, text, tone = '') {
  if (!node) return;
  node.textContent = text || '';
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

function showLog(node, text) {
  if (!node) return;
  node.textContent = text || '';
  node.hidden = !text;
}

/** 把后台返回的每一步命令输出拼成一段可读日志 */
function stepsToLog(steps, hint) {
  const lines = [];
  (steps || []).forEach((step) => {
    lines.push(`$ ${step.command}${step.code === 0 ? '' : `   （退出码 ${step.code}）`}`);
    if (step.output) lines.push(step.output);
    lines.push('');
  });
  if (hint) lines.push(hint);
  return lines.join('\n').trim();
}

/* --------------------------------------------------------------------------
   表单读写
   -------------------------------------------------------------------------- */
const field = (name) => $(`[data-field="${name}"]`);

function readForm() {
  return {
    name: field('name').value.trim(),
    id: field('id').value.trim().toLowerCase(),
    version: field('version').value.trim() || '1.0.0',
    category: field('category').value,
    platform: field('platform').value,
    arch: field('arch').value,
    type: field('type').value,
    tagline: field('tagline').value.trim(),
    notes: field('notes').value.trim(),
    featured: field('featured').checked,
  };
}

function fillForm(app) {
  state.editing = app ? app.id : '';
  field('name').value = app ? app.name : '';
  field('id').value = app ? app.id : '';
  field('version').value = app ? app.version || '' : '1.0.0';
  if (app && app.category) field('category').value = app.category;
  const platform = app && (app.platforms || [])[0];
  if (platform && [...field('platform').options].some((option) => option.value === platform)) {
    field('platform').value = platform;
  }
  field('tagline').value = app ? app.tagline || '' : '';
  field('notes').value = '';
  field('featured').checked = Boolean(app && app.featured);
  updateModeHint();
}

function updateModeHint() {
  const id = field('id').value.trim().toLowerCase();
  const existing = state.apps.find((app) => app.id === id);
  const hint = $('[data-mode-hint]');
  if (!id) {
    hint.textContent = '填好名字和短名，选一个安装包就能发布';
    return;
  }
  hint.textContent = existing
    ? `将更新已有软件「${existing.name}」（当前 v${existing.version}）`
    : '这是一个新软件，会加到网站首页';
}

/* --------------------------------------------------------------------------
   初始化
   -------------------------------------------------------------------------- */
async function init() {
  const session = await probeLocalBackend();
  if (!session) {
    // 公网上的静态页面，没有本机 Node 服务 → 走在线模式（直接调 GitHub API）
    state.mode = 'online';
    applyMode();
    const version = await readToolVersion();
    if (version) $$('[data-tool-version]').forEach((node) => (node.textContent = `v${version}`));
    await startOnline();
    return;
  }
  state.mode = 'local';
  applyMode();
  $('[data-connect]').hidden = true;
  if (!session.loggedIn) {
    $('[data-login]').hidden = false;
    $('[data-app]').hidden = true;
    document.body.dataset.ready = 'login';
    return;
  }
  await enterAdmin(session);
}

async function enterAdmin(session) {
  $('[data-connect]').hidden = true;
  $('[data-login]').hidden = true;
  $('[data-app]').hidden = false;
  // 在线模式没有「退出登录」这回事，令牌是存在浏览器里的，用「清除已保存的令牌」
  $('[data-logout]').hidden = isOnline();
  $$('[data-tool-version]').forEach((node) => {
    node.textContent = `v${(session.tool && session.tool.version) || '—'}`;
  });
  $('[data-site-summary]').textContent = session.site && session.site.name ? `站点：${session.site.name}` : '';
  document.body.dataset.ready = 'true';
  await loadAll();
  refreshGit();
}

async function loadAll() {
  const status = $('[data-status]');
  let data;
  if (isOnline()) {
    // 在线模式：数据直接从仓库里读（data/ 下的 JSON 就是唯一真相）
    try {
      const [apps, site, categories] = await Promise.all([
        readRepoJson('data/apps.json'),
        readRepoJson('data/site.json'),
        readRepoJson('data/categories.json'),
      ]);
      data = { apps: apps.apps || [], site, categories };
    } catch (error) {
      return setStatus(status, String(error.message || error), 'err');
    }
  } else {
    data = await api('/data');
    if (!data.ok) return setStatus(status, data.error || '读取数据失败', 'err');
  }
  applyData(data);
}

/** 把读到的数据铺到界面上（本地 / 在线两种模式共用） */
function applyData(data) {
  state.apps = data.apps || [];
  state.site = data.site || {};
  state.categories = (data.categories && data.categories.items) || [];
  const select = field('category');
  const names = state.categories.map((item) => item.name);
  if (names.length) select.innerHTML = names.map((name) => `<option>${name}</option>`).join('');
  if (state.editing) fillForm(state.apps.find((app) => app.id === state.editing));
  $('[data-count-apps]').textContent = String(state.apps.length);
  $('[data-count-packages]').textContent = String(
    state.apps.reduce((sum, app) => sum + (app.downloads || []).length, 0)
  );
  renderAppList();
  fillSiteForm();
}

function renderAppList() {
  const keyword = $('[data-search]').value.trim().toLowerCase();
  const list = $('[data-apps-list]');
  list.innerHTML = '';
  const apps = state.apps
    .filter((app) => {
      if (!keyword) return true;
      return [app.name, app.id, app.category].filter(Boolean).join(' ').toLowerCase().includes(keyword);
    })
    .sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));

  if (!apps.length) {
    list.innerHTML = '<p class="admin-muted">没有找到匹配的软件。</p>';
    return;
  }

  apps.forEach((app) => {
    const item = document.createElement('div');
    item.className = 'admin-item';
    const meta = [
      `v${app.version || '—'}`,
      (app.platforms || []).join(' / ') || '未填平台',
      `${(app.downloads || []).length} 个安装包`,
      app.updated ? `更新于 ${app.updated}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    item.innerHTML = `
      <div class="admin-item-main">
        <div class="admin-item-title">
          <strong></strong>
          <span class="admin-tag"></span>
          <span class="admin-tag"></span>
        </div>
        <div class="admin-item-meta"></div>
      </div>
      <div class="admin-item-actions">
        <button class="btn btn-soft btn-sm" type="button" data-edit>编辑</button>
        <a class="btn btn-ghost btn-sm" href="../apps/${encodeURIComponent(app.id)}/index.html" target="_blank" rel="noopener">预览</a>
        <button class="btn btn-ghost btn-sm" type="button" data-remove>删除</button>
      </div>`;
    const tags = item.querySelectorAll('.admin-tag');
    tags[0].textContent = app.category || '未分类';
    tags[1].textContent = app.id;
    item.querySelector('strong').textContent = app.name;
    item.querySelector('.admin-item-meta').textContent = meta;
    item.querySelector('[data-edit]').addEventListener('click', () => {
      fillForm(app);
      switchTab('publish');
      setStatus($('[data-status]'), `正在编辑「${app.name}」，改完点「保存并构建」`, '');
    });
    item.querySelector('[data-remove]').addEventListener('click', () => removeApp(app));
    list.appendChild(item);
  });
}

async function removeApp(app) {
  const status = $('[data-status]');
  const online = isOnline();
  const question = online
    ? `确定删除「${app.name}」吗？\n\n会把它从 data/apps.json 里删掉并提交到 GitHub。` +
      `已经传进 Releases 的安装包不会跟着删（要删得去 GitHub 上手动删）。`
    : `确定删除「${app.name}」吗？\n\n点「确定」会同时删掉它独占的安装包文件（其他软件还在用的文件会保留）。`;
  if (!window.confirm(question)) return;

  setStatus(status, `正在删除「${app.name}」…`);

  if (online) {
    try {
      await writeRepoJson(
        'data/apps.json',
        (text) => {
          const next = DATA.removeApp(text, app.id);
          if (!next) throw new Error('data/apps.json 格式不符合预期，请先检查这个文件。');
          return next;
        },
        `remove: ${app.name}`
      );
      setStatus(status, `已删除「${app.name}」并提交到 GitHub，Actions 会自动重新构建网站。`, 'ok');
      await loadAll();
    } catch (error) {
      setStatus(status, String(error.message || error), 'err');
    }
    return;
  }

  const result = await api(`/apps?id=${encodeURIComponent(app.id)}&files=1`, { method: 'DELETE' });
  if (!result.ok) return setStatus(status, result.error || '删除失败', 'err');
  setStatus(status, `已删除「${app.name}」${result.removedFiles.length ? `，同时删掉 ${result.removedFiles.length} 个安装包文件` : ''}`, 'ok');
  showLog($('[data-log]'), result.build ? result.build.output : '');
  await loadAll();
}

function fillSiteForm() {
  const site = state.site || {};
  $$('[data-site-field]').forEach((input) => {
    const key = input.dataset.siteField;
    if (key === 'accent') input.value = (site.theme && site.theme.accent) || '';
    else if (key === 'accent2') input.value = (site.theme && site.theme.accent2) || '';
    else if (key === 'keywords') input.value = (site.keywords || []).join(', ');
    else input.value = site[key] || '';
  });
}

/* --------------------------------------------------------------------------
   标签页
   -------------------------------------------------------------------------- */
function switchTab(name) {
  $$('[data-tab-btn]').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.tabBtn === name)));
  $$('[data-tab]').forEach((section) => {
    section.hidden = section.dataset.tab !== name;
  });
  if (name === 'github') refreshGit();
}

/* --------------------------------------------------------------------------
   发布
   -------------------------------------------------------------------------- */
function pickFile(file) {
  if (!file) return;
  state.file = file;
  const guess = detectPackage(file.name);
  const base = file.name.replace(/\.[^.]+$/, '');
  if (!field('name').value.trim()) field('name').value = base.replace(/[-_]+/g, ' ').trim();
  if (!field('id').value.trim()) field('id').value = slugify(base) || `app-${Date.now().toString(36)}`;
  const versionMatch = /(\d+(?:\.\d+)+)/.exec(base);
  if (versionMatch) field('version').value = versionMatch[1];
  field('platform').value = guess.platform;
  field('arch').value = guess.arch;
  if ([...field('type').options].some((option) => option.value === guess.type)) field('type').value = guess.type;

  $('[data-drop-text]').textContent = file.name;
  $('[data-file-info]').textContent = `${file.name} · ${humanSize(file.size)} · 识别为 ${guess.platform} ${guess.arch} ${guess.label}`;
  updateModeHint();
}

/** 手动填直链、没有文件名时，用「类型」下拉框的中文名当标签 */
const TYPE_LABELS = {
  installer: '安装版',
  portable: '免安装版',
  apk: 'APK 安装包',
  dmg: 'dmg 安装镜像',
  deb: 'deb 安装包',
  appimage: 'AppImage',
  archive: '压缩包',
  link: '外链',
};

/** 组装一条下载项（url / size / sha256 由上传结果或手填直链给） */
function buildDownloadItem(upload, fileName) {
  const form = readForm();
  const label = fileName ? detectPackage(fileName).label : TYPE_LABELS[form.type] || '文件';
  const item = {
    name: `${form.platform}${form.arch && form.arch !== 'universal' ? ` ${form.arch}` : ''} ${label}`,
    url: upload.url,
    size: upload.size,
    platform: form.platform,
    arch: form.arch,
    type: form.type,
  };
  if (upload.sha256) item.sha256 = upload.sha256;
  return item;
}

/** 把一条下载项并进 app.downloads：同平台同架构替换，否则追加 */
function applyDownload(app, item) {
  app.downloads = (app.downloads || []).filter(
    (one) => !(one.platform === item.platform && one.arch === item.arch)
  );
  app.downloads.push(item);
  if (app.downloads.length === 1) app.size = item.size;
}

/** 上传安装包：本地交给本机服务器，在线传成 GitHub Release 的附件 */
async function uploadPackage(form, online) {
  const file = state.file;
  const status = $('[data-status]');
  const progress = $('[data-progress]');
  const bar = $('[data-progress-bar]');
  progress.hidden = false;
  bar.style.width = '0%';
  const onProgress = (ratio) => {
    bar.style.width = `${Math.round(ratio * 100)}%`;
    setStatus(status, `正在上传安装包… ${Math.round(ratio * 100)}%`);
  };

  if (!online) {
    setStatus(status, `正在上传安装包（${humanSize(file.size)}）…`);
    const result = await uploadFile(file, { id: form.id, version: form.version }, onProgress);
    bar.style.width = '100%';
    return result;
  }

  const tag = `v${form.version}`;
  setStatus(status, `正在准备 Releases（${tag}）…`);
  const release = await ONLINE.ensureRelease(state.github, tag, `${form.name} ${form.version}`);
  if (!release.ok) throw new Error(release.error || '创建 Release 失败。');

  setStatus(status, `正在上传安装包（${humanSize(file.size)}）…`);
  const asset = await ONLINE.uploadAsset(state.github, release.release, file, onProgress);
  if (!asset.ok) throw new Error(asset.error || '上传附件失败。');
  bar.style.width = '100%';
  return {
    url: asset.url,
    size: humanSize(asset.size || file.size),
    sha256: await ONLINE.sha256File(file),
    file: ONLINE.assetName(file.name),
  };
}

async function saveApp({ push = false } = {}) {
  const form = readForm();
  const status = $('[data-status]');
  const online = isOnline();
  if (!form.name) return setStatus(status, '先填软件名字', 'err');
  if (!form.id) return setStatus(status, '先填网址短名（可以点「自动生成」）', 'err');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(form.id)) {
    return setStatus(status, '网址短名只能用「小写字母、数字、短横线」，例如 my-tool', 'err');
  }

  const existing = state.apps.find((app) => app.id === form.id) || null;
  const app = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: form.id,
    name: form.name,
    tagline: form.tagline || `${form.name} 安装包下载`,
    description: form.tagline || `${form.name} 安装包下载`,
    icon: '',
    category: form.category,
    platforms: [form.platform],
    tags: [],
    version: form.version,
    releaseDate: new Date().toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
    size: '',
    license: '',
    homepage: '',
    repo: '',
    requirements: [],
    featured: form.featured,
    downloads: [],
    changelog: [],
    history: [],
  };

  try {
    const directUrl = online ? $('[data-direct-url]').value.trim() : '';

    if (state.file) {
      const upload = await uploadPackage(form, online);
      applyDownload(app, buildDownloadItem(upload, state.file.name));
      setStatus(
        status,
        online
          ? `安装包已经传进 Releases 了（${upload.size}）`
          : `安装包已放进 downloads/${upload.file}（${upload.size}）`,
        'ok'
      );
      state.file = null;
      $('[data-drop-text]').textContent = '把安装包拖进来，或点这里选择文件';
      $('[data-file-info]').textContent = '还没有选择文件';
    } else if (directUrl) {
      if (!/^https?:\/\//i.test(directUrl)) {
        return setStatus(status, '「已有下载直链」要以 http:// 或 https:// 开头', 'err');
      }
      applyDownload(app, buildDownloadItem({ url: directUrl, size: '' }, ''));
      $('[data-direct-url]').value = '';
    } else if (!app.downloads.length) {
      return setStatus(status, '第一次发布要选一个安装包；只想改文案的话，先选文件或用命令行改 data/apps.json', 'err');
    }

    app.name = form.name;
    app.version = form.version;
    app.category = form.category;
    app.featured = form.featured;
    if (form.tagline) app.tagline = form.tagline;
    app.platforms = [...new Set([...(app.platforms || []), form.platform, ...app.downloads.map((item) => item.platform)].filter(Boolean))];

    const notes = form.notes.split(/[;；]/).map((text) => text.trim()).filter(Boolean);
    if (online) {
      await saveAppOnline(app, existing, notes);
      return;
    }

    setStatus(status, '正在写入并重新构建…');
    const result = await api('/apps', {
      method: 'POST',
      json: { app, mode: existing ? 'update' : 'create', notes },
    });
    if (!result.ok) {
      showLog($('[data-log]'), result.build ? result.build.output : '');
      return setStatus(status, result.error || '保存失败', 'err');
    }

    showLog($('[data-log]'), result.build ? result.build.output : '');
    const historyHint = result.historyAdded ? '，老版本已记进历史版本' : '';
    setStatus(status, `已保存「${app.name}」v${app.version}${historyHint}`, 'ok');
    state.editing = app.id;
    await loadAll();

    if (push) {
      setStatus(status, '内容已保存，正在上传到 GitHub…');
      const published = await api('/publish', { method: 'POST', json: { message: `${existing ? 'update' : 'add'}: ${app.name} v${app.version}` } });
      showLog($('[data-log]'), stepsToLog(published.steps, published.hint || published.error));
      setStatus(status, published.ok ? '已经上传到 GitHub 🎉' : published.error || '上传失败', published.ok ? 'ok' : 'err');
    }
  } catch (error) {
    setStatus(status, String(error.message || error), 'err');
  }
}

/**
 * 在线模式保存软件：语义和本地后台的 POST /api/apps 一一对应
 * （见 scripts/admin-server.mjs 的 handleSaveApp），区别只是把
 * 「写文件 + 跑构建」换成了「直接提交到 GitHub，交给 Actions 构建」。
 */
async function saveAppOnline(app, existing, notes) {
  const status = $('[data-status]');
  const today = new Date().toISOString().slice(0, 10);

  app.updated = today;
  app.releaseDate = app.releaseDate || today;
  app.platforms = [
    ...new Set([...(app.platforms || []), ...app.downloads.map((item) => item.platform)].filter(Boolean)),
  ];

  const problems = DATA.validateApp(app);
  if (problems.length) return setStatus(status, problems.join(' '), 'err');

  const historyAdded = existing ? DATA.recordHistory(app, existing) : false;
  if (notes.length || !existing || existing.version !== app.version) {
    DATA.pushChangelog(app, app.version, notes, today);
  }

  setStatus(status, '正在提交到 GitHub…');
  try {
    const written = await writeRepoJson(
      'data/apps.json',
      (text) => {
        const next = DATA.spliceApp(text, app);
        if (!next) throw new Error('data/apps.json 格式不符合预期，请先检查这个文件。');
        return next;
      },
      `${existing ? 'update' : 'add'}: ${app.name} v${app.version}`
    );
    const historyHint = historyAdded ? '，老版本已记进历史版本' : '';
    const link = written.url ? `，提交在 ${written.url}` : '';
    setStatus(
      status,
      `已保存并提交「${app.name}」v${app.version}${historyHint}${link}。Actions 正在重新构建网站，一分钟左右生效。`,
      'ok'
    );
    state.editing = app.id;
    await loadAll();
  } catch (error) {
    setStatus(status, String(error.message || error), 'err');
  }
}

/* --------------------------------------------------------------------------
   站点信息 / GitHub
   -------------------------------------------------------------------------- */
async function saveSite() {
  const status = $('[data-site-status]');
  const fields = {};
  $$('[data-site-field]').forEach((input) => {
    fields[input.dataset.siteField] = input.value.trim();
  });
  setStatus(status, '正在保存…');

  if (isOnline()) return saveSiteOnline(fields, status);

  const result = await api('/site', { method: 'POST', json: { fields } });
  if (!result.ok) return setStatus(status, result.error || '保存失败', 'err');
  const skipped = result.skipped && result.skipped.length ? `（这些字段文件里没有，已跳过：${result.skipped.join('、')}）` : '';
  setStatus(status, `已保存${skipped}`, 'ok');
  showLog($('[data-log]'), result.build ? result.build.output : '');
  state.site = { ...state.site, ...fields, theme: { accent: fields.accent, accent2: fields.accent2 } };
  refreshGit();
}

/** 在线模式保存站点信息：语义和本地后台的 POST /api/site 一致 */
async function saveSiteOnline(fields, status) {
  const simple = ['name', 'nameCn', 'tagline', 'description', 'url', 'author', 'email', 'github', 'footerNote'];
  const skipped = [];
  try {
    await writeRepoJson(
      'data/site.json',
      (text) => {
        let next = text;
        const site = JSON.parse(next);
        for (const key of simple) {
          if (typeof fields[key] !== 'string') continue;
          const changed = DATA.setTopLevelValue(next, key, fields[key]);
          if (changed) next = changed;
          else skipped.push(key);
        }
        const theme = { ...(site.theme || {}) };
        let themeChanged = false;
        if (/^#[0-9a-f]{3,8}$/i.test(fields.accent || '')) {
          theme.accent = fields.accent;
          themeChanged = true;
        }
        if (/^#[0-9a-f]{3,8}$/i.test(fields.accent2 || '')) {
          theme.accent2 = fields.accent2;
          themeChanged = true;
        }
        if (themeChanged) {
          const changed = DATA.setTopLevelValue(next, 'theme', theme);
          if (changed) next = changed;
          else skipped.push('theme');
        }
        if (typeof fields.keywords === 'string') {
          const list = fields.keywords.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
          const changed = DATA.setTopLevelValue(next, 'keywords', list);
          if (changed) next = changed;
          else skipped.push('keywords');
        }
        return next;
      },
      'chore: 更新站点信息'
    );
    const hint = skipped.length ? `（这些字段文件里没有，已跳过：${skipped.join('、')}）` : '';
    setStatus(status, `已保存并提交${hint}。Actions 会自动重新构建网站。`, 'ok');
    state.site = { ...state.site, ...fields, theme: { accent: fields.accent, accent2: fields.accent2 } };
  } catch (error) {
    setStatus(status, String(error.message || error), 'err');
  }
}

/** 读仓库状态：本地模式走 git，在线模式走 GitHub API */
async function refreshGit() {
  const box = $('[data-git-box]');
  if (!box) return;
  if (isOnline()) return refreshRepoStatus(box);
  box.textContent = '正在读取 git 状态…';
  const result = await api('/git');
  const git = result.git || {};
  if (!git.ok) {
    box.textContent = git.error || '读不到 git 状态';
    return;
  }
  box.innerHTML = `
    <div>分支：<code></code>　远程仓库：<code></code></div>
    <div>未提交的改动：<strong></strong></div>
    <div>最近一次提交：<code></code></div>`;
  const codes = box.querySelectorAll('code');
  codes[0].textContent = git.branch || '—';
  codes[1].textContent = git.remote || '（没有配置 origin）';
  codes[2].textContent = git.last || '（还没有提交过）';
  box.querySelector('strong').textContent = git.clean ? '没有，一切都已经在 GitHub 上了' : `${git.changes} 处`;
}

/** 在线模式：没有本地 git，改成问 GitHub API 要仓库信息和最近一次提交 */
async function refreshRepoStatus(box) {
  const config = state.github;
  if (!config) {
    box.textContent = '还没连上 GitHub。';
    return;
  }
  box.textContent = '正在读取仓库状态…';
  const commits = await ONLINE.request(
    config,
    `/repos/${config.owner}/${config.repo}/commits?sha=${encodeURIComponent(config.branch)}&per_page=1`
  );
  const last = Array.isArray(commits.data) && commits.data[0] ? commits.data[0] : null;
  const lastText = last
    ? `${String(last.sha).slice(0, 7)} · ${String((last.commit.author && last.commit.author.date) || '').slice(0, 10)} · ` +
      `${String((last.commit.message || '')).split('\n')[0]}`
    : '（还没有提交过）';

  box.innerHTML = `
    <div>分支：<code></code>　仓库：<code></code></div>
    <div>令牌权限：<strong></strong></div>
    <div>最近一次提交：<code></code></div>`;
  const codes = box.querySelectorAll('code');
  codes[0].textContent = config.branch;
  codes[1].textContent = config.fullName || `${config.owner}/${config.repo}`;
  codes[2].textContent = lastText;
  box.querySelector('strong').textContent = config.canPush
    ? '可以发布（Contents 读写）'
    : '只能看不能改（缺 Contents 写权限）';
}

async function publishToGithub() {
  const status = $('[data-publish-status]');
  const message = $('[data-commit-message]').value.trim();
  setStatus(status, '正在构建、提交并推送…');
  const result = await api('/publish', { method: 'POST', json: { message } });
  showLog($('[data-publish-log]'), stepsToLog(result.steps, result.hint || result.error));
  if (result.ok) setStatus(status, result.nothing ? result.hint : '已上传到 GitHub 🎉', 'ok');
  else setStatus(status, result.error || '上传失败', 'err');
  refreshGit();
}

/* --------------------------------------------------------------------------
   事件绑定
   -------------------------------------------------------------------------- */
function bind() {
  $('[data-connect-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('[data-connect-error]');
    const status = $('[data-connect-status]');
    error.hidden = true;

    const token = $('[data-github-token]').value.trim();
    const repo = $('[data-github-repo]').value.trim();
    const branch = $('[data-github-branch]').value.trim();
    const parsed = ONLINE.parseRepo(repo);
    if (!token) {
      error.textContent = '先把 GitHub 令牌粘进来。';
      error.hidden = false;
      return;
    }
    if (!parsed) {
      error.textContent = '仓库要写成 owner/repo，例如 2681114373zxd-prog/resource-site';
      error.hidden = false;
      return;
    }

    status.textContent = '正在验证令牌…';
    ONLINE.saveConfig({ token, repo: `${parsed.owner}/${parsed.repo}`, branch });
    const result = await connectGithub({ token, owner: parsed.owner, repo: parsed.repo, branch });
    if (!result.ok) {
      status.textContent = '';
      error.textContent = result.error;
      error.hidden = false;
      return;
    }
    $('[data-github-token]').value = '';
    status.textContent = '';
  });

  $('[data-disconnect]').addEventListener('click', () => {
    if (!window.confirm('清除这个浏览器里保存的 GitHub 令牌？\n\n（GitHub 上的令牌本身还在，要彻底撤销请去 GitHub 设置里删掉）')) {
      return;
    }
    ONLINE.clearConfig();
    window.location.reload();
  });

  $('[data-login-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('[data-login-error]');
    error.hidden = true;
    const result = await api('/login', { method: 'POST', json: { password: $('[data-password]').value } });
    if (!result.ok) {
      error.textContent = result.error || '登录失败';
      error.hidden = false;
      return;
    }
    const session = await api('/session');
    await enterAdmin(session);
  });

  $('[data-logout]').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    window.location.reload();
  });

  $$('[data-tab-btn]').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tabBtn)));

  const drop = $('[data-drop]');
  const fileInput = $('[data-file]');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') fileInput.click();
  });
  fileInput.addEventListener('change', () => pickFile(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.dataset.over = 'true';
    })
  );
  ['dragleave', 'drop'].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.dataset.over = 'false';
    })
  );
  drop.addEventListener('drop', (event) => {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    pickFile(file);
  });

  $$('[data-bump]').forEach((btn) =>
    btn.addEventListener('click', () => {
      field('version').value = nextVersion(field('version').value, btn.dataset.bump);
    })
  );
  $('[data-gen-id]').addEventListener('click', () => {
    field('id').value = slugify(field('name').value) || slugify(field('id').value);
    updateModeHint();
  });
  ['name', 'id'].forEach((key) => field(key).addEventListener('input', updateModeHint));
  $('[data-reset]').addEventListener('click', () => {
    state.file = null;
    fillForm(null);
    $('[data-drop-text]').textContent = '把安装包拖进来，或点这里选择文件';
    $('[data-file-info]').textContent = '还没有选择文件';
    $('[data-direct-url]').value = '';
    showLog($('[data-log]'), '');
    setStatus($('[data-status]'), '');
  });
  $('[data-save]').addEventListener('click', () => saveApp());
  $('[data-save-push]').addEventListener('click', () => saveApp({ push: true }));
  $('[data-search]').addEventListener('input', renderAppList);
  $('[data-save-site]').addEventListener('click', saveSite);
  $('[data-refresh-git]').addEventListener('click', refreshGit);
  $('[data-publish]').addEventListener('click', publishToGithub);
}

bind();
init().catch((error) => {
  const status = $('[data-login-error]');
  if (status) {
    status.textContent = `后台没跑起来，或者页面路径不对：${error.message}`;
    status.hidden = false;
  }
});
