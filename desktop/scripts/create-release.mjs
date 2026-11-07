// 创建 GitHub Release（不依赖 gh CLI）。
//
// 用法（桌面版）：
//   GITHUB_TOKEN=xxx node desktop/scripts/create-release.mjs \
//     --tag "4E-NEXT-Desktop-V0.3.4" \
//     --title "4E NEXT 0.3.4（首个正式版）" \
//     --notes-file desktop/RELEASE-NOTES.md
//
// 用法（安卓版；同一个脚本靠 --release-dir 换附件目录）：
//   GITHUB_TOKEN=xxx node desktop/scripts/create-release.mjs \
//     --release-dir android/release \
//     --tag "4E-NEXT-Android-V0.3.4" \
//     --title "4E NEXT 安卓版 0.3.4" \
//     --notes-file android/RELEASE-NOTES.md
//
// 正式版不加 --prerelease；beta 才需要（beta 若被标成 Latest 会顶掉 stable 的默认下载）。
//
// token 从环境变量 GITHUB_TOKEN 或 GH_TOKEN 读，绝不出现在命令行里。
// 需要 repo 权限（classic PAT 的 repo scope，或 fine-grained 的 Contents: Read and write）。

import { readFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}
function has(name) {
  return argv.includes("--" + name);
}

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  console.error("[release] 缺少 GITHUB_TOKEN / GH_TOKEN 环境变量。");
  process.exit(1);
}

// 仓库从 origin 推出来，免得再填一次
function detectRepo() {
  const explicit = flag("repo", null);
  if (explicit) return explicit;
  const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) throw new Error("无法从 origin 解析仓库： " + url);
  return m[1] + "/" + m[2];
}

const repo = detectRepo();
const tag = flag("tag", null);
if (!tag) {
  console.error("[release] 缺少 --tag");
  process.exit(1);
}
const title = flag("title", tag);
const notesFile = flag("notes-file", null);
// --notes：直接把一段文本当发布说明。三端发布要求「发布名称 = 发布介绍 = tag」，
// 云端流水线用 --notes "$TAG" 一行就能满足，不必再生成临时文件。
const notes = flag("notes", null);
// --target：Release 要新建 tag 时，tag 指向哪个 commit。云端传 GITHUB_SHA，
// 避免在推送 tag 之后 main 又前进时把新 tag 指到错的提交上。
const target = flag("target", null);
// --prune：上传完成后删掉同前缀的旧 Release（只删 Release，保留 git tag 历史）。
const prunePrefix = flag("prune", null);
const prerelease = has("prerelease");
const draft = has("draft");
const dryRun = has("dry-run");

// 附件默认自动发现 desktop/release/ 里的安装包、便携版 zip 与校验和。
// 刻意不按 tag 拼文件名：tag 命名（4E-NEXT-Desktop-V0.2.3B-beta.4）与产物命名
// （4E-NEXT-0.2.3-beta.4-...）本来就不是一回事，拼出来的路径对不上。
//
// --release-dir 可以把「找附件」的目录换掉，安卓端就靠这个复用同一个脚本：
//   node desktop/scripts/create-release.mjs --release-dir android/release --tag ...
// 之所以不把脚本挪到公共位置：它最初是为桌面端写的，桌面端的发布流程已经在用它，
// 挪动只会让文档里的路径全部失效。加一个参数是更小的改动。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const releaseDir = (() => {
  const custom = flag("release-dir", null);
  return custom ? resolve(repoRoot, custom) : join(repoRoot, "desktop", "release");
})();

/** 不同平台的附件扩展名不一样：桌面是 exe/zip，安卓是 apk。 */
function discoverAssets() {
  if (!existsSync(releaseDir)) return [];
  const out = readdirSync(releaseDir)
    .filter((n) => /\.(exe|zip|apk)$/i.test(n) && !/blockmap/i.test(n))
    .sort()
    .map((n) => join(releaseDir, n));
  const sums = join(releaseDir, "SHA256SUMS.txt");
  if (existsSync(sums)) out.push(sums);
  return out;
}

// --skip-upload：只建 Release 不上传附件（先建好拿到 URL，再分批传大文件，
// 这样单次调用的耗时可控，中途失败也能重跑续传）
const skipUpload = has("skip-upload");
const assets = skipUpload
  ? []
  : (flag("assets", null) ? flag("assets").split(",") : discoverAssets()).map((p) => p.trim());
if (!skipUpload && assets.length === 0) {
  console.error("[release] 没有找到任何附件。");
  console.error("[release]   找的是：" + releaseDir);
  console.error("[release]   桌面版先执行：npm --prefix desktop run dist && npm --prefix desktop run pack:portable");
  console.error("[release]   安卓版先执行：pnpm release:android");
  console.error("[release]   也可以用 --assets 显式指定文件。");
  process.exit(1);
}

const body = notes !== null ? notes : notesFile ? readFileSync(notesFile, "utf8") : "";

console.log("[release] 仓库：" + repo);
console.log("[release] tag：" + tag);
console.log("[release] 标题：" + title);
console.log("[release] 预发布：" + prerelease + "  草稿：" + draft);
console.log(
  "[release] 说明：" +
    (notes !== null
      ? "--notes 参数（" + body.length + " 字符）"
      : notesFile
        ? notesFile + "（" + body.length + " 字符）"
        : "（空）"),
);
if (prunePrefix) console.log("[release] 发布后清理旧版本：tag 前缀 " + prunePrefix);
for (const a of assets) {
  console.log("[release] 附件：" + a + (existsSync(a) ? "（" + (statSync(a).size / 1048576).toFixed(1) + " MB）" : "  ← 不存在！"));
}
if (dryRun) {
  console.log("[release] --dry-run，未调用 API。");
  process.exit(0);
}
for (const a of assets) {
  if (!existsSync(a)) {
    console.error("[release] 附件不存在，中止：" + a);
    process.exit(1);
  }
}

const api = "https://api.github.com";
const headers = {
  Authorization: "Bearer " + token,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "4enext-release-script",
};

async function main() {
  // 已存在同名 release 就复用，避免重复发布会 422
  let release = null;
  const existing = await fetch(api + "/repos/" + repo + "/releases/tags/" + encodeURIComponent(tag), { headers });
  if (existing.status === 200) {
    release = await existing.json();
    console.log("[release] 该 tag 已有 Release（id=" + release.id + "），改为复用并补传附件。");
  } else {
    const res = await fetch(api + "/repos/" + repo + "/releases", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: target || undefined,
        name: title,
        body,
        prerelease,
        draft,
      }),
    });
    if (!res.ok) {
      console.error("[release] 创建失败 HTTP " + res.status);
      console.error(await res.text());
      process.exit(1);
    }
    release = await res.json();
    console.log("[release] 已创建：" + release.html_url);
  }

  // 复用已有 Release 时也把名称/说明对齐到本次的值：
  // 云端第一次发布若失败在半路，或者旧版本用的是别的标题格式，重跑一次就能修正，
  // 不用手工去网页上改。
  if (release && (release.name !== title || release.body !== body)) {
    console.log("[release] 已有 Release 的名称/说明与本次不一致，更新为当前值。");
    const patch = await fetch(api + "/repos/" + repo + "/releases/" + release.id, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: title, body }),
    });
    if (!patch.ok) {
      console.error("[release] 更新名称/说明失败 HTTP " + patch.status);
      console.error((await patch.text()).slice(0, 400));
      process.exit(1);
    }
    release = await patch.json();
  }

  const uploaded = new Set((release.assets || []).map((a) => a.name));
  for (const file of assets) {
    const name = basename(file);
    if (uploaded.has(name)) {
      console.log("[release] 跳过（远端已有）：" + name);
      continue;
    }
    const size = statSync(file).size;
    console.log("[release] 上传 " + name + "（" + (size / 1048576).toFixed(1) + " MB）...");
    const res = await fetch(
      "https://uploads.github.com/repos/" + repo + "/releases/" + release.id + "/assets?name=" + encodeURIComponent(name),
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(size) },
        body: readFileSync(file),
      },
    );
    if (!res.ok) {
      console.error("[release] 上传失败 HTTP " + res.status + "：" + (await res.text()).slice(0, 400));
      process.exit(1);
    }
    const asset = await res.json();
    console.log("[release]   ✓ " + asset.name + "  " + (asset.size / 1048576).toFixed(1) + " MB");
  }

  if (prunePrefix) await pruneOlderReleases();

  console.log("\n[release] 完成：" + release.html_url);
}

/**
 * 删除同前缀的旧 Release（**保留** git tag）。
 *
 * 三端的约定是「每端只留最新一版」：旧安装包/APK 留在 Releases 页会让人下到过期版本。
 * 只删 Release 不删 tag —— 源码历史、提交引用都还在，想找回旧版源码随时可以。
 */
async function pruneOlderReleases() {
  const res = await fetch(api + "/repos/" + repo + "/releases?per_page=100", { headers });
  if (!res.ok) {
    console.warn("[release] 读取 Release 列表失败 HTTP " + res.status + "，跳过旧版本清理。");
    return;
  }
  const all = await res.json();
  const older = all
    .filter((r) => r.tag_name !== tag && r.tag_name.startsWith(prunePrefix))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!older.length) {
    console.log("[release] 没有需要清理的旧版本（前缀 " + prunePrefix + "）。");
    return;
  }
  for (const r of older) {
    console.log("[release] 删除旧版本 Release：" + r.tag_name + "（git tag 保留）");
    const del = await fetch(api + "/repos/" + repo + "/releases/" + r.id, { method: "DELETE", headers });
    if (!del.ok && del.status !== 404) {
      console.warn("[release]   删除失败 HTTP " + del.status + "：" + (await del.text()).slice(0, 200));
    } else {
      console.log("[release]   ✓ 已删除");
    }
  }
}

await main();
