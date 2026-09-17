// 下载指定版本的 Electron 运行时（win32-x64）到本地缓存。
// 不经过 npm 的 postinstall —— 打包机/CI 上更可控，也避免脚本执行策略带来的意外。
//
// 用法：node desktop/scripts/fetch-electron.mjs [version]
// 可用 ELECTRON_MIRROR 覆盖镜像源（默认 npmmirror，国内更快）。

import { createWriteStream, existsSync, mkdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
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
console.log("[fetch-electron] 已下载：" + zip + "（" + (statSync(zip).size / 1048576).toFixed(1) + " MB" + (total ? " / " + (total / 1048576).toFixed(1) : "") + "）");

// ---------------------------------------------------------------- 校验
//
// 这是要打包进安装程序的运行时，必须确认字节就是官方发布的那一份：
// 只从镜像站读文件、不校验，等于把"镜像站被换掉"直接变成"安装包里是陌生人的二进制"。
// 摘要优先从 GitHub 官方 release 取（镜像站自己发的摘要挡不住镜像站被入侵），
// 取不到再退回镜像站，两边都取不到就大声警告并留下本次算出的摘要备查。
const sumName = "electron-v" + version + "-win32-x64.zip";
const officialSums = "https://github.com/electron/electron/releases/download/v" + version + "/SHASUMS256.txt";

async function fetchText(u) {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

function pickSum(text) {
  if (!text) return null;
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === sumName) return m[1].toLowerCase();
  }
  return null;
}

const actual = createHash("sha256").update(readFileSync(zip)).digest("hex");
const fromOfficial = pickSum(await fetchText(officialSums));
const expected = fromOfficial || pickSum(await fetchText(mirror + version + "/SHASUMS256.txt"));

if (expected) {
  if (actual !== expected) {
    try {
      unlinkSync(zip);
    } catch {
      /* 删不掉也要让流程失败 */
    }
    console.error("[fetch-electron] 校验失败：下载到的文件与官方摘要不一致，已删除。");
    console.error("  期望 " + expected);
    console.error("  实际 " + actual);
    console.error("  来源 " + (fromOfficial ? officialSums : mirror + version + "/SHASUMS256.txt"));
    process.exit(1);
  }
  console.log(
    "[fetch-electron] 校验通过（sha256 " + actual.slice(0, 16) + "…，来源 " +
      (fromOfficial ? "GitHub 官方" : "镜像站（未能连上 GitHub，保证强度较低）") + "）",
  );
} else {
  console.warn("[fetch-electron] 警告：拿不到 SHASUMS256.txt，本次无法校验完整性。");
  console.warn("[fetch-electron]   已把本次算出的摘要写到 " + zip + ".sha256，供人工比对：");
  writeFileSync(zip + ".sha256", actual + "  " + sumName + "\n", "utf8");
  console.warn("[fetch-electron]   " + actual);
}
