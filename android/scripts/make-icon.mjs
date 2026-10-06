// 生成安卓启动图标。
//
// 源图就是桌面版已经做好的那一张：desktop/build/icon.png
// ——透明背景、无圆角、只有那个青色标记（#00838f），与网页版 favicon 同源。
// **不重新渲染、不重新抠图**：桌面版那一步（洋红键控反解 alpha）已经验证过，
// 再走一遍只会多一处可能分叉的地方。
//
// 产物分两类：
//   1. 传统图标 mipmap-*/ic_launcher.png —— 给 Android 12 以下兜底（本项目 minSdk 31，
//      其实用不到，但 launcher 在部分机型/桌面小部件上仍会读它，留着更稳）。
//   2. 自适应图标 mipmap-anydpi-v26/ic_launcher.xml + 前景层 —— Android 8+ 的正路，
//      由系统按各家 OEM 的形状遮罩裁切。前景要留安全边距，否则标记会被圆形遮罩切掉。
//
// 用法：node android/scripts/make-icon.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, toRgba, resizeRgba, encodePng } from "../../desktop/scripts/lib/png.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = join(here, "..");
const SRC = join(androidDir, "..", "desktop", "build", "icon.png");
const RES = join(androidDir, "app", "src", "main", "res");

if (!existsSync(SRC)) {
  console.error("[make-icon] 找不到源图：" + SRC);
  console.error("[make-icon] 先执行：npm --prefix desktop run make-icon");
  process.exit(1);
}

// 传统图标的各密度尺寸（48dp 基准）
const LEGACY = [
  ["mdpi", 48],
  ["hdpi", 72],
  ["xhdpi", 96],
  ["xxhdpi", 144],
  ["xxxhdpi", 192],
];

// 自适应图标前景：108dp 画布，安全区 72dp。
// 图形按 72/108 缩放后居中，这样无论系统用圆形、方形还是水滴形遮罩都不会切到标记。
const ADAPTIVE = [
  ["mdpi", 108],
  ["hdpi", 162],
  ["xhdpi", 216],
  ["xxhdpi", 324],
  ["xxxhdpi", 432],
];

/** 安全区占比：图形只占画布的这一部分，其余留白。 */
const SAFE_ZONE = 72 / 108;

const src = decodePng(readFileSync(SRC));
const rgba = toRgba(src);
console.log("[make-icon] 源图 " + src.width + "×" + src.height + "，通道 " + src.channels);

/** 缩放到目标尺寸并直接铺满。 */
function plain(size) {
  return resizeRgba(rgba, src.width, src.height, size, size);
}

/**
 * 缩放到 size×size 画布上、内容只占中间 SAFE_ZONE 那部分，其余透明。
 * 逐像素从源图采样（最近邻）——源图是纯色平涂加抗锯齿边缘，
 * 缩放本身就是盒式重采样，边缘质量已经够，不需要再做一次插值。
 */
function inset(size) {
  const out = Buffer.alloc(size * size * 4);
  const inner = Math.round(size * SAFE_ZONE);
  const offset = Math.floor((size - inner) / 2);
  const scaled = resizeRgba(rgba, src.width, src.height, inner, inner);
  for (let y = 0; y < inner; y++) {
    const dstRow = ((y + offset) * size + offset) * 4;
    scaled.copy(out, dstRow, y * inner * 4, (y + 1) * inner * 4);
  }
  return { data: out, inner, offset };
}

for (const [density, size] of LEGACY) {
  const dir = join(RES, "mipmap-" + density);
  mkdirSync(dir, { recursive: true });
  const png = encodePng(size, size, plain(size));
  writeFileSync(join(dir, "ic_launcher.png"), png);
  writeFileSync(join(dir, "ic_launcher_round.png"), png);
  console.log("[make-icon] mipmap-" + density + "  ic_launcher(.round)  " + size + "×" + size);
}

for (const [density, size] of ADAPTIVE) {
  const dir = join(RES, "mipmap-" + density);
  mkdirSync(dir, { recursive: true });
  const { data, inner, offset } = inset(size);
  writeFileSync(join(dir, "ic_launcher_foreground.png"), encodePng(size, size, data));
  console.log(
    "[make-icon] mipmap-" + density + "  ic_launcher_foreground  " +
      size + "×" + size + "（内容 " + inner + "×" + inner + "，偏移 " + offset + "）",
  );
}

// 自适应图标描述文件。背景用纯品牌色，形状交给系统。
const anydpi = join(RES, "mipmap-anydpi-v26");
mkdirSync(anydpi, { recursive: true });
const adaptiveXml =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  "<!--\n" +
  "  自适应图标：背景 = 品牌青，前景 = 网页版 favicon 那个标记（带安全边距）。\n" +
  "  由 android/scripts/make-icon.mjs 生成，不要手改——改就改那个脚本。\n" +
  "-->\n" +
  '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <background android:drawable="@color/brand_splash" />\n' +
  '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n' +
  "</adaptive-icon>\n";
writeFileSync(join(anydpi, "ic_launcher.xml"), adaptiveXml, "utf8");
writeFileSync(join(anydpi, "ic_launcher_round.xml"), adaptiveXml, "utf8");
console.log("[make-icon] mipmap-anydpi-v26  ic_launcher(.round).xml");

console.log("[make-icon] 完成");
