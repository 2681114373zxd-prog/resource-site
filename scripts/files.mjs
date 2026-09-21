/* ==========================================================================
   files.mjs · 安装包相关的共用小工具
   --------------------------------------------------------------------------
   scripts/publish.mjs（一键发布）、scripts/hash.mjs（算大小 / SHA256）和
   scripts/admin-server.mjs（本地后台）都用这里的函数，避免同一段逻辑写两遍。
   这里不依赖任何第三方包。
   ========================================================================== */

import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

/** 读取本工具的版本号（package.json 里的 version），启动时显示用 */
export function toolVersion(rootPath) {
  try {
    return JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 字节数 → “42 MB” 这种给人看的大小 */
export function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** 读命令行参数，`--port 9000` 和 `--port=9000` 两种写法都认 */
export function argValue(argv, name, fallback = '') {
  const key = `--${name}`;
  const inline = argv.find((item) => item.startsWith(`${key}=`));
  if (inline) return inline.slice(key.length + 1) || fallback;
  const index = argv.indexOf(key);
  const next = index >= 0 ? argv[index + 1] : undefined;
  return next && !next.startsWith('--') ? next : fallback;
}

/** 把用户填的端口号变成合法端口；不合法返回 null，由调用方报错退出 */
export function parsePort(value, fallback = 8787) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const port = Number(text);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** 计算文件的 SHA256（流式读取，几百 MB 的安装包也不会占满内存） */
export async function sha256(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, rejectPromise) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', resolvePromise)
      .on('error', rejectPromise);
  });
  return hash.digest('hex');
}

/**
 * 把「软件名 / 文件名」变成能当网址用的 id：只保留小写字母、数字和短横线。
 * 例：`My Tool 1.2.3.exe` → `my-tool-1-2-3`；纯中文名会返回空字符串，
 * 这时候 publish.mjs 会让你手动指定一个 id。
 */
export function slugify(value) {
  return String(value || '')
    .replace(/\.[a-z0-9]{1,8}$/i, '') // 去掉 .exe / .tar.gz 之类的后缀
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** 文件名里能不能直接当网址用（全 ASCII 才安全，中文会被转义成一长串 %xx） */
export function isUrlSafeName(name) {
  return /^[\x20-\x7e]+$/.test(String(name)) && !/[?#%&'"<>|*:\\]/.test(String(name));
}

/**
 * 安装包后缀 → 平台 / 类型 / 按钮名称。
 * 只是「猜一个默认值」，猜错了用 --platform / --arch / --type 覆盖即可。
 */
const EXT_RULES = [
  { ext: ['.exe'], platform: 'Windows', type: 'installer', label: '安装版' },
  { ext: ['.msi'], platform: 'Windows', type: 'installer', label: 'MSI 安装版' },
  { ext: ['.apk'], platform: 'Android', type: 'apk', label: 'APK 安装包' },
  { ext: ['.aab'], platform: 'Android', type: 'apk', label: 'AAB 安装包' },
  { ext: ['.xapk'], platform: 'Android', type: 'apk', label: 'XAPK 安装包' },
  { ext: ['.dmg'], platform: 'macOS', type: 'dmg', label: 'dmg 安装镜像' },
  { ext: ['.pkg'], platform: 'macOS', type: 'installer', label: 'pkg 安装包' },
  { ext: ['.deb'], platform: 'Linux', type: 'deb', label: 'deb 安装包' },
  { ext: ['.rpm'], platform: 'Linux', type: 'archive', label: 'rpm 安装包' },
  { ext: ['.appimage'], platform: 'Linux', type: 'appimage', label: 'AppImage' },
  { ext: ['.ipa'], platform: 'iOS', type: 'archive', label: 'iOS 安装包' },
  {
    ext: ['.zip', '.7z', '.rar', '.tgz', '.tar.gz', '.tar.xz'],
    platform: '全平台',
    type: 'archive',
    label: '压缩包',
  },
];

/** 从文件名猜架构：猜不到就按平台给一个合理默认值 */
function detectArch(name, platform) {
  const lower = name.toLowerCase();
  if (/(arm64|aarch64|apple[-_ ]?silicon|m1|m2|m3)/.test(lower)) return platform === 'macOS' ? 'universal' : 'arm64';
  if (/(arm|armv7|armeabi)/.test(lower)) return 'arm64';
  if (/(x86_64|amd64|x64|win64|64bit|64-bit)/.test(lower)) return 'x64';
  if (/(x86|win32|32bit|32-bit|i386|i686)/.test(lower)) return 'x86';
  if (platform === 'Android' || platform === 'macOS') return 'universal';
  return 'x64';
}

/**
 * 根据文件名猜出安装包信息。
 * 返回 { platform, arch, type, label, portable }，全都只是默认值。
 */
export function detectPackage(fileName) {
  const name = String(fileName || '');
  const lower = name.toLowerCase();
  const rule = EXT_RULES.find((item) => item.ext.some((ext) => lower.endsWith(ext)));
  const platform = rule ? rule.platform : '全平台';
  const portable = /(portable|green|免安装|便携)/i.test(lower);
  return {
    platform,
    arch: detectArch(name, platform),
    type: portable ? 'portable' : rule ? rule.type : 'file',
    label: portable ? '免安装版' : rule ? rule.label : '文件',
  };
}

/**
 * 决定安装包存进 downloads/ 之后叫什么名字：
 *   · 本来就是英文 / 数字的文件名 → 只把空格换成短横线，尽量保持原样
 *   · 带中文或怪符号的文件名 → 换成「id-版本.后缀」，避免下载链接里出现一长串 %xx
 * 浏览器上传（后台）和命令行发布（publish.mjs）都用这一个规则。
 */
export function packageFileName(originalName, { id = '', version = '' } = {}) {
  const safe = String(originalName || '').trim().replace(/\s+/g, '-') || 'package';
  if (isUrlSafeName(safe)) return safe;
  const ext = extname(safe) || '.bin';
  return `${id || 'package'}${version ? `-${version}` : ''}${ext}`;
}
