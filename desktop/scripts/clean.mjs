// 清理桌面端的派生产物。
//
// 这些目录都很大且都能重新生成，出问题时的第一步就是清掉它们重来：
//   release/   ~2.7GB  打包产物（安装包、便携版、win-unpacked）
//   renderer/  ~110MB  渲染产物（需要重新 pnpm --filter 4enext-web build:desktop）
//
// 用法：
//   node desktop/scripts/clean.mjs          只清 release/（保留 renderer，省一次重编译）
//   node desktop/scripts/clean.mjs --all    连 renderer/ 一起清
//
// 注意：不会碰 desktop/assets/fonts（字体，重抓要几分钟）与 node_modules。

import { existsSync, rmSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, "..");
const all = process.argv.includes("--all");

const targets = [join(desktopDir, "release")];
if (all) targets.push(join(desktopDir, "renderer"));

let freed = 0;
for (const dir of targets) {
  if (!existsSync(dir)) {
    console.log("[clean] 跳过（不存在）：" + dir);
    continue;
  }
  const size = dirSize(dir);
  rmSync(dir, { recursive: true, force: true });
  freed += size;
  console.log("[clean] 已删除 " + dir + "（回收 " + (size / 1048576).toFixed(1) + " MB）");
}
console.log("[clean] 合计回收 " + (freed / 1048576).toFixed(1) + " MB");
if (all) console.log("[clean] 重新构建：pnpm --filter 4enext-web build:desktop");

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else if (entry.isFile()) total += statSync(p).size;
  }
  return total;
}
