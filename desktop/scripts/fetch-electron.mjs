// 下载指定版本的 Electron 运行时到本地缓存（按当前平台/架构）。
// 不经过 npm 的 postinstall —— 打包机/CI 上更可控，也避免脚本执行策略带来的意外。
//
// 用法：node desktop/scripts/fetch-electron.mjs [version]
//   平台/架构默认跟随当前运行环境（Windows → win32-x64，Ubuntu runner → linux-x64）；
//   需要交叉下载时用环境变量覆盖：ELECTRON_PLATFORM=linux ELECTRON_ARCH=x64
// 可用 ELECTRON_MIRROR 覆盖镜像源（默认 npmmirror，国内更快）。

import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(join(here, "..", "package.json"), "utf8"));
const version = (process.argv[2] || pkg.devDependencies?.electron || "44.4.1").replace(/^[^0-9]*/, "");
const platform = process.env.ELECTRON_PLATFORM || process.platform;
const arch = process.env.ELECTRON_ARCH || process.arch;
const fileName = "electron-v" + version + "-" + platform + "-" + arch + ".zip";
const mirror = (process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/").replace(/\/?$/, "/");
const outDir = process.env.ELECTRON_CACHE || join(root, ".electron-cache");
const zip = join(outDir, fileName);

// ---------------------------------------------------------------- 摘要
//
// 这是要打包进安装程序的运行时，必须确认字节就是官方发布的那一份：
// 只从镜像站读文件、不校验，等于把"镜像站被换掉"直接变成"安装包里是陌生人的二进制"。
// 摘要优先从 GitHub 官方 release 取（镜像站自己发的摘要挡不住镜像站被入侵），
// 取不到再退回镜像站，两边都取不到就大声警告并留下本次算出的摘要备查。
const sumName = fileName;
const officialSums = "https://github.com/electron/electron/releases/download/v" + version + "/SHASUMS256.txt";
const mirrorSums = mirror + version + "/SHASUMS256.txt";

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

/** 官方摘要优先，镜像站兜底；都拿不到返回 null。 */
async function expectedSum() {
  const fromOfficial = pickSum(await fetchText(officialSums));
  if (fromOfficial) return { sum: fromOfficial, source: "GitHub 官方" };
  const fromMirror = pickSum(await fetchText(mirrorSums));
  if (fromMirror) return { sum: fromMirror, source: "镜像站（未能连上 GitHub，保证强度较低）" };
  return null;
}

function sha256Of(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// ---------------------------------------------------------------- 缓存
//
// 缓存文件也要校验：下载中断留下的半截文件如果只按「大于 1MB」判断缓存命中，
// 会被当成运行时打进安装包，最后表现为一堆看不懂的启动失败。
if (existsSync(zip) && statSync(zip).size > 1024 * 1024) {
  const sizeMb = (statSync(zip).size / 1048576).toFixed(1);
  const expected = await expectedSum();
  if (!expected) {
    console.log("[fetch-electron] 已缓存（拿不到摘要，跳过校验）：" + zip + "（" + sizeMb + " MB）");
    process.exit(0);
  }
  if (expected.sum === sha256Of(zip)) {
    console.log("[fetch-electron] 已缓存且校验通过：" + zip + "（" + sizeMb + " MB）");
    process.exit(0);
  }
  console.warn("[fetch-electron] 缓存文件摘要对不上（可能是上次下载中断留下的半截文件），删除后重新下载。");
  rmSync(zip, { force: true });
}

mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- 下载
//
// 镜像地址有两种布局，CI 上主源不通时要能自动换源：
//   · npmmirror：<base>/<version>/<file>        （不带 v）
//   · GitHub 官方：<base>/v<version>/<file>     （带 v）
// 国内本地开发用 npmmirror 快；GitHub 托管 runner 上官方源通常更稳。
const bases = [mirror, "https://github.com/electron/electron/releases/download/"];
function urlFor(base) {
  const tag = base.includes("github.com") ? "v" + version : version;
  return base.replace(/\/?$/, "/") + tag + "/" + fileName;
}

let total = 0;
let downloaded = false;

async function tryDownload(base, attempt) {
  const url = urlFor(base);
  console.log("[fetch-electron] 尝试（第 " + attempt + " 次）" + url);
  const r = await fetch(url, { signal: AbortSignal.timeout(240000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const size = Number(r.headers.get("content-length") || 0);
  const file = createWriteStream(zip);
  try {
    await new Promise((resolve, reject) => {
      const src = Readable.fromWeb(r.body);
      // 必须接住流的 error：连接被中途重置时，否则是 unhandled 'error' 直接崩进程
      src.on("error", reject);
      file.on("error", reject);
      file.on("finish", resolve);
      src.pipe(file);
    });
  } catch (err) {
    file.destroy();
    // 半截文件不能留：下次运行会把它当成「已缓存」而跳过下载
    rmSync(zip, { force: true });
    throw err;
  }
  return size;
}

for (const base of bases) {
  for (let attempt = 1; attempt <= 2 && !downloaded; attempt++) {
    try {
      total = await tryDownload(base, attempt);
      downloaded = true;
    } catch (err) {
      console.error("[fetch-electron] 失败：" + (err instanceof Error ? err.message : String(err)));
    }
  }
  if (downloaded) break;
}
if (!downloaded) {
  console.error("[fetch-electron] 所有下载源都失败了。");
  process.exit(1);
}
console.log("[fetch-electron] 已下载：" + zip + "（" + (statSync(zip).size / 1048576).toFixed(1) + " MB" + (total ? " / " + (total / 1048576).toFixed(1) : "") + "）");

// ---------------------------------------------------------------- 校验
const expected = await expectedSum();
const actual = sha256Of(zip);

if (expected) {
  if (actual !== expected.sum) {
    rmSync(zip, { force: true });
    console.error("[fetch-electron] 校验失败：下载到的文件与官方摘要不一致，已删除。");
    console.error("  期望 " + expected.sum);
    console.error("  实际 " + actual);
    console.error("  来源 " + expected.source);
    process.exit(1);
  }
  console.log("[fetch-electron] 校验通过（sha256 " + actual.slice(0, 16) + "…，来源 " + expected.source + "）");
} else {
  console.warn("[fetch-electron] 警告：拿不到 SHASUMS256.txt，本次无法校验完整性。");
  console.warn("[fetch-electron]   已把本次算出的摘要写到 " + zip + ".sha256，供人工比对：");
  writeFileSync(zip + ".sha256", actual + "  " + sumName + "\n", "utf8");
  console.warn("[fetch-electron]   " + actual);
}
