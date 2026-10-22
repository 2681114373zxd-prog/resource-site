/* ==========================================================================
   validate.mjs · 读取 + 校验数据
   --------------------------------------------------------------------------
   build.mjs 和 check.mjs 共用这里的逻辑：
     - 缺字段、id 重复、下载地址写错、下载文件不存在……都会给出中文提示
   ========================================================================== */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** 读取 JSON（出错时给出友好提示） */
async function readJson(path) {
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`读取 ${path} 失败：${error.message}`);
  }
}

export async function loadProject(root) {
  const site = await readJson(join(root, 'data', 'site.json'));
  const categories = await readJson(join(root, 'data', 'categories.json'));
  const appsFile = await readJson(join(root, 'data', 'apps.json'));

  // 顶层必须是数组，或者 { "apps": [...] }。
  // 这里以前写的是 `appsFile.apps || []`：顶层键一旦被改坏（例如被翻译成「应用程序」），
  // 就会安静地取到 0 条软件 —— 构建退出码 0、部署上去是个空站。所以必须直接报错。
  if (Array.isArray(appsFile)) return { site, categories, apps: appsFile };
  if (appsFile && typeof appsFile === 'object' && Array.isArray(appsFile.apps)) {
    return { site, categories, apps: appsFile.apps };
  }

  const keys =
    appsFile && typeof appsFile === 'object'
      ? Object.keys(appsFile).join('、') || '（空对象）'
      : String(appsFile === null ? 'null' : typeof appsFile);
  throw new Error(
    `data/apps.json 的顶层必须是 { "apps": [...] }，当前顶层键是：${keys}（apps 也必须是数组）`
  );
}

/** slug 是否适合做目录名（中文、空格、大写都会给出提醒） */
function slugWarning(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return `id「${id}」不是推荐的写法（建议只用小写字母、数字和短横线，例如 my-app）`;
  }
  return '';
}

/* --------------------------------------------------------------------------
   字段契约（以 README「六、数据字段说明」为准）
   --------------------------------------------------------------------------
   这份白名单是防线：字段名一旦被写成中文（ID / 名称 / 下载 / 更改日志…），
   所有读取逻辑都只会拿到 undefined，而站点看上去「构建成功」。
   -------------------------------------------------------------------------- */
const APP_FIELDS = [
  'id',
  'name',
  'tagline',
  'description',
  'icon',
  'category',
  'platforms',
  'tags',
  'version',
  'releaseDate',
  'updated',
  'size',
  'license',
  'homepage',
  'repo',
  'requirements',
  'featured',
  'hidden',
  'downloads',
  'changelog',
  'history',
];
const DOWNLOAD_FIELDS = ['name', 'url', 'size', 'platform', 'arch', 'type', 'note', 'sha256'];
const CHANGELOG_FIELDS = ['version', 'date', 'notes'];
const HISTORY_FIELDS = ['version', 'date', 'size', 'notes', 'downloads'];
const PLATFORM_NAMES = ['Windows', 'macOS', 'Linux', 'Android'];

/** 找出不在白名单里的键名 */
function unknownKeys(record, allowed) {
  return Object.keys(record).filter((key) => !allowed.includes(key));
}

function unknownFieldMessage(where, keys, allowed) {
  return `data/apps.json：${where}有未知字段「${keys.join('、')}」，字段名必须用英文（允许的字段：${allowed.join('、')}）。`;
}

/**
 * 校验数据，返回 { errors, warnings }
 * errors   → 构建会失败，必须修
 * warnings → 只是提醒，不影响构建
 */
export async function validateProject(root, { site, apps, categories }) {
  const errors = [];
  const warnings = [];
  const seen = new Map();

  // 分类白名单：category 必须和 data/categories.json 里的 name 对得上。
  // 没传 categories 时自己读一份，保证 check.mjs / build.mjs 的调用方式都不用改。
  const catalog = categories || (await readJson(join(root, 'data', 'categories.json')));
  const categoryNames = (catalog?.items || []).map((item) => item.name).filter(Boolean);
  const categoryList = categoryNames.length ? categoryNames.join('、') : '（data/categories.json 里还没有分类）';

  // 一条软件都没有，通常就是「数据被改坏」的症状（顶层键写错、记录全丢）。
  // 不能只当提醒：那样构建会以退出码 0 产出空站。
  if (!apps.length) {
    errors.push('data/apps.json 里没有任何软件：顶层要写成 { "apps": [ … ] }，并且至少保留一条记录。');
  }

  for (const [index, app] of apps.entries()) {
    const label = app?.id || app?.name || app?.ID || app?.名称 || `第 ${index + 1} 条`;
    if (!app || typeof app !== 'object') {
      errors.push(`第 ${index + 1} 条数据不是对象，请检查 JSON 格式。`);
      continue;
    }
    const appUnknown = unknownKeys(app, APP_FIELDS);
    if (appUnknown.length) errors.push(unknownFieldMessage(`${label} `, appUnknown, APP_FIELDS));

    if (!app.id) errors.push(`${label}：缺少 id 字段（详情页地址要用它）。`);
    if (!app.name) errors.push(`${label}：缺少 name 字段。`);
    if (!app.version) warnings.push(`${label}：没有写 version，卡片上会显示 “—”。`);
    if (!app.updated && !app.releaseDate) warnings.push(`${label}：建议填写 updated（更新时间），排序会用到。`);
    if (!Array.isArray(app.platforms) || !app.platforms.length) {
      warnings.push(`${label}：没有写 platforms（例如 ["Windows", "Android"]）。`);
    } else {
      const badPlatforms = app.platforms.filter((item) => !PLATFORM_NAMES.includes(String(item)));
      if (badPlatforms.length) {
        errors.push(
          `data/apps.json：${label} 的 platforms 里有不认识的平台「${badPlatforms.join('、')}」（只能写：${PLATFORM_NAMES.join('、')}）。`
        );
      }
    }
    if (app.category && !categoryNames.includes(String(app.category))) {
      errors.push(
        `data/apps.json：${label} 的 category「${app.category}」不在 data/categories.json 里（可以写：${categoryList}）。`
      );
    }
    if (!Array.isArray(app.downloads) || !app.downloads.length) {
      warnings.push(`${label}：没有写 downloads 下载项，详情页会显示「暂无下载」。`);
    }
    if (app.changelog && !Array.isArray(app.changelog)) {
      errors.push(`data/apps.json：${label} 的 changelog 必须是数组。`);
    }
    if (app.history && !Array.isArray(app.history)) {
      errors.push(`data/apps.json：${label} 的 history 必须是数组。`);
    }
    if (app.id) {
      const slugIssue = slugWarning(app.id);
      if (slugIssue) warnings.push(slugIssue);
      if (seen.has(app.id)) errors.push(`id 重复：${app.id}（第 ${seen.get(app.id) + 1} 条和第 ${index + 1} 条）。`);
      seen.set(app.id, index);
    }

    for (const [i, entry] of (app.changelog || []).entries()) {
      if (!entry || typeof entry !== 'object') {
        errors.push(`data/apps.json：${label} 的第 ${i + 1} 条更新日志不是对象。`);
        continue;
      }
      const bad = unknownKeys(entry, CHANGELOG_FIELDS);
      if (bad.length) errors.push(unknownFieldMessage(`${label} 的第 ${i + 1} 条更新日志`, bad, CHANGELOG_FIELDS));
    }

    for (const [i, entry] of (app.history || []).entries()) {
      if (!entry || typeof entry !== 'object') {
        errors.push(`data/apps.json：${label} 的第 ${i + 1} 条历史版本不是对象。`);
        continue;
      }
      const bad = unknownKeys(entry, HISTORY_FIELDS);
      if (bad.length) errors.push(unknownFieldMessage(`${label} 的第 ${i + 1} 条历史版本`, bad, HISTORY_FIELDS));
    }

    for (const [i, item] of (app.downloads || []).entries()) {
      if (!item || !item.url) {
        errors.push(`${label}：第 ${i + 1} 个下载项缺少 url。`);
        continue;
      }
      const bad = unknownKeys(item, DOWNLOAD_FIELDS);
      if (bad.length) errors.push(unknownFieldMessage(`${label} 的第 ${i + 1} 个下载项`, bad, DOWNLOAD_FIELDS));

      const url = String(item.url);
      if (/^https?:/i.test(url)) {
        if (!/^https:/i.test(url) && !/^http:\/\/localhost/i.test(url)) {
          warnings.push(`${label}：下载地址使用 http（非加密）：${url.slice(0, 60)}…建议换成 https。`);
        }
        continue;
      }
      // 站内文件：检查 downloads/ 里是否真的有这个文件
      const relative = url.replace(/^\//, '').replace(/^\.\//, '');
      if (!relative.startsWith('downloads/')) {
        warnings.push(`${label}：站内链接「${url}」建议统一放在 downloads/ 目录下。`);
        continue;
      }
      try {
        await stat(join(root, relative));
      } catch {
        warnings.push(`${label}：找不到文件 downloads/${relative.replace('downloads/', '')}（下载按钮会 404）。`);
      }
    }
  }

  const siteUrl = String(site.url || '');
  if (!siteUrl) warnings.push('data/site.json 的 url 为空，sitemap / share 链接会不完整。');
  else if (/example\.github\.io|example\.com/.test(siteUrl)) {
    warnings.push(`data/site.json 的 url 还是示例地址（${siteUrl}），部署前记得换成你自己的域名。`);
  }
  if (!site.email && !site.github) warnings.push('site.json 里既没有 email 也没有 github，页脚的联系方式会很少。');

  return { errors, warnings };
}
