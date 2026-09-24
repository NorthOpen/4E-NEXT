import { GenericCard } from "../../sheet/EntryCard";
import { CATEGORY_LABELS } from "../../data/labels";
import { CATEGORY_FIELDS, genericSections } from "../homebrewSchema";
import type { CategorySpec } from "./types";
import { powerSpec } from "./power";
import { equipmentSpec } from "./equipment";
import { featSpec } from "./feat";
import { raceSpec } from "./race";

/**
 * 类别 spec 注册表：已实现自包含模块的类别在此登记。
 * 未登记的类别（vice/virtue/reference/item-set/ritual/dictionary 等 15 类）
 * 走 genericSpec 兜底，行为与通用实现一致，后续逐类独立实现。
 */
export const CATEGORY_SPECS: Record<string, CategorySpec> = {
  [powerSpec.key]: powerSpec,
  [equipmentSpec.key]: equipmentSpec,
  [featSpec.key]: featSpec,
  [raceSpec.key]: raceSpec,
};

/** 通用兜底 spec：无专属字段/分区/编辑器，预览用 GenericCard（风味默认开启）。 */
export function genericSpec(cat: string): CategorySpec {
  // 类别自带独立「风味文本」字段（如仪式）时，风味区的占位与跳转都指向该字段；
  // 否则按惯例风味写在正文里，占位文案提示「写入正文」。
  const hasFlavorField = (CATEGORY_FIELDS[cat] ?? []).some((f) => f.key === "flavorText");
  return {
    key: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    fields: [],
    sections: genericSections(CATEGORY_LABELS[cat] ?? cat),
    Preview: (p) => GenericCard({ entry: p.entry, frame: p.frame, jump: p.jump, flavorTarget: hasFlavorField ? "flavorText" : "sourceText" }),
  };
}

/** 按类别取 spec：未登记 → genericSpec 兜底（永不抛错）。 */
export function specFor(cat: string): CategorySpec {
  return CATEGORY_SPECS[cat] ?? genericSpec(cat);
}
