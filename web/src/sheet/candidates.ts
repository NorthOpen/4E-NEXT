// AI 车卡：候选层（纯函数）。
//
// 这里是「AI 看到的候选 = 用户看到的候选」的结构保证：
//   · 槽位等级由升级表推导（powerSlotLevels，原先私有在 CharacterSheet 内部）
//   · 职业/种族授予的威能 id 集合（classPowerIds / racePowerIds，原先散在三个选择器里各写一遍）
//   · 候选集合 = 选择器默认视图的同一条筛选链
// 选择器与 AI 共用这些函数：任何一侧改了规则，另一侧自动跟随，不会出现「AI 选得出、用户点不到」。
//
// 注意：专长前提（prerequisite）在这里**刻意不校验** —— 现有 UI 也不校验，
// 前提只是显示给用户读的一段文字。AI 与用户对等：读原文自行判断。

import type { Entry } from "../data/types";
import { powerCategory, type PowerCategoryKey } from "../lib/colors";
import {
  ABILITY_KEYS,
  baseClassName,
  buyPointsUsed,
  DAILY_SLOT_LEVELS,
  ENCOUNTER_SLOT_LEVELS,
  LEGENDARY_SLOT_LEVEL,
  PARAGON_SLOT_LEVELS,
  UTILITY_SLOT_LEVELS,
  type Character,
  type PowerSlots,
  type SlotLevel,
} from "./character";
import { abilityBoostCounts, LEVELS } from "./leveling";

/** relations.json 的形状（职业/种族 → 授予的威能 id） */
export interface Relations {
  powerByGrantedBy: Record<string, string[]>;
}

function lv(e: Entry): number {
  return parseInt(String(e.level ?? "0"), 10) || 0;
}

// —— 槽位等级：由升级表推导 ——

/**
 * 由升级表推导各「等级槽位」应填充的威能等级。
 * 遭遇/每日最多 3 个不同等级（取 3 个最近获得的等级）+ 1 个典范槽位；辅助逐个递增（2/6/10/…）再加典范/传奇。
 * 返回数组第 i 项 = 第 i 个该类别威能空位的标签等级（"paragon"/"legendary" 为无等级数字的典范/传奇槽位）。
 */
export function powerSlotLevels(cat: "atWill" | "encounter" | "daily" | "utility", level: number): SlotLevel[] {
  if (cat === "atWill") return [1, 1];
  const points = cat === "encounter" ? ENCOUNTER_SLOT_LEVELS : cat === "daily" ? DAILY_SLOT_LEVELS : UTILITY_SLOT_LEVELS;
  const leveled = points.filter((p) => p <= level).reverse(); // 从高到低
  let arr: SlotLevel[] = cat === "utility" ? leveled : leveled.slice(0, 3); // 遭遇/每日最多 3 个不同等级
  if (cat === "encounter" && level >= PARAGON_SLOT_LEVELS.encounter) arr = ["paragon", ...arr];
  if (cat === "daily" && level >= PARAGON_SLOT_LEVELS.daily) arr = ["paragon", ...arr];
  if (cat === "utility") {
    if (level >= PARAGON_SLOT_LEVELS.utility) arr = ["paragon", ...arr];
    if (level >= LEGENDARY_SLOT_LEVEL) arr = ["legendary", ...arr];
  }
  return arr;
}

// 注意：候选的等级上限是**角色等级**，不是槽位标签等级。
// 人物页的槽位选择器默认就是「当前及以下」（PowerSlotPicker 的 levelMode="current"，
// fixedLevel 只用来标注典范/传奇槽位），槽位上的数字只是「这一格是升级表哪一步给的」的说明。
// 这里若按槽位等级卡死，就会出现「AI 选得出、用户点不到」的不对等 —— 与专长前提同理。

// —— 来源集合：职业 / 种族授予的威能 ——

/** 职业授予的威能 id 集合（混职时合并两个职业；都为空的职业名/全名/id 三种键都查）。 */
export function classPowerIds(classes: (Entry | undefined)[], relations: Relations): Set<string> | null {
  const list = classes.filter((x): x is Entry => !!x);
  if (list.length === 0) return null;
  const ids = new Set<string>();
  for (const ce of list) {
    for (const key of [baseClassName(ce.name), ce.name, ce.id]) {
      for (const id of relations.powerByGrantedBy[key] ?? []) ids.add(id);
    }
  }
  return ids;
}

/** 种族授予的威能 id 集合（转写链接 + 授予表两处来源）。 */
export function racePowerIds(race: Entry | undefined, relations: Relations): Set<string> | null {
  if (!race) return null;
  const ids = new Set<string>(race.wiki.transclusions);
  for (const id of relations.powerByGrantedBy[race.name] ?? []) ids.add(id);
  return ids;
}

// —— 候选集合 ——

export interface PowerQuery {
  entries: Entry[];
  relations: Relations;
  classes?: (Entry | undefined)[];
  race?: Entry;
  category: PowerCategoryKey;
  /** 等级上限（通常 = 该槽位的等级上限） */
  maxLevel: number;
}

/**
 * 某一类威能在某槽位下的合法候选。
 * 与 PowerSlotPicker 的默认视图同源：类别 → 等级 ≤ 上限 → 来源（职业/种族授予）。
 */
export function powerCandidates(q: PowerQuery): Entry[] {
  const classIds = classPowerIds(q.classes ?? [], q.relations);
  const raceIds = racePowerIds(q.race, q.relations);
  const wantClass = !!classIds;
  const wantRace = !!raceIds;
  return q.entries
    .filter((p) => {
      if (powerCategory(p.usage, p.powerKind) !== q.category) return false;
      if (lv(p) > q.maxLevel) return false;
      const inClass = classIds ? classIds.has(p.id) : false;
      const inRace = raceIds ? raceIds.has(p.id) : false;
      if (wantClass && wantRace && !inClass && !inRace) return false;
      if (wantClass && !wantRace && !inClass) return false;
      if (!wantClass && wantRace && !inRace) return false;
      return true;
    })
    .sort((a, b) => lv(a) - lv(b));
}

/** 专长阶层（与 FeatSlotPicker 的默认阶层一致）。 */
export function featTierOf(level: number): "英雄" | "典范" | "传奇" {
  if (level <= 10) return "英雄";
  if (level <= 20) return "典范";
  return "传奇";
}

/** 某一阶层的专长候选（不校验前提，与 UI 对等）。 */
export function featCandidates(entries: Entry[], tier: string): Entry[] {
  return entries.filter((f) => !tier || f.tierZh === tier);
}

// —— 决策清单 ——

export type DecisionKind = "abilities" | "race" | "class" | "skills" | "power" | "feat" | "paragon" | "epic" | "equipment" | "ritual";

export interface Decision {
  /** 稳定标识，如 power:encounter:0 / feat:2 / race */
  id: string;
  kind: DecisionKind;
  label: string;
  /** empty = 还没有选；filled = 已选（可以在改卡模式里替换） */
  status: "empty" | "filled";
  /** 已选内容（id 或名称） */
  current?: string;
  /** 威能槽位等级（决定候选的等级上限） */
  slotLevel?: SlotLevel;
  slotIndex?: number;
  slotCat?: keyof PowerSlots;
  detail?: string;
}

const POWER_SLOT_LABEL: Record<keyof PowerSlots, string> = {
  atWill: "随意威能",
  encounter: "遭遇威能",
  daily: "每日威能",
  utility: "辅助威能",
  special: "种族/职业威能",
};

const SLOT_ORDER: (keyof PowerSlots)[] = ["atWill", "encounter", "daily", "utility"];

/**
 * 当前卡（或目标等级下的一张新卡）还差哪些决定。
 *
 * 只做「该有什么」的推导，不做合法性判断 —— 合法性由升级表与槽位常量本身保证。
 *
 * 顺序：种族 → 职业 → 属性 → 典范 → 传奇 → 受训技能 → 威能 → 专长 → 装备 → 仪式。
 * 主题不在其中：它不进 AI 的候选，也不出现在清单里，玩家在人物页自行挑选。
 */
export function decisionList(char: Character, opts: { targetLevel?: number } = {}): Decision[] {
  const level = Math.max(1, Math.min(30, opts.targetLevel ?? char.level ?? 1));
  const out: Decision[] = [];

  out.push({
    id: "race",
    kind: "race",
    label: "种族",
    status: char.raceId ? "filled" : "empty",
    current: char.raceId,
  });
  out.push({
    id: "class",
    kind: "class",
    label: char.hybrid ? "职业（混职）" : "职业",
    status: char.classId ? "filled" : "empty",
    current: char.classId,
  });

  // 属性排在种族/职业之后：分配时要用到种族加值与职业定位，提示词里会一并给出。
  // 说明文字不再显示「已用 N/22」——升级提升也写进同一份 abilities 里，N 会超过 22 而显得像出错；
  // 改成列当前值 + 本等级应有的升级提升点数。
  const points = buyPointsUsed(char.abilities);
  const boost = abilityBoostCounts(level);
  const boostTotal = boost.twoPlus * 2 + boost.allPlus * 6;
  const curAbil = ABILITY_KEYS.map((k) => char.abilities?.[k] ?? 10).join("/");
  out.push({
    id: "abilities",
    kind: "abilities",
    label: "属性分配（22 点购买）",
    status: points > 0 ? "filled" : "empty",
    detail: "当前 " + curAbil + (boostTotal ? " · 升级提升 " + boostTotal + " 点" : ""),
  });

  // 主题不在 AI 车卡范围内（玩家自行在人物页挑选），因此这里不产生主题决策项

  if (level >= 11) {
    out.push({
      id: "paragon",
      kind: "paragon",
      label: "典范之道",
      status: char.paragonPathId ? "filled" : "empty",
      current: char.paragonPathId,
    });
  }
  if (level >= 21) {
    out.push({
      id: "epic",
      kind: "epic",
      label: "传奇命运",
      status: char.epicDestinyId ? "filled" : "empty",
      current: char.epicDestinyId,
    });
  }

  out.push({
    id: "skills",
    kind: "skills",
    label: "受训技能",
    status: char.trainedSkills.length > 0 ? "filled" : "empty",
    detail: "已选 " + char.trainedSkills.length + " 项",
  });

  for (const cat of SLOT_ORDER) {
    const levels = powerSlotLevels(cat as "atWill", level);
    for (let i = 0; i < levels.length; i++) {
      const slot = levels[i];
      const cur = char.powerSlots?.[cat]?.[i];
      out.push({
        id: "power:" + cat + ":" + i,
        kind: "power",
        label:
          POWER_SLOT_LABEL[cat] +
          (typeof slot === "number" ? "（" + slot + " 级槽位）" : slot === "paragon" ? "（典范槽位）" : "（传奇槽位）"),
        status: cur ? "filled" : "empty",
        current: cur,
        slotLevel: slot,
        slotIndex: i,
        slotCat: cat,
      });
    }
  }

  const info = LEVELS[level - 1];
  const featCount = info ? info.feats : 0;
  for (let i = 0; i < featCount; i++) {
    const cur = char.featSlots?.[i];
    out.push({
      id: "feat:" + i,
      kind: "feat",
      label: "专长 " + (i + 1) + "（" + featTierOf(level) + "）",
      status: cur ? "filled" : "empty",
      current: cur,
      slotIndex: i,
      detail: featTierOf(level) + "阶层",
    });
  }

  const equipped = (char.equipmentSlots ?? []).filter(Boolean).length;
  out.push({
    id: "equipment",
    kind: "equipment",
    label: "装备",
    status: equipped > 0 ? "filled" : "empty",
    detail: "已装备 " + equipped + " 件",
  });

  const rituals = (char.ritualSlots ?? []).filter(Boolean).length;
  out.push({
    id: "ritual",
    kind: "ritual",
    label: "仪式",
    status: rituals > 0 ? "filled" : "empty",
    detail: "已选 " + rituals + " 项",
  });

  return out;
}

/** 待填（empty）的决定数——用于界面上的「还差几步」。 */
export function countPending(list: Decision[]): number {
  return list.filter((d) => d.status === "empty").length;
}
