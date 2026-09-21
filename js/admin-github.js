/* ==========================================================================
   admin-github.js · 在线后台（A 方案）：直接调 GitHub API，不用服务器
   --------------------------------------------------------------------------
   用途：把 admin/ 页面部署到公网（https://2681114373.ccwu.cc/admin/），
   在任何一台电脑上打开都能发布软件 —— 不需要本机跑 Node 服务。

   一次发布发生了什么：
     1. 你在页面上粘一个 GitHub 细粒度令牌（只给本仓库 Contents 读写）
     2. 安装包 → 传成 GitHub Release 的附件（release 由页面自动建）
     3. data/apps.json → 用和本地后台同一套「局部改写」逻辑改完，整文件提交
     4. 你仓库里的 GitHub Actions 收到 push，自动重建并重新部署

   安全说明：
     · 令牌只存在你自己浏览器的 localStorage 里，只发给 api.github.com
     · 页面本身公开可见，但没有令牌谁也改不了你的仓库
     · 令牌可以随时在 GitHub 上撤销，撤销后这个页面立刻失效

   这个文件只负责「和 GitHub 说话」，界面和拼数据在 js/admin.js 里。
   ========================================================================== */

(function () {
  'use strict';

  const API = 'https://api.github.com';
  const STORE_KEY = 'xixi.github.v1';

  /* ------------------------------------------------------------------------
     配置：存在浏览器本地，不上传、不提交
     ------------------------------------------------------------------------ */
  function loadConfig() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      return {
        token: typeof saved.token === 'string' ? saved.token : '',
        repo: typeof saved.repo === 'string' ? saved.repo : '',
        branch: typeof saved.branch === 'string' ? saved.branch : '',
      };
    } catch {
      return { token: '', repo: '', branch: '' };
    }
  }

  function saveConfig(config) {
    try {
      window.localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ token: config.token || '', repo: config.repo || '', branch: config.branch || '' })
      );
      return true;
    } catch {
      return false;
    }
  }

  function clearConfig() {
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      /* 隐私模式下 localStorage 可能不让写，忽略 */
    }
  }

  /** 把 "owner/repo"、"https://github.com/owner/repo" 都认成 { owner, repo } */
  function parseRepo(text) {
    const cleaned = String(text || '')
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
    const parts = cleaned.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;
    return { owner, repo };
  }

  /* ------------------------------------------------------------------------
     Base64（中文要按 UTF-8 编码，不能直接 btoa）
     ------------------------------------------------------------------------ */
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }

  function fromBase64(base64) {
    const binary = window.atob(String(base64 || '').replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** 把 GitHub / 网络错误翻译成能照着做的中文提示 */
  function explain(status, data) {
    const detail = data && data.message ? `（GitHub 说：${data.message}）` : '';
    if (status === 401) return `令牌无效或已过期，重新生成一个再粘进来。${detail}`;
    if (status === 403) return `令牌权限不够：要给这个仓库 Contents 的「Read and write」。${detail}`;
    if (status === 404) return `找不到这个仓库或这个文件。细粒度令牌必须显式勾选本仓库，否则一律报 404。${detail}`;
    if (status === 409) return `文件刚被别人改过，冲突了，过几秒重试。${detail}`;
    if (status === 422) return `GitHub 不接受这次请求。${detail}`;
    if (status === 429) return `请求太频繁被限流了，等一会儿再试。${detail}`;
    return `GitHub 返回 ${status}。${detail}`;
  }

  const encodePath = (path) => String(path).split('/').map(encodeURIComponent).join('/');

  /* ------------------------------------------------------------------------
     基础请求
     ------------------------------------------------------------------------ */
  async function request(config, path, { method = 'GET', body, accept } = {}) {
    const url = /^https?:/i.test(path) ? path : `${API}${path}`;
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${config.token}`,
          accept: accept || 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      return {
        ok: false,
        network: true,
        error: `连不上 GitHub（${error.message}）。检查一下网络，或者关掉广告拦截 / 代理插件再试。`,
      };
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) return { ok: false, status: response.status, data, error: explain(response.status, data) };
    return { ok: true, status: response.status, data };
  }

  /* ------------------------------------------------------------------------
     仓库 / 文件
     ------------------------------------------------------------------------ */
  /** 验令牌：顺便把默认分支和「能不能写」读出来，好给用户一个明确反馈 */
  async function verify(config) {
    const result = await request(config, `/repos/${config.owner}/${config.repo}`);
    if (!result.ok) return result;
    const repo = result.data || {};
    const canPush = Boolean(repo.permissions && repo.permissions.push);
    return {
      ok: true,
      fullName: repo.full_name || `${config.owner}/${config.repo}`,
      branch: config.branch || repo.default_branch || 'main',
      defaultBranch: repo.default_branch || 'main',
      canPush,
      isPrivate: Boolean(repo.private),
      warning: canPush ? '' : '这个令牌没有写权限，只能看不能改。',
    };
  }

  /** 读一个文本文件：{ ok, text, sha }；文件不存在返回 { ok: true, missing: true } */
  async function readFile(config, path) {
    const query = `?ref=${encodeURIComponent(config.branch)}`;
    const result = await request(config, `/repos/${config.owner}/${config.repo}/contents/${encodePath(path)}${query}`);
    if (result.status === 404) return { ok: true, missing: true };
    if (!result.ok) return result;
    const data = result.data || {};
    if (Array.isArray(data)) return { ok: false, error: `${path} 应该是个文件，仓库里却是个目录。` };
    if (data.content) return { ok: true, sha: data.sha, text: fromBase64(data.content) };
    // 超过 1 MB 的文件 GitHub 不在 content 里给内容，只能再取一次原始文件
    if (!data.download_url) return { ok: false, error: `${path} 读不出内容（GitHub 没给下载地址）。` };
    const raw = await request(config, data.download_url, { accept: 'application/vnd.github.raw' });
    if (!raw.ok) return raw;
    return { ok: true, sha: data.sha, text: typeof raw.data === 'string' ? raw.data : String(raw.data || '') };
  }

  /** 提交一个文本文件 */
  async function commitFile(config, path, text, message, sha) {
    const body = { message, content: toBase64(text), branch: config.branch };
    if (sha) body.sha = sha;
    const result = await request(config, `/repos/${config.owner}/${config.repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body,
    });
    if (!result.ok) return result;
    const commit = (result.data && result.data.commit) || {};
    return { ok: true, sha: commit.sha, url: commit.html_url || '' };
  }

  /**
   * 「读 → 改 → 写」的安全封装：
   * 每次写之前都重新读一遍拿最新 sha，冲突（409）就自动重来，最多 3 次。
   * build(currentText) 返回新文本；返回 null 表示不用改。
   */
  async function updateFile(config, path, build, message) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await readFile(config, path);
      if (!current.ok) return current;
      if (current.missing) {
        return { ok: false, error: `仓库里找不到 ${path}。先在本地把它提交上去，再来用在线后台。` };
      }
      let next;
      try {
        next = build(current.text);
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) };
      }
      if (next === null || next === undefined) return { ok: true, unchanged: true };
      const written = await commitFile(config, path, next, message, current.sha);
      if (written.ok) return written;
      if (written.status !== 409) return written;
    }
    return { ok: false, error: '一直有人在同时改这个文件，冲突重试 3 次都失败了，过一会儿再来。' };
  }

  /* ------------------------------------------------------------------------
     Release 和安装包附件
     ------------------------------------------------------------------------ */
  /** 找 tag 对应的 release，没有就建一个 */
  async function ensureRelease(config, tag, name) {
    const path = `/repos/${config.owner}/${config.repo}/releases/tags/${encodeURIComponent(tag)}`;
    const found = await request(config, path);
    if (found.ok) return { ok: true, release: found.data };
    if (found.status !== 404) return found;

    const created = await request(config, `/repos/${config.owner}/${config.repo}/releases`, {
      method: 'POST',
      body: { tag_name: tag, name: name || tag, body: '由 Xixi 在线后台发布', draft: false, prerelease: false },
    });
    if (created.ok) return { ok: true, release: created.data };
    // 422：这个 tag 已经存在（但还没有对应的 release），按 tag 再查一次
    if (created.status === 422) {
      const retry = await request(config, path);
      if (retry.ok) return { ok: true, release: retry.data };
    }
    return created;
  }

  /** 附件名：去掉路径分隔符，空格换成短横线 */
  function assetName(name) {
    return String(name || 'package').replace(/[\\/]/g, '-').replace(/\s+/g, '-');
  }

  /** 上传安装包到 release 附件（用 XHR 才有进度条） */
  function uploadAsset(config, release, file, onProgress) {
    return new Promise((resolvePromise) => {
      const base = String((release && release.upload_url) || '').replace(/\{.*$/, '');
      if (!base) {
        resolvePromise({ ok: false, error: '这个 release 没有上传地址，没法传附件。' });
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${base}?name=${encodeURIComponent(assetName(file.name))}`);
      xhr.setRequestHeader('authorization', `Bearer ${config.token}`);
      xhr.setRequestHeader('content-type', 'application/octet-stream');
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.browser_download_url) {
          resolvePromise({ ok: true, url: data.browser_download_url, size: data.size, name: data.name });
        } else if (xhr.status === 422) {
          resolvePromise({
            ok: false,
            status: 422,
            error: '这个版本的附件里已经有同名文件了。换个版本号，或者先去 GitHub 上把旧附件删掉再传。',
          });
        } else {
          resolvePromise({ ok: false, status: xhr.status, error: explain(xhr.status, data) });
        }
      };
      xhr.onerror = () => {
        resolvePromise({
          ok: false,
          network: true,
          error:
            '上传中断了：可能是网络问题，也可能是浏览器挡住了 GitHub 的上传域名。' +
            '可以先去 GitHub Releases 手动传，再把直链填进「已有下载直链」。',
        });
      };
      xhr.send(file);
    });
  }

  /** 算 SHA256 校验值；文件太大或浏览器不支持（非 https）就返回空字符串 */
  async function sha256File(file) {
    const subtle = window.crypto && window.crypto.subtle;
    if (!subtle) return '';
    if (file.size > 256 * 1024 * 1024) return '';
    const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  window.XIXI_GITHUB = {
    API,
    STORE_KEY,
    assetName,
    clearConfig,
    commitFile,
    ensureRelease,
    explain,
    fromBase64,
    loadConfig,
    parseRepo,
    readFile,
    request,
    saveConfig,
    sha256File,
    toBase64,
    updateFile,
    uploadAsset,
    verify,
  };
})();
