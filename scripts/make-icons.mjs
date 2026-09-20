/* ==========================================================================
   make-icons.mjs · 生成站点图标与分享封面图
   --------------------------------------------------------------------------
   用法：
     npm run icons              使用 data/site.json 里的主题色
     npm run icons -- "#ff6600" "#ff2d55"   指定主色 / 副色
   生成：
     assets/favicon/favicon.svg / favicon-32.png / apple-touch-icon.png
     assets/images/logo.svg
     assets/images/og-cover.png     （1200×630，分享到微信/QQ/Twitter 时的预览图）
   说明：纯 Node 实现（自己写 PNG 编码），不需要安装任何依赖。
   ========================================================================== */

import { deflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* --------------------------------------------------------------------------
   1. 最小 PNG 编码器
   -------------------------------------------------------------------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** RGBA Buffer → PNG 文件内容 */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------------------------
   2. 画布与图形
   -------------------------------------------------------------------------- */
export function createCanvas(width, height) {
  const data = Buffer.alloc(width * height * 4, 0);
  return { width, height, data };
}

export function blend(canvas, x, y, [r, g, b], alpha) {
  if (alpha <= 0) return;
  // 像素索引必须是整数，否则写入会被静默丢弃（Buffer 的索引不是整数时不生效）
  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const i = (y * canvas.width + x) * 4;
  const dstA = canvas.data[i + 3] / 255;
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;
  canvas.data[i] = Math.round((r * alpha + canvas.data[i] * dstA * (1 - alpha)) / outA);
  canvas.data[i + 1] = Math.round((g * alpha + canvas.data[i + 1] * dstA * (1 - alpha)) / outA);
  canvas.data[i + 2] = Math.round((b * alpha + canvas.data[i + 2] * dstA * (1 - alpha)) / outA);
  canvas.data[i + 3] = Math.round(outA * 255);
}

/** 逐像素填充图形：insideFn(px, py) 判定是否在形状内，采样抗锯齿 */
export function fill(canvas, insideFn, colorFn, bbox, samples = 4) {
  const [bx0, by0, bx1, by1] = bbox;
  const x0 = Math.max(0, Math.floor(bx0));
  const y0 = Math.max(0, Math.floor(by0));
  const x1 = Math.min(canvas.width, Math.ceil(bx1));
  const y1 = Math.min(canvas.height, Math.ceil(by1));
  const step = 1 / samples;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          if (insideFn(x + (sx + 0.5) * step, y + (sy + 0.5) * step)) hits += 1;
        }
      }
      if (!hits) continue;
      const coverage = hits / (samples * samples);
      const color = colorFn(x + 0.5, y + 0.5);
      blend(canvas, x, y, color, coverage);
    }
  }
}

/** 圆角矩形判定 */
export function roundRect(x0, y0, x1, y1, r) {
  return (px, py) => {
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
    const cx = Math.min(Math.max(px, x0 + r), x1 - r);
    const cy = Math.min(Math.max(py, y0 + r), y1 - r);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r + 0.0001;
  };
}

/** 三角形判定（重心法） */
export function triangle(ax, ay, bx, by, cx, cy) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  return (px, py) => {
    const d1 = sign(px, py, ax, ay, bx, by);
    const d2 = sign(px, py, bx, by, cx, cy);
    const d3 = sign(px, py, cx, cy, ax, ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };
}

function hexToRgb(hex, fallback = [79, 124, 255]) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : fallback;
}

const mix = (a, b, t) => a.map((value, i) => Math.round(value + (b[i] - value) * t));

/* --------------------------------------------------------------------------
   3. 5×7 点阵字体（只需要 ASCII，用来在封面图上写站名）
   -------------------------------------------------------------------------- */
export const GLYPHS = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '11111 00100 00100 00100 00100 00100 11111',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 10001',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110',
  1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010',
  5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110',
  7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '/': '00001 00010 00010 00100 01000 01000 10000',
  ':': '00000 01100 01100 00000 01100 01100 00000',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};

export function textWidth(text, scale) {
  return text.length * 6 * scale;
}

export function drawText(canvas, text, x, y, scale, color, alpha = 1) {
  // 坐标取整：像素索引必须是整数
  let cursor = Math.round(x);
  const startY = Math.round(y);
  const size = Math.max(1, Math.round(scale));
  for (const char of text.toUpperCase()) {
    const glyph = GLYPHS[char] || GLYPHS[' '];
    const rows = glyph.split(' ');
    rows.forEach((row, ry) => {
      [...row].forEach((bit, rx) => {
        if (bit !== '1') return;
        const px0 = cursor + rx * size;
        const py0 = startY + ry * size;
        for (let py = py0; py < py0 + size; py += 1) {
          for (let px = px0; px < px0 + size; px += 1) {
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
            blend(canvas, px, py, color, alpha);
          }
        }
      });
    });
    cursor += 6 * size;
  }
}

/* --------------------------------------------------------------------------
   4. 图标与封面
   -------------------------------------------------------------------------- */
const WHITE = [255, 255, 255];

/** 在 canvas 上画「下载箭头」标志（白色），size 为一个正方形区域 */
export function drawMark(canvas, x, y, size, [c1, c2], { card = false } = {}) {
  const originX = Math.round(x);
  const originY = Math.round(y);
  const size2 = Math.round(size);
  const s = size2 / 64; // 以 64 为基准坐标系
  const at = (v) => originX + v * s;
  const by = (v) => originY + v * s;

  if (card) {
    const inside = roundRect(originX, originY, originX + size2, originY + size2, size2 * 0.22);
    fill(canvas, inside, () => WHITE, [originX, originY, originX + size2, originY + size2], 4);
    // 卡片内部的渐变箭头：先画箭头（用主色），保持简洁
    const arrowColor = () => c1;
    fill(canvas, roundRect(at(26.9), by(14.1), at(37.1), by(32), 2 * s), arrowColor, [at(26), by(14), at(38), by(32)]);
    fill(canvas, triangle(at(32), by(43.5), at(18.2), by(28.2), at(45.8), by(28.2)), arrowColor, [
      at(18),
      by(28),
      at(46),
      by(44),
    ]);
    fill(canvas, roundRect(at(17.9), by(47), at(46.1), by(52.2), 2.5 * s), arrowColor, [at(17), by(47), at(46), by(53)]);
    return;
  }

  // 渐变色圆角方块
  const bgInside = roundRect(originX, originY, originX + size2, originY + size2, size2 * 0.22);
  fill(
    canvas,
    bgInside,
    (px, py) => mix(c1, c2, Math.min(1, Math.max(0, (px - originX + (py - originY)) / (size2 * 2)))),
    [originX, originY, originX + size2, originY + size2],
    4
  );
  // 白色下载箭头
  fill(canvas, roundRect(at(26.9), by(14.1), at(37.1), by(32), 2 * s), () => WHITE, [at(26), by(14), at(38), by(32)]);
  fill(canvas, triangle(at(32), by(43.5), at(18.2), by(28.2), at(45.8), by(28.2)), () => WHITE, [
    at(18),
    by(28),
    at(46),
    by(44),
  ]);
  fill(canvas, roundRect(at(17.9), by(47), at(46.1), by(52.2), 2.5 * s), () => WHITE, [at(17), by(47), at(46), by(53)]);
}

function makeFavicon(size, colors) {
  const canvas = createCanvas(size, size);
  drawMark(canvas, 0, 0, size, colors);
  return encodePng(size, size, canvas.data);
}

/** 画出 1200×630 的分享封面（返回画布，方便调试） */
export function renderCoverCanvas(width, height, site, colors) {
  const canvas = createCanvas(width, height);
  const [c1, c2] = colors;
  // 背景渐变
  fill(
    canvas,
    () => true,
    (px, py) => mix(c1, c2, Math.min(1, Math.max(0, (px / width) * 0.75 + (py / height) * 0.55))),
    [0, 0, width, height],
    1
  );
  // 左上角柔光
  const glow = (px, py) => {
    const d = Math.hypot(px - width * 0.16, py - height * 0.1) / (width * 0.6);
    return Math.max(0, 1 - d) ** 2 * 0.28;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) blend(canvas, x, y, WHITE, glow(x, y));
  }
  // 标志
  drawMark(canvas, width * 0.075, height * 0.28, height * 0.44, [c1, c2], { card: true });
  const textX = width * 0.33;
  const maxWidth = width - textX - width * 0.06; // 右侧留 6% 边距
  // 站名
  const name = String(site.name || 'DevShelf');
  const ascii = /^[\x20-\x7e]+$/.test(name);
  const nameScale = Math.max(5, Math.min(Math.floor(height * 0.05), Math.floor(maxWidth / (Math.max(name.length, 1) * 6))));
  if (ascii) {
    drawText(canvas, name, textX, height * 0.34, nameScale, WHITE, 1);
  } else {
    // 站名是中文时不写字（点阵字体只有 ASCII），只画一个装饰方块
    drawText(canvas, 'SOFTWARE  DOWNLOADS', textX, height * 0.38, Math.max(4, Math.round(nameScale * 0.6)), WHITE, 0.95);
  }
  // 副标题：只用 ASCII 字符，太长的自动截断
  const subtitle = String(site.taglineEn || site.url || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/[^\x20-\x7e]/g, ' ')
    .trim();
  const subScale = Math.max(3, Math.round(nameScale * 0.4));
  if (subtitle) {
    const maxChars = Math.floor(maxWidth / (subScale * 6));
    drawText(canvas, subtitle.slice(0, maxChars), textX, height * 0.34 + nameScale * 9, subScale, WHITE, 0.78);
  }
  return canvas;
}

export function makeCover(width, height, site, colors) {
  const canvas = renderCoverCanvas(width, height, site, colors);
  return encodePng(width, height, canvas.data);
}

function logoSvg(colors, { size = 64 } = {}) {
  const [c1, c2] = colors;
  const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const s = size / 64;
  const v = (n) => Number((n * s).toFixed(2));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="logo">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${hex(c1)}"/>
      <stop offset="1" stop-color="${hex(c2)}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${v(14)}" fill="url(#brand)"/>
  <g fill="#fff">
    <rect x="${v(26.9)}" y="${v(14.1)}" width="${v(10.2)}" height="${v(17.9)}" rx="${v(2)}"/>
    <path d="M${v(32)} ${v(43.8)} L${v(18)} ${v(28)} H${v(46)} Z"/>
    <rect x="${v(17.9)}" y="${v(47)}" width="${v(28.2)}" height="${v(5.2)}" rx="${v(2.6)}"/>
  </g>
</svg>
`;
}

/* --------------------------------------------------------------------------
   5. 主流程
   -------------------------------------------------------------------------- */
async function main() {
  const site = JSON.parse((await readFile(join(ROOT, 'data', 'site.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const args = process.argv.slice(2).filter((a) => /^#?[0-9a-f]{6}$/i.test(a.replace('#', '')));
  const c1 = hexToRgb(args[0] || site.theme?.accent || '#4f7cff');
  const c2 = hexToRgb(args[1] || site.theme?.accent2 || '#7c5cff');

  await mkdir(join(ROOT, 'assets', 'favicon'), { recursive: true });
  await mkdir(join(ROOT, 'assets', 'images'), { recursive: true });

  const svg = logoSvg([c1, c2]);
  await writeFile(join(ROOT, 'assets', 'favicon', 'favicon.svg'), svg, 'utf8');
  await writeFile(join(ROOT, 'assets', 'images', 'logo.svg'), svg, 'utf8');
  await writeFile(join(ROOT, 'assets', 'favicon', 'favicon-32.png'), makeFavicon(32, [c1, c2]));
  await writeFile(join(ROOT, 'assets', 'favicon', 'apple-touch-icon.png'), makeFavicon(180, [c1, c2]));
  await writeFile(join(ROOT, 'assets', 'images', 'og-cover.png'), makeCover(1200, 630, site, [c1, c2]));

  console.log('\n\u2713 图标已生成：');
  console.log('  assets/favicon/favicon.svg');
  console.log('  assets/favicon/favicon-32.png');
  console.log('  assets/favicon/apple-touch-icon.png');
  console.log('  assets/images/logo.svg');
  console.log('  assets/images/og-cover.png（1200×630）');
  console.log(`  配色：${args[0] || site.theme?.accent || '#4f7cff'} → ${args[1] || site.theme?.accent2 || '#7c5cff'}\n`);
}

// 直接运行 node scripts/make-icons.mjs 时才执行；被 import 时（例如自检脚本）只导出函数
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('\u2717 生成失败：', error);
    process.exitCode = 1;
  });
}
