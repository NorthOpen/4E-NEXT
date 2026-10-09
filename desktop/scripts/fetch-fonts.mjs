// 把 Chiron 字体封进桌面版，离线可用。
//
// 源：ZeoSeven Fonts（https://fontsapi.zeoseven.com），也就是网页版正在用的同一个来源。
//     Chiron Sung HK VF / Chiron Hei HK VF 是 Tamcy 基于思源宋体/黑体改造的字体（OFL 1.1），
//     由 cn-font-split 按 unicode-range 切成大量小分片。
//
// 为什么直接用分片而不是单体 VF TTF：
//   分片形态下浏览器只下载「页面上真正出现过的字」所在的分片，首次启动不需要吞下整个中文字库；
//   这正是网页版一直在用的形态——桌面版沿用它，字形与网页版完全一致。
//
// 用法：node desktop/scripts/fetch-fonts.mjs [--force]
//   --force  重新拉 CSS 并重新下载全部分片
//   默认     CSS 来源指纹对不上时重拉 CSS，已存在的分片直接复用（可断点续跑）
// 产物：desktop/assets/fonts/{chiron.css, sung/*.woff2, hei/*.woff2}（不入库，见 .gitignore）

import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outRoot = join(here, "..", "assets", "fonts");
const CSS_OUT = join(outRoot, "chiron.css");
const force = process.argv.includes("--force");

// 改抓取逻辑时同步改这个指纹：对不上会自动重拉 CSS。
const SOURCE_ID = "zeoseven-chiron-v2";

const SOURCES = [
  { id: "546", slug: "sung", label: "Chiron Sung HK VF（衬线体，网页版 index.html 静态加载）" },
  { id: "547", slug: "hei", label: "Chiron Hei HK VF（无衬线体，网页版按 fontMode 动态加载）" },
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// 上游分片接口对突发并发很敏感：实测在 GitHub runner 上以 16 并发连打，会从第 400 个左右开始
// 回非标准的 **567**（限流），于是整条安卓发布流水线在「取内置字体」这一步直接失败——
// 单发请求同一时刻是 200，所以这不是源站挂了，而是被当成爬虫挡了。
//
// 两道处理：① 压低并发并在分片之间留间隔，把瞬时速率降到源站能接受的范围；
//          ② 单个分片退避重试（网络错误、408/429 与 5xx 都算可恢复）。
// 代价是这一步从数秒变成几分钟，比「发布发不出去」划算。
//
// 另：actions/cache 的字体缓存**按 ref 隔离**，tag 触发的运行读不到 main 上的缓存，
// 所以每次 tag 出包都是从零下 1055 个分片——这也是必须把这一步做稳的原因。
const CONCURRENCY = 2;
const PACE_MS = 400;
const ATTEMPTS = 5;
const MAX_CONSECUTIVE_FAILURES = 40;

let consecutiveFailures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带退避重试的 GET。上游限流用的 567 也落在 res.status >= 500 里，同样重试。 */
async function fetchWithRetry(url, label) {
  let last = "未知错误";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let retryable = true;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        consecutiveFailures = 0;
        return res;
      }
      last = "HTTP " + res.status;
      retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    } catch (e) {
      last = e.message;
    }
    consecutiveFailures++;
    // 整站都在拒绝时不要耗到步骤超时：连着 40 次失败就明确报错退出
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      throw new Error(
        "连续 " + consecutiveFailures + " 次请求失败（最后一次：" + last + "），判定为上游限流或不可用，中止：" + label,
      );
    }
    if (!retryable || attempt === ATTEMPTS) break;
    const wait = Math.min(30000, 2000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
    console.warn("[fetch-fonts]   " + last + "，第 " + attempt + " 次失败，" + wait + " ms 后重试");
    await sleep(wait);
  }
  throw new Error("下载失败 " + last + " " + label);
}

if (!force && existsSync(CSS_OUT)) {
  const head = readFileSync(CSS_OUT, "utf8").slice(0, 400);
  if (head.includes(SOURCE_ID)) {
    console.log("[fetch-fonts] 已存在且来源一致：" + CSS_OUT + "（加 --force 可重新抓）");
    process.exit(0);
  }
  console.log("[fetch-fonts] 来源指纹不匹配，重拉 CSS（已下载的分片会复用）。");
}
if (force) rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

/** 并发受限的 map，避免一次打上千个请求出去。 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const downloads = [];
const blocks = [];
/** 本次真正引用到的分片绝对路径，用于事后清理过期文件 */
const referenced = new Set();
let licenseLines = [];

for (const src of SOURCES) {
  const cssUrl = "https://fontsapi.zeoseven.com/" + src.id + "/main/result.css";
  console.log("[fetch-fonts] 拉取 " + src.label + " ...");
  let res;
  try {
    res = await fetchWithRetry(cssUrl, "result.css " + src.id);
  } catch (e) {
    console.error("[fetch-fonts] 失败：" + e.message + " " + cssUrl);
    process.exit(1);
  }
  const css = await res.text();

  // 开头那段注释是版权与授权声明（OFL 1.1），必须随字体一起保留。
  // 注意：要把它的 /* 和 */ 一起去掉——原样嵌进我们自己的注释里，它的 */ 会提前闭合外层注释，
  // 后面整段会变成非法 CSS。
  if (licenseLines.length === 0) {
    const end = css.indexOf("*/");
    if (end > 0) {
      licenseLines = css
        .slice(0, end)
        .replace(/^\s*\/\*\s*/, "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    }
  }

  const found = css.match(/@font-face\{[^}]*\}/g) || [];
  if (found.length === 0) {
    console.error("[fetch-fonts] " + src.id + " 里没找到 @font-face，源可能变了。");
    process.exit(1);
  }

  mkdirSync(join(outRoot, src.slug), { recursive: true });

  // 只取 @font-face 块：万一上游以后加了全局 body 字体规则，静态引入会盖掉 html[data-font] 的切换逻辑。
  let local = 0;
  const rewritten = found.map((block) =>
    block.replace(/url\(\s*["']?\.?\/?([^"')]+\.woff2)["']?\s*\)/g, (_m, file) => {
      const name = file.split("/").pop();
      const dest = join(outRoot, src.slug, name);
      referenced.add(dest);
      downloads.push({ url: new URL("./" + name, cssUrl).toString(), dest });
      local++;
      return 'url("./' + src.slug + "/" + name + '")';
    }),
  );

  const fams = [...new Set([...css.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1].trim()))];
  console.log("[fetch-fonts]   " + found.length + " 个分片，族名 " + JSON.stringify(fams));
  if (local !== found.length) {
    console.error("[fetch-fonts] 有 " + (found.length - local) + " 个 @font-face 没解析出 woff2 路径，源格式可能变了。");
    process.exit(1);
  }
  blocks.push("/* ===== " + src.label + "：" + found.length + " 个 unicode-range 分片 ===== */");
  blocks.push(...rewritten);
  blocks.push("");
}

const todo = force ? downloads : downloads.filter((d) => !existsSync(d.dest) || statSync(d.dest).size === 0);
console.log("[fetch-fonts] 分片共 " + downloads.length + " 个，本次需要下载 " + todo.length + " 个 ...");

let done = 0;
let bytes = 0;
await mapLimit(todo, CONCURRENCY, async (item) => {
  const res = await fetchWithRetry(item.url, item.url);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(item.dest, buf);
  done++;
  if (done % 200 === 0) console.log("[fetch-fonts]   " + done + "/" + todo.length);
  await sleep(PACE_MS);
});
for (const d of downloads) if (existsSync(d.dest)) bytes += statSync(d.dest).size;

// 清理过期分片（上游改了切片方式时，旧文件不该留在产物里白占体积）
let stale = 0;
for (const src of SOURCES) {
  const dir = join(outRoot, src.slug);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!referenced.has(p)) {
      rmSync(p, { force: true });
      stale++;
    }
  }
}
if (stale > 0) console.log("[fetch-fonts] 清理过期分片 " + stale + " 个");

const header = [
  "/* 4E NEXT 桌面版内置字体（由 desktop/scripts/fetch-fonts.mjs 生成，请勿手改）",
  " * 来源指纹：" + SOURCE_ID,
  " * 来源：ZeoSeven Fonts（https://zeoseven.com）—— 与网页版同一来源，字形完全一致",
  " * 由 cn-font-split 按 unicode-range 切成小分片：浏览器只下载页面上真正用到的字所在的分片",
  " *",
  ...licenseLines.map((l) => " * " + l),
  " */",
  "",
].join("\n");

writeFileSync(CSS_OUT, header + blocks.join("\n"), "utf8");
console.log(
  "[fetch-fonts] 完成：" + downloads.length + " 个分片，" + (bytes / 1048576).toFixed(1) + " MB；CSS " + CSS_OUT,
);
