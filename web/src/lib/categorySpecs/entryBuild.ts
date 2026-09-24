import type { Entry } from "../../data/types";
import {
  fieldsFor, CATEGORY_FIELDS, APPEARANCE_FIELDS, WITHOUT_BODY, POWER_REF_CATEGORIES,
  splitTags, detectBodyFormat, renderBody,
  parsePowerBlocks, serializePowerBlocks,
  serializeItemSet, parseSetBonuses, parseSetBonusesJson, serializeTerms, parseTerms,
  parseLevelSectionsJson, serializeLevelSections, parseLevelSections,
  serializeRitualInfo, parseRitualInfo,
  parseCreatureBlockJson, serializeCreatureBlock, parseCreatureBlock,
  sectionBetweenWiki, extractLinks,
} from "../homebrewSchema";
import { specFor } from "./index";

/**
 * buildEntry / draftToForm 从 homebrewSchema 迁出至此，
 * 统一改为「spec 查表 + legacy 分支」结构（避免 homebrewSchema 反向依赖 categorySpecs 造成循环）。
 * - buildEntry：收集 extras → spec.build?.()（结构化派生）→ 未登记类别的 legacy 派生 → details 派生
 * - draftToForm：基础填充 → CATEGORY_FIELDS 标量 → spec.parse?.()（结构化回填）→ legacy 分支 → 外观字段
 */

/** 结构化编辑的 JSON form 键（存编辑态，不落库为标量；由 spec.build 派生 entry 字段） */
const STRUCTURED_KEYS = new Set([
  "powerSections", "properties", "featRows", "setBonuses", "termsPairs",
  "levelSections", "creatureBlock", "raceTraits", "startingPower", "loreSections", "raceAuxPowers",
]);

// 以便在空类型/空名称时也能构造出供骨架占位预览的 entry。
export function buildEntry(
  form: Record<string, string>,
  existingId?: string,
  opts?: { allowEmpty?: boolean },
): { ok: true; entry: Entry } | { ok: false; error: string } {
  const name = (form.name ?? "").trim();
  const cat = (form.category ?? "").trim();
  if (!opts?.allowEmpty) {
    if (!name) return { ok: false, error: "请填写名称" };
    if (!cat) return { ok: false, error: "请选择分类" };
  }

  const extras: Record<string, string> = {};
  for (const f of fieldsFor(cat)) {
    const v = (form[f.key] ?? "").trim();
    if (f.type === "tags" || f.key === "name" || f.key === "nameEn" || f.key === "category" || f.key === "source" || f.key === "sourceText" || f.key === "powerBlocks" || STRUCTURED_KEYS.has(f.key) || !v) continue;
    extras[f.key] = v;
  }
  for (const f of CATEGORY_FIELDS[cat] ?? []) {
    const v = (form[f.key] ?? "").trim();
    if (v && f.key !== "powerBlocks" && !STRUCTURED_KEYS.has(f.key)) extras[f.key] = v;
  }

  const bodyFormat: "md" | "wiki" = form.bodyFormat === "wiki" ? "wiki" : "md";
  let sourceText = form.sourceText ?? "";

  // —— spec 钩子：结构化派生（power/equipment/feat/race 已实现；未登记类别缺省跳过）——
  const spec = specFor(cat);
  let specDetails: string | undefined;
  if (spec.build) {
    const r = spec.build({ cat, form, extras, sourceText, bodyFormat });
    if (r.sourceText !== undefined) sourceText = r.sourceText;
    if (r.extras) Object.assign(extras, r.extras);
    if (r.details) specDetails = r.details;
  }

  // —— 未登记类别的 legacy 派生 ——
  // 物品套装：知识/组成/增益 → sourceText（wiki 章节）
  if (cat === "item-set") {
    const components = (form.setComponents ?? "").split(/[，,、]/).map((s) => s.trim()).filter(Boolean);
    const bonuses = parseSetBonusesJson(form.setBonuses);
    sourceText = serializeItemSet(form.setKnowledge ?? "", components, bonuses);
  }
  // 译名字典：词条对 → sourceText / terms
  if (cat === "dictionary") {
    const pairs = parseTerms(form.termsPairs ?? "");
    sourceText = serializeTerms(pairs);
    if (pairs.length) extras.terms = pairs.map(([e, z]) => `${e}: ${z}`).join("\n");
  }
  // 威能引用类：提供「等级特性小节」结构化编辑，但**不隐藏正文**——lore 类正文仍需 textarea 承载。
  // 仅当用户填写了 levelSections 时才用结构化结果覆盖 sourceText，否则保留手写正文。
  if (POWER_REF_CATEGORIES.has(cat)) {
    const secs = parseLevelSectionsJson(form.levelSections, { allowPlain: true });
    if (secs.length) {
      let body = serializeLevelSections(secs);
      // 典范之道/传奇天命：正文以「前提条件：{{!!prerequisite}}」模板开头
      if ((cat === "paragon-path" || cat === "epic-destiny") && body) {
        body = `前提条件：{{!!prerequisite}}\n${body}`;
      }
      sourceText = body;
    }
  }

  // 威能结构化「标签块」：保留数组供回填（details 已由 power spec 派生）
  const powerBlocks = cat === "power" ? parsePowerBlocks(form.powerBlocks) : null;

  let details: string | undefined;
  if (specDetails !== undefined) {
    details = specDetails;
  } else if (cat === "ritual") {
    // 仪式：头部六行(div.ritualinfo) + 效果正文（对齐官方仪式卡布局）
    const header = serializeRitualInfo({
      ritualLevel: form.ritualLevel ?? "",
      ritualCategory: form.ritualCategory ?? "",
      time: form.time ?? "",
      cost: form.cost ?? "",
      marketPrice: form.marketPrice ?? "",
      keySkill: form.keySkill ?? "",
    });
    const effect = sourceText ? renderBody(sourceText, bodyFormat, extras) : "";
    details = header || effect ? (header ? header + (effect ? "\n" + effect : "") : effect) : undefined;
  } else if (cat === "creature") {
    // 生物：数据块(structured) 追加到 lore 正文之后（details 优先于 sourceText 被卡片渲染）
    const lore = sourceText ? renderBody(sourceText, bodyFormat, extras) : "";
    const blk = parseCreatureBlockJson(form.creatureBlock);
    const blockHtml = blk ? serializeCreatureBlock(blk) : "";
    details = lore || blockHtml ? [lore, blockHtml].filter(Boolean).join("\n") : undefined;
  } else if (!WITHOUT_BODY.has(cat)) {
    if (powerBlocks && powerBlocks.length) {
      details = serializePowerBlocks(powerBlocks);
    } else {
      details = sourceText ? renderBody(sourceText, bodyFormat, extras) : undefined;
    }
  }

  const entry: Entry = {
    id: existingId?.trim() || name,
    name,
    nameEn: (form.nameEn ?? "").trim() || undefined,
    category: cat,
    tags: splitTags(form.tags ?? ""),
    origin: "user",
    source: (form.source ?? "").trim() || (opts?.allowEmpty ? "" : "私设"),
    sourceText,
    bodyFormat,
    fields: extras,
    wiki: { transclusions: [], links: [], macros: [], headings: [] },
    ...(powerBlocks && powerBlocks.length ? { powerBlocks } : {}),
    details,
    ...extras,
  };
  return { ok: true, entry };
}

export function draftToForm(entry: Entry): Record<string, string> {
  const form: Record<string, string> = {
    name: entry.name ?? "",
    nameEn: entry.nameEn ?? "",
    category: entry.category ?? "",
    tags: (entry.tags ?? []).join(", "),
    source: entry.source ?? "",
    sourceText: entry.sourceText ?? "",
    bodyFormat: detectBodyFormat(entry),
  };
  for (const f of CATEGORY_FIELDS[entry.category] ?? []) {
    const v = (entry as Record<string, unknown>)[f.key];
    form[f.key] = typeof v === "string" ? v : "";
  }
  // —— spec 钩子：结构化编辑回填（power/equipment/feat/race）——
  const spec = specFor(entry.category);
  spec.parse?.(entry, form);

  // —— 未登记类别的 legacy 回填 ——
  // 物品套装：sourceText 的知识/组成/增益三节 → 三个字段
  if (entry.category === "item-set") {
    const parsed = parseSetBonuses(entry.sourceText ?? "");
    form.setKnowledge = parsed.knowledge;
    form.setBonuses = JSON.stringify(parsed.setBonus);
    form.setComponents = extractLinks(sectionBetweenWiki(entry.sourceText ?? "", "套装组成", "套装增益")).join("，");
  }
  // 译名字典：terms/sourceText 的「英: 中」行 → termsPairs
  if (entry.category === "dictionary") {
    const src = (typeof entry.terms === "object" && entry.terms ? Object.entries(entry.terms).map(([e, z]) => `${e}: ${z}`).join("\n") : "") || entry.sourceText || "";
    form.termsPairs = parseTerms(src).map(([e, z]) => `${e}: ${z}`).join("\n");
  }
  // 仪式：从 details/sourceText 的 ritualinfo 反推缺失的头部字段（time/cost/marketPrice）
  if (entry.category === "ritual") {
    if (!form.time || !form.cost || !form.marketPrice) {
      const h = parseRitualInfo(
        ((entry as Record<string, unknown>).details as string) || entry.sourceText || "",
        { ritualLevel: form.ritualLevel, ritualCategory: form.ritualCategory, time: form.time, cost: form.cost, marketPrice: form.marketPrice, keySkill: String(form.keySkill ?? "") },
      );
      if (h.time) form.time = h.time;
      if (h.cost) form.cost = h.cost;
      if (h.marketPrice) form.marketPrice = h.marketPrice;
    }
  }
  // 生物：details/sourceText 中的 div.creature 数据块 → creatureBlock（结构化）；并从 sourceText 剥离数据块
  if (entry.category === "creature") {
    const full = ((entry as Record<string, unknown>).details as string) || entry.sourceText || "";
    const blk = parseCreatureBlock(full);
    if (blk) form.creatureBlock = JSON.stringify(blk);
    const lore = (form.sourceText ?? "").replace(/<div class="?creature"?>[\s\S]*?<\/div>/i, "").replace(/\n{3,}/g, "\n\n").trim();
    form.sourceText = lore;
  }
  // 威能引用类：正文（或 details 兜底）→ 等级特性小节；剥离「前提条件：{{!!prerequisite}}」首行
  if (POWER_REF_CATEGORIES.has(entry.category)) {
    let src = entry.sourceText || "";
    if ((entry.category === "paragon-path" || entry.category === "epic-destiny") && !src) {
      src = (entry as Record<string, unknown>).details as string || "";
    }
    const stripped = src.replace(/^前提条件：\{\{!!prerequisite\}\}(\r?\n)?/, "");
    const secs = parseLevelSections(stripped, { allowPlain: true });
    if (secs.length) form.levelSections = JSON.stringify(secs);
  }

  for (const f of APPEARANCE_FIELDS) {
    const v = (entry as Record<string, unknown>)[f.key];
    form[f.key] = typeof v === "string" ? v : "";
  }
  return form;
}
