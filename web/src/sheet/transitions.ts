// 角色落子：把「选中某个 id」变成对 Character 的一次纯更新。
//
// 为什么必须有这一层：AI 落子必须与用户点选产生**逐字段相同**的结果，
// 否则「AI 改的卡」与「手点的卡」会长得不一样，出问题时无从对照。
// 目前抽出威能槽位一条；换职业/种族/主题的连带清理（classGrantedPowerIds 等）还留在
// CharacterSheet 的事件处理里，等下一阶段一并搬过来，届时两处共用同一份。

import type { Entry } from "../data/types";
import { isHybridTalentFeat } from "../lib/hybrid";
import { grantedPowerSlot, setFeatSlot, setPowerSlot, type AbilityKey, type Character, type PowerSlots } from "./character";
import { parseSubraceInfo } from "../lib/wikirender";
import { featGrantedPowers, featPrereqClassFeature, featReplacementInfo } from "./featEffects";
import { hybridPowerPoints, psionicPowerPoints } from "./powerpoints";
import { featChoiceInfo } from "./proficiency";
import { xpForLevel } from "./leveling";

export type PowerCat = "atWill" | "encounter" | "daily" | "utility";

export interface EntryMaps {
  classById: Map<string, Entry>;
  powerById: Map<string, Entry>;
}

/** 选中一个威能（与人物页 PowerSlotPicker.onSelect 的行为一致，含混职灵能点重算）。 */
export function applyPowerPick(char: Character, cat: PowerCat, index: number, id: string, maps: EntryMaps): Character {
  const powerSlots: PowerSlots = setPowerSlot(char.powerSlots, cat, index, id);
  // 混职灵能职业的每日灵能点随随意威能变化，选完必须重算 —— 与人物页同一处逻辑
  const rec =
    cat === "atWill"
      ? hybridPowerPoints({ ...char, powerSlots }, (i) => maps.classById.get(i), (i) => maps.powerById.get(i))
      : undefined;
  return { ...char, powerSlots, ...(rec !== undefined ? { powerPoints: rec } : {}) };
}

/** 属性分配落子：只写基础值（char.abilities 是购点基础值，种族加值在渲染时另算）。 */
export function applyAbilityScores(char: Character, abilities: Record<AbilityKey, number>): Character {
  return { ...char, abilities: { ...char.abilities, ...abilities } };
}

export interface FeatPickOutcome {
  char: Character;
  /** 实际加入威能面板的赠送威能 id */
  granted: string[];
  /** 这条专长还需要你在人物页补一个选择（武器 / 法器 / 混职天赋选项） */
  needsChoice: boolean;
  /** 这条专长是替换型：需要你在人物页指定替换哪一个槽位 */
  needsReplacement: boolean;
}

/** 威能面板的全部槽位（顺序与人物页的 SLOT_CATS 一致） */
const SLOT_KEYS: (keyof PowerSlots)[] = ["atWill", "encounter", "daily", "utility", "special"];

/**
 * 选中一个专长（与人物页 FeatSlotPicker.onSelect 的行为一致）：
 *   ① 先摘掉该槽位旧专长赠送的威能（否则换专长会把旧威能留在面板上）
 *   ② 写入专长、清掉该槽位旧的选择型选项
 *   ③ 替换型专长不自动加威能（由用户在人物页挑替换哪个槽位）；
 *      其余按人物页同一套规则把赠送威能放进面板（前提带职业特性的进「种族/职业威能」）
 * 需要玩家补选项（武器/法器/混职天赋）时只提示、不猜 —— 那是玩家的选择。
 */
export function applyFeatPick(char: Character, index: number, feat: Entry, lookup: (t: string) => Entry | undefined): FeatPickOutcome {
  const previousIds = char.featGrantedPowerIds?.[index] ?? [];
  const featGrantedPowerIds: Record<number, string[]> = { ...char.featGrantedPowerIds };
  delete featGrantedPowerIds[index];

  const powerSlots: PowerSlots = { ...char.powerSlots };
  if (previousIds.length > 0) {
    const drop = new Set(previousIds);
    for (const c of SLOT_KEYS) powerSlots[c] = powerSlots[c].map((id) => (id && drop.has(id) ? "" : id));
  }

  const featChoices = { ...char.featChoices };
  delete featChoices[index];
  const featSlots = setFeatSlot(char.featSlots, index, feat.id);

  const needsChoice = !!featChoiceInfo(feat) || isHybridTalentFeat(feat);
  const base: Character = { ...char, powerSlots, featSlots, featChoices, featGrantedPowerIds };

  if (featReplacementInfo(feat, lookup)) {
    return { char: base, granted: [], needsChoice, needsReplacement: true };
  }

  const powers = featGrantedPowers(feat, lookup);
  if (powers.length === 0) return { char: base, granted: [], needsChoice, needsReplacement: false };

  const toSpecial = featPrereqClassFeature(feat);
  const used = new Set<string>();
  for (const c of SLOT_KEYS) for (const id of powerSlots[c]) if (id) used.add(id);
  for (const pw of powers) {
    if (used.has(pw.id)) continue;
    const cat = toSpecial ? "special" : grantedPowerSlot(pw.usage, pw.powerKind, pw.name);
    if (!cat) continue;
    const arr = [...powerSlots[cat]];
    const i = arr.findIndex((x) => !x);
    if (i >= 0) arr[i] = pw.id;
    else arr.push(pw.id);
    powerSlots[cat] = arr;
    used.add(pw.id);
  }

  return {
    char: { ...base, powerSlots, featGrantedPowerIds: { ...featGrantedPowerIds, [index]: powers.map((x) => x.id) } },
    granted: powers.map((x) => x.id),
    needsChoice,
    needsReplacement: false,
  };
}

// —— 种族 / 职业 / 主题 / 典范 / 传奇 ——
//
// 这四项与前两类不同：换掉它们会**作废已经做过的选择**（职业授予的威能要退出面板、种族威能要清掉……）。
// 人物页把这套连带清理写在各自的事件处理里，本阶段先不搬（搬错一步就是把用户的卡改乱）。
// 取而代之的是一道**空白卡守卫**：只有当卡上还没有任何会被作废的选择时才允许代选 ——
// 此时清理步骤天然是空操作，落子结果与手点完全一致；有内容时按钮不给点，并说明原因。
// 下一阶段把连带清理整体提取到本文件，再放开这个限制（改卡模式要用）。

/** 空白卡：还没有任何「换职业/种族/主题时会被作废」的选择。 */
export function isBlankBuild(char: Character): boolean {
  return (
    SLOT_KEYS.every((c) => (char.powerSlots?.[c] ?? []).every((id) => !id)) &&
    (char.featSlots ?? []).every((id) => !id) &&
    (char.trainedSkills ?? []).length === 0 &&
    (char.classTrainedSkills ?? []).length === 0 &&
    (char.classGrantedPowerIds ?? []).length === 0 &&
    (char.classGrantedFeatIds ?? []).length === 0 &&
    (char.classGrantedRitualIds ?? []).length === 0 &&
    (char.raceGrantedPowerIds ?? []).length === 0 &&
    (char.raceAutoGrantedPowerIds ?? []).length === 0 &&
    (char.themeGrantedPowerIds ?? []).length === 0 &&
    Object.keys(char.classFeatureChoices ?? {}).length === 0 &&
    Object.keys(char.featGrantedPowerIds ?? {}).length === 0 &&
    Object.keys(char.featChoices ?? {}).length === 0
  );
}

/**
 * 换职业（与人物页 ClassPickerModal.onSelect 同一套结果）。
 * ids = [主职] 或 [主职, 混职职]；isHybrid 由选择器给出。
 * 「旧职业授予的威能随职业走」在这里一并摘除 —— 换了职业还留着上一个职业送的威能是不对的。
 */
export function applyClassPick(char: Character, ids: string[], isHybrid: boolean, maps: EntryMaps): Character {
  const gone = new Set(char.classGrantedPowerIds ?? []);
  const powerSlots: PowerSlots = { ...char.powerSlots };
  for (const c of SLOT_KEYS) powerSlots[c] = powerSlots[c].map((id) => (id && gone.has(id) ? "" : id));
  return {
    ...char,
    hybrid: isHybrid,
    classId: ids[0],
    classId2: ids[1],
    classTrainedSkills: [],
    classGrantedPowerIds: [],
    classGrantedFeatIds: [],
    classGrantedRitualIds: [],
    classGrantedRitualSources: {},
    powerSlots,
    powerPoints:
      hybridPowerPoints({ classId: ids[0], classId2: ids[1], powerSlots }, (i) => maps.classById.get(i), (i) => maps.powerById.get(i)) ??
      psionicPowerPoints(ids[0], char.level) ??
      char.powerPoints,
  };
}

/** 换种族（与人物页种族选择分支同一套结果）：条目本身是亚种时，落到父种族并带上亚种增益。 */
export function applyRacePick(char: Character, race: Entry, allRaces: Entry[]): Character {
  const subInfo = parseSubraceInfo(race.sourceText);
  const baseRace = subInfo ? allRaces.find((x) => (x.name + " " + (x.nameEn ?? "")).trim() === subInfo.baseRaceName) : undefined;
  if (subInfo && baseRace) {
    const applied: Record<string, boolean> = {};
    for (const b of subInfo.benefits) applied[b.title] = true;
    return {
      ...char,
      raceId: baseRace.id,
      subraceId: race.id,
      subraceBenefits: applied,
      raceSwaps: {},
      vision: baseRace.vision,
      size: baseRace.size ?? char.size,
    };
  }
  return {
    ...char,
    raceId: race.id,
    subraceId: undefined,
    subraceBenefits: {},
    raceSwaps: {},
    vision: race.vision,
    size: race.size ?? char.size,
  };
}

/**
 * 改等级（与人物页 setLevel 同一套结果）：写等级与 XP、低于 11/21 级时清掉典范/传奇、重算灵能点。
 * 人物页那份还会重置面板里的升级提升计数（组件内状态），那一项与 AI 页无关。
 */
export function applyLevel(char: Character, level: number, maps: EntryMaps): Character {
  const lv = Math.max(0, Math.min(30, level));
  return {
    ...char,
    level: lv,
    xp: lv === 0 ? "0" : String(xpForLevel(lv)),
    paragonPathId: lv < 11 ? undefined : char.paragonPathId,
    epicDestinyId: lv < 21 ? undefined : char.epicDestinyId,
    powerPoints:
      hybridPowerPoints(char, (i) => maps.classById.get(i), (i) => maps.powerById.get(i)) ??
      psionicPowerPoints(char.classId, lv) ??
      char.powerPoints,
  };
}

/** 典范之道 / 传奇命运：人物页就是直接置 id（清空同理）。 */
export function applyPathPick(char: Character, id: string, kind: "paragon" | "epic"): Character {
  return kind === "paragon" ? { ...char, paragonPathId: id } : { ...char, epicDestinyId: id };
}
