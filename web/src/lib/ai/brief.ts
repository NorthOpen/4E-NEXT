// AI 车卡：把角色卡压成一段「用户看得见的事实」喂给模型。
//
// 只给模型看它做决定真正需要的东西：已经选了什么、关键数值现状。
// 不给原始 Character JSON（字段太多、派生值会诱导模型去算数），也不给暂存/标记类字段。

import { ABILITY_KEYS, ABILITY_LABELS, abilityModifier, type Character } from "../../sheet/character";

export interface BriefContext {
  /** id → 名称（找不到时回落 id 本身） */
  nameOf: (id: string) => string | undefined;
}

function nm(id: string | undefined, ctx: BriefContext): string {
  if (!id) return "（未选）";
  return ctx.nameOf(id) ?? id;
}

function slotLine(ids: string[] | undefined, ctx: BriefContext): string {
  const picked = (ids ?? []).filter(Boolean);
  return picked.length ? picked.map((id) => nm(id, ctx)).join("、") : "（空）";
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
  lines.push("随意威能：" + slotLine(char.powerSlots?.atWill, ctx));
  lines.push("遭遇威能：" + slotLine(char.powerSlots?.encounter, ctx));
  lines.push("每日威能：" + slotLine(char.powerSlots?.daily, ctx));
  lines.push("辅助威能：" + slotLine(char.powerSlots?.utility, ctx));
  lines.push("专长：" + slotLine(char.featSlots, ctx));
  lines.push("典范之道：" + nm(char.paragonPathId, ctx) + "；传奇命运：" + nm(char.epicDestinyId, ctx));
  lines.push("装备：" + ((char.equipmentSlots ?? []).filter(Boolean).length) + " 件；仪式：" + ((char.ritualSlots ?? []).filter(Boolean).length) + " 项");

  return lines.join("\n");
}
