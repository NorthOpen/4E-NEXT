import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, readJsonl, writeJson, writeJsonCompact, writeJsonl } from "../../lib/io.js";
import {
  MONSTERS_AUDIT_DIR,
  MONSTERS_CANONICAL_DIR,
  MONSTERS_CATEGORIES_DIR,
  MONSTERS_INDEX_DIR,
} from "../../lib/paths.js";
import { MonsterEntrySchema, type MonsterEntry } from "../../schema/monster.js";
import { findMonsterSource, readMonsterWorkbook, writeMonsterRaw, type MonsterExtractSummary, type MonsterIndexRow } from "./extract.js";
import { buildMonsterBlocks, writeMonsterBlocks, type MonsterBlocksSummary } from "./segment.js";
import { assignIds, assignImages, buildMonsterEntry, parseHeaderLine, MONSTER_EXTRACTOR_VERSION } from "./parse.js";
import { renderCreatureText } from "./render.js";
import { buildCoverage, type MonsterCoverage } from "./audit.js";

/**
 * 怪物手册数据管线总编排：无损层 → 分块层 → 规范层 → 派生层 → 审计层。
 *
 * 与玩家资源管线的对应关系：
 *   out/monsters/raw/rows.jsonl        ←→ out/raw/tiddlers-raw.jsonl        （无损）
 *   out/monsters/blocks/blocks.jsonl   ←→ out/categories/_classification.json（切块/归类）
 *   out/monsters/canonical/monster.jsonl ←→ out/canonical/*.jsonl           （规范 + 增量同步）
 *   out/monsters/categories/monster.json ←→ out/categories/*.json           （前端加载）
 *   out/monsters/index/*               ←→ out/index/*                       （检索）
 *   out/monsters/audit/_coverage.json  ←→ out/categories/_audit.json        （审计）
 *
 * 增量同步沿用同一套做法：以 contentHash 判定条目是否变化，未变的条目原样沿用上一版对象，
 * 保证 git diff 干净、修订信息不丢；来源被删条目进 removed 清单。
 */

export const MONSTER_SCHEMA_VERSION = 1;

export interface MonsterChanges {
  added: string[];
  changed: string[];
  removed: string[];
}

export interface MonstersSummary {
  source: string;
  sourceSha256: string;
  raw: MonsterExtractSummary;
  blocks: MonsterBlocksSummary;
  total: number;
  valid: number;
  invalid: number;
  initial: boolean;
  changes: { added: number; changed: number; removed: number };
  byBook: Record<string, number>;
  files: {
    canonical: string;
    categories: string;
    index: string;
    manifest: string;
    audit: string;
  };
  coverage: MonsterCoverage;
}

function canonicalFile(): string {
  return join(MONSTERS_CANONICAL_DIR, "monster.jsonl");
}

/** 上一版规范层快照：{ id → 条目 }。空表示首次同步。 */
function loadPrevState(): Map<string, MonsterEntry> {
  const state = new Map<string, MonsterEntry>();
  const f = canonicalFile();
  if (!existsSync(f)) return state;
  for (const e of readJsonl<MonsterEntry>(f)) state.set(e.id, e);
  return state;
}

/**
 * 总表索引：同名可能有多行（总表本身有 18 例重名），全部保留，
 * 对齐时优先挑等级一致的那一行，否则取第一行——只取首行会把等级张冠李戴。
 */
function buildIndexLookup(indexRows: MonsterIndexRow[]): Map<string, MonsterIndexRow[]> {
  const m = new Map<string, MonsterIndexRow[]>();
  for (const r of indexRows) {
    const k = normName(r.name);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function pickIndexRow(cands: MonsterIndexRow[] | undefined, level: number | undefined): MonsterIndexRow | undefined {
  if (!cands || cands.length === 0) return undefined;
  if (level !== undefined) {
    const hit = cands.find((c) => c.level === level);
    if (hit) return hit;
  }
  return cands[0];
}

function normName(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[，,]/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .trim();
}

export interface RunMonstersOptions {
  /** 显式指定源文件（默认自动在仓库根目录与 data/ 里找带「怪物」的 xlsx） */
  source?: string;
}

export function runMonsters(opts: RunMonstersOptions = {}): MonstersSummary {
  const src = opts.source ?? findMonsterSource();
  if (!src) {
    throw new Error(
      "未找到怪物手册源文件：请把《DnD4E 怪物手册 1~3 合订本》xlsx 放在仓库根目录或 data/ 目录（文件名含「怪物」）"
    );
  }

  // —— 无损层 ——
  const wb = readMonsterWorkbook(src);
  const raw = writeMonsterRaw(wb);

  // —— 分块层 ——
  const seg = buildMonsterBlocks(wb.rows, wb.toc);
  const blocks = writeMonsterBlocks(seg);

  // —— 图片归属 ——
  const imageStats = assignImages(seg.blocks, wb.images);

  // —— 规范层 ——
  const lookup = buildIndexLookup(wb.index);
  const invalid: { id: string; errors: string[] }[] = [];
  const built: MonsterEntry[] = [];
  seg.blocks.forEach((block, i) => {
    // 用解析后的中文名（而不是整行名称行）去查总表，否则尾部会拖着「LV14 护卫」而永远对不上
    const header = parseHeaderLine(block.headerLine, block.subLine);
    const idxRow = pickIndexRow(lookup.get(normName(header.name)), header.level);
    built.push(buildMonsterEntry(block, idxRow, imageStats.byBlock.get(i)));
  });
  assignIds(built);
  built.sort((a, b) => a.provenance.rowStart - b.provenance.rowStart);

  const prev = loadPrevState();
  const initial = prev.size === 0;
  const changes: MonsterChanges = { added: [], changed: [], removed: [] };
  const canon: MonsterEntry[] = [];
  const nowIds = new Set<string>();

  for (const e of built) {
    nowIds.add(e.id);
    const prevEntry = prev.get(e.id);
    // 原文哈希与抽取器版本都没变 → 原样沿用上一版对象（字节稳定，git diff 干净）
    if (
      prevEntry &&
      prevEntry.provenance.contentHash === e.provenance.contentHash &&
      prevEntry.extractorVersion === String(MONSTER_EXTRACTOR_VERSION)
    ) {
      canon.push(prevEntry);
      continue;
    }
    const res = MonsterEntrySchema.safeParse(e);
    if (res.success) {
      canon.push(res.data as MonsterEntry);
      if (prevEntry) changes.changed.push(e.id);
      else changes.added.push(e.id);
    } else {
      invalid.push({ id: e.id, errors: res.error.errors.map((x) => "[" + x.path.join(".") + "] " + x.message) });
      canon.push(e);
    }
  }
  for (const pid of prev.keys()) if (!nowIds.has(pid)) changes.removed.push(pid);

  writeJsonl(canonicalFile(), canon);
  writeJson(join(MONSTERS_CANONICAL_DIR, "_meta.json"), {
    schemaVersion: MONSTER_SCHEMA_VERSION,
    extractorVersion: MONSTER_EXTRACTOR_VERSION,
    generatedAt: new Date().toISOString(),
    initial,
    source: { file: wb.source.file, sha256: wb.source.sha256, bytes: wb.source.bytes },
    changes: { added: changes.added.length, changed: changes.changed.length, removed: changes.removed.length },
    totals: { count: canon.length, valid: canon.length - invalid.length, invalid: invalid.length },
    books: seg.stats.books,
  });
  writeJson(join(MONSTERS_CANONICAL_DIR, "_changes.json"), {
    generatedAt: new Date().toISOString(),
    initial,
    ...(initial ? {} : changes),
  });

  // —— 派生层：前端加载的全量条目 ——
  ensureDir(MONSTERS_CATEGORIES_DIR);
  // 额外带一份 creatureText（4E Wiki 生物数据块形态）：前端直接用现成的 gen-creature-card
  // 样式渲染，不必在浏览器里把展示逻辑重写一遍（与 pnpm monsters:tiddler 同一套渲染器）。
  const categoriesFile = join(MONSTERS_CATEGORIES_DIR, "monster.json");
  writeJsonCompact(
    categoriesFile,
    canon.map((e) => ({ ...e, creatureText: renderCreatureText(e, { placeholders: false }) }))
  );

  // —— 检索索引 ——
  ensureDir(MONSTERS_INDEX_DIR);
  const searchEntries = canon.map((e) => ({
    id: e.id,
    name: e.name,
    nameEn: e.nameEn,
    book: e.book,
    section: e.section,
    level: e.level,
    rank: e.rank,
    role: e.role,
    origin: e.origin,
    creatureType: e.creatureType,
    creatureGroup: e.creatureGroup,
    xp: e.xp,
    hp: e.hp,
    ac: e.ac,
    tags: [e.rank, e.role, e.origin, e.creatureType, e.creatureGroup, e.section, e.book].filter(Boolean),
    text: [e.name, e.nameEn, e.section, e.book, e.rank, e.role, e.origin, e.creatureType, e.creatureGroup]
      .filter(Boolean)
      .join(" "),
  }));
  const indexFile = join(MONSTERS_INDEX_DIR, "monsters.json");
  writeJsonCompact(indexFile, searchEntries);

  const tally = (key: (e: MonsterEntry) => string | undefined): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const e of canon) {
      const k = key(e);
      if (!k) continue;
      m[k] = (m[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
  };
  const levelBucket = (lv: number | undefined): string | undefined => {
    if (lv === undefined) return undefined;
    if (lv <= 10) return "1-10";
    if (lv <= 20) return "11-20";
    if (lv <= 30) return "21-30";
    return "31+";
  };
  const manifestFile = join(MONSTERS_INDEX_DIR, "manifest.json");
  writeJson(manifestFile, {
    schemaVersion: MONSTER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: { file: wb.source.file, sha256: wb.source.sha256 },
    total: canon.length,
    byBook: tally((e) => e.book),
    byRank: tally((e) => e.rank),
    byRole: tally((e) => e.role),
    byOrigin: tally((e) => e.origin),
    byCreatureType: tally((e) => e.creatureType),
    byCreatureGroup: tally((e) => e.creatureGroup),
    byLevelBucket: tally((e) => levelBucket(e.level)),
    sections: seg.sections.map((s) => ({ title: s.title, book: s.book, matched: s.bookMatched, count: s.monsterCount })),
  });

  // —— 审计层 ——
  ensureDir(MONSTERS_AUDIT_DIR);
  const coverage = buildCoverage({ wb, seg, entries: canon, imageStats, invalid });
  const auditFile = join(MONSTERS_AUDIT_DIR, "_coverage.json");
  writeJson(auditFile, coverage);

  return {
    source: wb.source.file,
    sourceSha256: wb.source.sha256,
    raw,
    blocks,
    total: canon.length,
    valid: canon.length - invalid.length,
    invalid: invalid.length,
    initial,
    changes: {
      added: changes.added.length,
      changed: changes.changed.length,
      removed: changes.removed.length,
    },
    byBook: seg.stats.books,
    files: {
      canonical: canonicalFile(),
      categories: categoriesFile,
      index: indexFile,
      manifest: manifestFile,
      audit: auditFile,
    },
    coverage,
  };
}
