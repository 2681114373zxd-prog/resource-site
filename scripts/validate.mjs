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
  const apps = Array.isArray(appsFile) ? appsFile : appsFile.apps || [];
  return { site, categories, apps };
}

/** slug 是否适合做目录名（中文、空格、大写都会给出提醒） */
function slugWarning(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return `id「${id}」不是推荐的写法（建议只用小写字母、数字和短横线，例如 my-app）`;
  }
  return '';
}

/**
 * 校验数据，返回 { errors, warnings }
 * errors   → 构建会失败，必须修
 * warnings → 只是提醒，不影响构建
 */
export async function validateProject(root, { site, apps }) {
  const errors = [];
  const warnings = [];
  const seen = new Map();

  if (!apps.length) warnings.push('data/apps.json 里还没有任何软件。');

  for (const [index, app] of apps.entries()) {
    const label = app?.id || app?.name || `第 ${index + 1} 条`;
    if (!app || typeof app !== 'object') {
      errors.push(`第 ${index + 1} 条数据不是对象，请检查 JSON 格式。`);
      continue;
    }
    if (!app.id) errors.push(`${label}：缺少 id 字段（详情页地址要用它）。`);
    if (!app.name) errors.push(`${label}：缺少 name 字段。`);
    if (!app.version) warnings.push(`${label}：没有写 version，卡片上会显示 “—”。`);
    if (!app.updated && !app.releaseDate) warnings.push(`${label}：建议填写 updated（更新时间），排序会用到。`);
    if (!Array.isArray(app.platforms) || !app.platforms.length) {
      warnings.push(`${label}：没有写 platforms（例如 ["Windows", "Android"]）。`);
    }
    if (!Array.isArray(app.downloads) || !app.downloads.length) {
      warnings.push(`${label}：没有 downloads 下载项，详情页会显示「暂无下载」。`);
    }
    if (app.id) {
      const slugIssue = slugWarning(app.id);
      if (slugIssue) warnings.push(slugIssue);
      if (seen.has(app.id)) errors.push(`id 重复：${app.id}（第 ${seen.get(app.id) + 1} 条和第 ${index + 1} 条）。`);
      seen.set(app.id, index);
    }

    for (const [i, item] of (app.downloads || []).entries()) {
      if (!item || !item.url) {
        errors.push(`${label}：第 ${i + 1} 个下载项缺少 url。`);
        continue;
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
