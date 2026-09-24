import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DATA_DIR, RAW_FILE, CANONICAL_DIR, OUT_DIR } from "./lib/paths.js";
import { runExtract } from "./etl/extract.js";
import { runClassify } from "./etl/classify.js";
import { runNormalize } from "./etl/normalize.js";
import { runIndex } from "./etl/index.js";
import { runAudit } from "./etl/audit.js";
import { findRulesSource, runRules } from "./etl/rules.js";
import { runMonsters } from "./etl/monsters/index.js";
import { exportMonsterMedia, findMonsterSource } from "./etl/monsters/extract.js";
import { runMonsterTiddlers } from "./etl/monsters/render.js";

function findSourceHtml(): string | undefined {
  if (!existsSync(DATA_DIR)) return undefined;
  const files = readdirSync(DATA_DIR).filter((f) => {
    const n = f.toLowerCase();
    return n.endsWith(".html") || n.endsWith(".htm");
  });
  return files[0] ? join(DATA_DIR, files[0]) : undefined;
}

async function cmdExtract(): Promise<void> {
  const src = findSourceHtml();
  if (!src) {
    console.error("[extract] 未找到源文件：请把单文件 HTML 维基放入 data/ 目录");
    process.exitCode = 1;
    return;
  }
  const sum = runExtract(src);
  console.log("[extract] 总 " + sum.total + " | 系统 " + sum.system + " | 内容 " + sum.content);
  console.log("[extract] 已写出: " + RAW_FILE);
}

async function cmdClassify(): Promise<void> {
  const counts = runClassify();
  console.log("[classify] 分类统计:");
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log("  " + v + "  " + k);
  }
}

async function cmdNormalize(): Promise<void> {
  const counts = runNormalize();
  console.log("[normalize] 已生成分类 JSON:");
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log("  " + v + "  " + k + ".json");
  }
  const meta = JSON.parse(readFileSync(join(CANONICAL_DIR, "_meta.json"), "utf8")) as {
    schemaVersion: number;
    generatedAt: string;
    initial: boolean;
    changes: { added: number; changed: number; removed: number };
    totals: { count: number; valid: number; invalid: number };
  };
  const c = meta.changes;
  console.log("[canonical] schemaVersion=" + meta.schemaVersion + " 生成于 " + meta.generatedAt);
  console.log("[canonical] " + (meta.initial ? "首次同步" : "增量同步")
    + " 新增 " + c.added + " / 更新 " + c.changed + " / 移除 " + c.removed);
  console.log("[canonical] 校验通过 " + meta.totals.valid + " 条 / 失败 " + meta.totals.invalid + " 条（全量 " + meta.totals.count + "）");
  console.log("[canonical] 已写出 out/canonical/*.jsonl + _meta.json + _changes.json");
}

async function cmdCommit(): Promise<void> {
  if (!existsSync(join(CANONICAL_DIR, "_meta.json"))) {
    console.error("[commit] 缺少 canonical 状态，请先运行 normalize");
    process.exitCode = 1;
    return;
  }
  const meta = JSON.parse(readFileSync(join(CANONICAL_DIR, "_meta.json"), "utf8")) as {
    initial: boolean;
    changes: { added: number; changed: number; removed: number };
  };
  const c = meta.changes;
  // 以「out/ 是否已被 git 跟踪」判定是否需要初始入库（Phase A 产物可能尚未入库）
  let untracked = false;
  try {
    untracked = execSync("git ls-files out/", { encoding: "utf8" }).trim().length === 0;
  } catch {
    untracked = true;
  }
  if (!untracked && c.added === 0 && c.changed === 0 && c.removed === 0) {
    console.log("[commit] 无内容变更，跳过提交");
    return;
  }
  execSync("git add out/", { stdio: "inherit" });
  const label = untracked || meta.initial
    ? "初始导入全部条目"
    : "+" + c.added + " ~" + c.changed + " -" + c.removed;
  execSync('git commit -m "sync: 4e wiki 数据快照 ' + label + '"', { stdio: "inherit" });
  console.log("[commit] 已提交: " + label);
}

async function cmdSync(): Promise<void> {
  await cmdNormalize();
  await cmdCommit();
}

async function cmdProfile(): Promise<void> {
  const { distributions, flags } = runAudit();
  console.log("[profile] 字段值分布（全量见 out/categories/_audit.json）:");
  for (const f of Object.keys(distributions)) {
    const entries = Object.entries(distributions[f]).sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 15).map(([k, v]) => k + "×" + v).join(", ");
    const more = entries.length > 15 ? " (+" + (entries.length - 15) + " 种)" : "";
    console.log("  [" + f + "] " + entries.length + " 种: " + top + more);
  }
  console.log("[profile] 未映射 usage 值: " + (flags.usage.join(", ") || "无"));
  console.log("[profile] 未映射 tier 值: " + (flags.tier.join(", ") || "无"));
}

async function cmdIndex(): Promise<void> {
  const r = runIndex();
  console.log("[index] manifest: " + r.manifest);
  console.log("[index] search-index: " + r.searchIndex);
  console.log("[index] relations: " + r.relations);
}

async function cmdRules(): Promise<void> {
  // 万律书源文件（单文件 TW5）不随仓库分发：没放源文件时保留已入库的 out/rules/rules.json，
  // 仅提示跳过，避免 pnpm all 整体失败。
  const src = findRulesSource();
  if (!src) {
    console.warn("[rules] 未找到万律书源文件（4e-rules.html），跳过词条化；沿用已入库的 out/rules/rules.json");
    return;
  }
  const r = runRules();
  console.log("[rules] 源文件: " + r.source);
  console.log("[rules] 词条 " + r.total + " 条（章节 " + r.chapters + " / 术语 " + r.terms + " / 问答 " + r.faq + "）");
  console.log("[rules] 已写出: " + r.output);
}

async function cmdMonsters(): Promise<void> {
  // 怪物手册源文件（44MB xlsx）不随仓库分发：没放源文件时保留已入库的 out/monsters/，
  // 仅提示跳过，避免 pnpm all 整体失败（与 rules 同一处理）。
  const src = findMonsterSource();
  if (!src) {
    console.warn("[monsters] 未找到怪物手册源文件（xlsx），跳过；沿用已入库的 out/monsters/");
    return;
  }
  const r = runMonsters({ source: src });
  const c = r.coverage;
  console.log("[monsters] 源文件: " + r.source);
  console.log("[monsters] 无损层 " + r.raw.rows + " 行 / 总表 " + r.raw.indexRows + " 条 / 目录 " + r.raw.tocEntries + " 章 / 图片锚点 " + r.raw.images);
  console.log("[monsters] 分块 " + r.blocks.sections + " 章 → " + r.blocks.blocks + " 个怪物块");
  console.log("[monsters] 规范层 " + r.total + " 条（校验通过 " + r.valid + " / 失败 " + r.invalid + "）");
  console.log("[monsters] " + (r.initial ? "首次同步" : "增量同步")
    + " 新增 " + r.changes.added + " / 更新 " + r.changes.changed + " / 移除 " + r.changes.removed);
  console.log("[monsters] 书归属 " + Object.entries(r.byBook).map(([k, v]) => k + "=" + v).join(" ") + "（未对齐目录的章节 " + c.sections.unmatched.length + "）");
  console.log("[monsters] 字段覆盖率: 等级 " + pct(c.fieldCoverage.level) + " / HP " + pct(c.fieldCoverage.hp) + " / AC " + pct(c.fieldCoverage.ac)
    + " / 威能 " + pct(c.fieldCoverage.powers) + " / 特性 " + pct(c.fieldCoverage.traits) + " / 图片 " + pct(c.fieldCoverage.image));
  console.log("[monsters] 威能 " + c.powers.totalPowers + " 条 + 特性 " + c.powers.totalTraits + " 条；无威能的条目 " + c.powers.entriesWithNoPower);
  console.log("[monsters] 已写出: " + r.files.canonical + " / " + r.files.categories);
  console.log("[monsters] 审计: " + r.files.audit);
}

async function cmdMonstersMedia(): Promise<void> {
  const src = findMonsterSource();
  if (!src) {
    console.error("[monsters:media] 未找到怪物手册源文件（xlsx）");
    process.exitCode = 1;
    return;
  }
  const dir = join(OUT_DIR, "monsters", "media");
  const r = exportMonsterMedia(src, dir);
  console.log("[monsters:media] 已导出 " + r.files + " 张插图（" + (r.bytes / 1048576).toFixed(1) + " MB）到 " + r.dir);
  console.log("[monsters:media] 该目录不入库，仅本地按需生成");
}

async function cmdMonstersTiddler(): Promise<void> {
  // 展示态导出：把规范层渲染成 4E Wiki 的 creature 词条（web 端生物卡零改动可渲染）
  const r = runMonsterTiddlers();
  console.log("[monsters:tiddler] 已导出 " + r.files + " 个 creature 词条到 " + r.dir);
  console.log("[monsters:tiddler] 分书: " + Object.entries(r.byBook).map(([k, v]) => k + "=" + v).join(" "));
  console.log("[monsters:tiddler] 形态：creature 数据块 + 字段自转写 + 官方动作图标宏，可被 web/src/lib/wikirender.ts 直接渲染");
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + "%";
}

async function cmdAll(): Promise<void> {
  await cmdExtract();
  await cmdClassify();
  await cmdNormalize();
  await cmdIndex();
  await cmdRules();
  await cmdMonsters();
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "all";
  const handlers: Record<string, () => Promise<void>> = {
    extract: cmdExtract,
    profile: cmdProfile,
    classify: cmdClassify,
    normalize: cmdNormalize,
    index: cmdIndex,
    rules: cmdRules,
    monsters: cmdMonsters,
    "monsters:media": cmdMonstersMedia,
    "monsters:tiddler": cmdMonstersTiddler,
    sync: cmdSync,
    commit: cmdCommit,
    all: cmdAll,
  };
  const h = handlers[cmd];
  if (!h) {
    console.error(
      "未知命令: " + cmd + "。用法: pnpm <extract|profile|classify|normalize|index|rules|monsters|monsters:media|monsters:tiddler|sync|commit|all>"
    );
    process.exitCode = 1;
    return;
  }
  await h();
}

void main();
