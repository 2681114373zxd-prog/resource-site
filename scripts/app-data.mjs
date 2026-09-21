/* ==========================================================================
   app-data.mjs · 软件数据的共用逻辑
   --------------------------------------------------------------------------
   命令行发布（scripts/publish.mjs）和本地后台（scripts/admin-server.mjs）
   都要做这几件事，所以统一放在这里，避免两边行为不一致：

     · mergeDownload(app, download)         平台 + 架构相同就替换，否则追加
     · pushChangelog(app, version, notes)   写更新日志（同一版本同一天只留一条）
     · nextBump(version, kind)              版本号 +1：1.2.3 → 1.2.4
     · recordHistory(app, previous)         把被替换掉的老版本记进「历史版本」
     · validateApp(app)                     能不能写进 apps.json
   ========================================================================== */

/** 把一条下载项合并进软件 */
export function mergeDownload(app, download) {
  app.downloads = Array.isArray(app.downloads) ? app.downloads : [];
  const index = app.downloads.findIndex(
    (item) => item.platform === download.platform && item.arch === download.arch
  );
  if (index >= 0) {
    app.downloads[index] = { ...app.downloads[index], ...download };
    return { action: 'replace', name: app.downloads[index].name };
  }
  app.downloads.push(download);
  return { action: 'add', name: download.name };
}

/** 更新日志：同一版本同一天只留一条，避免重复发布时堆一堆一样的记录 */
export function pushChangelog(app, version, notes, date) {
  if (!Array.isArray(app.changelog)) app.changelog = [];
  const first = app.changelog[0];
  if (first && first.version === version && first.date === date) {
    if (notes.length) first.notes = [...new Set([...(first.notes || []), ...notes])];
    return;
  }
  if (!notes.length && first && first.version === version) return;
  app.changelog.unshift({ version, date, notes: notes.length ? notes : ['更新安装包。'] });
  app.changelog = app.changelog.slice(0, 20);
}

/** 版本号 +1：1.2.3 → 1.2.4（kind = patch / minor / major）；看不懂的版本号原样返回 */
export function nextBump(version, kind = 'patch') {
  const raw = String(version || '').trim();
  const match = /^(v?)(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(raw);
  if (!match) return raw || '1.0.0';
  let [, prefix, major, minor = '0', patch = '0'] = match;
  let [a, b, c] = [Number(major), Number(minor), Number(patch)];
  if (kind === 'major') {
    a += 1;
    b = 0;
    c = 0;
  } else if (kind === 'minor') {
    b += 1;
    c = 0;
  } else {
    c += 1;
  }
  return `${prefix}${a}.${b}.${c}`;
}

/**
 * 把「被替换掉的老版本」记进历史版本（详情页的「历史版本」区就是用这个）。
 * 同一个版本只记一次，最多保留 max 条。
 */
export function recordHistory(app, previous, { max = 10 } = {}) {
  if (!previous) return false;
  const version = String(previous.version || '').trim();
  if (!version || version === String(app.version || '').trim()) return false;
  if (!Array.isArray(previous.downloads) || !previous.downloads.length) return false;

  app.history = Array.isArray(app.history) ? app.history : [];
  if (app.history.some((item) => String(item.version) === version)) return false;

  app.history.unshift({
    version,
    date: previous.updated || previous.releaseDate || '',
    size: previous.size || '',
    notes: (Array.isArray(previous.changelog) && previous.changelog[0] && previous.changelog[0].notes) || [],
    downloads: previous.downloads,
  });
  app.history = app.history.slice(0, max);
  return true;
}

/** 一个软件对象能不能写进 apps.json（返回中文错误信息，空数组 = 没问题） */
export function validateApp(app) {
  const errors = [];
  if (!app || typeof app !== 'object') return ['数据不是一个对象。'];
  if (!app.id) errors.push('缺少 id（网址短名）。');
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(String(app.id))) {
    errors.push(`id「${app.id}」不合法：只能用小写字母、数字和短横线。`);
  }
  if (!app.name) errors.push('缺少软件名字。');
  if (!Array.isArray(app.downloads) || !app.downloads.length) errors.push('至少要有一个下载项。');
  (app.downloads || []).forEach((item, index) => {
    if (!item || !item.url) errors.push(`第 ${index + 1} 个下载项缺少下载地址。`);
  });
  return errors;
}
