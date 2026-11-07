// 组装 Windows 免安装便携版。
//
// 关键：产物必须从 electron-builder 的 --dir 输出（release/win-unpacked）复制，不能自己解压 Electron 压缩包。
// 原因很具体：exe 的图标是写在 PE 文件的资源段里的，光把 electron.exe 改名成「4E NEXT.exe」
// 并不会换掉里面的图标——任务栏和资源管理器里看到的仍是 Electron 默认图标。
// electron-builder 打包时会用 rcedit 改写 exe 资源（图标、版本号），这一步不能省。
//
// 用法：npm --prefix desktop run pack:portable
//   （等价于先 electron-builder --win --dir，再跑本脚本）

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 便携版打完后顺手写 SHA256SUMS.txt：云端流水线只跑这一条命令就能拿到全部附件
import { writeSums } from "./make-sums.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, "..");
const pkg = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));

const productName = "4E NEXT";
const version = pkg.version;
const releaseDir = join(desktopDir, "release");
const unpacked = join(releaseDir, "win-unpacked");
const stage = join(releaseDir, productName + "-win32-x64");
const exeName = productName + ".exe";

function step(msg) {
  console.log("[pack-portable] " + msg);
}

if (!existsSync(join(unpacked, exeName))) {
  console.error("[pack-portable] 找不到 " + join(unpacked, exeName));
  console.error("[pack-portable] 先执行：electron-builder --win --dir --config electron-builder.yml");
  process.exit(1);
}
if (!existsSync(join(desktopDir, "renderer", "index.html"))) {
  console.error("[pack-portable] 找不到渲染产物，先执行：pnpm --filter 4enext-web build:desktop");
  process.exit(1);
}

step("从 electron-builder 产物复制（保留已写入 exe 的图标资源）");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(unpacked, stage, { recursive: true });

step("写入便携标记");
writeFileSync(
  join(stage, "portable.txt"),
  "本文件存在时，4E NEXT 的数据写在同目录的 data\\ 文件夹里。\n" +
    "删除本文件则改用系统应用数据目录（Windows 为 %APPDATA%\\4E NEXT）。\n",
  "utf8",
);

const zip = join(releaseDir, "4E-NEXT-" + version + "-win-x64-portable.zip");
if (existsSync(zip)) rmSync(zip, { force: true });

step("打包 zip（约 400MB，需要几分钟）");
// 为什么不用裸 `tar`：
//   Windows 自带的 bsdtar（%SystemRoot%\System32\tar.exe）支持 `-a` 按扩展名选 zip，
//   但 Git Bash 的 PATH 里 /usr/bin/tar 是 GNU tar，不认 .zip——GitHub Actions 的
//   windows-latest 上就是这样，退出码 128。Linux runner 的 GNU tar 同样不行。
//   所以这里按平台给「绝对路径 / 工具」：Windows 用系统 bsdtar，其他平台用 zip(1)。
const stageName = productName + "-win32-x64";
const attempts =
  process.platform === "win32"
    ? [
        [join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, "-C", releaseDir, stageName]],
        ["tar.exe", ["-a", "-c", "-f", zip, "-C", releaseDir, stageName]],
      ]
    : [["zip", ["-r", "-q", zip, stageName]]];

let packError = null;
for (const [cmd, args] of attempts) {
  // stdio: ignore —— 受限沙箱下带管道 stdio 的 spawn 会被拒，这里也顺便避免管道
  const r = spawnSync(cmd, args, { stdio: "ignore", cwd: process.platform === "win32" ? undefined : releaseDir });
  if (r.status === 0) {
    packError = null;
    break;
  }
  packError = cmd + "（退出码 " + r.status + "）";
  rmSync(zip, { force: true });
}
if (packError) {
  console.error("[pack-portable] zip 打包失败：" + packError);
  process.exit(1);
}

const stageMb = dirSizeMb(stage);

// zip 已经装下了整个暂存目录，而 release/win-unpacked 是可运行的同一份内容，
// 再留一份 480MB 的 stage 就是纯冗余。需要它（比如不想解压就想直接跑）时加 --keep-stage。
const keepStage = process.argv.includes("--keep-stage");
if (!keepStage) {
  rmSync(stage, { recursive: true, force: true });
}
step("完成：" + (keepStage ? stage : zip + "（暂存目录已清理，加 --keep-stage 可保留）"));
step("体积：解压后约 " + stageMb.toFixed(1) + " MB；zip " + (statSync(zip).size / 1048576).toFixed(1) + " MB");

const sums = writeSums(releaseDir);
step(sums ? "已写入 " + sums : "没有找到 *-setup.exe / *portable.zip，跳过 SHA256SUMS.txt");
console.log(
  JSON.stringify({
    stage,
    exe: join(stage, exeName),
    zip,
    version,
    sizeMb: Number(stageMb.toFixed(1)),
    zipMb: Number((statSync(zip).size / 1048576).toFixed(1)),
  }),
);

function dirSizeMb(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeMb(p) * 1048576;
    else if (entry.isFile()) total += statSync(p).size;
  }
  return total / 1048576;
}
