// 下载指定版本的 Electron 运行时（win32-x64）到本地缓存。
// 不经过 npm 的 postinstall —— 打包机/CI 上更可控，也避免脚本执行策略带来的意外。
//
// 用法：node desktop/scripts/fetch-electron.mjs [version]
// 可用 ELECTRON_MIRROR 覆盖镜像源（默认 npmmirror，国内更快）。

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(join(here, "..", "package.json"), "utf8"));
const version = (process.argv[2] || pkg.devDependencies?.electron || "44.4.1").replace(/^[^0-9]*/, "");
const mirror = (process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/").replace(/\/?$/, "/");
const outDir = process.env.ELECTRON_CACHE || join(root, ".electron-cache");
const zip = join(outDir, "electron-v" + version + "-win32-x64.zip");

if (existsSync(zip) && statSync(zip).size > 1024 * 1024) {
  console.log("[fetch-electron] 已缓存：" + zip + "（" + (statSync(zip).size / 1048576).toFixed(1) + " MB）");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const url = mirror + version + "/electron-v" + version + "-win32-x64.zip";
console.log("[fetch-electron] 下载 " + url);

const res = await fetch(url);
if (!res.ok) {
  console.error("[fetch-electron] 下载失败：HTTP " + res.status);
  process.exit(1);
}
const total = Number(res.headers.get("content-length") || 0);
const file = createWriteStream(zip);
await new Promise((resolve, reject) => {
  Readable.fromWeb(res.body).pipe(file).on("finish", resolve).on("error", reject);
});
console.log("[fetch-electron] 完成：" + zip + "（" + (statSync(zip).size / 1048576).toFixed(1) + " MB" + (total ? " / " + (total / 1048576).toFixed(1) : "") + "）");
