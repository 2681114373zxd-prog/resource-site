/* ==========================================================================
   validate.mjs · 读取 + 校验数据
   --------------------------------------------------------------------------
   build.mjs 和 check.mjs 共用这里的逻辑：
     - 缺字段、id 重复、下载地址写错、下载文件不存在……都会给出中文提示
   ========================================================================== */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PLATFORM_VALUES, WILDCARD_PLATFORMS, isDateLike } from './app-data.mjs';

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

/** 找出不在白名单里的键名 */
function unknownKeys(record, allowed) {
  return Object.keys(record).filter((key) => !allowed.includes(key));
}

function unknownFieldMessage(where, keys, allowed) {
  return `data/apps.json：${where}有未知字段「${keys.join('、')}」，字段名必须用英文（允许的字段：${allowed.join('、')}）。`;
}

/* --------------------------------------------------------------------------
   日期校验
   --------------------------------------------------------------------------
   updated / releaseDate / changelog.date / history.date 不只是显示：sortApps 排序、
   sitemap.xml 的 lastmod、feed.xml 的 pubDate、详情页「更新于」都直接吃它们，
   写坏了页面上就是 NaN / Invalid Date。

   判定规则是「格式 ∧ 可解析」，两条缺一不可：
     · 只查格式   → 2026-13-01 / 2026-09-32 蒙混过关
     · 只查可解析 → 2026/09/03 或「2026年9月3日」会被 V8 解析成功
   再加一次往返比对：2026-02-30 格式对、Date 也「能解析」，但会静默滚成 03-02。

   只写年份 / 年月是允许的（作者真实写过的历史写法，例如 Termux 的 "2026"）。

   判定逻辑本身在 scripts/app-data.mjs 的 isDateLike()：后台在线保存
   （js/admin.js）走的是同一份逻辑，两边必须一致。
   -------------------------------------------------------------------------- */

/** 字段写了但不是合法日期时返回一句中文错误；没写（或空串）返回空，交给其它提醒管 */
function dateIssue(where, field, value) {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  if (isDateLike(value)) return '';
  return `data/apps.json：${where} 的 ${field}「${value}」不是合法日期（可以写 2026、2026-09 或 2026-09-03）。`;
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
    // 日期：缺失只提醒（可选字段，别拦发布），写了但不合法直接拦
    for (const field of ['updated', 'releaseDate']) {
      const issue = dateIssue(label, field, app[field]);
      if (issue) errors.push(issue);
    }
    if (!Array.isArray(app.platforms) || !app.platforms.length) {
      warnings.push(`${label}：没有写 platforms（例如 ["Windows", "Android"]）。`);
    } else {
      const badPlatforms = app.platforms.filter((item) => !PLATFORM_VALUES.includes(String(item)));
      if (badPlatforms.length) {
        errors.push(
          `data/apps.json：${label} 的 platforms 里有不认识的平台「${badPlatforms.join('、')}」（只能写：${PLATFORM_VALUES.join('、')}）。`
        );
      }
      const hasConcrete = app.platforms.some((p) => !WILDCARD_PLATFORMS.includes(String(p)));
      const hasWildcard = app.platforms.some((p) => WILDCARD_PLATFORMS.includes(String(p)));
      if (hasConcrete && hasWildcard) {
        warnings.push(`${label}：platforms 里同时写了具体系统和「${WILDCARD_PLATFORMS.join('、')}」，建议只保留具体系统。`);
      }
    }
    if (app.category && !categoryNames.includes(String(app.category))) {
      errors.push(
        `data/apps.json：${label} 的 category「${app.category}」不在 data/categories.json 里（可以写：${categoryList}）。`
      );
    }
    // 写了但类型不对（例如 "downloads": "https://…"）是数据错误，不能只当成「没写」：
    // 那样会安静地构建出一个没有下载按钮的详情页。
    if (!Array.isArray(app.downloads)) {
      errors.push(`data/apps.json：${label} 的 downloads 必须是数组。`);
    } else if (!app.downloads.length) {
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

    // 下面三个循环都要先确认是数组：字段类型写错（例如 "changelog": "一句备注"）时，
    // 上面已经 push 了中文错误，这里再对字符串调 .entries() 只会抛英文 TypeError，
    // 把真正有用的提示盖掉。
    for (const [i, entry] of (Array.isArray(app.changelog) ? app.changelog : []).entries()) {
      if (!entry || typeof entry !== 'object') {
        errors.push(`data/apps.json：${label} 的第 ${i + 1} 条更新日志不是对象。`);
        continue;
      }
      const bad = unknownKeys(entry, CHANGELOG_FIELDS);
      if (bad.length) errors.push(unknownFieldMessage(`${label} 的第 ${i + 1} 条更新日志`, bad, CHANGELOG_FIELDS));
      const dateBad = dateIssue(`${label} 的第 ${i + 1} 条更新日志`, 'date', entry.date);
      if (dateBad) errors.push(dateBad);
    }

    for (const [i, entry] of (Array.isArray(app.history) ? app.history : []).entries()) {
      if (!entry || typeof entry !== 'object') {
        errors.push(`data/apps.json：${label} 的第 ${i + 1} 条历史版本不是对象。`);
        continue;
      }
      const bad = unknownKeys(entry, HISTORY_FIELDS);
      if (bad.length) errors.push(unknownFieldMessage(`${label} 的第 ${i + 1} 条历史版本`, bad, HISTORY_FIELDS));
      const dateBad = dateIssue(`${label} 的第 ${i + 1} 条历史版本`, 'date', entry.date);
      if (dateBad) errors.push(dateBad);
    }

    for (const [i, item] of (Array.isArray(app.downloads) ? app.downloads : []).entries()) {
      if (!item || !item.url) {
        errors.push(`${label}：第 ${i + 1} 个下载项缺少 url。`);
        continue;
      }
      const bad = unknownKeys(item, DOWNLOAD_FIELDS);
      if (bad.length) errors.push(unknownFieldMessage(`${label} 的第 ${i + 1} 个下载项`, bad, DOWNLOAD_FIELDS));

      if (item.platform && !PLATFORM_VALUES.includes(String(item.platform))) {
        errors.push(
          `data/apps.json：${label} 的第 ${i + 1} 个下载项平台「${item.platform}」不认识（只能写：${PLATFORM_VALUES.join('、')}）。`
        );
      }

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
