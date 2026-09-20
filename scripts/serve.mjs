/* ==========================================================================
   serve.mjs · 零依赖本地预览服务器
   --------------------------------------------------------------------------
   用法：
     node scripts/serve.mjs            默认 http://127.0.0.1:5173
     node scripts/serve.mjs 8080       指定端口
     node scripts/serve.mjs 8080 lan   同时允许局域网访问（手机预览用）
   说明：只用于本地预览，线上部署不需要它。
   ========================================================================== */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi',
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.xz': 'application/x-xz',
  '.dmg': 'application/x-apple-diskimage',
  '.deb': 'application/vnd.debian.binary-package',
  '.md': 'text/markdown; charset=utf-8',
};

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function guessType(path) {
  const ext = extname(path);
  return MIME[ext] || MIME[ext.toLowerCase()] || 'application/octet-stream';
}

async function resolveFile(pathname) {
  // 把请求路径限制在项目目录内，防止 ../ 穿越
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const target = resolve(ROOT, safePath);
  const base = resolve(ROOT);
  if (target !== base && !target.startsWith(base + sep)) return null;
  if (await exists(join(target, 'index.html'))) return join(target, 'index.html');
  if ((await exists(target)) && (await stat(target)).isFile()) return target;
  if (await exists(`${target}.html`)) return `${target}.html`;
  return null;
}

export function createStaticServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const file = await resolveFile(url.pathname);
      if (!file) {
        const fallback = join(ROOT, '404.html');
        const body = (await exists(fallback)) ? await readFile(fallback) : '404 Not Found';
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': guessType(file),
        'Content-Length': body.length,
        // 本地预览时禁用缓存，改完刷新就能看到
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`500 服务器内部错误\n${error.message}`);
    }
  });
}

function localAddresses() {
  const result = [];
  const nets = networkInterfaces();
  Object.values(nets).forEach((list) => {
    (list || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) result.push(net.address);
    });
  });
  return result;
}

/** 启动服务器，返回实际使用的端口 */
export async function serve({ port = 5173, all = false, quiet = false } = {}) {
  const host = all ? '0.0.0.0' : '127.0.0.1';
  const server = createStaticServer();
  let used = port;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await new Promise((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise);
        server.listen(used, host, resolvePromise);
      });
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      used += 1;
      if (!quiet) console.log(`  端口 ${used - 1} 被占用，改用 ${used}`);
    }
  }
  if (!quiet) {
    console.log(`\n  本地预览：http://127.0.0.1:${used}`);
    if (all) {
      localAddresses().forEach((ip) => console.log(`  手机预览：http://${ip}:${used}（需要和电脑在同一个 Wi-Fi）`));
    } else {
      console.log('  提示：加参数 lan 可以开启局域网访问，用手机打开检查移动端效果。');
    }
    console.log('  按 Ctrl + C 停止。\n');
  }
  return { server, port: used };
}

// 直接用 node scripts/serve.mjs 运行时才启动
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const portArg = Number(process.argv[2]);
  serve({
    port: Number.isFinite(portArg) && portArg > 0 ? portArg : 5173,
    all: process.argv.includes('lan'),
  }).catch((error) => {
    console.error('启动失败：', error);
    process.exitCode = 1;
  });
}
