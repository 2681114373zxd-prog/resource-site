/* ==========================================================================
   dev.mjs · 本地开发模式
   --------------------------------------------------------------------------
   1. 构建一次
   2. 启动本地服务器（默认 http://127.0.0.1:5173）
   3. 监听 data/、js/、assets/、模板的变化，自动重新构建
   用法：npm run dev           加 --lan 可让手机访问
   ========================================================================== */

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 用系统默认浏览器打开网址（--open 参数时使用） */
function openBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    console.log(`  请手动打开浏览器访问：${url}`);
  }
}

function runBuild() {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('exit', () => resolvePromise());
  });
}

async function main() {
  await runBuild();
  const portArg = process.argv.find((arg) => /^\d+$/.test(arg));
  const { port } = await serve({ port: portArg ? Number(portArg) : 5173, all: process.argv.includes('--lan') });
  if (process.argv.includes('--open')) openBrowser(`http://127.0.0.1:${port}`);

  // 监听源码变化：只监听内容目录，避免 dist/ 反复触发
  const watched = ['data', 'js', 'assets', 'scripts/templates'].map((dir) => join(ROOT, dir));
  let timer = null;
  let building = false;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (building) return;
      building = true;
      console.log('\n\u25b6 检测到文件变化，重新构建…');
      await runBuild();
      console.log('\u2713 已更新，刷新浏览器即可看到效果。');
      building = false;
    }, 260);
  };

  watched.forEach((dir) => {
    try {
      watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return rebuild();
        // 忽略构建产物（它们会在构建时被重新写出），否则会无限重建
        const name = String(filename).replace(/\\/g, '/').split('/').pop();
        if (/^(apps\.generated\.js|home\.js|app\.js)$/.test(name)) return;
        if (/\.(json|js|css|html|svg|md)$/i.test(filename)) rebuild();
      });
    } catch {
      console.log(`  跳过监听：${dir}`);
    }
  });
  watch(join(ROOT, 'index.html'), () => rebuild());
  console.log('  开发模式已开启：修改 data/apps.json 等文件后会自动重新构建。\n');
}

main();
