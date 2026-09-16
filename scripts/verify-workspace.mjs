// 提交/构建前的自检：确认 desktop/ 没有被误加进 pnpm workspace。
//
// 背景（2026-09-16 真实事故）：desktop/ 依赖 electron 与 electron-builder。它一旦进入
// pnpm-workspace.yaml，pnpm-lock.yaml 就必须同步更新；而 CI 跑的是
// "pnpm install --frozen-lockfile"，锁文件与新的 workspace 成员对不上会直接
// 以 ERR_PNPM_OUTDATED_LOCKFILE 失败——网页端部署整条挂掉，且报错埋在安装步骤里，不好定位。
//
// desktop 用自己目录下的 npm install（见 desktop/README.md）。
//
// 用法：
//   node scripts/verify-workspace.mjs              校验仓库里的 pnpm-workspace.yaml
//   node scripts/verify-workspace.mjs <file>       校验指定文件（供测试用）
// 也作为 GitHub Actions 构建前的第一步（见 .github/workflows/deploy.yml）。

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
const wsFile = arg ? (isAbsolute(arg) ? arg : resolve(process.cwd(), arg)) : join(root, "pnpm-workspace.yaml");

if (!existsSync(wsFile)) {
  console.error("[verify-workspace] 找不到 " + wsFile);
  process.exit(1);
}

// 逐行解析：去掉行内注释，只认 "- <name>" 形式的成员
const members = readFileSync(wsFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.replace(/#.*/, "").trim())
  .filter((line) => line.startsWith("- "))
  .map((line) => line.slice(2).trim())
  .filter(Boolean);

console.log("[verify-workspace] " + wsFile);
console.log("[verify-workspace] workspace 成员：" + (members.length ? members.join(", ") : "(空)"));

const forbidden = ["desktop"];
const bad = members.filter((m) => forbidden.includes(m));

if (bad.length > 0) {
  console.error("");
  console.error("[verify-workspace] 失败：" + bad.join(", ") + " 被加进了 pnpm workspace。");
  console.error("  它依赖 electron（约 100MB 二进制），并会让 pnpm-lock.yaml 与 workspace 失去同步，");
  console.error("  导致 CI 的 pnpm install --frozen-lockfile 以 ERR_PNPM_OUTDATED_LOCKFILE 失败，");
  console.error("  网页端部署会整条挂掉。desktop 请用自己目录下的 npm install，详见 desktop/README.md。");
  process.exit(1);
}

console.log("[verify-workspace] ok");
