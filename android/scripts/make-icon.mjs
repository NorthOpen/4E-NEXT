// 生成安卓启动图标。
//
// 源图就是桌面版已经做好的那一张：desktop/build/icon.png
// ——**品牌青实心块 + 镂空的 4E 字**（青块是图形，字是挖空的部分）。
// 不自绘、不重新渲染：桌面版那一步（洋红键控反解 alpha）已经验证过，
// 再走一遍只会多一处可能分叉的地方。
//
// ⚠️ 这里有一个**只看代码看不出来**的坑，0.3.4 就是这么发出去的：
//   自适应图标 = 背景层 + 前景层，两层叠在一起。原来的做法是
//   「背景 = @color/brand_splash（品牌青）+ 前景 = 源图里那个青块」——
//   **两层同色**，于是整块图标渲染出来就是一片纯青，4E 完全不见了。
//   镂空的字是「透明」，透出去看到的正是同一块青底。
//
//   正确的分工（见下面的 STYLE）：
//     背景层 = 品牌青（铺满整个遮罩）
//     前景层 = **白色的字**（＝源图 alpha 取反），这样字才和底分得开
//   字形不是新画的：它是源图里青块之间的缝隙，逐像素取反就得到。
//
// 产物（按密度）：
//   1. mipmap-*/ic_launcher_foreground.png —— 自适应图标前景（白字，带安全边距）
//   2. mipmap-*/ic_launcher_monochrome.png —— Android 13+ 主题化图标用的单色层
//   3. mipmap-*/ic_launcher(.round).png    —— 传统图标，给读老路径的启动器/小部件兜底
//   4. mipmap-anydpi-v26/…（背景+前景）、mipmap-anydpi-v33/…（再加单色层）
//
// 用法：
//   node android/scripts/make-icon.mjs                 # 默认样式：白字青底
//   node android/scripts/make-icon.mjs --style=tile    # 备选样式：青块白底（外形同桌面版）
//   node android/scripts/make-icon.mjs --preview       # 额外把候选样式渲染成预览图

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, toRgba, resizeRgba, encodePng } from "../../desktop/scripts/lib/png.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = join(here, "..");
const SRC = join(androidDir, "..", "desktop", "build", "icon.png");
const RES = join(androidDir, "app", "src", "main", "res");
const PREVIEW_DIR = join(androidDir, "build", "icon-preview");

const argv = process.argv.slice(2);
const STYLE = argv.includes("--style=tile") ? "tile" : "letters";
const WANT_PREVIEW = argv.includes("--preview");

/** 品牌青，取自 web/public/favicon.svg 的 fill（与 values/colors.xml 的 brand_splash 同值）。 */
const BRAND = { r: 0x00, g: 0x83, b: 0x8f };
/** 前景层里字的颜色。 */
const INK_WHITE = { r: 0xff, g: 0xff, b: 0xff };

if (!existsSync(SRC)) {
  console.error("[make-icon] 找不到源图：" + SRC);
  console.error("[make-icon] 先执行：npm --prefix desktop run make-icon");
  process.exit(1);
}

// ---------------------------------------------------------------- 尺寸

// 传统图标的各密度尺寸（48dp 基准）
const LEGACY = [
  ["mdpi", 48],
  ["hdpi", 72],
  ["xhdpi", 96],
  ["xxhdpi", 144],
  ["xxxhdpi", 192],
];

// 自适应图标：108dp 画布，安全区 72dp（系统保证这一块一定可见）
const ADAPTIVE = [
  ["mdpi", 108],
  ["hdpi", 162],
  ["xhdpi", 216],
  ["xxhdpi", 324],
  ["xxxhdpi", 432],
];

/** 安全区占比。 */
const SAFE_ZONE = 72 / 108;
/**
 * 字形占画布的比例。
 *
 * 比安全区再小一点（68/108 而不是 72/108）：源图里的字横画是**顶到左右边缘**的，
 * 按 72/108 摆正好落在安全区的边界上，遇上圆形遮罩会在中线上被啃掉一丝。
 * 缩到 68 留出约 2dp 余量，圆形、方形、水滴形遮罩都不会切到笔画。
 */
const GLYPH_SPAN = 68 / 108;

// ---------------------------------------------------------------- 源图

const src = decodePng(readFileSync(SRC));
const rgba = toRgba(src);
const total = src.width * src.height;
console.log("[make-icon] 源图 " + src.width + "×" + src.height + "，通道 " + src.channels);

/** 源图不透明率，用来兜底判断这张图到底是不是「青块 + 镂空字」。 */
let opaqueCount = 0;
for (let i = 0; i < total; i++) if (rgba[i * 4 + 3] === 255) opaqueCount++;
console.log("[make-icon] 源图实心占比 " + ((opaqueCount / total) * 100).toFixed(1) + "%");

/** 镂空部分（＝字形）的包围盒，用于确认源图方向没搞反。 */
const glyphBox = boundsWhere(rgba, src.width, src.height, (a) => a < 128);
console.log(
  "[make-icon] 镂空（字形）包围盒 x " + glyphBox.x0 + ".." + glyphBox.x1 +
    "  y " + glyphBox.y0 + ".." + glyphBox.y1,
);
if (glyphBox.x1 - glyphBox.x0 < src.width * 0.5) {
  console.error("[make-icon] 源图的镂空区域太小，看起来不像「青块 + 镂空字」，请检查源图。");
  process.exit(1);
}

/**
 * 前景图层：把源图的 alpha 取反，得到「字」本身，颜色统一刷成白。
 *
 * 取反是精确互补的：青块处 alpha=255 → 0（不画），镂空处 alpha=0 → 255（画），
 * 抗锯齿的中间值也逐像素对应，所以字形的边缘和源图一模一样，不需要重新描边。
 */
function whiteGlyphLayer() {
  const out = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    const a = rgba[i * 4 + 3];
    out[i * 4] = INK_WHITE.r;
    out[i * 4 + 1] = INK_WHITE.g;
    out[i * 4 + 2] = INK_WHITE.b;
    out[i * 4 + 3] = 255 - a;
  }
  return out;
}

/** 传统图标用的一整块图标：把源图合成到白底上（镂空处变白，不再透出桌面壁纸）。 */
function flattenedIcon() {
  const out = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    const a = rgba[i * 4 + 3] / 255;
    out[i * 4] = Math.round(rgba[i * 4] * a + 255 * (1 - a));
    out[i * 4 + 1] = Math.round(rgba[i * 4 + 1] * a + 255 * (1 - a));
    out[i * 4 + 2] = Math.round(rgba[i * 4 + 2] * a + 255 * (1 - a));
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------- 合成

/**
 * 把一个图层缩放到画布上的内容尺寸。
 *
 * 返回的是**紧贴内容**的小图（inner×inner）+ 居中偏移 offset，而不是一张铺满的画布：
 * 两者混用最容易出的错就是「按 inner 的跨度去读一张 stride=size 的画布」——
 * 结果是一层斜向的错位条纹。分开之后，读的人不可能再搞错跨度。
 *
 * @param size        画布边长（px）
 * @param layer       源图层（与源图同尺寸的 RGBA）
 * @param contentSpan 内容在画布上占的比例（0–1）
 */
function scaledLayer(size, layer, contentSpan) {
  const inner = Math.max(1, Math.round(size * contentSpan));
  return {
    data: resizeRgba(layer, src.width, src.height, inner, inner),
    inner,
    offset: Math.floor((size - inner) / 2),
  };
}

/** 把内容图层原样贴到画布中央（画布必须是空的，用于产出带透明的前景层）。 */
function blit(canvas, canvasSize, layer) {
  for (let y = 0; y < layer.inner; y++) {
    layer.data.copy(
      canvas,
      ((y + layer.offset) * canvasSize + layer.offset) * 4,
      y * layer.inner * 4,
      (y + 1) * layer.inner * 4,
    );
  }
}

/** 画布 + 居中贴好的内容图层。 */
function placeLayer(size, layer, contentSpan) {
  const out = Buffer.alloc(size * size * 4);
  const content = scaledLayer(size, layer, contentSpan);
  blit(out, size, content);
  return { data: out, inner: content.inner, offset: content.offset };
}

const glyphLayer = whiteGlyphLayer();
const flattened = flattenedIcon();

/** 当前样式下的自适应前景层与背景色。 */
const foregroundLayer = STYLE === "letters" ? glyphLayer : rgba;
const foregroundSpan = STYLE === "letters" ? GLYPH_SPAN : SAFE_ZONE;
const backgroundXml = STYLE === "letters" ? "@color/brand_splash" : "@android:color/white";

// 换样式时先清掉另一种样式留下的产物：否则 res/ 里会留着上一轮的
// ic_launcher_monochrome.png 与 v33 的 XML（它引用的正是那些图），
// 打包出来的图标会和脚本当前样式对不上——这种"改了没生效"最难排查。
if (STYLE !== "letters") {
  for (const [density] of ADAPTIVE) {
    rmSync(join(RES, "mipmap-" + density, "ic_launcher_monochrome.png"), { force: true });
  }
  rmSync(join(RES, "mipmap-anydpi-v33"), { recursive: true, force: true });
}

// ---------------------------------------------------------------- 写产物

for (const [density, size] of LEGACY) {
  const dir = join(RES, "mipmap-" + density);
  mkdirSync(dir, { recursive: true });
  // 传统图标是**一整块**图标，不能带透明镂空：老启动器会把镂空处透成壁纸
  const png = encodePng(size, size, resizeRgba(flattened, src.width, src.height, size, size));
  writeFileSync(join(dir, "ic_launcher.png"), png);
  writeFileSync(join(dir, "ic_launcher_round.png"), png);
  console.log("[make-icon] mipmap-" + density + "  ic_launcher(.round)  " + size + "×" + size);
}

for (const [density, size] of ADAPTIVE) {
  const dir = join(RES, "mipmap-" + density);
  mkdirSync(dir, { recursive: true });
  const fg = placeLayer(size, foregroundLayer, foregroundSpan);
  writeFileSync(join(dir, "ic_launcher_foreground.png"), encodePng(size, size, fg.data));
  console.log(
    "[make-icon] mipmap-" + density + "  ic_launcher_foreground  " +
      size + "×" + size + "（内容 " + fg.inner + "×" + fg.inner + "，偏移 " + fg.offset + "）",
  );

  // 单色层：Android 13+ 的主题化图标。系统只取这张图的 alpha 再刷成主题色，
  // 所以它应当是「字形」而不是整块图 —— 整块图会被刷成一坨纯色方块。
  // 青块白底那种样式没有可用的单色层（整块是方形色块），故不生成。
  if (STYLE === "letters") {
    const mono = placeLayer(size, glyphLayer, GLYPH_SPAN);
    writeFileSync(join(dir, "ic_launcher_monochrome.png"), encodePng(size, size, mono.data));
  }
}
console.log("[make-icon] 单色层（monochrome）：" + (STYLE === "letters" ? "已生成" : "本样式不适用，跳过"));

// 自适应图标描述文件。背景与前景的分工见文件头的说明。
const HEAD = (mono) =>
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  "<!--\n" +
  "  自适应图标：背景 = " + backgroundXml + "，前景 = " +
  (STYLE === "letters" ? "白色的 4E 字形（源图 alpha 取反）" : "源图里的品牌青标记") + "。\n" +
  "  由 android/scripts/make-icon.mjs 生成，不要手改——改就改那个脚本。\n" +
  (mono ? "  v33 目录里多一层 monochrome，给 Android 13+ 的「主题化图标」用。\n" : "") +
  "-->\n" +
  '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <background android:drawable="' + backgroundXml + '" />\n' +
  '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n' +
  (mono ? '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n' : "") +
  "</adaptive-icon>\n";

for (const [dirName, mono] of [["mipmap-anydpi-v26", false], ["mipmap-anydpi-v33", true]]) {
  if (mono && STYLE !== "letters") continue;
  const anydpi = join(RES, dirName);
  mkdirSync(anydpi, { recursive: true });
  const xml = HEAD(mono);
  writeFileSync(join(anydpi, "ic_launcher.xml"), xml, "utf8");
  writeFileSync(join(anydpi, "ic_launcher_round.xml"), xml, "utf8");
  console.log("[make-icon] " + dirName + "  ic_launcher(.round).xml");
}

console.log("[make-icon] 样式：" + STYLE + "（背景 " + backgroundXml + "）");

// ---------------------------------------------------------------- 预览图

if (WANT_PREVIEW) previewAll();

/**
 * 预览图：把几种样式按启动器的样子渲染出来（圆形遮罩 + 中性底色），
 * 用来在不动真机、不装包的情况下肉眼比对外观。产物不入库（写在 android/build/ 下）。
 */
function previewAll() {
  mkdirSync(PREVIEW_DIR, { recursive: true });
  const OUT = 384;
  const variants = [
    ["before-0.3.4", { bg: BRAND, layer: rgba, span: SAFE_ZONE }],
    ["letters", { bg: BRAND, layer: glyphLayer, span: GLYPH_SPAN }],
    ["tile", { bg: { r: 0xff, g: 0xff, b: 0xff }, layer: rgba, span: SAFE_ZONE }],
  ];
  const card = { r: 0x1f, g: 0x24, b: 0x27 }; // 深色桌面，白边/纯色问题一眼能看出来
  for (const [name, spec] of variants) {
    const file = join(PREVIEW_DIR, "icon-" + name + ".png");
    writeFileSync(file, encodePng(OUT, OUT, renderMasked(OUT, spec, card)));
    console.log("[make-icon] 预览 " + file);
  }
}

/**
 * 把「背景层 + 前景层」渲染成启动器上的圆形图标。
 * 先按 4 倍分辨率合成，再用 4×4 超采样取圆形遮罩，边缘不会锯齿。
 */
function renderMasked(outSize, spec, cardColor) {
  const SS = 4;
  const HI = outSize * SS;
  const hi = Buffer.alloc(HI * HI * 4);
  for (let i = 0; i < HI * HI; i++) {
    hi[i * 4] = spec.bg.r;
    hi[i * 4 + 1] = spec.bg.g;
    hi[i * 4 + 2] = spec.bg.b;
    hi[i * 4 + 3] = 255;
  }
  const content = scaledLayer(HI, spec.layer, spec.span);
  for (let y = 0; y < content.inner; y++) {
    for (let x = 0; x < content.inner; x++) {
      const s = (y * content.inner + x) * 4;
      const d = ((y + content.offset) * HI + (x + content.offset)) * 4;
      alphaOver(hi, d, content.data, s);
    }
  }

  const out = Buffer.alloc(outSize * outSize * 4);
  const radius = HI / 2; // 圆形遮罩：内切于 108dp 画布
  for (let y = 0; y < outSize; y++) {
    for (let x = 0; x < outSize; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const hx = Math.floor((x + (sx + 0.5) / SS) * SS);
          const hy = Math.floor((y + (sy + 0.5) / SS) * SS);
          const dx = hx + 0.5 - radius;
          const dy = hy + 0.5 - radius;
          const inside = dx * dx + dy * dy <= radius * radius;
          const i = (hy * HI + hx) * 4;
          if (inside) {
            r += hi[i]; g += hi[i + 1]; b += hi[i + 2];
          } else {
            r += cardColor.r; g += cardColor.g; b += cardColor.b;
          }
        }
      }
      const n = SS * SS;
      const o = (y * outSize + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 把 src 按自身 alpha 叠到 dst 上（非预乘，逐像素）。 */
function alphaOver(dst, di, src, si) {
  const a = src[si + 3] / 255;
  if (a === 0) return;
  dst[di] = Math.round(src[si] * a + dst[di] * (1 - a));
  dst[di + 1] = Math.round(src[si + 1] * a + dst[di + 1] * (1 - a));
  dst[di + 2] = Math.round(src[si + 2] * a + dst[di + 2] * (1 - a));
  dst[di + 3] = 255;
}

/** 逐像素判定为真的区域包围盒。 */
function boundsWhere(data, width, height, pred) {
  let x0 = width, x1 = -1, y0 = height, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pred(data[(y * width + x) * 4 + 3])) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, x1, y0, y1 };
}
