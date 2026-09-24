import {
  CATEGORY_FIELDS, CATEGORY_SECTIONS,
  powerFreqOf, powerKindOf, parsePowerBlocks, serializePowerBlocks,
  parsePowerDetails, POWER_TYPES,
} from "../homebrewSchema";
import type { CategorySpec, BuildResult } from "./types";
import { PowerCard } from "../../sheet/EntryCard";

/**
 * 威能 spec：已达标（结构化编辑器 + PowerCard），仅机械迁入。
 * build：再生频率 → usage 代码；威能类型 → powerKind；标签块 → details（官方 <table class=details> 同构）。
 */
export const powerSpec: CategorySpec = {
  key: "power",
  label: "威能",
  fields: CATEGORY_FIELDS.power,
  sections: CATEGORY_SECTIONS.power,
  editors: { powerBlocks: "powerBlocks" },
  withoutBody: true,
  build: ({ form }) => {
    const out: BuildResult = {};
    const freq = powerFreqOf(form.usageZh || "");
    if (freq) out.extras = { usage: freq.usage };
    const type = powerKindOf(form.powerType || "");
    if (type) out.extras = { ...(out.extras ?? {}), powerKind: type.powerKind };
    const blocks = parsePowerBlocks(form.powerBlocks);
    if (blocks && blocks.length) out.details = serializePowerBlocks(blocks);
    return out;
  },
  parse: (entry, form) => {
    // 标签块回填：数组优先；官方/旧条目 details HTML → 可编辑标签块
    if (Array.isArray(entry.powerBlocks) && entry.powerBlocks.length) {
      form.powerBlocks = JSON.stringify(entry.powerBlocks);
    } else if (entry.details) {
      const blocks = parsePowerDetails(entry.details);
      if (blocks?.length) form.powerBlocks = JSON.stringify(blocks);
    }
    // 再生频率缺省时按官方 usage/usageZh 反推（只有 随意/遭遇/每日 三值）
    if (!form.usageZh) {
      if (entry.usage === "at-will" || entry.usageZh === "随意") form.usageZh = "随意";
      else if (entry.usage === "encounter" || entry.usageZh === "遭遇") form.usageZh = "遭遇";
      else if (entry.usage === "daily" || entry.usageZh === "每日") form.usageZh = "每日";
    }
    // 威能类型：官方 powerType（如「邪术师攻击」）剥离授予者前缀，归一为 攻击/辅助/特殊
    const t = entry.powerType ?? "";
    const m = /^(.*?)(攻击|辅助|特殊|威能)$/.exec(t);
    const type = m?.[2] === "威能" ? "特殊" : m?.[2];
    if (type && POWER_TYPES.some((p) => p.label === type)) {
      form.powerType = type;
      if (!form.grantedBy && m?.[1]) form.grantedBy = m[1];
    } else if (entry.powerKind === "utility") form.powerType = "辅助";
    else if (entry.powerKind === "special") form.powerType = "特殊";
    else if (entry.powerKind === "attack") form.powerType = "攻击";
    // sourceText 若只是「<<power-format>>」等宏占位（剥掉宏后为空），清空以免正文区显示无意义代码
    if (form.sourceText && !form.sourceText.replace(/<<[^>]+>>/g, "").trim()) {
      form.sourceText = "";
    }
  },
  Preview: PowerCard,
};
