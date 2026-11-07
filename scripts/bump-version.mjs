// 一键同步三端版本号。
//
// 为什么需要它：0.4.1 之前，发一版要手改 5 个地方（根 / web / desktop 的 package.json、
// 安卓的 versionName 与 versionCode、README 里的两个下载链接），少改一处就是
// 「网页写着 0.4.2、APK 里还是 0.4.1」这类最难查的问题。云端流水线会校验
// tag 与 package.json 一致，但那时候已经 push 了，只能重来。
//
// 用法：
//   node scripts/bump-version.mjs 0.4.2
//   node scripts/bump-version.mjs 0.4.2 --dry-run   # 只打印将要改什么
//
// versionCode 的算法与既有版本保持一致：(主*10+次)*100+修订
//   0.3.4 → 304   0.3.8 → 308   0.4.0 → 400   0.4.1 → 401
// 要求新的 versionCode 必须比旧的大，否则直接报错（避免发出去的包无法覆盖安装）。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dryRun = process.argv.includes("--dry-run");
const next = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error("[version] 用法：node scripts/bump-version.mjs <主.次.修订> [--dry-run]");
  process.exit(1);
}

const rel = (p) => relative(root, p).replace(/\\/g, "/");
const read = (p) => readFileSync(p, "utf8");

function versionOf(p) {
  const m = /"version"\s*:\s*"([^"]+)"/.exec(read(p));
  if (!m) throw new Error("读不到 version：" + p);
  return m[1];
}

/** 与既有版本号保持一致的 versionCode 算法 */
function versionCodeOf(v) {
  const [maj, min, pat] = v.split(".").map(Number);
  return (maj * 10 + min) * 100 + pat;
}

const pkgFiles = [join(root, "package.json"), join(root, "web", "package.json"), join(root, "desktop", "package.json")];
const current = versionOf(pkgFiles[0]);
for (const p of pkgFiles) {
  if (versionOf(p) !== current) {
    console.error("[version] 版本号本来就不一致：" + rel(p) + " = " + versionOf(p) + "，根 package.json = " + current);
    console.error("[version] 先手工对齐再跑本脚本。");
    process.exit(1);
  }
}
if (current === next) {
  console.log("[version] 当前已经是 " + current + "，无需修改。");
  process.exit(0);
}

const oldCode = Number(/versionCode\s*=\s*(\d+)/.exec(read(join(root, "android", "app", "build.gradle.kts")))?.[1] ?? 0);
const newCode = versionCodeOf(next);
if (newCode <= oldCode) {
  console.error("[version] 新 versionCode " + newCode + " 不大于旧值 " + oldCode + "，安卓端会无法覆盖安装。");
  process.exit(1);
}

/** file: [oldText, newText] 列表；用字面量替换，避免正则元字符问题 */
const edits = [];
const pkgJson = (p) => read(p).replace('"version": "' + current + '"', '"version": "' + next + '"');
for (const p of pkgFiles) edits.push([p, pkgJson(p)]);

edits.push([
  join(root, "desktop", "package-lock.json"),
  read(join(root, "desktop", "package-lock.json")).replace(
    /("name":\s*"4enext-desktop",\s*"version":\s*")[^"]+(")/g,
    "$1" + next + "$2",
  ),
]);

const gradle = join(root, "android", "app", "build.gradle.kts");
edits.push([
  gradle,
  read(gradle)
    .replace(/versionName\s*=\s*"[^"]+"/, 'versionName = "' + next + '"')
    .replace(/versionCode\s*=\s*\d+/, "versionCode = " + newCode),
]);

const readme = join(root, "README.md");
const readmeText = read(readme);
const bumpedReadme = readmeText.replace(/4E-NEXT-(Desktop|Android|Linux)-V[0-9A-Za-z.\-]+/g, "4E-NEXT-$1-V" + next);
if (bumpedReadme === readmeText) {
  console.warn("[version] ⚠️ README.md 里没找到 4E-NEXT-Desktop-V… / 4E-NEXT-Android-V… 链接，已跳过。");
} else {
  edits.push([readme, bumpedReadme]);
}

console.log("[version] " + current + " → " + next + "（安卓 versionCode " + oldCode + " → " + newCode + "）");
for (const [file] of edits) console.log("[version]   改写 " + rel(file));
if (dryRun) {
  console.log("[version] --dry-run：未写入任何文件。");
  process.exit(0);
}
for (const [file, text] of edits) writeFileSync(file, text, "utf8");
console.log("[version] 完成。下一步：提交并推送 main（网页端自动部署），再打总 tag：git tag 4E-NEXT-V" + next);
