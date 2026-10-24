// 构建期图标名单校验。
//
// 为什么需要它：图标字体已经被子集化（见 scripts/build-icon-font.py），只保留
// src/assets/icon-names.json 里列出的字形。以后某人新加一个图标却忘了重跑生成脚本时，
// 页面上不会有任何报错，只会把这个图标渲染成连字文本（auto_awesome 之类）——
// 那种问题只有肉眼能发现，所以在这里提前喊一声。
//
// 只警告、不退出非零：漏跑的代价是某个图标难看，而让整条部署流水线失败代价更大。
// 想把它当成硬性检查，加 --strict 即可（本地用）。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const srcDir = join(root, "src");
const namesFile = join(srcDir, "assets", "icon-names.json");

const strict = process.argv.includes("--strict");

/** 与 build-icon-font.py 保持同一条正则：只要 span 里直接写了图标名，就必须在名单里 */
const LIGATURE_RE = /material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

let known;
try {
  known = new Set(JSON.parse(readFileSync(namesFile, "utf8")).glyphs);
} catch {
  console.warn("[icons] 读不到 " + relative(root, namesFile) + "，跳过校验");
  process.exit(0);
}

const missing = new Map();
for (const file of walk(srcDir)) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(LIGATURE_RE)) {
    const name = match[1];
    if (known.has(name)) continue;
    if (!missing.has(name)) missing.set(name, new Set());
    missing.get(name).add(relative(root, file));
  }
}

if (missing.size === 0) {
  console.log("[icons] 图标名单校验通过（" + known.size + " 个字形）");
} else {
  console.warn("[icons] 发现 " + missing.size + " 个不在子集里的图标，它们会显示成文字：");
  for (const [name, files] of missing) {
    console.warn("  · " + name + "  ←  " + [...files].join(", "));
  }
  console.warn("[icons] 处理办法：python web/scripts/build-icon-font.py 重新生成子集");
  if (strict) process.exit(1);
}
