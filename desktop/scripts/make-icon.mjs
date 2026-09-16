// 从 favicon.svg 的渲染结果生成应用图标：透明背景、无底色、只有标记本身。
//
// 为什么要「键控」这一步：
//   无头 Chrome 截图不保留透明通道——页面背景透明的区域会被填成白色。
//   所以先在洋红（#ff00ff）底色上渲染标记，再把洋红抠成 alpha。
//
//   用洋红做键色的原因：它与标记色 #00838f 在绿色通道上相距最远
//   （洋红 G=0，青色 G≈131），而标记是纯色平涂，因此可以逐像素精确反解出 alpha，
//   抗锯齿边缘也能被正确还原，不会出现锯齿或彩色描边。
//
// 输入：desktop/build/icon-keyed.png（favicon.svg 在洋红底上的 1024×1024 渲染）
// 输出：desktop/build/icon.png（#00838f 标记 + 透明背景）
//
// 用法：node desktop/scripts/make-icon.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const buildDir = join(here, "..", "build");
const SRC = join(buildDir, "icon-keyed.png");
const OUT = join(buildDir, "icon.png");

// 标记的正式颜色：取自 web/public/favicon.svg 的 fill（与网页版一致）
const INK = { r: 0x00, g: 0x83, b: 0x8f };

// 提前声明：下面在模块顶层就会调用 encodePng，声明放在文件末尾会落进暂时性死区
let CRC_TABLE = null;

if (!existsSync(SRC)) {
  console.error("[make-icon] 找不到键控源图：" + SRC);
  console.error("[make-icon] 它应当是一份 favicon.svg 在洋红(#ff00ff)底上的渲染图。");
  process.exit(1);
}

const png = decodePng(readFileSync(SRC));
const { width: w, height: h, channels: ch, data } = png;
const total = w * h;

// 端点不写死，从图里实测：截图管线可能带来轻微色彩偏移
const greens = new Uint32Array(256);
for (let i = 0; i < total; i++) greens[data[i * ch + 1]]++;

let keyGreen = -1;
let inkGreen = -1;
for (let g = 0; g < 256; g++) {
  if (greens[g] === 0) continue;
  if (keyGreen < 0) keyGreen = g;
  inkGreen = g;
}
// 用「出现最多」的那个绿值作为实心标记色，比取最大值更抗噪
let modeGreen = 0;
let modeCount = -1;
for (let g = 0; g < 256; g++) {
  if (greens[g] > modeCount) {
    modeCount = greens[g];
    modeGreen = g;
  }
}
if (modeGreen <= keyGreen) {
  console.error("[make-icon] 源图看起来没有洋红底（绿通道最高频值 = " + modeGreen + "）。");
  process.exit(1);
}
console.log(
  "[make-icon] 键色绿=" + keyGreen + "，标记绿=" + modeGreen + "（实测区间 " + keyGreen + "~" + inkGreen + "）",
);

const rgba = Buffer.alloc(total * 4);
const span = modeGreen - keyGreen;
let opaque = 0;
let clear = 0;
let partial = 0;
for (let i = 0; i < total; i++) {
  const g = data[i * ch + 1];
  const a = Math.max(0, Math.min(255, Math.round(((g - keyGreen) / span) * 255)));
  if (a === 255) opaque++;
  else if (a === 0) clear++;
  else partial++;
  rgba[i * 4] = INK.r;
  rgba[i * 4 + 1] = INK.g;
  rgba[i * 4 + 2] = INK.b;
  rgba[i * 4 + 3] = a;
}

writeFileSync(OUT, encodePng(w, h, rgba));
const pct = (n) => ((n / total) * 100).toFixed(1) + "%";
console.log(
  "[make-icon] " + w + "x" + h + " → " + OUT +
    "  实心 " + pct(opaque) + " / 透明 " + pct(clear) + " / 半透明边缘 " + pct(partial),
);

// ---------------------------------------------------------------- PNG 编解码
// 与构建环境无关地自给自足：这里没有 sharp / canvas 之类的图像库，
// 而这一步只是「读像素 + 写 RGBA」，用 node:zlib 手写一次比引依赖更可控。
// 只支持本项目用到的形态：8 位、非隔行、颜色类型 2（RGB）或 6（RGBA）。

function decodePng(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error("不是 PNG");

  let o = 8;
  let ihdr = null;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  if (!ihdr) throw new Error("缺少 IHDR");
  if (ihdr.bitDepth !== 8) throw new Error("只支持 8 位色深，实际 " + ihdr.bitDepth);
  if (ihdr.interlace !== 0) throw new Error("不支持隔行 PNG");
  const channels = { 2: 3, 6: 4 }[ihdr.colorType];
  if (!channels) throw new Error("只支持颜色类型 2/6，实际 " + ihdr.colorType);

  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  const zero = Buffer.alloc(stride);

  let pos = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : zero;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) v += paeth(a, b, c);
      else if (ft !== 0) throw new Error("未知行过滤器 " + ft);
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // 过滤器 None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
