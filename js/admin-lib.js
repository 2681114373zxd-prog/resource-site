/* 由 scripts/bundle.mjs 自动生成，请不要直接修改这个文件。
   源码在 js/ 目录下（shared.js → render.js → core.js → 页面脚本），改完源码后运行 npm run build 会重新生成。 */
(function () {
  'use strict';

/* ---------- scripts/json-style.mjs ---------- */
/* ==========================================================================
   json-style.mjs · 按「人写出来的样子」改写 JSON 文件
   --------------------------------------------------------------------------
   data/apps.json 是手写的：短数组写在一行、下载项也是一个对象一行。
   如果每次发布都用 JSON.stringify(obj, null, 2) 整体重写，会产生几百行
   「只是换了换行」的改动，git 历史会变得没法看。

   所以这里不做「整体重写」，而是「按需局部改写」：

     · stringifyStyled(value)            —— 生成和文件风格接近的 JSON 文本
     · spliceApp(text, app)              —— 只替换 / 插入这一个软件的那一段
     · setTopLevelValue(text, key, val)  —— 只替换某个顶层字段的值（改站点信息用）

   其他没动过的行，一个字符都不会变。
   ========================================================================== */

const isPrimitive = (value) => value === null || typeof value !== 'object';

/**
 * 单行写法，和 data/apps.json 里的手写风格一致：
 *   ["Windows", "Linux"]                     —— 逗号后面有空格
 *   { "name": "x", "size": "1 MB" }          —— 花括号里外侧各留一个空格
 */
function renderCompact(node) {
  if (isPrimitive(node)) return JSON.stringify(node) ?? 'null';
  if (Array.isArray(node)) return `[${node.map(renderCompact).join(', ')}]`;
  const keys = Object.keys(node);
  if (!keys.length) return '{}';
  return `{ ${keys.map((key) => `${JSON.stringify(key)}: ${renderCompact(node[key])}`).join(', ')} }`;
}

/* --------------------------------------------------------------------------
   1. 格式化：短数组 / 小对象写一行，大的才拆开
   -------------------------------------------------------------------------- */
function stringifyStyled(value, options = {}) {
  const indent = Number.isInteger(options.indent) ? options.indent : 2;
  const maxInline = Number.isInteger(options.maxInline) ? options.maxInline : 200;
  const pad = (level) => ' '.repeat(indent * level);

  function render(node, level) {
    if (isPrimitive(node)) return JSON.stringify(node) ?? 'null';

    // 只有「里面全是简单值、而且整行不长」的数组 / 对象才写一行：
    // 这样 "platforms": ["Windows", "Linux"] 和下载项对象会在一行，
    // 而 changelog / history 这种装着对象的数组仍然一行一个，和手写风格一致。
    const values = Array.isArray(node) ? node : Object.values(node);
    if (!values.length) return Array.isArray(node) ? '[]' : '{}';
    if (values.every(isPrimitive) && JSON.stringify(node).length + pad(level).length <= maxInline) {
      return renderCompact(node);
    }

    if (Array.isArray(node)) {
      const items = node.map((item) => `${pad(level + 1)}${render(item, level + 1)}`);
      return `[\n${items.join(',\n')}\n${pad(level)}]`;
    }
    const entries = Object.keys(node).map(
      (key) => `${pad(level + 1)}${JSON.stringify(key)}: ${render(node[key], level + 1)}`
    );
    return `{\n${entries.join(',\n')}\n${pad(level)}}`;
  }

  return `${render(value, 0)}\n`;
}

/* --------------------------------------------------------------------------
   2. 找位置用的小工具（JSON 是格式良好的，只需要跳过字符串字面量）
   -------------------------------------------------------------------------- */

function skipString(text, index) {
  let i = index + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i += 1;
  }
  return i;
}

/** 从 { 或 [ 开始，返回配对的那个 } 或 ] 的下标 */
function matchBracket(text, openIndex) {
  const open = text[openIndex];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      i = skipString(text, i) - 1;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 从 index 往前扫一遍，返回包住它的所有容器（栈顶 = 最内层） */
function enclosingContainers(text, index) {
  const stack = [];
  for (let i = 0; i < index; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      i = skipString(text, i) - 1;
      continue;
    }
    if (ch === '{' || ch === '[') stack.push({ ch, index: i });
    else if (ch === '}' || ch === ']') stack.pop();
  }
  return stack;
}

function appsArrayBounds(text) {
  const keyed = /"apps"\s*:\s*\[/.exec(text);
  if (keyed) {
    const open = keyed.index + keyed[0].length - 1;
    return { open, close: matchBracket(text, open) };
  }
  const bare = /^\s*\[/.exec(text); // 兼容「文件本身就是数组」的写法
  if (bare) {
    const open = bare[0].length - 1;
    return { open, close: matchBracket(text, open) };
  }
  return null;
}

/** apps 数组里每个软件条目的缩进（例如 4 个空格） */
function itemIndentOf(text, bounds) {
  const body = text.slice(bounds.open + 1, bounds.close);
  const first = /\n([ \t]*)\S/.exec(body);
  if (first) return first[1];
  const closeIndent = (/[ \t]*$/.exec(text.slice(0, bounds.close)) || [''])[0];
  return `${closeIndent}  `;
}

function indentBlock(block, indent) {
  return block
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n');
}

/** 找到某个 id 的软件条目在文本里占据的范围 */
function findAppSpan(text, id) {
  const re = /"id"\s*:\s*("(?:[^"\\]|\\.)*")/g;
  let match;
  while ((match = re.exec(text))) {
    if (JSON.parse(match[1]) !== id) continue;
    const stack = enclosingContainers(text, match.index);
    const container = stack[stack.length - 1];
    if (!container || container.ch !== '{') continue;
    const end = matchBracket(text, container.index);
    if (end > 0) return { start: container.index, end: end + 1 };
  }
  return null;
}

/* --------------------------------------------------------------------------
   3. 对外接口
   -------------------------------------------------------------------------- */

/**
 * 把某个软件写进 apps.json 的文本里：
 *   · 已经有同 id 的条目 → 只替换那一段
 *   · 没有 → 追加到 apps 数组末尾
 * 返回新的文件文本（未改动的地方保持原样）。
 */
function spliceApp(text, app, options = {}) {
  const bounds = appsArrayBounds(text);
  if (!bounds || bounds.close < 0) return null;
  const block = stringifyStyled(app, options).trimEnd();
  const itemIndent = itemIndentOf(text, bounds);
  const rendered = indentBlock(block, itemIndent);

  const span = findAppSpan(text, app.id);
  if (span) {
    // 连这一行前面的缩进一起换掉，否则会出现「原缩进 + 新缩进」叠在一起
    const lineStart = text.lastIndexOf('\n', span.start - 1) + 1;
    const prefix = text.slice(lineStart, span.start);
    if (!/^[ \t]*$/.test(prefix)) return `${text.slice(0, span.start)}${rendered}${text.slice(span.end)}`;
    return `${text.slice(0, lineStart)}${indentBlock(block, prefix)}${text.slice(span.end)}`;
  }

  const closeIndent = (/[ \t]*$/.exec(text.slice(0, bounds.close)) || [''])[0];
  const head = text.slice(0, bounds.open + 1);
  const body = text.slice(bounds.open + 1, bounds.close).replace(/\s+$/, '');
  const tail = text.slice(bounds.close);
  const separator = body.trim() ? ',' : '';
  return `${head}${body}${separator}\n${rendered}\n${closeIndent}${tail}`;
}

/** 只替换顶层字段的值，例如改 data/site.json 里的 name / description */
function setTopLevelValue(text, key, value, options = {}) {
  const re = new RegExp(`("${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[ \\t]*:[ \\t]*)`);
  const match = re.exec(text);
  if (!match) return null;

  const start = match.index + match[0].length;
  const ch = text[start];
  let end;
  if (ch === '{' || ch === '[') end = matchBracket(text, start) + 1;
  else if (ch === '"') end = skipString(text, start);
  else {
    const rest = /^[^,\n}\]]*/.exec(text.slice(start));
    end = start + rest[0].trimEnd().length;
  }
  if (end <= start) return null;
  return `${text.slice(0, start)}${stringifyStyled(value, options).trimEnd()}${text.slice(end)}`;
}

/**
 * 从 apps.json 里删掉一个软件（连逗号一起收拾干净）。
 * 删完数组里一个都不剩时，会写成 `"apps": []`，不会留下空行。
 */
function removeApp(text, id) {
  const span = findAppSpan(text, id);
  if (!span) return null;

  let start = span.start;
  let end = span.end;
  let before = start - 1;
  while (before >= 0 && /\s/.test(text[before])) before -= 1;

  if (text[before] === ',') {
    start = before; // 它前面的逗号要一起删掉
  } else {
    let after = end;
    while (after < text.length && /\s/.test(text[after])) after += 1;
    if (text[after] === ',') {
      end = after + 1;
      while (end < text.length && /\s/.test(text[end])) end += 1; // 顺手吃掉后面的空行
    }
  }

  const next = `${text.slice(0, start)}${text.slice(end)}`;
  const bounds = appsArrayBounds(next);
  if (bounds && !next.slice(bounds.open + 1, bounds.close).trim()) {
    return `${next.slice(0, bounds.open + 1)}]${next.slice(bounds.close + 1)}`;
  }
  return next;
}

/* ---------- scripts/app-data.mjs ---------- */
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
function mergeDownload(app, download) {
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
function pushChangelog(app, version, notes, date) {
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
function nextBump(version, kind = 'patch') {
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
function recordHistory(app, previous, { max = 10 } = {}) {
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
function validateApp(app) {
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

  // 挂到全局，供后台页面（js/admin.js）直接调用
  window.XIXI_DATA = { mergeDownload, nextBump, pushChangelog, recordHistory, removeApp, setTopLevelValue, spliceApp, stringifyStyled, validateApp };
})();
