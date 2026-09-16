// 创建 GitHub Release（不依赖 gh CLI）。
//
// 用法：
//   GITHUB_TOKEN=xxx node desktop/scripts/create-release.mjs \
//     --tag "4E-NEXT-Desktop-V0.2.3B-beta.4" \
//     --title "4E NEXT 桌面版 0.2.3-beta.4（测试版）" \
//     --notes-file desktop/RELEASE-NOTES.md \
//     --prerelease
//
// token 从环境变量 GITHUB_TOKEN 或 GH_TOKEN 读，绝不出现在命令行里。
// 需要 repo 权限（classic PAT 的 repo scope，或 fine-grained 的 Contents: Read and write）。

import { readFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
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
const prerelease = has("prerelease");
const draft = has("draft");
const dryRun = has("dry-run");

// 附件默认自动发现 desktop/release/ 里的安装包、便携版 zip 与校验和。
// 刻意不按 tag 拼文件名：tag 命名（4E-NEXT-Desktop-V0.2.3B-beta.4）与产物命名
// （4E-NEXT-0.2.3-beta.4-...）本来就不是一回事，拼出来的路径对不上。
const releaseDir = join(dirname(fileURLToPath(import.meta.url)), "..", "release");

function discoverAssets() {
  if (!existsSync(releaseDir)) return [];
  const out = readdirSync(releaseDir)
    .filter((n) => /\.(exe|zip)$/i.test(n) && !/blockmap/i.test(n))
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
  console.error("[release] 没有找到任何附件。先执行 pack:portable 与 dist，或用 --assets 显式指定。");
  process.exit(1);
}

const body = notesFile ? readFileSync(notesFile, "utf8") : "";

console.log("[release] 仓库：" + repo);
console.log("[release] tag：" + tag);
console.log("[release] 标题：" + title);
console.log("[release] 预发布：" + prerelease + "  草稿：" + draft);
console.log("[release] 说明：" + (notesFile ? notesFile + "（" + body.length + " 字符）" : "（空）"));
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
      body: JSON.stringify({ tag_name: tag, name: title, body, prerelease, draft }),
    });
    if (!res.ok) {
      console.error("[release] 创建失败 HTTP " + res.status);
      console.error(await res.text());
      process.exit(1);
    }
    release = await res.json();
    console.log("[release] 已创建：" + release.html_url);
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

  console.log("\n[release] 完成：" + release.html_url);
}

await main();
