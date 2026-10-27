'use strict';

/**
 * 生成应用图标与托盘图标（纯 Node 实现，不依赖任何图形库）。
 * 思路：手写 PNG 编码 + 3×3 超采样做抗锯齿。
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ---------- 极简 PNG 编码 ---------- */
const crcTable = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 几何 ---------- */
function insideRoundRect(x, y, w, h, r) {
  const cx = Math.abs(x - w / 2) - (w / 2 - r);
  const cy = Math.abs(y - h / 2) - (h / 2 - r);
  const dx = Math.max(cx, 0);
  const dy = Math.max(cy, 0);
  return Math.sqrt(dx * dx + dy * dy) + Math.min(Math.max(cx, cy), 0) - r <= 0;
}

function segDist(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  let t = (wx * vx + wy * vy) / (vx * vx + vy * vy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

/**
 * 圆角方块 + 对勾。
 * @param {number} size
 * @param {boolean} withBg 是否带底色（托盘图标需要，纯透明底在对勾上看不清）
 */
function drawIcon(size, thicknessRatio = 0.115) {  const S = 3; // 每像素 3×3 超采样
  const buf = Buffer.alloc(size * size * 4);

  const r = size * 0.235;
  const th = size * thicknessRatio;

  // 对勾三个关键点
  const p1 = [size * 0.29, size * 0.53];
  const p2 = [size * 0.44, size * 0.675];
  const p3 = [size * 0.72, size * 0.35];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let as = 0;

      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;

          if (!insideRoundRect(px, py, size, size, r)) continue;

          // 竖向渐变：#D97757 → #A9451F
          const t = py / size;
          let cr = Math.round(217 + (169 - 217) * t);
          let cg = Math.round(119 + (69 - 119) * t);
          let cb = Math.round(87 + (31 - 87) * t);

          const d = Math.min(
            segDist(px, py, p1[0], p1[1], p2[0], p2[1]),
            segDist(px, py, p2[0], p2[1], p3[0], p3[1])
          );
          if (d <= th / 2) {
            cr = 255;
            cg = 252;
            cb = 248;
          }

          rs += cr;
          gs += cg;
          bs += cb;
          as += 255;
        }
      }

      const n = S * S;
      const i = (y * size + x) * 4;
      if (as === 0) {
        buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
      } else {
        const cover = as / (255 * n);
        buf[i] = Math.round(rs / (as / 255));
        buf[i + 1] = Math.round(gs / (as / 255));
        buf[i + 2] = Math.round(bs / (as / 255));
        buf[i + 3] = Math.round(255 * cover);
      }
    }
  }
  return buf;
}

/**
 * 报警托盘图标：同样的圆角方块，但底色换成红，中间画感叹号。
 * 用于「有提醒到点」时与正常图标交替闪烁——窗口 skipTaskbar，
 * 闪任务栏按钮无效，只能靠托盘图标本身动起来。
 */
function drawAlertIcon(size) {
  const S = 3;
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.235;
  const th = size * 0.15;

  // 感叹号：竖线 + 下方圆点
  const barTop = size * 0.24;
  const barBottom = size * 0.6;
  const dotY = size * 0.76;
  const dotR = th * 0.62;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let as = 0;

      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;

          if (!insideRoundRect(px, py, size, size, r)) continue;

          // 竖向渐变：#F2555A → #B02328
          const t = py / size;
          let cr = Math.round(242 + (176 - 242) * t);
          let cg = Math.round(85 + (35 - 85) * t);
          let cb = Math.round(90 + (40 - 90) * t);

          const onBar = segDist(px, py, size / 2, barTop, size / 2, barBottom) <= th / 2;
          const onDot = Math.hypot(px - size / 2, py - dotY) <= dotR;
          if (onBar || onDot) {
            cr = 255;
            cg = 252;
            cb = 248;
          }

          rs += cr;
          gs += cg;
          bs += cb;
          as += 255;
        }
      }

      const n = S * S;
      const i = (y * size + x) * 4;
      if (as === 0) {
        buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
      } else {
        const cover = as / (255 * n);
        buf[i] = Math.round(rs / (as / 255));
        buf[i + 1] = Math.round(gs / (as / 255));
        buf[i + 2] = Math.round(bs / (as / 255));
        buf[i + 3] = Math.round(255 * cover);
      }
    }
  }
  return buf;
}

/* ---------- 输出 ---------- */
const root = path.join(__dirname, '..');

function write(file, size, thickness) {
  const p = path.join(root, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, encodePNG(size, size, drawIcon(size, thickness)));
  console.log('generated', file, size + 'px');
}

function writeAlert(file, size) {
  const p = path.join(root, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, encodePNG(size, size, drawAlertIcon(size)));
  console.log('generated', file, size + 'px');
}

write('assets/tray.png', 32, 0.15);
writeAlert('assets/tray-alert.png', 32);
write('assets/icon-256.png', 256, 0.115);
write('build/icon.png', 256, 0.115);
