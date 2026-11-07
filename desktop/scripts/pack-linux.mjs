// 把 Linux 解包产物打成便携 tar.gz，并写 SHA256SUMS.txt。
//
// AppImage 是单文件「便携版」，但运行依赖系统有 FUSE2；不少发行版默认不装。
// 所以再给一份解压即用的 tar.gz：解压后直接运行 4e-next。
//
// 用法：node desktop/scripts/pack-linux.mjs
// 前置：npm --prefix desktop run dist:linux（产物在 desktop/release-linux/）

import { cpSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSums } from "./make-sums.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, "..");
const pkg = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));
const version = pkg.version;
const releaseDir = join(desktopDir, "release-linux");
const unpacked = join(releaseDir, "linux-unpacked");
const stageName = "4E-NEXT-linux-x64";
const stage = join(releaseDir, stageName);
const tarPath = join(releaseDir, "4E-NEXT-" + version + "-linux-x64-portable.tar.gz");

function step(msg) {
  console.log("[pack-linux] " + msg);
}

// executableName 在 electron-builder.linux.yml 里定的是 4e-next
const exe = join(unpacked, "4e-next");
if (!existsSync(exe)) {
  console.error("[pack-linux] 找不到 " + exe);
  console.error("[pack-linux] 先执行：npm --prefix desktop run dist:linux");
  process.exit(1);
}

step("复制解包产物 -> " + stageName);
rmSync(stage, { recursive: true, force: true });
cpSync(unpacked, stage, { recursive: true });

step("打包 tar.gz（约几分钟）");
rmSync(tarPath, { force: true });
const r = spawnSync("tar", ["-czf", tarPath, "-C", releaseDir, stageName], { stdio: "ignore" });
if (r.status !== 0) {
  console.error("[pack-linux] tar.gz 打包失败（退出码 " + r.status + "）");
  process.exit(1);
}

step("清理暂存目录");
rmSync(stage, { recursive: true, force: true });

const sums = writeSums(releaseDir);
step(sums ? "已写入 " + sums : "没有找到可校验的附件，跳过 SHA256SUMS.txt");
step("完成：" + tarPath + "（" + (statSync(tarPath).size / 1048576).toFixed(1) + " MB）");
