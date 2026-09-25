// AI 车卡：把角色卡压成一段「用户看得见的事实」喂给模型。
//
// 只给模型看它做决定真正需要的东西：已经选了什么、关键数值现状。
// 不给原始 Character JSON（字段太多、派生值会诱导模型去算数），也不给暂存/标记类字段。

import { ABILITY_KEYS, ABILITY_LABELS, abilityModifier, type Character } from "../../sheet/character";
import { featSlotTier, powerSlotLevels } from "../../sheet/candidates";
import { LEVELS } from "../../sheet/leveling";

export interface BriefContext {
  /** id → 名称（找不到时回落 id 本身） */
  nameOf: (id: string) => string | undefined;
}

function nm(id: string | undefined, ctx: BriefContext): string {
  if (!id) return "（未选）";
  return ctx.nameOf(id) ?? id;
}

/** 槽位等级的文字（数字级 / 典范 / 传奇） */
function slotLevelText(lv: number | "paragon" | "legendary"): string {
  return typeof lv === "number" ? lv + "级" : lv === "paragon" ? "典范" : "传奇";
}

/**
 * 某一类威能按「槽位等级 + 已选」列出来。
 * 为什么带上等级：模型要能看出这张卡还空着哪些格子、它们各是什么等级，
 * 才会从整张卡的构筑出发做取舍，而不是只盯着当前这一格反复挑同一个。
 */
function powerSlotLine(cat: "atWill" | "encounter" | "daily" | "utility", char: Character, ctx: BriefContext): string {
  const slots = char.powerSlots?.[cat] ?? [];
  const levels = powerSlotLevels(cat, Math.max(1, Math.min(30, char.level || 1)));
  const parts = levels.map((lv, i) => {
    const id = slots[i];
    return slotLevelText(lv) + " " + (id ? nm(id, ctx) : "（空）");
  });
  return parts.length ? parts.join(" ｜ ") : "（无槽位）";
}

/** 卡片摘要：模型据此判断「还缺什么、现在的风格是什么」。 */
export function cardBrief(char: Character, ctx: BriefContext): string {
  const lines: string[] = [];

  const cls = [nm(char.classId, ctx), char.classId2 ? nm(char.classId2, ctx) : ""].filter(Boolean).join(" / ");
  const kind = char.hybrid ? "（混职）" : "";
  lines.push("角色：" + (char.name || "（未命名）") + "，" + char.level + " 级，" + nm(char.raceId, ctx) + " " + cls + kind);

  const abil = ABILITY_KEYS.map((k) => {
    const v = char.abilities?.[k] ?? 10;
    const m = abilityModifier(v);
    return ABILITY_LABELS[k].zh + " " + v + "(" + (m >= 0 ? "+" + m : String(m)) + ")";
  }).join("  ");
  lines.push("属性：" + abil);

  lines.push("受训技能：" + (char.trainedSkills.length ? char.trainedSkills.join("、") : "（空）"));
  lines.push("随意威能：" + powerSlotLine("atWill", char, ctx));
  lines.push("遭遇威能：" + powerSlotLine("encounter", char, ctx));
  lines.push("每日威能：" + powerSlotLine("daily", char, ctx));
  lines.push("辅助威能：" + powerSlotLine("utility", char, ctx));
  // 专长槽位数来自升级表（空卡上 featSlots 还是空的，不能只看数组长度）
  const featCount = LEVELS[Math.max(1, Math.min(30, char.level || 1)) - 1]?.feats ?? 0;
  const featParts: string[] = [];
  for (let i = 0; i < featCount; i++) {
    const id = char.featSlots?.[i];
    // 带上该槽位应挑的阶层（英雄/典范/传奇）：槽位是哪一级获得的就属哪个阶层
    featParts.push("专长" + (i + 1) + "[" + featSlotTier(i, char.level) + "] " + (id ? nm(id, ctx) : "（空）"));
  }
  lines.push("专长：" + (featParts.length ? featParts.join(" ｜ ") : "（无槽位）"));
  lines.push("典范之道：" + nm(char.paragonPathId, ctx) + "；传奇命运：" + nm(char.epicDestinyId, ctx));
  lines.push("装备：" + ((char.equipmentSlots ?? []).filter(Boolean).length) + " 件；仪式：" + ((char.ritualSlots ?? []).filter(Boolean).length) + " 项");
  lines.push("※ 同一张卡不能重复选同一个威能 / 专长：已经在本卡上的条目不会再出现在候选列表里。");

  return lines.join("\n");
}
