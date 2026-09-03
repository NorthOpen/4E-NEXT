import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FilledTextField, FilledSelect, SelectOption, TextButton, IconButton, Switch } from "../components/md";
import { loadCategory, loadRelations } from "../data/loaders";
import type { Entry } from "../data/types";
import { type AbilityKey, type Character, ABILITY_LABELS, deriveStats, isHeavyArmor, parseClassStats, parseRaceAbilities, racialBonus, applyAbilityBonus, parseTrainedSkillCount, parseClassSkills, parseBuiltinTrainedSkills, cleanDisplayName, setPowerSlot, clearPowerSlot, setFeatSlot, clearFeatSlot, setEquipmentSlot, clearEquipmentSlot, EQUIPMENT_SLOTS, buyPointsUsed, BUY_POINTS, DEFENSE_BONUS_SOURCES, parseRaceDefenses, baseClassName, SKILL_TABLE, ARMOR_PENALTY_SKILLS, armorPenaltyFor, zhName, type DefenseKey, type DefenseBonusSource, type SpeedMods, type InitMods, type SkillMods, type PowerSlots, grantedPowerCategory, grantedPowerSlot, type SlotLevel, ENCOUNTER_SLOT_LEVELS, DAILY_SLOT_LEVELS, UTILITY_SLOT_LEVELS, PARAGON_SLOT_LEVELS, LEGENDARY_SLOT_LEVEL, type ClassStats, type RaceDefenseBonus, type DerivedStats, setRitualSlot, clearRitualSlot } from "./character";
import { LEVELS, levelFromXp, xpForLevel } from "./leveling";
import PowerSlotPicker from "./PowerSlotPicker";
import FeatSlotPicker from "./FeatSlotPicker";
import FeatChoiceDialog from "./FeatChoiceDialog";
import PowerReplacementDialog, { type ReplSlotGroup } from "./PowerReplacementDialog";
import WeaponPalette, { type WeapInfo, implGroup } from "./WeaponPalette";
import ItemSlotPicker from "./ItemSlotPicker";
import EntryCard from "./EntryCard";
import PortraitFrame from "./PortraitFrame";
import CombatPanels from "./CombatPanel";
import { collectProficiencyTokens, collectProficiencySources, isProficient, featChoiceInfo, collectArmorTokens, collectShieldTokens, collectImplementGroups, armorProficient, type FeatOption, type ProfGroup } from "./proficiency";
import { SmartHover } from "./SmartHover";
import { collectClassSources, collectFeatSources } from "./combat-source";
import { stripWiki } from "../lib/text";
import { hybridTalentGroups, resolveHybridOption, isHybridTalentFeat, mergedClassTraitText, originalFeatureInfo, type HybridTalentGroup } from "../lib/hybrid";
import { wikiToHtml, classTraitHtml, classFeaturesHtml, classSummary, raceTraitHtml, raceBodyHtml, splitRaceLore, splitClassLore, splitAuxPowers, parseSubraceInfo, parseFeatureSections, parseClassFeatureOptions, parseReplacementPairs, tokenizeWikiBody, parseRaceTraitLines, type FeatureSection } from "../lib/wikirender";
import { BASE_WEAPONS, BASE_ARMORS, BASE_IMPLEMENTS, BASE_SHIELDS, findBaseItem, baseItemId, traitsText, type BaseWeapon, type BaseImplement } from "../lib/baseitems";
import { priceForLevel, itemLevels, enhancementBonusForLevel } from "../lib/levelprices";
import { POWER_CATEGORIES, POWER_COLORS, ITEM_COLOR, FEAT_COLOR } from "../lib/colors";
import PickerModal from "./PickerModal";
import ClassPickerModal from "./ClassPickerModal";
import SheetDialog from "../components/SheetDialog";
import RitualPicker, { ritualMarketPrice } from "./RitualPicker";
import { themeStarting, themeStartingPowers, themeExtraPowers, themeOptionalPowers, tierLevel, splitThemeSections, THEME_MECH_START, type ThemeSection } from "./theme";
// 灵能点推导：与速览页共用（速览页长休需按同一规则恢复灵能点）
import { psionicPowerPoints, hybridPowerPoints } from "./powerpoints";
// 防御推导（装备/职业特性自动加值、AC 属性替换）：与速览页共用同一实现
import { deriveDefenses, hybridTalentProf, resolvePrimalAspect, runicArtistry } from "./defense";

const ABILITIES: AbilityKey[] = ["str", "con", "dex", "int", "wis", "cha"];

// 种族出处 → 系列分组排序：系列属主键，同一系列内按规则书优先级排序（仅用于种族选择弹窗展示顺序）。
// [系列序, 书内序]；核心系列优先，其次精华、扩展、世设、补充，纯参考书垫底。未知出处归入末尾。
const RACE_SERIES: Record<string, [number, number]> = {
  // 核心系列
  PH: [0, 0], PH2: [0, 1], PH3: [0, 2], PP: [0, 2],
  DMG: [0, 3], DMG2: [0, 4],
  MM: [0, 5], MM2: [0, 6], MM3: [0, 7],
  // 精华系列（Essentials）
  HoFL: [1, 0], HoFK: [1, 1], HoS: [1, 2], HoF: [1, 3], HoEC: [1, 4],
  DMK: [1, 5], MV: [1, 6],
  // 扩展
  AV: [2, 0], AV2: [2, 1], MME: [2, 2], MP: [2, 3], MP2: [2, 4],
  AP: [2, 5], DP: [2, 6], PriP: [2, 7], PsiP: [2, 8],
  PHRD: [2, 9], PHRT: [2, 10],
  Dragon: [2, 11], Dra: [2, 11],
  // 世设
  FRCS: [3, 0], FRPG: [3, 1], ECS: [3, 2], EPG: [3, 3],
  DSCS: [3, 4], DSCC: [3, 5], NCS: [3, 6],
  // 补充
  BoVD: [4, 0], DSH: [4, 1], DEM: [4, 2], DMD: [4, 3], DCD: [4, 4],
  MotP: [4, 5], OG: [4, 6], TPA: [4, 7], TPB: [4, 8],
  // 参考书
  PSG: [5, 0], RC: [5, 1],
};
function sortRaces(list: Entry[]): Entry[] {
  const aIsHuman = (e: Entry) => e.nameEn === "Human" || e.name === "人类";
  return [...list].sort((a, b) => {
    if (aIsHuman(a) !== aIsHuman(b)) return aIsHuman(a) ? -1 : 1;
    const ka = RACE_SERIES[a.source ?? ""] ?? [9, 0];
    const kb = RACE_SERIES[b.source ?? ""] ?? [9, 0];
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return 0;
  });
}

// 技能别名：种族文本用「贼活」，技能面板用「盗术」等
const SKILL_ALIAS: Record<string, string> = { "贼活": "盗术" };
const SKILL_NAME_SET = new Set(SKILL_TABLE.map((s) => s.name));
// 解析种族文本自动填入内容：技能种族加值 + 语言槽
// 语言：排除「通用语」（固定芯片单独展示）；「任选 X 种」或「A 或 B」→ 留一个空槽给用户填写；其余为固定语言。
function parseRaceAutofill(sourceText: string): { skills: Record<string, number>; languages: string[] } {
  const mt = sourceText.match(/@@\.classTrait\s+"""([\s\S]*?)"""/);
  const ct = mt ? mt[1] : "";
  // 技能奖励：从行内拆出「+2技能」片段，识别为面板技能名的部分作为种族加值；「任意/由…决定」等跳过（留空手填）
  const skills: Record<string, number> = {};
  const skillLine = (ct.match(/技能奖励[\s\S]{0,1}([^\n]*)/) || [])[1] ?? "";
  for (const raw of skillLine.split(/[,，、；;]/)) {
    const m = raw.match(/\+?\s*(\d+)\s*([\u4e00-\u9fff]{2,})/);
    if (!m) continue;
    const name = SKILL_ALIAS[m[2].trim()] ?? m[2].trim();
    if (SKILL_NAME_SET.has(name)) skills[name] = (skills[name] ?? 0) + Number(m[1]);
  }
  // 语言
  const langLine = (ct.match(/\u8bed\u8a00[\s\S]{0,1}([^\n]*)/) || [])[1] ?? "";
  const fixed: string[] = [];
  let anyCount = 0;
  for (const raw of langLine.split(/[,，、；;。]/)) {
    const part = raw.trim();
    if (!part) continue;
    if (part.includes("任选")) {
      const n = part.match(/任选\s*(两|二|三|四|五|六|七|八|九|十|一)?\s*种?/);
      anyCount += n ? anyCountOfCn(n[1]) : 1;
      continue;
    }
    if (part.includes("或")) { anyCount += 1; continue; } // 「A 或 B」择一，留空槽
    // 去掉排版引号（''语言：'' 的粗体标记会残留 '），再去除括注；跳过含数字的种族特殊能力（如「心灵感应5」）
    const name = part.replace(/（[\s\S]*）|\([\s\S]*\)/g, "").replace(/'/g, "").trim();
    if (!name || /\d/.test(name)) continue;
    fixed.push(name); // 通用语与其它固定语言一样，作为可填可删的普通槽位
  }
  const languages: string[] = [...fixed];
  for (let i = 0; i < anyCount; i++) languages.push("");
  if (languages.length === 0) languages.push("");
  return { skills, languages };
}
function anyCountOfCn(token: string | undefined): number {
  if (!token) return 1;
  if (token === "两" || token === "二") return 2;
  if (token === "三") return 3;
  if (token === "四") return 4;
  return 1;
}

// 22 购点常用预设（数值数组按 ABILITIES 顺序，均恰好 22 点；应用时按玩家拖动的属性顺序分配）
const BUY_PRESETS: { label: string; values: number[] }[] = [
  { label: "16 16 12 11 11 8", values: [16, 16, 12, 11, 11, 8] },
  { label: "16 16 12 10 10 10", values: [16, 16, 12, 10, 10, 10] },
  { label: "18 14 11 10 10 8", values: [18, 14, 11, 10, 10, 8] },
  { label: "18 12 12 10 10 10", values: [18, 12, 12, 10, 10, 10] },
];

const SLOT_CATS: { key: keyof PowerSlots; label: string; color: string }[] = [
  { key: "atWill", label: "随意威能", color: POWER_CATEGORIES[0].color },
  { key: "encounter", label: "遭遇威能", color: POWER_CATEGORIES[1].color },
  { key: "daily", label: "每日威能", color: POWER_CATEGORIES[2].color },
  { key: "utility", label: "辅助威能", color: POWER_CATEGORIES[3].color },
  { key: "special", label: "种族/职业威能", color: POWER_CATEGORIES[4].color },
];

function resizeSlots(arr: (string | undefined)[], n: number): (string | undefined)[] {
  const out = [...arr];
  const capped = Math.max(0, Math.min(20, n));
  if (out.length > capped) out.length = capped;
  while (out.length < capped) out.push(undefined);
  return out;
}

// 截断数组到 n：仅移除末尾的空槽（""/undefined），绝不丢弃已填充槽位的数据。
// 用于「减少槽位 / 恢复」时，让实际渲染的槽位数可以随 −/恢复 收缩，同时又保护已填入的内容不丢失。
function trimTrailingEmpty<T extends string | undefined>(arr: T[], n: number): T[] {
  const out = [...arr];
  while (out.length > n) {
    const last = out[out.length - 1];
    if (last === "" || last === undefined) out.pop();
    else break; // 末尾是已填充内容，不再截断以防数据丢失
  }
  return out;
}

// 扩容到 n：用空串补齐，保持元素类型不变（string[] → string[]）。
function padEmpty<T extends string | undefined>(arr: T[], n: number): T[] {
  const out = [...arr];
  while (out.length < n) out.push("" as T);
  return out;
}

// 由升级表推导各「等级槽位」应填充的威能等级。
// 遭遇/每日最多 3 个不同等级（取 3 个最近获得的等级）+ 1 个典范槽位；辅助逐个递增（2/6/10/…）再加典范/传奇；
// 返回数组第 i 项 = 第 i 个该类别威能空位的标签等级（"paragon"/"legendary" 为无等级数字的典范/传奇槽位）。
function powerSlotLevels(cat: "atWill" | "encounter" | "daily" | "utility", level: number): SlotLevel[] {
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

// 空位按钮文字：典范/传奇槽位标注为「选择典范/传奇遭遇威能」；普通等级槽位一律「选择遭遇威能」
// （高等级兼容低等级，无需在按钮上标注具体等级，点击后可选 ≤ 当前等级的威能）。
function slotLevelText(sl: SlotLevel | undefined, catLabel: string): string {
  if (sl === "paragon") return "选择典范" + catLabel;
  if (sl === "legendary") return "选择传奇" + catLabel;
  return "选择" + catLabel;
}

// —— 职业特性授予威能的提取 / 加入威能面板 ——

// 从 wiki 文本提取全部 [[链接]] 目标（去重，保留顺序）
function wikiLinkTargets(text?: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim();
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

// 正文「如果你有[[X]]威能」等条件句中的链接：仅为前提说明，不是本次特性授予的威能，
// 不应随普通特性自动加入威能面板（如法师（学派法师）19级「每日威能」中的[[召唤暗影仆从]]，
// 它只是「若已有该威能可选新召唤生物」的条件提及）。
function conditionalGrantLinks(text?: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const re = /(?:如果你|若你|如果你已|若你已)(?:拥有|持有|有|已有)\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1].trim());
  return out;
}

// 选项值归一化为字符串数组（choiceKey 存 string 或 string[]）
function choiceVals(v: string | string[] | undefined): string[] {
  return Array.isArray(v) ? v : v ? [v] : [];
}

// —— 混职天赋 Hybrid Talent 的解析与效果解析已在 lib/hybrid.ts ——
// CharacterSheet 在此仅需从 lib/hybrid 导入：hybridTalentGroups / resolveHybridOption /
// isHybridTalentFeat / hybridTalentProfTokens / HybridTalentGroup。

// 选项描述中授予的威能：若含「选择用[[A]]来代替[[B]]」子二选一（如炼狱契约炼狱叱喝/阿弗纳斯赠礼），
// 则只取当前选中的（未选时默认保留原威能 B）；否则描述里所有 [[威能]] 链接都视为授予。
function optionGrantedPowers(desc: string, innerChosen: string | string[] | undefined, lookup: (t: string) => Entry | undefined): Entry[] {
  const out: Entry[] = [];
  const add = (t: string) => {
    const e = lookup(t);
    if (e && e.category === "power" && !out.some((x) => x.id === e.id)) out.push(e);
  };
  const sub = desc.match(/(?:你可以)?选择(?:用)?\[\[([^\]]+)\]\]来代替\[\[([^\]]+)\]\](?:威能)?/);
  if (sub) {
    const alt = sub[1].trim();
    const keep = sub[2].trim();
    const vals = choiceVals(innerChosen);
    add(vals.includes(alt) ? alt : keep);
    return out;
  }
  // 「选择[[A]]威能来替换[[B]]」：选中该替代时只授予新威能 A，不连带授予被替代的 B（如骑士「精野守卫者」先前的双赠 bug）
  const replL = desc.match(/(?:你可以)?选择\[\[([^\]]+)\]\]威能来替换\[\[([^\]]+)\]\]/);
  if (replL) { add(replL[1].trim()); return out; }
  for (const t of wikiLinkTargets(desc)) add(t);
  return out;
}

// 正文中「N级时，你获得[[威能]]」的等级门槛：返回 威能链接 → 需达到的等级（如野蛮人「狂暴打击」5级）。
// 用于特性授予威能时，未达等级的威能先不加入威能面板。
function levelGatedWikiLinks(body?: string): Map<string, number> {
  const gates = new Map<string, number>();
  if (!body) return gates;
  const re = /(\d+)级(?:时|后)?，?\s*(?:你(?:会|将)?)?获得\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const lv = parseInt(m[1], 10);
    const t = m[2].trim();
    if (!gates.has(t) || gates.get(t)! > lv) gates.set(t, lv);
  }
  return gates;
}

// 正文中「获得[[专长]]作为(奖励|额外)专长」「获得[[专长]]专长作为…」等赠送句提取专长链接目标。
// 只把明确写「获得…作为…专长」的当作职业赠送专长，不把被动提及/引用的专长当作赠送。
function grantedFeatLinks(text?: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  // 匹配「获得[[X]]专长」（X 被明确获得）及「获得[[X]]作为奖励/额外专长」两种赠送句式；
  // 前者如战士（骑士）1级「盾牌娴熟」：你获得[[盾牌娴熟 Shield Finesse]]专长。
  const re = /获得\[\[([^\]|]+)(?:\|[^\]]+)?\]\](?:专长作为(?:一个)?(?:奖励|额外)专长|作为(?:一个)?(?:奖励|额外)专长|专长)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim();
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

// 职业赠送仪式：正文提到「仪式书」时，收集句中 [[…]] 链接并过滤出仪式类条目
// （如德鲁伊的[[动物信使]]、机关术士的[[调制药水]]、神导士的[[命运之手]]）。
// 用「仪式书」作前提避免把被动提及/引用的仪式（如游侠野兽伙伴正文里与[[死者复活]]的对比）误判为赠送。
// 「选择[[A]]或者[[B]]」的互斥选择（如心灵术士的传讯术/谭森飘浮碟）不自动赠送，玩家需自行选择其一。
function grantedRitualLinks(text?: string, lookup?: (t: string) => Entry | undefined): string[] {
  if (!text || !text.includes("仪式书")) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  // 先收集互斥选择中的仪式标题（如「选择[[传讯术]]或者[[谭森飘浮碟]]」），随后从结果中排除
  const exclusive = new Set<string>();
  const choiceRe = /选择\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*(?:或|或者)\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let cm: RegExpExecArray | null;
  while ((cm = choiceRe.exec(text)) !== null) {
    for (let i = 1; i <= 2; i++) {
      const t = cm[i].trim();
      const e = lookup ? lookup(t) : undefined;
      if (e && e.category === "ritual") exclusive.add(t);
    }
  }
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim();
    if (seen.has(t) || exclusive.has(t)) continue;
    const e = lookup ? lookup(t) : undefined;
    if (e && e.category === "ritual") { seen.add(t); out.push(t); }
  }
  return out;
}

// —— 专长赠送威能 / 威能替换 ——

// 专长正文（前提 + 增益 + 特殊）拼接，用于扫描其中赠送/替换威能的表述
function featBodyText(f: Entry): string {
  return [f.prerequisite, f.benefit, (f as { fields?: { special?: string } }).fields?.special].filter(Boolean).join("\n");
}

// 专长简洁模式正文：专长名后的增益文字（去 wiki 标记与 HTML 标签；[[链接]] 只留中文名）
function compactFeatText(f: Entry): string {
  const src = f.benefit || (f as { fields?: { special?: string } }).fields?.special || "";
  const text = src.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_m, t: string) => zhName(t));
  return stripWiki(text)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 专长赠送的威能：正文「获得[[威能]]威能」的明确赠送句。
// 排除否定语境（不/不会/不再/没有/未曾获得）与被动引用（「获得[[X]]的通常效果」），
// 也不把替换型专长（单独用 featReplacementInfo 处理）算作普通赠送。
function featGrantedPowers(f: Entry, lookup: (t: string) => Entry | undefined): Entry[] {
  const out: Entry[] = [];
  const text = featBodyText(f);
  const re = /获得\[\[([^\]|]+)(?:\|[^\]]+)?\]\](?:威能)?(?![^。！？!?.,，、\n])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 3), m.index);
    if (/(不|不会|不再|没有|未曾|并非)$/.test(before)) continue;
    const e = lookup(m[1].trim());
    if (e && e.category === "power" && !out.some((x) => x.id === e.id)) out.push(e);
  }
  return out;
}

// 专长前提是否与「职业特性」相关：前提中出现「」引用的职业特性名或「职业特性」字样（如「引导神力」职业特性）。
// 相关时，该专长赠送的威能应送入「种族/职业威能」（special），而非标准攻击/辅助空位。
function featPrereqClassFeature(f: Entry): boolean {
  const p = f.prerequisite ?? "";
  if (!p) return false;
  return /「[^」]+」/.test(p) || /职业特性/.test(p);
}

// 专长将旧威能替换为新威能：识别三类替换表述，返回新威能与目标说明（供选择后弹面板询问填入哪个格子）。
//  - 「获得[[新]]专长威能，它会替换你的N级辅助威能」
//  - 「[[新]]专长威能替换你的一个N级或更高级的辅助威能」
//  - 「将你的[[旧]]种族威能替换成[[新]]威能」
export interface FeatReplacement {
  newPower: Entry;
  hint: string; // 目标说明文字（如「替换你的一个16级或更高级的辅助威能」）
  targetCat?: keyof PowerSlots; // 被替换威能所在的槽位类别（供替换弹窗只显示相关槽位）
}
// 从目标说明片段解析被替换威能的槽位类别
function replTargetCat(fragment: string): keyof PowerSlots | undefined {
  if (/辅助/.test(fragment)) return "utility";
  if (/遭遇攻击|遭遇/.test(fragment)) return "encounter";
  if (/每日攻击|每日/.test(fragment)) return "daily";
  if (/种族威能/.test(fragment)) return "special";
  return undefined;
}
function featReplacementInfo(f: Entry, lookup: (t: string) => Entry | undefined): FeatReplacement | undefined {
  const text = featBodyText(f);
  const resolve = (t: string): Entry | undefined => {
    const e = lookup(t.trim());
    return e && e.category === "power" ? e : undefined;
  };
  let m: RegExpMatchArray | null;
  // 「将一个N级或更高级的X威能替换成[[新]]威能」/「你将一个N级或更高级的X威能替换成[[新]]威能」
  m = text.match(/(?:你可以)?将一个(\d+)级或更高级的(辅助|遭遇攻击|每日攻击)威能替换成\[\[([^\]]+)\]\](?:威能)?/);
  if (m) {
    const np = resolve(m[3]);
    if (np) {
      const cat = m[2] === "辅助" ? "utility" : m[2] === "遭遇攻击" ? "encounter" : "daily";
      return { newPower: np, hint: "替换你的" + m[1] + "级或更高级的" + m[2] + "威能", targetCat: cat };
    }
  }
  // 「获得[[新]]专长威能，它会替换你的N级辅助威能」
  m = text.match(/获得\[\[([^\]]+)\]\](?:专长威能)?，?\s*它会替换你的([^。！？\n]+)/);
  if (m) { const np = resolve(m[1]); if (np) return { newPower: np, hint: "替换你的" + m[2].trim(), targetCat: replTargetCat(m[2]) }; }
  m = text.match(/\[\[([^\]]+)\]\](?:专长威能)?替换你的([^。！？\n]+)/);
  if (m) { const np = resolve(m[1]); if (np) return { newPower: np, hint: "替换你的" + m[2].trim(), targetCat: replTargetCat(m[2]) }; }
  m = text.match(/将你的\[\[([^\]]+)\]\][^。！？\n]{0,12}?替换成\[\[([^\]]+)\]\][^。！？\n]{0,8}?威能/);
  if (m) { const np = resolve(m[2]); if (np) return { newPower: np, hint: "替换你的" + m[1].trim() + "威能", targetCat: "special" }; }
  // 「你失去该威能，且获得[[新]]威能」（如游荡者专长「背刺」）
  m = text.match(/你失去该威能，?\s*且获得\[\[([^\]]+)\]\](?:威能)?/);
  if (m) { const np = resolve(m[1]); if (np) return { newPower: np, hint: "替换一个你已有的相关攻击威能", targetCat: replTargetCat(text) }; }
  return undefined;
}

// 装备栏位分组（下标对应 EQUIPMENT_SLOTS），按部位各自单独成组
const EQUIP_GROUPS: { label: string; kind?: "weapon" | "armor" | "shield"; slots: { index: number; name: string }[] }[] = [
  { label: "武器", kind: "weapon", slots: [{ index: 0, name: "主手" }, { index: 1, name: "副手" }] },
  { label: "护甲", kind: "armor", slots: [{ index: 5, name: "护甲" }] },
  { label: "臂部", kind: "shield", slots: [{ index: 7, name: "臂部" }] },
  { label: "头部", slots: [{ index: 3, name: "头部" }] },
  { label: "颈部", slots: [{ index: 4, name: "颈部" }] },
  { label: "腰部", slots: [{ index: 6, name: "腰部" }] },
  { label: "佩戴", slots: [{ index: 2, name: "佩戴" }] },
  { label: "手部", slots: [{ index: 8, name: "手部" }] },
  { label: "足部", slots: [{ index: 11, name: "足部" }] },
  { label: "戒指", slots: [{ index: 9, name: "戒指 1" }, { index: 10, name: "戒指 2" }] },
];

// 基础物品块：名称 + 大字伤害骰/AC + 简名特性；特性完整定义悬浮显示（同威能简洁模式）
function BaseItemBlock(props: { id?: string; kind: "weapon" | "armor" | "shield"; label?: string; onClick: () => void }) {
  const item = props.id ? findBaseItem(props.id) : undefined;
  const weapon = item?.kind === "weapon" ? item.weapon : undefined;
  const armor = item?.kind === "armor" ? item.armor : undefined;
  const shield = item?.kind === "shield" ? item.shield : undefined;
  const implement = item?.kind === "implement" ? item.implement : undefined;
  const traitNames = weapon && weapon.traits && weapon.traits !== "—" ? weapon.traits : "";
  const traitFull = weapon ? traitsText(weapon.traits) : "";
  return (
    <button type="button" className="base-item" onClick={props.onClick} title="点击更换基础物品">
      {shield ? (
        <>
          <span className="bi-name">{shield.name}</span>
          <span className="bi-dice">+{shield.ac} AC</span>
          <span className="bi-traits">{shield.traits}</span>
        </>
      ) : implement ? (
        <>
          <span className="bi-name">{implement.name}</span>
          <span className="bi-dice">—</span>
          <span className="bi-traits">{implement.category}法器</span>
        </>
      ) : props.kind === "weapon" ? (
        <>
          <span className="bi-name">{weapon ? weapon.name : (props.label ?? "基础武器")}</span>
          <span className="bi-dice">{weapon ? weapon.dice : "—"}</span>
          <span className="bi-traits">{traitNames || "点击选择"}</span>
          {traitFull && (
            <span className="base-pop">
              {traitFull.split("\n").map((l, i) => <span key={i} className="base-pop-line">{l}</span>)}
            </span>
          )}
        </>
      ) : props.kind === "shield" ? (
        <>
          <span className="bi-name">基础盾牌</span>
          <span className="bi-dice">—</span>
          <span className="bi-traits">点击选择</span>
        </>
      ) : (
        <>
          <span className={"bi-name" + (armor?.masterwork ? " masterwork" : "")}>{armor ? armor.name : "基础护甲"}</span>
          <span className="bi-dice">{armor ? "+" + armor.ac : "—"}</span>
          <span className="bi-traits">{armor ? (armor.masterwork ? "最小增强 +" + armor.minEnhance : armor.category) : "点击选择"}</span>
        </>
      )}
    </button>
  );
}
// 基础物品选择弹窗：左侧导航 + 分组卡片
const ARMOR_BASES: { name: string; cat: string }[] = [
  { name: "布甲", cat: "轻甲" },
  { name: "皮甲", cat: "轻甲" },
  { name: "革甲", cat: "轻甲" },
  { name: "镶嵌皮甲", cat: "轻甲" },
  { name: "环甲", cat: "轻甲" },
  { name: "链甲", cat: "重甲" },
  { name: "鳞甲", cat: "重甲" },
  { name: "板甲", cat: "重甲" },
  { name: "镶钢链甲", cat: "重甲" },
  { name: "板条甲", cat: "重甲" },
  { name: "钉板甲", cat: "重甲" },
  { name: "全身板甲", cat: "重甲" },
];

function BasePickerDialog(props: { kind: "weapon" | "armor" | "shield"; index: number; baseId?: string; proficientInfos?: WeapInfo[]; proficientImplGroups?: string[]; armorTokens?: Set<string>; shieldTokens?: Set<string>; onSelect: (id: string) => void; onClear: () => void; onClose: () => void }) {
  const [masterwork, setMasterwork] = useState(false);
  // 当前选中的护甲组（左侧导航高亮；初始定位到已装备护甲所属组）
  const [armorGroup, setArmorGroup] = useState<string>(() => {
    const cur = props.baseId ? findBaseItem(props.baseId) : undefined;
    if (cur?.kind === "armor" && cur.armor) {
      const a = cur.armor;
      if (a.masterwork) {
        const b = ARMOR_BASES.find((x) => a.name.includes(x.name));
        if (b) return b.cat + "-" + b.name;
      }
      return a.category;
    }
    return "轻甲";
  });
  const active = (id: string) => props.baseId === id;
  const armorTok = props.armorTokens ?? new Set<string>();
  const shieldTok = props.shieldTokens ?? new Set<string>();
  // 护甲擅长：命中具体护甲名 或 命中所属大类（轻甲/重甲）
  const armorProf = (a: { name: string; category: string }) =>
    armorProficient(armorTok, shieldTok, a.name) ||
    (a.category === "轻甲" ? armorTok.has("轻甲") : a.category === "重甲" ? armorTok.has("重甲") : false);
  const card = (name: string, id: string, main: string, sub: string, proficient = false, mw?: boolean) => (
    <button
      key={id}
      type="button"
      className={active(id) ? "picker-card base-picker-card selected" : "picker-card base-picker-card" + (mw ? " masterwork" : "")}
      onClick={() => props.onSelect(id)}
    >
      <span className="bi-name">{name}</span>
      <span className="bi-dice">{main}</span>
      <span className="bi-traits">{sub}</span>
      {proficient && <span className="prof-badge">擅长</span>}
    </button>
  );

  const armorGroups = masterwork
    ? ARMOR_BASES.map((b) => ({ label: b.cat + "-" + b.name, items: BASE_ARMORS.filter((a) => a.name.includes(b.name)) }))
    : [{ label: "轻甲", items: BASE_ARMORS.filter((a) => a.category === "轻甲" && !a.masterwork) }, { label: "重甲", items: BASE_ARMORS.filter((a) => a.category === "重甲" && !a.masterwork) }];
  // 精制品切换后组集合变化时回退到第一组
  const activeArmorGroup = armorGroups.some((g) => g.label === armorGroup) ? armorGroup : (armorGroups[0]?.label ?? "");
  const currentBase = props.baseId ? findBaseItem(props.baseId) : undefined;
  const currentBaseName = currentBase
    ? (currentBase.kind === "weapon" ? currentBase.weapon!.name
      : currentBase.kind === "armor" ? currentBase.armor!.name
      : currentBase.kind === "shield" ? currentBase.shield!.name
      : currentBase.implement!.name)
    : undefined;

  return createPortal(
    <div className="picker-overlay" onClick={props.onClose}>
      <div className="picker-dialog class-dialog base-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">选择基础{props.kind === "weapon" ? "武器" : props.kind === "armor" ? "护甲" : "盾牌"}{currentBaseName ? "（当前：" + currentBaseName + "）" : ""}</span>
          <div className="base-dialog-actions">
            <TextButton onClick={props.onClear}>清除基础物品</TextButton>
            <button type="button" className="crop-btn" onClick={props.onClose}>关闭</button>
          </div>
        </div>
        {props.kind === "armor" && (
          <label className="base-mw-toggle">
            <Switch selected={masterwork} onChange={(e) => setMasterwork((e.target as any).selected)} />
            <span>精制品</span>
          </label>
        )}
      {props.kind === "weapon" ? (
        <WeaponPalette
          weapons={BASE_WEAPONS}
          allowImplShield
          proficientInfos={props.proficientInfos ?? []}
          proficientImplGroups={props.proficientImplGroups}
          armorTokens={props.armorTokens}
          shieldTokens={props.shieldTokens}
          currentName={currentBaseName}
          onSelect={(id) => props.onSelect(id)}
        />
      ) : props.kind === "shield" ? (
        <div className="class-layout base-class-layout">
          <div className="class-sources">
            <button type="button" className="cl-item active" title="盾牌">盾牌</button>
          </div>
          <div className="class-main">
            <div className="base-cat">
              <div className="base-cat-title">盾牌</div>
              <div className="picker-cards">
                {BASE_SHIELDS.map((s) => card(s.name, baseItemId("shield", s.name), "+" + s.ac + " AC", s.traits, armorProficient(armorTok, shieldTok, s.name)))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="class-layout base-class-layout">
          <div className="class-sources">
            {armorGroups.map((g) => (
              <button key={g.label} type="button" className={activeArmorGroup === g.label ? "cl-item active" : "cl-item"} title={g.label} onClick={() => setArmorGroup(g.label)}>{g.label}</button>
            ))}
          </div>
          <div className="class-main">
            {armorGroups.filter((g) => g.label === activeArmorGroup).map((g) => (
              <div key={g.label} className="base-cat">
                <div className="base-cat-title">{g.label}</div>
                <div className="picker-cards">
                  {g.items.filter((a) => !a.masterwork).map((a) => card(a.name, baseItemId("armor", a.name), "+" + a.ac, a.category, armorProf(a)))}
                  {masterwork && g.items.filter((a) => a.masterwork).map((a) => card(a.name, baseItemId("armor", a.name), "+" + a.ac, "最小增强 +" + a.minEnhance + (a.special ? " · " + a.special : ""), armorProf(a), true))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>,
    document.body
  );
}
function EquipGroupSlots(props: {
  slots: (string | undefined)[];
  detail: boolean;
  names: (i: number) => string;
  items: (i: number) => Entry | undefined;
  picker: (i: number) => void;
  clear: (i: number) => void;
  usedOf?: (i: number) => boolean;
  baseKind?: "weapon" | "armor" | "shield";
  baseOf?: (i: number) => string | undefined;
  onBaseClick?: (i: number) => void;
  levelsOf?: (i: number) => number[];
  enhanceOf?: (i: number) => number;
  onEnhance?: (i: number, tier: number) => void;
}) {
  if (!props.detail) {
    return (
      <div className="compact-list">
        {props.slots.map((_, i) => {
          const item = props.items(i);
          const baseName = props.baseKind && props.baseOf ? (() => {
            const b = props.baseOf(i);
            const f = b ? findBaseItem(b) : undefined;
            return f ? (f.kind === "weapon" ? f.weapon!.name : f.kind === "armor" ? f.armor!.name : f.kind === "shield" ? f.shield!.name : f.implement!.name) : undefined;
          })() : undefined;
          if (item) {
            const used = !!props.usedOf?.(i);
            return (
              <div key={i} className={"compact-row" + (used ? " slot-used" : "")} onClick={() => props.picker(i)} title={used ? "已标记使用（锁定）" : "点击更换"}>
                <span className="cr-dot" style={{ background: ITEM_COLOR }} />
                {baseName && <span className="compact-base" onClick={(e) => { e.stopPropagation(); props.onBaseClick?.(i); }}>{baseName}</span>}
                <span className="cr-name">{item.name}{item.nameEn ? " " + item.nameEn : ""}</span>
                <span className="cr-sub">{item.rarity}{item.itemLevel ? " · L" + item.itemLevel : ""}</span>
                <IconButton className="slot-x" title={used ? "已标记使用（锁定）" : "清空槽位"} aria-label="清空槽位" onClick={(e) => { e.stopPropagation(); if (used) return; props.clear(i); }}><span className="material-symbols-outlined">close</span></IconButton>
                <div className="compact-pop"><EntryCard entry={item} /></div>
              </div>
            );
          }
          return (
            <button key={i} type="button" className="compact-empty" onClick={() => props.picker(i)}>＋ 选择{props.names(i)}</button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="power-grid">
      {props.slots.map((_, i) => {
        const item = props.items(i);
        const base = props.baseKind && props.baseOf ? (
          <BaseItemBlock id={props.baseOf(i)} kind={props.baseKind} label={props.baseKind === "weapon" ? props.names(i) : undefined} onClick={() => props.onBaseClick?.(i)} />
        ) : null;
        if (item) {
          return (
            <div key={i} className="slot-col">
              {base}
              {props.levelsOf && (() => {
                const levels = props.levelsOf(i);
                if (levels.length) {
                  const tier = props.enhanceOf ? Math.max(1, Math.min(levels.length, props.enhanceOf(i))) : 1;
                  const lv = levels[tier - 1];
                  const hasMore = levels.length > 1;
                  return (
                    <div className="enhance-stepper" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="sg-step" disabled={!hasMore || tier <= 1} title="降低增强" onClick={() => props.onEnhance?.(i, Math.max(1, tier - 1))}>−</button>
                      <span className="enhance-info">
                        <span className="enhance-sub">附魔：L{lv}{hasMore ? " · " + priceForLevel(lv).toLocaleString("zh-CN") + " gp" : ""}</span>
                        <span className="enhance-main">增强+{enhancementBonusForLevel(lv)}</span>
                      </span>
                      <button type="button" className="sg-step" disabled={!hasMore || tier >= levels.length} title="提高增强" onClick={() => props.onEnhance?.(i, Math.min(levels.length, tier + 1))}>+</button>
                    </div>
                  );
                }
                return null;
              })()}
              <div className={"slot-filled" + (props.usedOf?.(i) ? " slot-used" : "")} onClick={() => props.picker(i)} title={props.usedOf?.(i) ? "已标记使用（锁定）" : "点击更换"}>
                <EntryCard entry={item} />
              </div>
            </div>
          );
        }
        return (
          <div key={i} className="slot-col">
            {base}
            <button type="button" className="slot-empty" onClick={() => props.picker(i)}>
              <span className="material-symbols-outlined">add</span>
              <span>{props.baseKind ? "选择" + props.names(i) + "附魔" : "选择" + props.names(i)}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

const DEF_BONUS_LABELS: Record<DefenseBonusSource, string> = {
  feat: "专长",
  enhance: "增强",
  armor: "防具",
  shield: "盾牌",
  other: "其他",
};

// 职业特性正文渲染：保留换行/表格，并把 [[威能]]、[[专长]] 等超链接转为悬浮卡片预览
function WikiBody({ body, fields, lookup, indent }: { body: string; fields: Record<string, string>; lookup: (target: string) => Entry | undefined; indent?: boolean }) {
  const tokens = useMemo(() => tokenizeWikiBody(body, fields, indent), [body, fields, indent]);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "link") {
          const entry = lookup(t.target);
          if (!entry) return <span key={i} className="wiki-ref-plain">{t.alias}</span>;
          return <SmartHover key={i} className="wiki-ref" popClass="wiki-ref-pop" pop={<EntryCard entry={entry} />}>{t.alias}</SmartHover>;
        }
        if (t.kind === "html") return <div key={i} className="wiki-html" dangerouslySetInnerHTML={{ __html: enBreak(t.html) }} />;
        return <span key={i} dangerouslySetInnerHTML={{ __html: enBreak(t.html) }} />;
      })}
    </>
  );
}

// 单个职业特性条目：普通特性渲染标题+正文；选择型特性渲染「选择一个」选项（阵营面板样式）
// 单选型（count=1）：点击切换选中；多选型（count>1，如法师戏法「获得4个」）：点击增删并显示进度
// 从特性正文中拆出 <div class="sidebar">…</div> 内的「!!! 小节」规则文本
// （如守望者「守望者形态威能」、萨满「定制精魂伙伴」），作为可折叠子规则随特性渲染（样式与兽王折叠一致）
function splitSidebarSubs(body: string | undefined): { main?: string; subs: { title: string; body: string }[] } {
  if (!body) return { subs: [] };
  const subs: { title: string; body: string }[] = [];
  let main = body;
  const re = /<div class="sidebar">([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    main = main.replace(m[0], "");
    const parts = m[1].split(/^(?=!!! )/m);
    for (const p of parts) {
      const sm = p.match(/^!!!\s+(.+?)\s*\n([\s\S]*)$/);
      if (!sm) continue;
      const title = sm[1].trim();
      const subBody = sm[2]
        .replace(/^@@\.\w+\s*/gm, "")
        .replace(/^@@\s*$/gm, "")
        .replace(/^\s*$/gm, "")
        .trim();
      if (title && subBody) subs.push({ title, body: subBody });
    }
  }
  if (subs.length === 0) {
    // 无 sidebar：正文原样返回（仅去掉首尾空白，保留段落空行），
    // 供 splitFlavor 按空行切分首段风味；压缩空行交由 prose/FeatureBody 统一处理。
    return { main: main.trim(), subs };
  }
  main = main.replace(/^\s*$/gm, "").trim();
  return { main: main.length > 0 ? main : undefined, subs };
}

// 选择型特性（如萨满「精魂伙伴」）中，把各选项描述内共用的 sidebar 规则小节
// （如「定制精魂伙伴」）提取为独立折叠规则，无条件显示、不挂在任一具体选项内部。
function OptSubFold({ options, fields, lookup }: {
  options: { label: string; desc?: string }[];
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
}) {
  const subs = useMemo(() => {
    const arr: { title: string; body: string }[] = [];
    const seen = new Set<string>();
    for (const o of options) {
      const r = splitSidebarSubs(o.desc);
      for (const s of r.subs) if (!seen.has(s.title)) { seen.add(s.title); arr.push(s); }
    }
    return arr;
  }, [options]);
  if (subs.length === 0) return null;
  return (
    <>
      {subs.map((sub) => (
        <details className="beast-sub" key={sub.title} open>
          <summary>{featTitle(sub.title).trim()}</summary>
          <div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(sub.body)} fields={fields} lookup={lookup} indent /></div></div>
        </details>
      ))}
    </>
  );
}

interface GrantPowerLink { ref: string; entry: Entry }
// 普通特性正文中，若以「!!! 威能名」子小节逐块列出被授予的威能（如专业射手「获得下列3个威能」），
// 则把对应子小节从正文中抽出为可悬浮威能卡链接（SmartHover→EntryCard），供详图以 chip 展示、简洁模式直接剔除，
// 避免与威能面板重复堆叠并泄漏威能卡正文英文。
function extractGrantPowers(body: string | undefined, refs: string[], lookup: (t: string) => Entry | undefined): { main?: string; links: GrantPowerLink[] } {
  if (refs.length === 0 || !body) return { main: body, links: [] };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let main = body;
  const links: GrantPowerLink[] = [];
  for (const ref of refs) {
    const entry = lookup(ref.trim());
    if (!entry || entry.category !== "power") continue;
    const re = new RegExp("\\n?!!![ \\t]+" + esc(ref.trim()) + "[ \\t]*\\n[\\s\\S]*?(?=\\n?!!![ \\t]+|\\n?-{3,}|$)", "");
    const m = main.match(re);
    if (m) { main = main.replace(m[0], ""); links.push({ ref: ref.trim(), entry }); }
  }
  return { main: main.trim(), links };
}

function ClassFeatureItem({ section, fields, choiceKey, chosen, innerChosen, onChoose, lookup }: {
  section: FeatureSection;
  fields: Record<string, string>;
  choiceKey: string;
  chosen?: string | string[];
  innerChosen?: string | string[];
  onChoose: (key: string, label: string | string[]) => void;
  lookup: (target: string) => Entry | undefined;
}) {
  const parsed = useMemo(() => parseClassFeatureOptions(section.body), [section.body]);
  const { main: secMain, subs: secSubs } = useMemo(() => splitSidebarSubs(section.body), [section.body]);
  // 普通特性若以「获得下列N个威能」并在正文末尾用 !!! 子小节列出多个已授予威能（如专业射手「获得下列3个威能」），
  // 抽出这些子威能作为可悬浮威能卡链接（SmartHover→EntryCard）展示，去掉正文中的内联占位文本，避免与威能面板重复堆叠。
  const feaGrantPowers = useMemo(() => {
    const refs = section.powerRefs?.length ? section.powerRefs : section.powerRef ? [section.powerRef] : [];
    return extractGrantPowers(secMain, refs, lookup);
  }, [secMain, section.powerRefs, section.powerRef, lookup]);
  const chosenVals = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
  const count = parsed.count ?? 1;
  const multiple = count > 1;
  const isChosen = (label: string) => chosenVals.includes(label);
  const toggle = (label: string) => {
    if (multiple) {
      if (isChosen(label)) onChoose(choiceKey, chosenVals.filter((x) => x !== label));
      else if (chosenVals.length < count) onChoose(choiceKey, [...chosenVals, label]);
      // 已选满 count 个时忽略新增，确保选择数量不超过上限（如保护者「原力协调」选 3 个）
    } else onChoose(choiceKey, isChosen(label) ? "" : label);
  };
  const selOpts = parsed.options.filter((o) => isChosen(o.label));
  // 选项为纯 [[链接]]（C 形态：戏法/庇护威能）→ 无描述，仅展示所选威能
  const linkOnly = parsed.options.length > 0 && parsed.options.every((o) => !o.desc);
  // 「选择一个额外专长：[[X]]或[[Y]]」二选一专长（如行刑者「多才防御」）→ 互斥 chip 选择
  const fc = useMemo(() => featChoiceData(section.body ?? ""), [section.body]);
  if (fc) {
    const chosenFeat = typeof chosen === "string" ? chosen : "";
    return (
      <div className="pf-item">
        <div className="pf-title">{featTitle(section.title)}</div>
        {fc.flavor && <FeatureBody body={fc.flavor} fields={fields} lookup={lookup} />}
        <div className="exe-guild">
          {fc.feats.map((f) => (
            <button key={f.target} type="button" className={"exe-guild-chip" + (chosenFeat === f.target ? " selected" : "")} onClick={() => onChoose(choiceKey, chosenFeat === f.target ? "" : f.target)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="cls-options-hint">{chosenFeat ? "已选择一个专长" : "点击选择一个专长"}</div>
      </div>
    );
  }
  if (parsed.selectable) {
    return (
      <div className="pf-item">
        <div className="pf-title">{featTitle(section.title)}</div>
        {parsed.intro && <FeatureBody body={parsed.intro} fields={fields} lookup={lookup} />}
        <div className="cls-options">
          {parsed.options.map((o, i) => {
            const entry = lookup(o.label);
            const active = isChosen(o.label);
            const disabled = multiple && !active && chosenVals.length >= count;
            return (
              <SmartHover key={i} className={active ? "cls-option active" : "cls-option" + (disabled ? " cls-option-disabled" : "")} popClass="cls-option-pop" pop={entry ? <EntryCard entry={entry} /> : undefined} onClick={() => { if (!disabled) toggle(o.label); }}>
                {o.label}
              </SmartHover>
            );
          })}
        </div>
        {multiple && (
          <div className={chosenVals.length >= count ? "cls-options-hint ok" : "cls-options-hint"}>
            已选 {chosenVals.length}/{count}{chosenVals.length >= count ? " 个" : ` 个（还需 ${count - chosenVals.length} 个）`}
          </div>
        )}
        {!multiple && parsed.options.length > 0 && <div className="cls-options-hint">点击选择一个选项（{chosenVals.length}/{count}）</div>}
        {multiple && linkOnly && selOpts.length > 0 && (
          <div className="cls-choice-desc">
            <div className="cls-choice-powers">
              {selOpts.map((o, i) => {
                const entry = lookup(o.label);
                if (!entry) return <span key={i} className="cls-choice-power-name">{o.label}</span>;
                return (
                  <SmartHover key={i} className="cls-choice-power" popClass="cls-choice-power-pop" pop={<EntryCard entry={entry} />}>
                    {entry.name}{entry.nameEn ? " " + entry.nameEn : ""}
                  </SmartHover>
                );
              })}
            </div>
          </div>
        )}
        {selOpts.length > 0 && !linkOnly && selOpts.some((o) => o.desc) && (
          <div className="cls-choice-desc">
            {selOpts.map((o, i) => {
              const r = splitSidebarSubs(o.desc);
              return <OptionOrSubChoice key={i} label={o.label} desc={r.main ?? ""} innerKey={choiceKey + "::inner"} innerChosen={innerChosen} onChoose={onChoose} fields={fields} lookup={lookup} />;
            })}
          </div>
        )}
        <OptSubFold options={parsed.options} fields={fields} lookup={lookup} />
      </div>
    );
  }
  return (
    <div className="pf-item">
      <div className="pf-title">{featTitle(section.title)}</div>
      {feaGrantPowers.main && <FeatureBody body={feaGrantPowers.main} fields={fields} lookup={lookup} />}
      {feaGrantPowers.links.length > 0 && (
        <div className="cls-choice-powers">
          {feaGrantPowers.links.map((l, i) => (
            <SmartHover key={i} className="cls-choice-power" popClass="cls-choice-power-pop" pop={<EntryCard entry={l.entry} />}>
              {l.entry.name}{l.entry.nameEn ? " " + l.entry.nameEn : ""}
            </SmartHover>
          ))}
        </div>
      )}
      {secSubs.map((sub) => (
        <details className="beast-sub" key={sub.title}>
          <summary>{featTitle(sub.title).trim()}</summary>
          <div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(sub.body)} fields={fields} lookup={lookup} indent /></div></div>
            </details>
      ))}
      {featPowerHint(section.title) && <div className="pf-hint-power"><WikiBody body={featPowerHint(section.title)!} fields={fields} lookup={lookup} indent /></div>}
    </div>
  );
}

// 选项描述的渲染：开头风味句用斜体楷书；若其余描述内嵌「你可以选择用[[A]]来代替[[B]]」的
// 子二选一（如邪术师炼狱契约的炼狱叱喝/阿弗纳斯赠礼），则拆出并渲染为可点选的子选项。
function OptionOrSubChoice({ label, desc, innerKey, innerChosen, onChoose, fields, lookup, compact }: {
  label: string;
  desc: string;
  innerKey: string;
  innerChosen?: string | string[];
  onChoose: (key: string, label: string | string[]) => void;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
  compact?: boolean;
}) {
  const { flavor, rest } = useMemo(() => splitOptFlavorMulti(desc), [desc]);
  // 选项本身可能引用一个生物/魔宠条目（如元素法师「灵魔仆从」的土魔/风魔/炎魔/水魔），
  // 选中后把该生物的数据卡内联展示，并随选项切换更换。
  const creature = useMemo(() => (label ? lookup(label) : undefined), [label, lookup]);
  return (
    <>
      {label && <div className="cls-opt-name">{label}：</div>}
      {!compact && flavor && <div className="cls-opt-flavor"><WikiBody body={prose(flavor)} fields={fields} lookup={lookup} /></div>}
      {rest && (flavor ? <OptionRest desc={rest} innerKey={innerKey} innerChosen={innerChosen} onChoose={onChoose} fields={fields} lookup={lookup} compact={compact} /> : <span className="pf-rest-standalone"><OptionRest desc={rest} innerKey={innerKey} innerChosen={innerChosen} onChoose={onChoose} fields={fields} lookup={lookup} compact={compact} /></span>)}
      {creature && creature.category === "creature" && creature.sourceText && (
        <details className="beast-sub" open={!compact}>
          <summary>魔宠数据</summary>
          <div className="beast-sub-body">
            <div className="pf-body">
              <div className="pf-rest gen-creature-card" dangerouslySetInnerHTML={{ __html: wikiToHtml(creature.sourceText, fields) }} />
            </div>
          </div>
        </details>
      )}
    </>
  );
}

// 渲染选项描述中风味之外的部分；若内含「选择用[[A]]来代替[[B]]」子二选一则拆为可点选子选项
function OptionRest({ desc, innerKey, innerChosen, onChoose, fields, lookup, compact }: {
  desc: string;
  innerKey: string;
  innerChosen?: string | string[];
  onChoose: (key: string, label: string | string[]) => void;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
  compact?: boolean;
}) {
  // 同一特性内规则段落之间不留空行（压缩 \n\n → 单换行），仅首段风味保留
  const flat = desc.replace(/\n{2,}/g, "\n");
  const m = flat.match(/(你可以选择用\[\[([^\]]+)\]\]来代替\[\[([^\]]+)\]\])/);
  if (!m || m.index === undefined) return <WikiBody body={flat} fields={fields} lookup={lookup} indent />;
  const keep = m[3].trim(); // 保留的原威能（炼狱叱喝）
  const alt = m[2].trim();  // 可选的替代威能（阿弗纳斯赠礼）
  const innerVals = Array.isArray(innerChosen) ? innerChosen : innerChosen ? [innerChosen] : [];
  const opts = [keep, alt];
  const at = m.index;
  // 简洁模式：只展示当前选中的子威能（带悬停预览），不显示两个可选按钮
  if (compact) {
    const cur = opts.find((o) => innerVals.includes(o)) ?? keep;
    const curE = lookup(cur);
    return (
      <>
        <div className="cls-feat-opt-wrap">
          <SmartHover className="cls-feat-opt" popClass="cls-option-pop" pop={curE ? <EntryCard entry={curE} /> : undefined}>
            {cur}
          </SmartHover>
        </div>
        {flat.slice(at + m[0].length) && <WikiBody body={flat.slice(at + m[0].length)} fields={fields} lookup={lookup} indent />}
      </>
    );
  }
  return (
    <>
      {at > 0 && <div className="cls-sub-title">炼狱契约随意威能</div>}
      <div className="cls-sub-hint">你可以从这两项随意威能中选择：</div>
      <div className="cls-options cls-sub">
        {opts.map((l) => {
          const e = lookup(l);
          return (
            <SmartHover key={l} className={innerVals.includes(l) ? "cls-option active" : "cls-option"} popClass="cls-option-pop" pop={e ? <EntryCard entry={e} /> : undefined} onClick={() => onChoose(innerKey, innerVals.includes(l) ? "" : l)}>
              {l}
            </SmartHover>
          );
        })}
      </div>
      {flat.slice(at + m[0].length) && <WikiBody body={flat.slice(at + m[0].length)} fields={fields} lookup={lookup} indent />}
    </>
  );
}

interface AltGroup { base: FeatureSection; alts: FeatureSection[] }

// 取标题的纯中文前缀（去掉末尾的英文名，如「战士武器天赋 Fighter Weapon Talent」→「战士武器天赋」）
function cnTitle(title: string): string {
  const m = title.match(/^[^A-Za-z]+/);
  return m ? m[0].trim() : title;
}

// 某些特性标题需要改成更贴合其功能的名字（如邪术师的「魔能爆」改为「使用魔能」）
const FEAT_TITLE_RENAME: Record<string, string> = { "魔能爆 Eldritch Blast": "使用魔能", "神圣制裁": "神圣制裁（Divine Sanction）" };
function featTitle(title: string): string {
  return FEAT_TITLE_RENAME[title.trim()] ?? title;
}

// 正文中的「中文 English」名称对（如「大气精魂 Air Spirit」「召唤自然盟友 Summon Natural Ally」）：
// 在中文与英文之间插入 <br/>，使英文排在中文下方，且中间无空行。
// 仅当英文直接后接中文/中文标点/行尾时触发，避免把「力量 Strength 调整值」这类句中英文术语误切。
function enBreak(html: string): string {
  return html.replace(
    // 中文短语 + 空格 + 英文词（1~4 词）。仅在英文直接后接中文/中文标点或行尾时换行，
    // 避免把「力量 Strength 调整值」这类英文后带空格的句中术语误切。
    /([\u4e00-\u9fff·、]{1,}) ([A-Za-z][A-Za-z'’\-]{1,}(?: [A-Za-z'’\-]{1,}){0,3})(?=[\u4e00-\u9fff]|[\u3000-\u303f，。；！？、：“”‘’]|$)/g,
    "$1<br/>$2",
  );
}

// 特性正文下方补充的「获得XX威能」提示（正文无 [[威能]] 链接时，明确告知玩家获得该威能，如保护者「自然生长」）
const FEAT_POWER_HINT: Record<string, string> = { "自然生长 Nature's Growth": "获得自然生长威能" };
function featPowerHint(title: string): string | undefined {
  return FEAT_POWER_HINT[title.trim()];
}

// 精华职业（4E Essentials 系列）：职业特性按等级折叠，达到前提等级才自动展开
const ESSENTIALS_CLASS_IDS = new Set([
  "牧师（战争祭司） Cleric (Warpriest)",
  "法师（学派法师） Wizard (Mage)",
  "战士（杀手） Fighter (Slayer)",
  "战士（骑士） Fighter (Knight)",
  "游荡者（盗贼） Rogue (Thief)",
  "邪术师（魔剑士） Warlock (Hexblade)",
  "圣武士（圣骑兵） Paladin (Cavalier)",
  "游侠（斥候） Ranger (Scout)",
  "游侠（猎人） Ranger (Hunter)",
  "德鲁伊（哨兵） Druid (Sentinel)",
  "诗人（吟唱诗人） Bard (Skald)",
  "法师（巫师） Wizard (Witch)",
  "德鲁伊（保护者） Druid (Protector)",
  "野蛮人（狂战士） Barbarian (Berserker)",
  "邪术师（缚影师） Warlock (Binder)",
  "圣武士（黑暗卫士） Paladin (Blackguard)",
  "法师（元素法师） Wizard (Sha'ir)",
  "术士（元素使） Sorcerer (Elementalist)",
  "法师（剑咏士） Wizard (Bladesinger)",
]);

// 从特性标题提取前提等级：「N级：标题」→ N；无前缀的 1 级基础特性 → 1
function featureLevel(title: string): number {
  const m = title.trim().match(/^(\d+)级[：:]\s*/);
  return m ? parseInt(m[1], 10) : 1;
}



// 职业特性是否在 `level` 级可用：无等级前缀（如「混职天赋选项」「原力守护者」）恒可用；
// 带「X级：」前缀且 X ≤ level 才可用（体现逐级获得职业特性，如「5级：进阶用毒」）。
const hasLevelPrefix = (title: string) => /^\d+级[：:]/.test(title.trim());
function featureReachable(title: string, level: number): boolean {
  return !hasLevelPrefix(title) || featureLevel(title) <= level;
}

// 特性正文中的「你选择一个额外专长：[[X]]或[[Y]]」二选一专长（如行刑者「多才防御」）。
// 命中时渲染互斥 chip，选中即授予对应专长。
interface FeatChoice { flavor?: string; feats: { target: string; label: string }[] }
function featChoiceData(body: string): FeatChoice | undefined {
  const m = body.match(/选择一个额外专长[：:]\s*([\s\S]*?)(?=\n|$)/);
  if (!m) return undefined;
  const feats = [...m[1].matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map((x) => {
    const target = x[1].trim();
    return { target, label: cleanDisplayName(target) };
  });
  if (!feats.length) return undefined;
  const gidx = body.indexOf("''增益");
  const flavor = gidx >= 0 ? body.slice(0, gidx).trim() : undefined;
  return { flavor, feats };
}

// 刺客（行刑者）：先在三工会（血红正义/低语联盟/忍者之道）选一，再展示行刑者英雄层级表，然后逐条列出每级职业特性。
// 工会效果取自正文中的三个「!! 血红正义/低语联盟/忍者之道」节（含「''增益：''你获得[[威能]]…」与武器擅长）。
interface ExeGuildOption { key: string; body: string; intro?: string }
function executionerGuilds(sourceText: string): { intro?: string; options: ExeGuildOption[]; table?: string } | undefined {
  if (!sourceText || !/^!!\s*刺客公会/m.test(sourceText)) return undefined;
  const norm = (s: string) => s.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim();
  const options: ExeGuildOption[] = [];
  // 各工会的「介绍」（@@ !!! 血红正义/低语联盟/忍者之道 下 flavor）
  const introByKey: Record<string, string> = {};
  const ire = /^!!!\s*(血红正义[^\n]*|低语联盟[^\n]*|忍者之道[^\n]*)\n(?:@@\.indent\s+)?([\s\S]*?)(?=^!!!\s|^---)/gm;
  for (const m2 of sourceText.matchAll(ire)) {
    const k = norm(m2[1]);
    const t = (m2[2] || "").replace(/^@@\s*$/gm, "").trim();
    if (t) introByKey[k] = t;
  }
  const re = /^!!\s*(血红正义[^\n]*|低语联盟[^\n]*|忍者之道[^\n]*)\n([\s\S]*?)(?=^!!\s)/gm;
  for (const m of sourceText.matchAll(re)) {
    const key = norm(m[1]);
    const body = (m[2] || "").replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").trim();
    if (body) options.push({ key, body, intro: introByKey[key] });
  }
  const introM = sourceText.match(/^!!\s*刺客公会[^\n]*\n(?:@@\.indent\s+)?([\s\S]*?)(?=^!!!\s)/m);
  const intro = introM ? introM[1].replace(/^@@\s*$/gm, "").trim() : undefined;
  const tm = sourceText.match(/<table class="[^"]*">[\s\S]*?<\/table>/);
  return { intro, options, table: tm ? tm[0].replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1") : undefined };
}

// —— 学派法师：魔法学派选择（参考缚影师契约：单行学派选择，自动填充各等级收益） ——
// 学派法师（Wizard (Mage)）英雄层级共有 5 处「魔法学派」选择点：
//   1级 学徒级：选第一学派 A → 获得 A 的「学徒级」收益
//   4级 学徒级：选第二学派 B（≠A）→ 获得 B 的「学徒级」收益
//   5级 专家级：自动获得第一学派 A 的「专家级」收益
//   8级 专家级：自动获得第二学派 B（非 5级所选）的「专家级」收益
//   10级 大师级：自动获得第一学派 A 的「大师级」收益
// 具体收益不在职业条目内，而在各「魔法学派」条目（塑能/幻术/惑控/死灵/幽影/占火）中，
// 以「1级：XX学徒」「5级：XX专家」「10级：XX大师」小节组织。
interface MageSchool {
  key: string; // 学派短名（如「塑能」，用作选择标识与按钮文案）
  name: string; // 学派条目名（如「塑能学派」）
  entry: Entry; // 学派条目（用于悬浮卡片）
  apprentice?: string; // 学徒级学派法师收益（1级：XX学徒）
  expert?: string; // 专家级学派法师收益（5级：XX专家）
  master?: string; // 大师级学派法师收益（10级：XX大师）
}
function parseMageSchools(entry: Entry, schools: Entry[] | undefined): MageSchool[] {
  if (!entry.id.includes("学派法师")) return [];
  const out: MageSchool[] = [];
  for (const s of schools ?? []) {
    if (!s.tags?.includes("魔法学派")) continue;
    const secs = (s.sourceText ?? "").split(/^(?=!! )/m);
    let apprentice: string | undefined;
    let expert: string | undefined;
    let master: string | undefined;
    for (const sec of secs) {
      const m = sec.match(/^!! (.+?)\n([\s\S]*)$/);
      if (!m) continue;
      const title = m[1].trim();
      // 剥离 @@ 标记与「''学徒级/专家级/大师级学派法师特性''」粗体标签行（收益性质已由特性标题表达）
      const body = (m[2] || "")
        .replace(/^@@\.\w+\s*/gm, "")
        .replace(/^@@\s*$/gm, "")
        .replace(/^''(?:学徒级|专家级|大师级)学派法师特性''\s*\n+/m, "")
        .replace(/^\s*$/gm, "")
        .trim();
      if (!body) continue;
      if (/^1级[：:]/.test(title) && /学徒/.test(title)) apprentice = body;
      else if (/^5级[：:]/.test(title) && /专家/.test(title)) expert = body;
      else if (/^10级[：:]/.test(title) && /大师/.test(title)) master = body;
    }
    if (!apprentice && !expert && !master) continue;
    out.push({ key: s.name.replace(/学派$/, ""), name: s.name, entry: s, apprentice, expert, master });
  }
  return out;
}

// —— 黑暗卫士：支配 / 暴怒 败德二选一 ——
// 主职业「败德精神」「败德随意威能」「进阶暗影护罩」正文中引用「与你的败德相关联」的增益/威能，
// 具体内容不写在职业条目里，而在两个独立败德条目（支配败德 / 暴怒败德）中按等级小节组织。
// 玩家选定一种败德后，把这些小节的机械正文填充回对应占位特性，并据此自动授予对应随意威能。
interface BlackguardViceFill { keyword: string; body: string }
interface BlackguardViceOption { key: string; descTitle?: string; flavor?: string; fills: BlackguardViceFill[] }
interface BlackguardVicesParse { intro?: string; options: BlackguardViceOption[]; descTitles: string[] }
// 需要按败德填充的占位特性名（与败德条目里的「!! …（支配/暴怒）」小节标题包含的关键词对应）
const VICE_FILL_KEYWORDS = ["败德随意威能", "败德精神", "进阶暗影护罩", "败德辅助威能"];
function blackguardVices(entry: Entry, lookup: (t: string) => Entry | undefined): BlackguardVicesParse | undefined {
  // 先剥离全部层级表：英雄层级表位于「暴怒」小节正后方，若不剥离会被吞进暴怒的风味提取
  const src = stripLevelTables(entry.sourceText ?? "");
  if (!entry.id.includes("黑暗卫士") || !/^! 败德 Vices/m.test(src)) return undefined;
  const opts: { key: string; id: string }[] = [
    { key: "支配", id: "支配败德 Vice of Domination" },
    { key: "暴怒", id: "暴怒败德 Vice of Fury" },
  ];
  const introM = src.match(/^! 败德 Vices[^\n]*\n([\s\S]*?)(?=^!!\s)/m);
  const intro = introM ? introM[1].replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").trim() : undefined;
  const options: BlackguardViceOption[] = [];
  const VICE_EN: Record<string, string> = { 支配: "Domination", 暴怒: "Fury" };
  for (const o of opts) {
    const ve = lookup(o.id) ?? lookup(o.key);
    if (!ve || !ve.sourceText) continue;
    const en = VICE_EN[o.key];
    const descTitle = `${o.key} ${en}`;
    // 主职业条目里的「!! 支配 Domination / 暴怒 Fury」小节即为该败德的风味段。
    // 按「!! 」分节定位该小节（避免非贪婪 + $ 在 m 标志下被每行行尾提前截断，
    // 也避免把后续「!! 」小节一并吞入），再清理 @@ 标记取味。
    const fsec = src.split(/^(?=!! )/m).find((s) => {
      const h = s.match(/^!! ([^\n]+)/);
      return !!h && h[1].trim().startsWith(o.key + " " + en);
    });
    const flavor = fsec
      ? fsec.replace(/^!![^\n]*\n/, "").replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").replace(/^---+[ \t]*$/gm, "").replace(/^\s*$/gm, "").trim()
      : undefined;
    const fills: BlackguardViceFill[] = [];
    const secs = ve.sourceText.split(/^(?=!! )/m);
    for (const sec of secs) {
      const m = sec.match(/^!! (.+?)\n([\s\S]*)$/);
      if (!m) continue;
      const kw = VICE_FILL_KEYWORDS.find((k) => m[1].includes(k));
      if (!kw) continue; // 跳过 11/12/20 等「残酷黑暗卫士典范之道」小节（不匹配关键词）
      const body = (m[2] || "").replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").replace(/^\s*$/gm, "").trim();
      if (body) fills.push({ keyword: kw, body });
    }
    if (fills.length) options.push({ key: o.key, descTitle, flavor, fills });
  }
  if (!options.length) return undefined;
  return { intro, options, descTitles: options.map((o) => o.descTitle!).filter(Boolean) };
}

// —— 缚影师：契约三选一（精类/星辰/阴暗） ——
// 主职业「契约之赐」「契约学识」「盟友召唤」占位特性正文写"与你的契约相关联"，
// 具体内容不写在职业条目里，而在独立的 (缚影师) 契约条目中按等级小节组织。
// 玩家选定一个契约后，把这些小节的机械正文填充回对应占位特性，并据此自动授予对应威能。
interface BinderPactFill { keyword: string; body: string }
interface BinderPactOption { key: string; descTitle?: string; flavor?: string; fills: BinderPactFill[] }
interface BinderPactsParse { kind: "binder" | "hexblade"; intro?: string; options: BinderPactOption[]; descTitles: string[] }
// 占位特性关键词 → 契约条目里「!! XX契约之赐（缚影师）/契约学识/缚影师盟友/高阶盟友」「缚影师行动/恩惠/之赐」等标题包含的关键词。
// 契约遭遇威能节（正文为「{{威能}}」说明，无机械描述）也一并填充，便于显示规则正文（但不自动授权 —— 保留为"选择槽"）。
const PACT_FILL_KEYWORDS = ["契约之赐", "契约学识", "缚影师盟友", "高阶缚影师盟友", "缚影师行动", "缚影师恩惠", "缚影师之赐", "契约遭遇威能"];
function binderPacts(entry: Entry, lookup: (t: string) => Entry | undefined): BinderPactsParse | undefined {
  const src = stripLevelTables(entry.sourceText ?? "");
  if (!entry.id.includes("缚影师") || !/^! 契约/m.test(src)) return undefined;
  const opts: { key: string; id: string }[] = [
    { key: "精类", id: "精类契约 Fey Pact (Binder)" },
    { key: "星辰", id: "星辰契约 Star Pact (Binder)" },
    { key: "阴暗", id: "阴暗契约 Gloom Pact (Binder)" },
  ];
  // 主职业条目里的「! 契约」段是介绍文字
  const introM = src.match(/^! 契约[^\n]*\n([\s\S]*?)(?=^---)/m);
  const intro = introM ? introM[1].replace(/^<<list-links[^>]*>>[ \t]*\r?\n?/gm, "").replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").trim() : undefined;
  const options: BinderPactOption[] = [];
  for (const o of opts) {
    const pe = lookup(o.id) ?? lookup(o.key + "契约");
    if (!pe || !pe.sourceText) continue;
    const fills: BinderPactFill[] = [];
    const secs = pe.sourceText.split(/^(?=!! )/m);
    for (const sec of secs) {
      const m = sec.match(/^!! (.+?)\n([\s\S]*)$/);
      if (!m) continue;
      const kw = PACT_FILL_KEYWORDS.find((k) => m[1].includes(k));
      if (!kw) continue;
      const body = (m[2] || "").replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").replace(/^\s*$/gm, "").trim();
      if (body) fills.push({ keyword: kw, body });
    }
    if (!fills.length) continue;
    // 契约风味：契约条目顶部 @@.indent 段（缚影师特有的介绍性文字）
    let flavor: string | undefined;
    const fm = pe.sourceText.match(/^@@\.indent\s*\n([\s\S]*?)(?=^!! )/m);
    if (fm) flavor = fm[1].replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").replace(/^\s*$/gm, "").trim();
    options.push({ key: o.key, descTitle: o.key + "契约", flavor, fills });
  }
  if (!options.length) return undefined;
  return { kind: "binder", intro, options, descTitles: options.map((o) => o.descTitle!).filter(Boolean) };
}

// —— 魔剑士（邪术师·魔剑士）：契约五选一（精类/炼狱/星辰/阴暗/元素） ——
// 与缚影师相同：主职业「契约奖励/契约之赐/契约武器/契约武器惩戒/召唤邪术师盟友/高阶召唤邪术师盟友」
// 占位特性正文写"由你的契约决定"，机械内容在独立的「魔剑士契约」条目中按等级小节组织。
// 玩家选定一个契约后，把这些小节正文填充回对应占位特性；{{威能}} 模板还原为 [[威能]] 链接，
// 以随特征正文自动授予契约威能与契约武器附带威能（如精类契约武器附带的冰刺击/穿刺碎片）。
// 契约条目里的「（Dragon #393）」替换件与「16级：进阶…契约之赐」等典范变体在此不单独拆分，
// 仅取各占位特性的标准小节；契约内「!! 11/12/20级：魔剑士行动/面貌/诅咒/祈祷/变形」为典范特性，
// 无对应占位特性，故不参与填充。
interface HexbladePactTarget { name: string; headerKey: string }
const HEXBLADE_TARGETS: HexbladePactTarget[] = [
  { name: "高阶召唤邪术师盟友", headerKey: "高阶召唤邪术师盟友" },
  { name: "召唤邪术师盟友", headerKey: "召唤邪术师盟友" },
  { name: "契约武器惩戒", headerKey: "契约武器惩戒" },
  { name: "契约武器", headerKey: "契约武器" },
  { name: "契约奖励", headerKey: "契约奖励" },
  { name: "契约之赐", headerKey: "契约之赐" },
];
function hexbladePacts(entry: Entry, lookup: (t: string) => Entry | undefined): BinderPactsParse | undefined {
  const src = stripLevelTables(entry.sourceText ?? "");
  if (!entry.id.includes("魔剑士") || !/^! 契约/m.test(src)) return undefined;
  const opts: { key: string; id: string }[] = [
    { key: "精类", id: "精类契约 Fey Pact" },
    { key: "炼狱", id: "炼狱契约 Infernal Pact" },
    { key: "星辰", id: "星辰契约 Star Pact" },
    { key: "阴暗", id: "阴暗契约 Gloom Pact" },
    { key: "元素", id: "元素契约 Elemental Pact" },
  ];
  // 主职业条目里的「! 契约」段是介绍文字
  const introM = src.match(/^! 契约[^\n]*\n([\s\S]*?)(?=^---)/m);
  const intro = introM ? introM[1].replace(/^<<list-links[^>]*>>[ \t]*\r?\n?/gm, "").replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").trim() : undefined;
  const options: BinderPactOption[] = [];
  for (const o of opts) {
    const pe = lookup(o.id) ?? lookup(o.key + "契约");
    if (!pe || !pe.sourceText) continue;
    // 契约章节 → 占位特性：跳过（Dragon #393）替换件与「进阶…」典范变体，命中后取指定名称
    const fills: BinderPactFill[] = [];
    const secs = pe.sourceText.split(/^(?=!! )/m);
    for (const sec of secs) {
      const m = sec.match(/^!! (.+?)\n([\s\S]*)$/);
      if (!m) continue;
      const header = m[1];
      if (header.includes("Dragon") || header.includes("进阶")) continue;
      const hit = HEXBLADE_TARGETS.find((t) => header.includes(t.headerKey));
      if (!hit || fills.some((f) => f.keyword === hit.name)) continue;
      let body = (m[2] || "").replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").replace(/^\s*$/gm, "").trim();
      // {{威能}} 模板（契约武器附带的威能卡）还原为 [[威能]] 链接，随特征正文自动授予
      body = body.replace(/\{\{([^}]+)\}\}/g, "[[$1]]");
      // 契约武器：把内嵌的随意威能卡标记出来，按魔法物品（附魔武器）样式呈现在真实武器面板里
      if (hit.name === "契约武器") {
        body = body.replace(/<div id=powercard>/, '<div id="powercard" class="hb-contract-weapon">');
      }
      if (body) fills.push({ keyword: hit.name, body });
    }
    if (!fills.length) continue;
    options.push({ key: o.key, descTitle: o.key + "契约", fills });
  }
  if (!options.length) return undefined;
  return { kind: "hexblade", intro, options, descTitles: [] };
}

// —— 圣骑兵：美德二选一（牺牲 / 英勇） ——
// 主职业「美德精神」「美德随意威能」「进阶正义之盾」「共享美德」占位特性正文写"与你的美德相关联"，
// 具体内容不写在职业条目里，而在两个独立美德条目（牺牲美德 / 英勇美德）中按等级小节组织。
// 玩家选定一种美德后，把这些小节的机械正文填充回对应占位特性，并据此自动授予对应威能（希望打击/报复打击等）。
interface VirtueFill { keyword: string; body: string }
interface VirtueOption { key: string; descTitle?: string; flavor?: string; fills: VirtueFill[] }
interface VirtuesParse { intro?: string; options: VirtueOption[]; descTitles: string[] }
// 占位特性关键词 → 美德条目里「!! 1级：牺牲精神/美德随意威能/7级：进阶正义之盾/22级：共享牺牲」等标题包含的关键词
const VIRTUE_FILL_KEYWORDS = ["美德随意威能", "精神", "进阶正义之盾", "共享"];
function cavalierVirtues(entry: Entry, lookup: (t: string) => Entry | undefined): VirtuesParse | undefined {
  const src = stripLevelTables(entry.sourceText ?? "");
  if (!entry.id.includes("圣骑兵") || !/^! 美德 Virtues/m.test(src)) return undefined;
  const opts: { key: string; id: string; en: string }[] = [
    { key: "牺牲", id: "牺牲美德 Virtue of Sacrifice", en: "Sacrifice" },
    { key: "英勇", id: "英勇美德 Virtue of Valor", en: "Valor" },
  ];
  const introM = src.match(/^! 美德 Virtues[^\n]*\n([\s\S]*?)(?=^!!\s)/m);
  const intro = introM ? introM[1].replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").trim() : undefined;
  const options: VirtueOption[] = [];
  for (const o of opts) {
    const ve = lookup(o.id) ?? lookup(o.key + "美德");
    if (!ve || !ve.sourceText) continue;
    const descTitle = `${o.key} ${o.en}`;
    // 主职业条目里的「!! 牺牲 Sacrifice / 英勇 Valor」小节即为该美德的风味段
    const fsec = src.split(/^(?=!! )/m).find((s) => {
      const h = s.match(/^!! ([^\n]+)/);
      return !!h && h[1].trim().startsWith(o.key + " " + o.en);
    });
    const flavor = fsec
      ? fsec.replace(/^!![^\n]*\n/, "").replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").replace(/^---+[ \t]*$/gm, "").replace(/^\s*$/gm, "").trim()
      : undefined;
    const fills: VirtueFill[] = [];
    const secs = ve.sourceText.split(/^(?=!! )/m);
    for (const sec of secs) {
      const m = sec.match(/^!! (.+?)\n([\s\S]*)$/);
      if (!m) continue;
      const kw = VIRTUE_FILL_KEYWORDS.find((k) => m[1].includes(k));
      if (!kw) continue;
      const body = (m[2] || "").replace(/^@@\.\w+\s*/gm, "").replace(/^@@\s*$/gm, "").replace(/^\s*$/gm, "").trim();
      if (body) fills.push({ keyword: kw, body });
    }
    if (fills.length) options.push({ key: o.key, descTitle, flavor, fills });
  }
  if (!options.length) return undefined;
  return { intro, options, descTitles: options.map((o) => o.descTitle!).filter(Boolean) };
}

// —— 战争祭司：领域选择 ——
// 战争祭司的职业特性几乎全部由所选「领域」派生：主职业条目里只有占位特性（「N级：领域特性和威能」
// 「引导神力威能」「领域特性」「领域遭遇威能」等），具体收益/威能在独立领域条目（大地/风暴/太阳…）
// 中按「!! N级：…」分节组织。选定领域后，把这些小节填充回对应等级+类型的占位特性，并据此自动授予领域威能。
interface WarpriestDomainSection { level: number; type: "all" | "channel" | "encounter" | "feature"; title: string; body: string }
interface WarpriestDomainOption { key: string; name: string; entry: Entry; sections: WarpriestDomainSection[]; powers: { title: string; level: number }[] }
interface WarpriestDomainsParse { options: WarpriestDomainOption[] }
// 特性标题 → 领域小节类型判定（主职业占位特性与领域小节标题共用此判定，按相同「等级+类型」配对填充）
function domainTypeOf(title: string): "all" | "channel" | "encounter" | "feature" | undefined {
  const t = cnTitle(title);
  if (t.includes("领域特性和威能")) return "all";
  if (t.includes("引导神力")) return "channel";
  if (t.includes("领域遭遇威能")) return "encounter";
  if (t.includes("领域特性")) return "feature";
  return undefined;
}
function warpriestDomains(entry: Entry, domains: Entry[] | undefined): WarpriestDomainsParse | undefined {
  if (!entry.id.includes("战争祭司")) return undefined;
  const options: WarpriestDomainOption[] = [];
  for (const d of domains ?? []) {
    if (d.category !== "domain" && !(d.tags ?? []).includes("领域")) continue;
    const sections: WarpriestDomainSection[] = [];
    const powerLv = new Map<string, number>();
    const secs = (d.sourceText ?? "").split(/^(?=!! )/m);
    for (const sec of secs) {
      const m = sec.match(/^!! (.+?)\n([\s\S]*)$/);
      if (!m) continue;
      const title = m[1].trim();
      const level = featureLevel(title);
      const type = domainTypeOf(title);
      if (level <= 0) continue;
      let body = m[2] || "";
      // 记录本小节每个 {{威能}} 引用及其小节等级，用于自动授予；并把 {{威能}} 还原为 [[威能]] 常驻悬浮链接便于展示
      const pm = /\{\{([^}]+)\}\}/g;
      let pmc: RegExpExecArray | null;
      while ((pmc = pm.exec(body)) !== null) {
        const t = pmc[1].trim();
        if (level < (powerLv.get(t) ?? Infinity)) powerLv.set(t, level);
      }
      body = body
        .split("\n")
        // 去掉「!!! 领域随意威能」等小节标题的 ! 前缀，避免被 wikiToHtml 转成 <h4/h5/h6>（会造成字号异常与多余空行）
        .map((l) => l.replace(/^!{1,}\s*/, "").trim())
        // 去掉纯英文风味行与空行（保留中文机制正文）
        .filter((l) => /[\u4e00-\u9fff]/.test(l))
        // {{威能}} → [[威能|中文]]、[[威能]] → [[威能|中文]]：目标保留全名供自动授予，显示只用中文别名
        .map((l) => l
          .replace(/\{\{([^}]+)\}\}/g, (_m, t) => `[[${t}|${cnTitle(t)}]]`)
          .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t, a) => (a ? `[[${t}|${a}]]` : `[[${t}|${cnTitle(t)}]]`)))
        .join("\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
      if (body) sections.push({ level, type: type ?? "all", title, body });
    }
    const powers = [...powerLv.entries()].map(([title, level]) => ({ title, level }));
    options.push({ key: d.name, name: d.name, entry: d, sections, powers });
  }
  return options.length ? { options } : undefined;
}

// 压缩连续空行段落，使特性正文段落之间不留空行
function prose(b: string): string {
  return b.replace(/\n{2,}/g, "\n");
}

// 把 [[中文 English]]/[[链接|别名]] 链接转为纯文本（取中文前缀或别名），用于无需悬浮预览的引言
function plainWikiLinks(b: string): string {
  return b.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, title: string, alias?: string) => alias ?? cnTitle(title.trim()));
}

// 提取该职业所有层级的层级表（英雄/典范/传奇，caption 含「层级」），供折叠到「具有下列职业特性」标题下方展示
function extractLevelTables(src: string): string[] {
  const out: string[] = [];
  // 层级表的 <caption>…层级…</caption> 直接跟在 <table> 开头标签之后，才能从该表自身起始匹配，
  // 避免从前一个无关 <table>（如「偷袭额外伤害」表）开始截取，把中间的英雄内容错当层级表。
  const re = /<table[^>]*>\s*<caption>[^<]*层级[^<]*<\/caption>[\s\S]*?<\/table>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[0]);
  return out;
}

// 从源码中剥离所有层级表及其相邻分隔线，避免其在原区块重复渲染
function stripLevelTables(src: string): string {
  return src.replace(/[ \t]*---[ \t]*\r?\n?<table[^>]*>\s*<caption>[^<]*层级[^<]*<\/caption>[\s\S]*?<\/table>[ \t]*(?:\r?\n---[ \t]*)?/g, "");
}

// 规则/指引触发词：某句含这些词即视为「规则文字」而非风味叙述
const FLAVOR_STOP = /(你(?:获得|可以选择|选择|使用|必须|不能|会获得|造成|受到)|选择|使用|进行|着用|视为|攻击骰|攻击|命中|重击|检定|豁免|标记|借机|目标|骰|每回合|每个回合|每轮一次|每遭遇一次|一回合|自由动作|临时生命值|若你|当你|如果你|如果|前提|需求|擅长|威能|要求)/;

// 识别「''标签：''」开头的粗体规则标题行（如萨满守护精魂/哨卫精魂的「精魂恩赐 Spirit Boon：」）。
// 这类行是规则结构而非风味叙述，整段不判风味，直接作为规则正文（缩进渲染）。
const FLAVOR_TAG_OPEN = /^\s*''[^'\n]*[：:]\s*''/;

// 已知「整段均为风味」的引言前缀：正文含「你获得」等规则触发词，但整段仍是叙述性风味，
// 不应被逐句扫描截断（如神罚使「神罚天谴」开头的三句叙述）。命中时整段首段视为风味。
const FLAVOR_FULL_PREFIXES = [
  "作为一个神罚使，你锤炼自己的思想、肉体和灵魂，只为一个目的：毁灭与你的信仰的敌对的人。",
];

// 把职业特性正文开头的叙述性(风味)句子与随后的规则/指引句子分开，供斜体楷书渲染风味文字。
// 规则：仅取首个自然段（首个空行之前）作为风味候选，逐句扫描，遇到含规则触发词的句子即停止；
// 停止前累积的句子视为风味。首个空行之后的内容一律视为规则正文（如保护者「召唤自然盟友」的
// 「由于该特性…」升级规则不会被误判为风味，也不会因正文内深层的「''N级：''」标签而误判整段）。
function splitFlavor(body: string): { flavor: string; rest: string } {
  // 首行是「''标签：''」粗体规则标题行（规则列表而非风味叙述），整段不判风味
  if (FLAVOR_TAG_OPEN.test(body)) return { flavor: "", rest: body };
  for (const pre of FLAVOR_FULL_PREFIXES) {
    if (body.startsWith(pre)) {
      const nl = body.indexOf("\n");
      if (nl >= 0) return { flavor: body.slice(0, nl), rest: body.slice(nl) };
      return { flavor: body, rest: "" };
    }
  }
  // 首个自然段（首个空行之前）作为风味候选
  const paraM = /^([\s\S]*?)(?:\n\s*\n|$)/.exec(body);
  const first = paraM ? paraM[1] : body;
  // 若紧随首段之后是「''规则标签：''」粗体规则行（如武僧修士宗派的各宗派描述引言：
  // <风味叙述…>\n\n''规则标签：…''\n…），则首段整段视为风味，其后为规则正文。
  // 仅在「段首」判定，避免命中正文内深层小节里的「''N级：''」等标签（如召唤自然盟友的子章节）。
  if (paraM && paraM[0].endsWith("\n") && /^\s*''[^'\n]*?[：:]\s*''/.test(body.slice(paraM[0].length))) {
    return { flavor: first.trim(), rest: body.slice(paraM[0].length) };
  }
  // 句尾标点「。！？」可选：首段末尾常有无标点的叙述句，也视为风味的一部分
  const re = /\s*([^。！？!?]+(?:[。！？!?])?)/g;
  let end = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(first))) {
    if (FLAVOR_STOP.test(m[0])) break;
    end = re.lastIndex;
  }
  if (!end) return { flavor: "", rest: body };
  return { flavor: first.slice(0, end), rest: body.slice(end) };
}

// 在 splitFlavor 基础上扩展「连续多个风味段落」：当首段已判定为风味后，继续累积其后紧随的
// 纯英文叙述段（不含中文字符），直至遇到含中文的规则段、粗体规则标签「''X：''」或列表「*/数字」。 
// 用于正确吸收如哨兵「自然循环之侍从」各季节选项前连续的两段英文风味，避免第二段被当作规则正文。
function splitOptFlavorMulti(body: string): { flavor: string; rest: string } {
  const base = splitFlavor(body);
  if (!base.flavor || !base.rest) return base; // 首段无风味或风味即全文：无扩展空间
  const parts = base.rest.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  let flavor = base.flavor;
  let keep = 0;
  for (const p of parts) {
    if (/[\u4e00-\u9fff]/.test(p) || /^''[^'\n]*[：:]''/.test(p) || /^\*|^\d+\./.test(p)) break;
    flavor += "\n\n" + p;
    keep++;
  }
  return { flavor, rest: parts.slice(keep).join("\n\n") };
}

// 渲染特性正文：开头风味句用斜体楷书，其余规则正文照常
// hideFlavor 时仅输出规则正文（简洁模式隐藏风味文字）
function FeatureBody({ body, fields, lookup, className, hideFlavor }: {
  body: string;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
  className?: string;
  hideFlavor?: boolean;
}) {
  // 传入原始正文（保留空行段落）以正确切分首段风味；压缩空行在渲染时分别对 flavor/rest 进行
  const { flavor, rest } = useMemo(() => splitFlavor(body), [body]);
  // 去掉 rest 开头的换行，改用块级容器强制换行（确保风味句后的规则文本另起一行缩进）
  const restTrim = useMemo(() => prose(rest).replace(/^\n+/, "").trimStart(), [rest]);
  return (
    <div className={className ?? "pf-body"}>
      {!hideFlavor && flavor && <span className="pf-flavor"><WikiBody body={prose(flavor)} fields={fields} lookup={lookup} /></span>}
      {restTrim && <div className="pf-rest"><WikiBody body={restTrim} fields={fields} lookup={lookup} indent /></div>}
    </div>
  );
}

// 把「职位/威能来源」后紧跟的风味文字拆到下一行
function splitTraitLabels(t: string): string {
  return t.replace(/(\{\{!!role\}\})。/, "$1。\n").replace(/(\{\{!!power source\}\})。/, "$1。\n");
}

// 归一特性标题到纯中文核心：去掉「N级：」等级前缀与英文（如「1级：战斗守卫者 Battle Guardian」→「战斗守卫者」），
// 用于替代组基础项的歧义消除匹配。
function featBaseName(t: string): string {
  return cnTitle(t).replace(/^\d{1,2}级[：:]?\s*/, "").trim();
}

function detectReplacementGroups(sections: FeatureSection[]): Map<string, AltGroup> {
  const refs = new Map<string, FeatureSection[]>();
  for (const s of sections) {
    const b = s.body ?? "";
    // 三种「可选替代」表述：
    //  1) 标准：「此职业特性会替代「X」职业特性」（基础职业特性）
    //  2) 链接式：「你可以选择[[A]]威能来替换[[B]]」（可选替代威能，如骑士「精野守卫者」替代「战斗守卫者」）
    //  3) 引用式：「你可选择此特性来替换「B」特性」（可选替代特性，如骑士「旋木偏移」替代「盾牌娴熟」）
    const m1 = b.match(/此职业特性会替代「([^」]+)」职业特性/);
    const m2 = b.match(/你可以?选择\[\[[^\]]+\]\]威能来替换\[\[([^\]]+)\]\]/);
    const m3 = b.match(/你可选择此特性来替换「([^」]+)」特性?/);
    const ref = (m1 ? m1[1].trim() : "") || (m2 ? m2[1].trim() : "") || (m3 ? m3[1].trim() : "");
    if (!ref) continue;
    if (!refs.has(ref)) refs.set(ref, []);
    refs.get(ref)!.push(s);
  }
  const groups = new Map<string, AltGroup>();
  for (const [ref, alts] of refs) {
    // 基础项歧义消除：按「N级：」前缀无关的纯中文核心名匹配，且排除替代项自身
    const core = featBaseName(ref);
    const base = sections.find((x) => featBaseName(x.title) === core && !alts.includes(x));
    if (base) groups.set(base.title, { base, alts });
  }
  return groups;
}

// 展示 base 与其替代项合并的选项组；base 自身带内部选择（如战士武器天赋选单手/双手）时，选中 base 再渲染内层子选项
// 召唤坐骑：解析「你获得[[召唤天堂坐骑 Call Celestial Steed]]威能」→ 威能 details 中的生物链接（天堂战马 Celestial Warhorse），
// 把该生物的数据卡以内联折叠展示（详图默认展开、简洁默认收起），实现对该特性的坐骑数据进行预览。
function SummonedSteedData({ section, detail, fields, lookup }: {
  section: FeatureSection;
  detail: boolean;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
}) {
  // 从特性正文中提取召唤威能，再由威能正文（details/sourceText）提取其召出的生物
  const creature = useMemo(() => {
    const pwTarget = wikiLinkTargets(section.body ?? "").find((t) => lookup(t)?.category === "power" && /召唤天堂坐骑/.test(t));
    const pw = pwTarget ? lookup(pwTarget) : undefined;
    if (!pw) return undefined;
    const crTarget = wikiLinkTargets(`${pw.fields?.details ?? ""}\n${pw.sourceText ?? ""}`).find((t) => lookup(t)?.category === "creature");
    return crTarget ? lookup(crTarget) : undefined;
  }, [section.body, lookup]);
  if (!creature || !creature.sourceText) return null;
  return (
    <details className="beast-sub" open={detail}>
      <summary>{cleanDisplayName(creature.name)}数据</summary>
      <div className="beast-sub-body">
        <div className="pf-body">
          <div className="pf-rest gen-creature-card" dangerouslySetInnerHTML={{ __html: wikiToHtml(creature.sourceText, fields) }} />
        </div>
      </div>
    </details>
  );
}

// —— 哨兵「动物伙伴」专属渲染 ——
// 该特性按结构重组为：风味引进 → 收益（增益）行 → 所选季节的动物伙伴（位于收益下方）→ 折叠的规则小节。
// {{狼动物伙伴…}} 等生物转clusion 在 parseFeatureSections 时已作为 powerRefs 提取并保留（正文中被剔除），
// 故按「季节↔伙伴」关键词在 refs 中匹配 creature 条目渲染其数据卡。
const SEASON_TO_COMPANION: Record<string, string> = { "春": "狼", "夏": "熊", "荒原": "活体微风" };
// 取「自然循环之侍从」所选季节对应的伙伴关键词（返回如「狼」「熊」「活体微风」），无法判定返回 undefined
function companionKwOf(season?: string): string | undefined {
  if (!season) return undefined;
  return Object.entries(SEASON_TO_COMPANION).find(([s]) => season.includes(s))?.[1];
}

// 伙伴 creature 数据卡（低层）：渲染为 beast-sub 折叠，详图默认展开、简洁默认收起
function AnimalCompanionData({ creature, detail, fields }: {
  creature: Entry;
  detail: boolean;
  fields: Record<string, string>;
}) {
  if (!creature.sourceText) return null;
  return (
    <details className="beast-sub" open={detail}>
      <summary>{cleanDisplayName(creature.name)}数据</summary>
      <div className="beast-sub-body">
        <div className="pf-body">
          <div className="pf-rest gen-creature-card" dangerouslySetInnerHTML={{ __html: wikiToHtml(creature.sourceText, fields) }} />
        </div>
      </div>
    </details>
  );
}

interface AnimalCompanionSub {
  title: string;         // !!! 子小节标题（含中英文）
  body: string;          // 子小节正文
  kind: "fold" | "companion"; // fold=需折叠的规则小节（动物伙伴动作/独立动作）；companion=与季节对应的伙伴小节
}
interface AnimalCompanionParse {
  intro: string;         // 特性开头风味引进（增益行之前）
  benefit: string;       // ''增益：''… 收益行
  rules: string;         // 收益行之后、首个 !!! 之前的规则文本（折叠为「你的动物伙伴」）
  subs: AnimalCompanionSub[];
}
// 解析「动物伙伴」特性正文为上述结构
function parseAnimalCompanion(body: string): AnimalCompanionParse {
  const benM = body.match(/''增益[：:]\s*''/);
  const intro = benM ? body.slice(0, benM.index).trim() : body;
  const post = benM ? body.slice(benM.index) : "";
  const nlPos = post.indexOf("\n");
  const benefit = (nlPos >= 0 ? post.slice(0, nlPos) : post).trim();
  const after = nlPos >= 0 ? post.slice(nlPos) : "";
  const subIdx = after.search(/^!!! /m);
  const rules = (subIdx >= 0 ? after.slice(0, subIdx) : after).replace(/^\s*$/gm, "").trim();
  const subsRaw = subIdx >= 0 ? after.slice(subIdx) : "";
  const raw: { title: string; body: string }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  for (const line of subsRaw.split("\n")) {
    const h = line.match(/^!!! (.+)$/);
    if (h) {
      if (cur) raw.push({ title: cur.title, body: cur.body.join("\n") });
      cur = { title: h[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) raw.push({ title: cur.title, body: cur.body.join("\n") });
  const subs: AnimalCompanionSub[] = raw.map((s) => ({
    title: s.title,
    body: s.body,
    // 规则小节：标题含「动作」（动物伙伴动作/动物伙伴独立动作）；其余为与季节对应的伙伴小节
    kind: s.title.includes("动作") ? "fold" : "companion",
  }));
  return { intro, benefit, rules, subs };
}

// 「动物伙伴」特性主渲染：重组风味/收益/伙伴/折叠规则。
function AnimalCompanionBlock({ section, detail, fields, season, lookup }: {
  section: FeatureSection;
  detail: boolean;
  fields: Record<string, string>;
  season?: string; // 「自然循环之侍从」所选季节（联动伙伴）
  lookup: (target: string) => Entry | undefined;
}) {
  const refs = section.powerRefs ?? [];
  const { intro, benefit, rules, subs } = useMemo(() => parseAnimalCompanion(section.body ?? ""), [section.body]);
  // 所选季节对应伙伴小节的子标题正文（如「春之德鲁伊：狼 Druid of Spring: Wolf + 英文风味」）
  const selSub = useMemo(() => subs.find((s) => s.kind === "companion" && s.title.includes(season?.split(" ")[0] ?? season ?? "")), [subs, season]);
  // 所选季节对应伙伴数据卡
  const companion = useMemo(() => {
    const kw = companionKwOf(season);
    if (!kw) return undefined;
    const full = refs.find((r) => lookup(r)?.category === "creature" && r.includes(kw));
    return full ? lookup(full) : undefined;
  }, [refs, season, lookup, selSub]);
  const foldSubs = subs.filter((s) => s.kind === "fold");

  // 折叠规则小节的摘要名：去英文后的中文名（如「动物伙伴动作」「动物伙伴独立动作」）
  const foldName = (t: string) => cnTitle(t).trim();

  if (!detail) {
    // 简洁模式：隐藏风味，仅显示特性名 + 收益 + 所选伙伴数据卡；规则小节折叠收起
    return (
      <div className="cls-feat set">
        <div className="cls-feat-name">{cleanDisplayName(featTitle(section.title))}</div>
        {benefit && <div className="cls-feat-note"><WikiBody body={prose(benefit)} fields={fields} lookup={lookup} indent /></div>}
        {selSub && <div className="ac-companion-name">{cleanDisplayName(selSub.title)}</div>}
        {companion && <AnimalCompanionData creature={companion} detail={false} fields={fields} />}
        {rules && <details className="beast-sub"><summary>你的动物伙伴</summary><div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(rules)} fields={fields} lookup={lookup} indent /></div></div></details>}
        {foldSubs.map((s) => (
          <details className="beast-sub" key={s.title}><summary>{foldName(s.title)}</summary><div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(s.body)} fields={fields} lookup={lookup} indent /></div></div></details>
        ))}
      </div>
    );
  }
  // 详图模式：风味 → 收益 → 所选伙伴（收益下方）→ 折叠规则
  return (
    <div className="pf-item">
      <div className="pf-title">{featTitle(section.title)}</div>
      {intro && <div className="pf-body"><span className="pf-flavor"><WikiBody body={prose(intro)} fields={fields} lookup={lookup} /></span></div>}
      {benefit && <div className="pf-body"><div className="pf-rest"><WikiBody body={prose(benefit)} fields={fields} lookup={lookup} indent /></div></div>}
      {selSub && companion && (
        <div className="ac-companion">
          <div className="ac-opt-name">{cleanDisplayName(selSub.title)}</div>
          {selSub.body && <div className="pf-body"><span className="pf-flavor"><WikiBody body={prose(selSub.body)} fields={fields} lookup={lookup} /></span></div>}
          <AnimalCompanionData creature={companion} detail fields={fields} />
        </div>
      )}
      {!season && <div className="ac-companion-hint">请先在『自然循环之侍从』中选择季节</div>}
      {rules && <details className="beast-sub"><summary>你的动物伙伴</summary><div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(rules)} fields={fields} lookup={lookup} indent /></div></div></details>}
      {foldSubs.map((s) => (
        <details className="beast-sub" key={s.title}><summary>{foldName(s.title)}</summary><div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(s.body)} fields={fields} lookup={lookup} indent /></div></div></details>
      ))}
    </div>
  );
}

// —— 哨兵季节变体特性（13级自然循环典范 / 17级动物伙伴威能）——
// 结构与「动物伙伴」相似但更简单：引言 + 春/夏/荒原三个「!!!」小节，各含「''增益：''」收益。
// 根据「自然循环之侍从」所选季节，仅显示/生效对应小节。
interface SeasonVariantPart { title: string; body: string }
function splitSeasonVariant(body: string): { intro: string; subs: SeasonVariantPart[] } {
  const subIdx = body.search(/^!!! /m);
  const intro = (subIdx >= 0 ? body.slice(0, subIdx) : body).replace(/^\s*$/gm, "").trim();
  const raw = subIdx >= 0 ? body.slice(subIdx) : "";
  const subs: SeasonVariantPart[] = [];
  let cur: SeasonVariantPart | null = null;
  for (const line of raw.split("\n")) {
    const h = line.match(/^!!! (.+)$/);
    if (h) {
      if (cur) subs.push(cur);
      cur = { title: h[1].trim(), body: "" };
    } else if (cur) {
      cur.body += (cur.body ? "\n" : "") + line;
    }
  }
  if (cur) subs.push(cur);
  return { intro, subs };
}
// 取正文中与所选季节匹配的那一个「!!!」小节；未选季节或无法匹配时返回 undefined
function seasonSubOf(body: string, season?: string): SeasonVariantPart | undefined {
  if (!season) return undefined;
  const seasonCJK = Object.keys(SEASON_TO_COMPANION).find((s) => season.includes(s));
  if (!seasonCJK) return undefined;
  return splitSeasonVariant(body).subs.find((x) => x.title.includes(seasonCJK));
}

// 「自然循环典范/动物伙伴威能」主渲染：引言风味 + 所选季节小节（风味 + 收益），并按季节过滤展示。
function SeasonVariantBlock({ section, detail, fields, season, lookup }: {
  section: FeatureSection;
  detail: boolean;
  fields: Record<string, string>;
  season?: string;
  lookup: (target: string) => Entry | undefined;
}) {
  const { intro } = useMemo(() => splitSeasonVariant(section.body ?? ""), [section.body]);
  const selSub = useMemo(() => seasonSubOf(section.body ?? "", season), [section.body, season]);
  if (!detail) {
    // 简洁模式：隐藏风味，仅显示特性名 + 所选季节的收益；规则收益用紧凑样式
    return (
      <div className="cls-feat set">
        <div className="cls-feat-name">{cleanDisplayName(featTitle(section.title))}</div>
        {selSub && <div className="cls-feat-note"><WikiBody body={prose(selSub.body)} fields={fields} lookup={lookup} indent /></div>}
      </div>
    );
  }
  // 详图模式：引言风味 → 所选季节小节（小节名 + 风味 + 收益）
  return (
    <div className="pf-item">
      <div className="pf-title">{featTitle(section.title)}</div>
      {intro && <div className="pf-body"><span className="pf-flavor"><WikiBody body={prose(intro)} fields={fields} lookup={lookup} /></span></div>}
      {selSub && (
        <div className="ac-companion">
          <div className="ac-opt-name">{cleanDisplayName(selSub.title)}</div>
          <SeasonVariantBody body={selSub.body} fields={fields} lookup={lookup} />
        </div>
      )}
      {!season && <div className="ac-companion-hint">请先在『自然循环之侍从』中选择季节</div>}
    </div>
  );
}

// 季节小节正文：分隔风味（英文叙述）与「''增益：''」规则收益后分别渲染
function SeasonVariantBody({ body, fields, lookup }: { body: string; fields: Record<string, string>; lookup: (target: string) => Entry | undefined }) {
  const { flavor, rest } = useMemo(() => splitOptFlavorMulti(body), [body]);
  return (
    <div className="pf-body">
      {flavor && <span className="pf-flavor"><WikiBody body={prose(flavor)} fields={fields} lookup={lookup} /></span>}
      {rest && <div className="pf-rest"><WikiBody body={prose(rest)} fields={fields} lookup={lookup} indent /></div>}
    </div>
  );
}

// 圣骑兵「召唤坐骑」替代组：当选中「召唤坐骑」时，在其正文下方附上坐骑生物数据折叠。
// 复用 ReplacementGroupItem，仅对其 alt 命中「召唤坐骑」的选项附加数据预览。
function ReplacementGroupItem({ group, detail, fields, outerKey, outerChosen, innerKey, innerChosen, onChoose, lookup }: {
  group: AltGroup;
  detail: boolean;
  fields: Record<string, string>;
  outerKey: string;
  outerChosen?: string | string[];
  innerKey: string;
  innerChosen?: string | string[];
  onChoose: (key: string, label: string | string[]) => void;
  lookup: (target: string) => Entry | undefined;
}) {
  const baseName = cleanDisplayName(group.base.title);
  // chip 的显示名：去掉「N级：」等级前缀（如「1级：战斗守卫者 Battle Guardian」→「战斗守卫者 Battle Guardian」）；
  // 存储值仍用原始名，保证与授予逻辑匹配。
  const repDisplay = (n: string) => cleanDisplayName(n).replace(/^\d{1,2}级：/, "").replace(/·.*$/, "");
  const displayTitle = ({ "卓越战法": "战法", "战士武器天赋": "战斗风格", "准确射击": "游侠范式", "治疗者学识": "牧师学识" } as Record<string, string>)[cnTitle(group.base.title)] ?? repDisplay(baseName);
  const opts = [
    { label: baseName, desc: group.base.body },
    ...group.alts.map((a) => ({ label: cleanDisplayName(a.title), desc: a.body ? a.body.replace(/^此职业特性会替代「[^」]+」职业特性\s*。?\s*/, "").replace(/^你可以?选择\[\[[^\]]+\]\]威能来替换\[\[[^\]]+\]\]\s*/, "").replace(/^你可选择此特性来替换「[^」]+」特性?\s*/, "") : "" })),
  ];
  const innerParse = useMemo(() => parseClassFeatureOptions(group.base.body), [group.base.body]);
  const outerSel = typeof outerChosen === "string" ? outerChosen : "";
  const isBase = outerSel === baseName;
  const altSel = opts.find((o) => o.label === outerSel);
  // 选中的替代项若为「召唤坐骑」类特性（正文授予「召唤天堂坐骑」威能），在其下方附加坐骑生物数据预览
  const steedAlt = group.alts.find((a) => cleanDisplayName(a.title) === outerSel && cnTitle(a.title).includes("召唤坐骑"));
  const steedBody = steedAlt ? (steedAlt.body ?? "") : "";
  const innerVals = Array.isArray(innerChosen) ? innerChosen : innerChosen ? [innerChosen] : [];
  const innerSelected = innerParse.options.find((o) => innerVals.includes(o.label));
  let baseIntro = group.base.body ?? "";
  const lm = baseIntro.match(/^选择[^。]*。\s*/);
  if (lm) baseIntro = baseIntro.slice(lm[0].length);

  if (detail) {
    return (
      <div className="pf-item">
        <div className="pf-title">{displayTitle}<span className="cls-options-hint">点击选择一个选项（{outerSel ? 1 : 0}/1）</span></div>
        <div className="cls-options">
          {opts.map((o, i) => {
            const e = lookup(o.label);
            return (
              <SmartHover key={i} className={outerSel === o.label ? "cls-option active" : "cls-option"} popClass="cls-option-pop" pop={e ? <EntryCard entry={e} /> : undefined} onClick={() => onChoose(outerKey, outerSel === o.label ? "" : o.label)}>
                {repDisplay(o.label)}
              </SmartHover>
            );
          })}
        </div>
        {isBase && innerParse.selectable && innerParse.options.length > 0 && (
          <>
            <div className="cls-options cls-sub">
              {innerParse.options.map((o, i) => {
                const e = lookup(o.label);
                return (
                  <SmartHover key={i} className={innerVals.includes(o.label) ? "cls-option active" : "cls-option"} popClass="cls-option-pop" pop={e ? <EntryCard entry={e} /> : undefined} onClick={() => onChoose(innerKey, innerVals.includes(o.label) ? "" : o.label)}>
                    {o.label}
                  </SmartHover>
                );
              })}
            </div>
            <div className="cls-options-hint">点击选择一个选项（{innerVals.length ? 1 : 0}/1）</div>
          </>
        )}
        {outerSel && (isBase ? (baseIntro && <FeatureBody body={baseIntro} fields={fields} lookup={lookup} />) : (altSel?.desc && <FeatureBody body={altSel.desc} fields={fields} lookup={lookup} />))}
        {steedBody && (
          <SummonedSteedData
            section={{ title: steedAlt!.title, body: steedBody, powerRef: "" }}
            detail
            fields={fields}
            lookup={lookup}
          />
        )}
      </div>
    );
  }
  // 简洁模式
  return (
    <div className={"cls-feat" + (outerSel ? " set" : " unset")}>
      <div className="cls-feat-name">{displayTitle}</div>
      {!outerSel ? (
        <div className="cls-feat-sub">未选择</div>
      ) : (
        <div className="cls-feat-opt">{isBase && innerSelected ? `${repDisplay(baseName)}（${innerSelected.label}）` : repDisplay(outerSel)}</div>
      )}
      {!isBase && altSel?.desc && <FeatureBody body={altSel.desc} fields={fields} lookup={lookup} className="cls-feat-note" hideFlavor />}
      {isBase && baseIntro && <FeatureBody body={baseIntro} fields={fields} lookup={lookup} className="cls-feat-note" hideFlavor />}
      {steedBody && (
        <SummonedSteedData
          section={{ title: steedAlt!.title, body: steedBody, powerRef: "" }}
          detail={false}
          fields={fields}
          lookup={lookup}
        />
      )}
    </div>
  );
}

// 战士「额外战士架势」（7/17级）：从基础「战士架势」的选项池中追加单选一个尚未选择的架势。
// options 复用基础战士架势的可选项；taken 为已被其他架势选择占用（不可重复选）的架势名集合。
function ExtraStanceBlock({ section, detail, choiceKey, options, chosen, taken, onChoose, lookup }: {
  section: FeatureSection;
  detail: boolean;
  choiceKey: string;
  options: { label: string; desc: string }[];
  chosen?: string | string[];
  taken: Set<string>;
  onChoose: (key: string, label: string | string[]) => void;
  lookup: (target: string) => Entry | undefined;
}) {
  const vals = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
  const val = vals.length ? vals[0] : "";
  const toggle = (label: string) => onChoose(choiceKey, val === label ? "" : label);
  if (!detail) {
    return (
      <div className={"cls-feat" + (val ? " set" : " unset")}>
        <div className="cls-feat-name">{cleanDisplayName(featTitle(section.title))}</div>
        {val ? <SmartHover className="cls-feat-opt" popClass="cls-option-pop" pop={lookup(val) ? <EntryCard entry={lookup(val)!} /> : undefined}>{cleanDisplayName(val)}</SmartHover> : <div className="cls-feat-sub">未选择</div>}
      </div>
    );
  }
  return (
    <div className="pf-item">
      <div className="pf-title">{featTitle(section.title)}<span className="cls-options-hint">点击选择一个选项（{val ? 1 : 0}/1）</span></div>
      <div className="cls-options">
        {options.map((o, i) => {
          const e = lookup(o.label);
          const active = val === o.label;
          const disabled = !active && taken.has(o.label);
          return (
            <SmartHover key={i} className={active ? "cls-option active" : "cls-option" + (disabled ? " cls-option-disabled" : "")} popClass="cls-option-pop" pop={e ? <EntryCard entry={e} /> : undefined} onClick={() => { if (!disabled) toggle(o.label); }}>
              {o.label}
            </SmartHover>
          );
        })}
      </div>
      {val && <div className="cls-options-hint">已选择一个选项</div>}
    </div>
  );
}

// 解析兽王特性正文中的野兽数据块（熊/野猪/猫/…每种伙伴的类型数据）。
// 注意：parseFeatureSections 会把行首的「@@.classTrait」标记清掉，故数据块在正文里以「""" <span>名</span> … 内容 … """」形式出现；
// 相邻数据块连续排列为「"""…""" """…"""」。
function parseBeastCompanions(body: string): { label: string; detail: string }[] {
  const out: { label: string; detail: string }[] = [];
  const re = /"""\s*\n?\s*<span>([\s\S]*?)<\/span>([\s\S]*?)"""/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const label = m[1].trim();
    const detail = m[2].replace(/^\s*\n*\s*/, "").replace(/\s*\n*\s*$/, "").trim();
    if (label) out.push({ label, detail });
  }
  return out;
}

// 野兽伙伴数据悬浮卡片
function BeastCard({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="beast-card">
      <div className="beast-card-title">{label}</div>
      <div className="beast-card-body" dangerouslySetInnerHTML={{ __html: wikiToHtml(detail, {}).replace(/\n/g, "<br/>") }} />
    </div>
  );
}

// 兽王：详图显示「成为兽王」按钮；激活后展开兽王规则并选择野兽伙伴（悬停展示数据）。
// 简洁模式不显示按钮，仅在有选择时展示所选伙伴。激活兽王会互斥隐藏「战斗流派」和「游侠范式」。
function BeastMasterBlock({ section, detail, fields, on, chosen, toggleKey, beastKey, onChoose, lookup }: {
  section: FeatureSection;
  detail: boolean;
  fields: Record<string, string>;
  on: boolean;
  chosen: string;
  toggleKey: string;
  beastKey: string;
  onChoose: (key: string, label: string | string[]) => void;
  lookup: (target: string) => Entry | undefined;
}) {
  const beasts = useMemo(() => parseBeastCompanions(section.body ?? ""), [section.body]);
  const ruleText = (section.body ?? "").replace(/"""[\s\S]*?"""/g, "").replace(/^\s*$/gm, "").trim();
  // 拆分兽王规则正文：主引言 + 「!!! 小节」列表（野兽伙伴数据/野兽类型/复活/指挥/自主行动/治疗/获得新的伙伴）
  // 主引言按空行拆成段落：「猎手标的」段单独折叠为【兽王猎手标的】，「复活野兽伙伴」段并入【复活野兽伙伴】折叠，其余作为【成为兽王】折叠
  const { general, quarry, raise, beastType, collapsed } = useMemo(() => {
    const subs: { title: string; body: string }[] = [];
    const parts = ruleText.split(/^(?=!!! )/m);
    const intro = parts.length > 1 ? parts[0].trim() : ruleText.trim();
    for (const p of parts.slice(1)) {
      const m2 = /^!!!\s+(.+?)\s*\n([\s\S]*)$/.exec(p);
      if (!m2) continue;
      subs.push({ title: m2[1].trim(), body: m2[2].replace(/^\s*$/gm, "").trim() });
    }
    const typeIdx = subs.findIndex((s) => s.title.startsWith("野兽类型"));
    const paras = (intro || ruleText).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const quarryPara = paras.find((p) => p.includes("猎手标的"));
    const raisePara = paras.find((p) => p.includes("复活野兽伙伴"));
    return {
      general: paras.filter((p) => p !== quarryPara && p !== raisePara).join("\n"),
      quarry: quarryPara ?? "",
      raise: raisePara ?? "",
      beastType: typeIdx >= 0 ? subs[typeIdx] : undefined,
      collapsed: subs.filter((_, i) => i !== typeIdx),
    };
  }, [ruleText]);
  if (!detail) {
    const b = beasts.find((x) => x.label === chosen);
    return (
      <div className={"cls-feat" + (on && chosen ? " set" : " unset")}>
        <div className="cls-feat-name">兽王</div>
        {on && chosen ? (
          <>
            <div className="cls-feat-opt-wrap">
              <SmartHover className="cls-feat-opt" popClass="cls-option-pop" pop={b ? <BeastCard label={b.label} detail={b.detail} /> : undefined}>{chosen}</SmartHover>
            </div>
            {b && <div className="beast-card-body compact-beast-card" dangerouslySetInnerHTML={{ __html: wikiToHtml(b.detail, {}).replace(/\n/g, "<br/>") }} />}
          </>
        ) : (
          <div className="cls-feat-sub">未选择</div>
        )}
      </div>
    );
  }
  return (
    <div className="pf-item beast-master">
      <div className="pf-title">兽王<span className="cls-options-hint">点击选择一个选项（{on ? 1 : 0}/1）</span></div>
      <div className="cls-options">
        <SmartHover className={on ? "cls-option active" : "cls-option"} popClass="cls-option-pop" onClick={() => onChoose(toggleKey, on ? "" : "on")}>
          成为兽王
        </SmartHover>
      </div>
      {!on ? (
        <div className="cls-feat-sub">选择成为兽王后，将无法选择战斗流派或游侠范式。</div>
      ) : (
        <>
          {general && (
            <details className="beast-sub">
              <summary>成为兽王</summary>
              <div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(general)} fields={fields} lookup={lookup} indent /></div></div>
            </details>
          )}
          {quarry && (
            <details className="beast-sub">
              <summary>兽王猎手标的</summary>
              <div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(quarry)} fields={fields} lookup={lookup} indent /></div></div>
            </details>
          )}
          {beastType && (
            <div className="beast-type">
              <div className="pf-sub-title">{beastType.title}</div>
              {beastType.body && <FeatureBody body={beastType.body} fields={fields} lookup={lookup} />}
            </div>
          )}
          <div className="cls-sub-title">选择野兽伙伴</div>
          <div className="cls-options cls-beasts">
            {beasts.map((b) => (
              <SmartHover key={b.label} className={chosen === b.label ? "cls-option active" : "cls-option"} popClass="cls-option-pop" pop={<BeastCard label={b.label} detail={b.detail} />} onClick={() => onChoose(beastKey, chosen === b.label ? "" : b.label)}>
                {b.label}
              </SmartHover>
            ))}
          </div>
          {collapsed.map((s) => (
            <details className="beast-sub" key={s.title}>
              <summary>{s.title.replace(/\s+[A-Za-z].*$/m, "").trim()}</summary>
              <div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(raise && s.title.startsWith("复活野兽伙伴") ? raise + "\n" + s.body : s.body)} fields={fields} lookup={lookup} indent /></div></div>
            </details>
          ))}
        </>
      )}
    </div>
  );
}

// 解析正文中的「!!! 子标题」小节列表（公共工具）：如兽王规则、用毒毒药配方
function parsePoi(body: string): { intro: string; items: { title: string; body: string }[] } | undefined {
  const parts = (body ?? "").split(/^(?=!!! )/m);
  const items: { title: string; body: string }[] = [];
  for (const p of parts.slice(1)) {
    const m2 = /^!!!\s+(.+?)\s*\n([\s\S]*)$/.exec(p.trim());
    if (m2) items.push({ title: m2[1].trim(), body: m2[2].replace(/^\s*$/gm, "").trim() });
  }
  if (!items.length) return undefined;
  return { intro: parts[0].trim(), items };
}

// 【用毒 Poison Use】/【进阶用毒】等：正文含「!!! 毒药名」子节 → 折叠 + 多选毒药配方。
// choiceKey 存所选毒药标签（string[]）。选中毒药的配方正文以 beast-sub 折叠卡展示。
function PoisonUseBlock({ section, detail, fields, chosen, choiceKey, level, onChoose, lookup }: {
  section: FeatureSection;
  detail: boolean;
  fields: Record<string, string>;
  chosen?: string | string[];
  choiceKey: string;
  level: number;
  onChoose: (key: string, label: string | string[]) => void;
  lookup: (target: string) => Entry | undefined;
}) {
  const { intro, items } = useMemo(() => parsePoi(section.body ?? "")!, [section.body]);
  // 各层级毒药配方的可选上限按职业特性递推（随等级增加）：
  //   1级配方：基础 2 → 5级+1 → 9级+1（最多 4）
  //   15级配方：15级 1 → 19级+1（最多 2）
  //   25级配方：25级 1 → 29级+1（最多 2）
  const t = cnTitle(section.title);
  const max = t.includes("25级") ? 1 + (level >= 29 ? 1 : 0)
    : t.includes("15级") ? 1 + (level >= 19 ? 1 : 0)
    : 2 + (level >= 5 ? 1 : 0) + (level >= 9 ? 1 : 0);
  const chosenVals = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
  const toggle = (t: string) => onChoose(choiceKey, chosenVals.includes(t) ? chosenVals.filter((x) => x !== t) : chosenVals.length >= max ? chosenVals : [...chosenVals, t]);
  const cnt = `${chosenVals.length}/${max}`;
  if (!detail) {
    return (
      <div className="pf-item">
        <div className="pf-title">{featTitle(section.title)}</div>
        <div className="cls-sub-title">选择毒药配方（{cnt}）</div>
        <div className="cls-options cls-beasts">
          {items.map((p) => (
            <SmartHover key={p.title} portal className={chosenVals.includes(p.title) ? "cls-option active" : "cls-option" + (chosenVals.length >= max && !chosenVals.includes(p.title) ? " cls-option-disabled" : "")} popClass="cls-option-pop" pop={lookup(p.title) ? <EntryCard entry={lookup(p.title)!} /> : undefined} onClick={() => toggle(p.title)}>{cleanDisplayName(p.title)}</SmartHover>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="pf-item">
      <div className="pf-title">{featTitle(section.title)}<span className="cls-options-hint">选择毒药配方（{cnt}）</span></div>
      {intro && <FeatureBody body={intro} fields={fields} lookup={lookup} />}
      <div className="cls-sub-title">毒药配方</div>
      <div className="cls-options cls-beasts">
        {items.map((p) => (
          <SmartHover key={p.title} portal className={chosenVals.includes(p.title) ? "cls-option active" : "cls-option" + (chosenVals.length >= max && !chosenVals.includes(p.title) ? " cls-option-disabled" : "")} popClass="cls-option-pop" pop={lookup(p.title) ? <EntryCard entry={lookup(p.title)!} /> : undefined} onClick={() => toggle(p.title)}>{cleanDisplayName(p.title)}</SmartHover>
        ))}
      </div>
      {items.filter((p) => chosenVals.includes(p.title)).map((p) => (
        <details className="beast-sub" key={p.title}>
          <summary>{cleanDisplayName(p.title)}</summary>
          <div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(p.body)} fields={fields} lookup={lookup} indent /></div></div>
        </details>
      ))}
    </div>
  );
}

// 权势者仪态（HoF 可选职业特性）：开关型启用后从若干权势者仪态中多选；可选数量随等级递增（1→2、13→3、17→4）。
// toggleKey 存 "on"/""；listKey 存所选仪态标签（string[]）。
function SignsBlock({ section, detail, fields, count, chosen, on, toggleKey, listKey, onChoose, lookup }: {
  section: FeatureSection;
  detail: boolean;
  fields: Record<string, string>;
  count: number;
  chosen: string[];
  on: boolean;
  toggleKey: string;
  listKey: string;
  onChoose: (key: string, label: string | string[]) => void;
  lookup: (target: string) => Entry | undefined;
}) {
  const { intro, options } = useMemo(() => parseClassFeatureOptions(section.body ?? ""), [section.body]);
  const opts = options;
  const selected = opts.filter((o) => chosen.includes(o.label));
  if (!detail) {
    return (
      <div className={"cls-feat" + (on && chosen.length ? " set" : " unset")}>
        <div className="cls-feat-name">权势者仪态</div>
        {!on ? (
          <div className="cls-feat-sub">未选择</div>
        ) : selected.length === 0 ? (
          <div className="cls-feat-sub">未选 0/{count}</div>
        ) : (
          <>
            <div className="cls-feat-count">已选 {chosen.length}/{count}</div>
            {selected.map((o) => (
              <SmartHover key={o.label} className="cls-feat-opt" popClass="cls-option-pop" pop={lookup(o.label) ? <EntryCard entry={lookup(o.label)!} /> : undefined}>
                {cleanDisplayName(featTitle(o.label))}
              </SmartHover>
            ))}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="pf-item beast-master">
      <div className="pf-title">权势者仪态<span className="cls-options-hint">点击选择一个选项（{on ? 1 : 0}/1）</span></div>
      <div className="cls-options">
        <SmartHover className={on ? "cls-option active" : "cls-option"} popClass="cls-option-pop" onClick={() => onChoose(toggleKey, on ? "" : "on")}>
          启用权势者仪态
        </SmartHover>
      </div>
      {!on ? (
        <div className="cls-feat-sub">启用后可从若干权势者仪态中选择（当前可选 {count} 个）。</div>
      ) : (
        <>
          {intro && <div className="pf-intro"><FeatureBody body={intro} fields={fields} lookup={lookup} /></div>}
          <div className="cls-sub-title signs-sub-title">选择权势者仪态（可选 {count} 个）</div>
          <div className="cls-options cls-beasts">
            {opts.map((o) => {
              const e = lookup(o.label);
              const active = chosen.includes(o.label);
              const disabled = !active && chosen.length >= count;
              return (
                <SmartHover key={o.label} className={active ? "cls-option active" : "cls-option" + (disabled ? " cls-option-disabled" : "")} popClass="cls-option-pop" pop={e ? <EntryCard entry={e} /> : undefined}
                  onClick={() => {
                    if (active) onChoose(listKey, chosen.filter((x) => x !== o.label));
                    else if (!disabled) onChoose(listKey, [...chosen, o.label]);
                  }}>
                  {o.label}
                </SmartHover>
              );
            })}
          </div>
          <div className="cls-options-hint">{chosen.length}/{count} 已选{chosen.length >= count ? "（已满）" : ""}</div>
        </>
      )}
    </div>
  );
}

// 解析保护者「召唤自然盟友」正文：头部（风味 + 升级机械规则）+ 两个原力姿态小节，
// 每个姿态小节内含 1/15/29 级子节（风味叙述 + 「你可以使用…召唤一个[[野兽]]或[[野兽]]」规则行）。
interface PrimalSummonLevel { level: number; flavor: string; rules: string }
interface PrimalSummonAspect { title: string; levels: PrimalSummonLevel[] }
function parsePrimalSummon(body: string): { head: string; aspects: PrimalSummonAspect[] } {
  const idx = body.search(/^!!! /m);
  const head = idx >= 0 ? body.slice(0, idx).trim() : body.trim();
  const aspects: PrimalSummonAspect[] = [];
  if (idx < 0) return { head, aspects };
  const blocks = body.slice(idx).split(/^(?=!!! )/m);
  for (const b of blocks) {
    const m = b.match(/^!!! (.+?)\n([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].trim();
    const levels: PrimalSummonLevel[] = [];
    const lre = /(?:^|\n)''(\d+)级[：:]\s*([\s\S]*?)(?=(?:^|\n)''\d+级[：:]|$)/g;
    let lm: RegExpExecArray | null;
    while ((lm = lre.exec(m[2])) !== null) {
      const level = parseInt(lm[1], 10);
      const rest = lm[2].trim();
      const parts = rest.split(/\n\s*\n/);
      // 剥离「''N级：''」粗体标记闭合的 '' 泄漏（如「''1级：''The creatures…」→ 去掉开头的 ''）
      const flavor = (parts[0] ?? "").trim().replace(/^''/, "").trim();
      const rules = parts.slice(1).join("\n\n").trim();
      if (level) levels.push({ level, flavor, rules });
    }
    if (levels.length) aspects.push({ title, levels });
  }
  return { head, aspects };
}

// 保护者「召唤自然盟友」：根据当前生效的原力姿态（由「原力姿态」特性选择/德鲁伊集会派生）自动展示对应姿态，
// 每级获取内容（1/15/29 级）折叠为子小节，野兽 [[链接]] 悬浮显示数据卡。
function PrimalSummonBlock({ section, detail, fields, aspect, lookup }: {
  section: FeatureSection;
  detail: boolean;
  fields: Record<string, string>;
  aspect: string;      // 当前生效的原力姿态标题（原力守护者/原力掠食者），未选则为 ""
  lookup: (target: string) => Entry | undefined;
}) {
  const { head, aspects } = useMemo(() => parsePrimalSummon(section.body ?? ""), [section.body]);
  const active = aspects.find((a) => a.title === aspect) ?? aspects[0];
  if (!detail) {
    return (
      <div className="cls-feat set">
        <div className="cls-feat-name">{featTitle(section.title)}</div>
        {head && <FeatureBody body={head} fields={fields} lookup={lookup} className="cls-feat-note" hideFlavor />}
        {active && <div className="cls-feat-opt">{active.title}</div>}
        {active?.levels.map((lv) => (
          <div key={lv.level} className="cls-feat-note">
            <div className="cls-feat-opt-wrap"><span className="cls-feat-opt">{lv.level}级</span></div>
            {lv.rules && <div className="cls-feat-optname"><WikiBody body={lv.rules} fields={fields} lookup={lookup} /></div>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="pf-item beast-master">
      <div className="pf-title">{featTitle(section.title)}</div>
      {head && <FeatureBody body={head} fields={fields} lookup={lookup} />}
      <div className="cls-options-hint">当前原力姿态：{active?.title ?? "无"}</div>
      {active?.levels.map((lv) => (
        <details key={lv.level} className="beast-sub" open={lv.level <= 1}>
          <summary>{lv.level}级</summary>
          <div className="beast-sub-body">
            <div className="pf-body">
              {lv.flavor && <span className="pf-flavor"><WikiBody body={lv.flavor} fields={fields} lookup={lookup} /></span>}
              {lv.rules && <div className="pf-rest"><WikiBody body={lv.rules} fields={fields} lookup={lookup} indent /></div>}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

// 开关型职业特性（正文以「当你选择该职业特性时」开头者，如督军「射手督军」）：详图用开关按钮，
// 选中后展示规则；简洁模式仅展示选中状态与正文。toggleKey 存 "on"/""。
function ToggleFeatureBlock({ section, detail, fields, on, toggleKey, onChoose, lookup }: {
  section: FeatureSection;
  detail: boolean;
  fields: Record<string, string>;
  on: boolean;
  toggleKey: string;
  onChoose: (key: string, label: string | string[]) => void;
  lookup: (target: string) => Entry | undefined;
}) {
  const body = (section.body ?? "").trim();
  // 去掉开头的「当你选择该职业特性时，」引导语，仅展示规则正文
  const rule = body.replace(/^当你选择(?:该|此)职业特性时[，,]\s*/, "").trim();
  if (!detail) {
    return (
      <div className={"cls-feat" + (on ? " set" : " unset")}>
        <div className="cls-feat-name">{featTitle(section.title)}</div>
        {!on ? (
          <div className="cls-feat-sub">未选择</div>
        ) : (
          rule && <FeatureBody body={rule} fields={fields} lookup={lookup} className="cls-feat-note" hideFlavor />
        )}
      </div>
    );
  }
  return (
    <div className="pf-item">
      <div className="pf-title">{featTitle(section.title)}<span className="cls-options-hint">点击选择一个选项（{on ? 1 : 0}/1）</span></div>
      <div className="cls-options">
        <SmartHover className={on ? "cls-option active" : "cls-option"} popClass="cls-option-pop" onClick={() => onChoose(toggleKey, on ? "" : "on")}>
          选择该职业特性
        </SmartHover>
      </div>
      {on && rule && <FeatureBody body={rule} fields={fields} lookup={lookup} />}
    </div>
  );
}

// 多替换组职业特性（正文含多个独立替换对，如牧师「引导神力」）：每个替换对一组单选，组间互不影响。
// 每组显示「被替代项 + 可选项」按钮，选择某个可选项即用其替换被替代项，被替代项为默认组员。
function MultiReplacementBlock({ section, detail, baseKey, chosen, onChoose, fields, lookup }: {
  section: FeatureSection;
  detail: boolean;
  fields: Record<string, string>;
  baseKey: string;                                                       // 形如 entry.id::标题，本组件在各组后追加 ::g{index}
  chosen: (string | undefined)[];                                        // 各组当前选中值（按组下标对齐）
  onChoose: (key: string, label: string | string[]) => void;
  lookup: (target: string) => Entry | undefined;
}) {
  const parsed = useMemo(() => parseReplacementPairs(section.body ?? ""), [section.body]);
  if (!parsed) return null;
  if (!detail) {
    return (
      <div className="cls-feat">
        <div className="cls-feat-name">{featTitle(section.title)}</div>
        {parsed.intro && <FeatureBody body={prose(parsed.intro)} fields={fields} lookup={lookup} className="cls-feat-note" hideFlavor />}
        {parsed.groups.map((g, gi) => {
          const cur = chosen[gi] ?? "";
          return (
            <div className="cls-feat-opt-wrap" key={gi}>
              <SmartHover className="cls-feat-opt" popClass="cls-option-pop" pop={lookup(cur) ? <EntryCard entry={lookup(cur)!} /> : undefined}>{cur || g.base}</SmartHover>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="pf-item">
      <div className="pf-title">{featTitle(section.title)}</div>
      {parsed.intro && <FeatureBody body={prose(parsed.intro)} fields={fields} lookup={lookup} />}
      {parsed.groups.map((g, gi) => {
        const key = baseKey + "::g" + gi;
        const cur = chosen[gi] ?? "";
        const isCur = (label: string) => cur === label;
        return (
          <div key={gi}>
            <div className="cls-options">
              {[g.base, ...g.alts].filter((v, i, a) => a.indexOf(v) === i).map((label, i) => {
                const e = lookup(label);
                return (
                  <SmartHover key={i} className={isCur(label) ? "cls-option active" : "cls-option"} popClass="cls-option-pop" pop={e ? <EntryCard entry={e} /> : undefined} onClick={() => onChoose(key, cur === label ? "" : label)}>
                    {label}
                  </SmartHover>
                );
              })}
            </div>
            {cur && <div className="cls-options-hint">点击选择一个选项（1/1）</div>}
          </div>
        );
      })}
    </div>
  );
}

// 黑暗卫士败德按钮的悬浮预览卡片：仅展示该败德直接相关的机械内容（各败德小节的增益 / 赠送威能），
// 并按行过滤掉英文风味叙述（仅保留中文机械行）；对 {{威能}} 模板占位还原为「你获得」威能行。
function VicePreview({ option, fields, lookup }: {
  option: BlackguardViceOption;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
}) {
  const LABELS: Record<string, string> = { "败德精神": "败德精神", "败德随意威能": "败德随意威能", "进阶暗影护罩": "进阶暗影护罩", "败德辅助威能": "败德辅助威能" };
  return (
    <div className="vice-preview">
      <div className="vice-preview-head">{option.key}败德</div>
      {option.fills.map((f, i) => {
        const pw = f.body.match(/\{\{([^}]+)\}\}/);
        const powerT = pw ? pw[1].trim() : undefined;
        const mech = f.body
          .replace(/\{\{[^}]+\}\}/g, "")
          .split("\n")
          .map((ln) => ln.replace(/^@@\.\w+\s*/gm, "").trim())
          .filter((ln) => ln && /[\u4e00-\u9fff]/.test(ln))
          .join("\n")
          .replace(/\n{2,}/g, "\n")
          .trim();
        return (
          <div key={i} className="vice-preview-row">
            <div className="vice-preview-label">{LABELS[f.keyword] ?? f.keyword}</div>
            <div className="vice-preview-body">
              {mech && <WikiBody body={mech} fields={fields} lookup={lookup} />}
              {powerT && <WikiBody body={"你获得[[" + powerT + "]]威能"} fields={fields} lookup={lookup} />}
            </div>
          </div>
        );
  })}
    </div>
  );
}

// 縢影师契约按钮的悬浮预览卡片：仅展示该契约直接相关的机械内容（各小节增益 / 赠送威能），
// 并按行过滤掉英文风味叙述（仅保留中文机械行）；对 {{威能}} 模板占位还原为「你获得」威能行。
function PactPreview({ option, fields, lookup }: {
  option: BinderPactOption;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
}) {
  const LABELS: Record<string, string> = {
    "契约之赐": "契约之赐",
    "契约遭遇威能": "契约遭遇威能",
    "契约学识": "契约学识",
    "缚影师盟友": "缚影师盟友",
    "高阶缚影师盟友": "高阶缚影师盟友",
    "缚影师行动": "缚影师行动",
    "缚影师恩惠": "缚影师恩惠",
    "缚影师之赐": "缚影师之赐",
    // 魔剑士契约占位特性
    "契约奖励": "契约奖励",
    "契约武器": "契约武器",
    "契约武器惩戒": "契约武器惩戒",
    "召唤邪术师盟友": "召唤邪术师盟友",
    "高阶召唤邪术师盟友": "高阶召唤邪术师盟友",
  };
  return (
    <div className="vice-preview">
      <div className="vice-preview-head">{option.key}契约</div>
      {option.fills.map((f, i) => {
        const pw = f.body.match(/\{\{([^}]+)\}\}/);
        const powerT = pw ? pw[1].trim() : undefined;
        const mech = f.body
          .replace(/\{\{[^}]+\}\}/g, "")
          .split("\n")
          .map((ln) => ln.replace(/^@@\.\w+\s*/gm, "").trim())
          .filter((ln) => ln && /[\u4e00-\u9fff]/.test(ln))
          .join("\n")
          .replace(/\n{2,}/g, "\n")
          .trim();
        return (
          <div key={i} className="vice-preview-row">
            <div className="vice-preview-label">{LABELS[f.keyword] ?? f.keyword}</div>
            <div className="vice-preview-body">
              {mech && <WikiBody body={mech} fields={fields} lookup={lookup} />}
              {powerT && <WikiBody body={"你获得[[" + powerT + "]]威能"} fields={fields} lookup={lookup} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 圣骑兵美德按钮的悬浮预览卡片：展示所选美德各小节机械收益与赠送威能（{{威能}} 还原为「你获得」威能行），
// 并过滤掉英文风味叙述（仅保留中文机械行）。
function VirtuePreview({ option, fields, lookup }: {
  option: VirtueOption;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
}) {
  const LABELS: Record<string, string> = {
    "美德精神": "美德精神",
    "美德随意威能": "美德随意威能",
    "进阶正义之盾": "进阶正义之盾",
    "共享": "共享美德",
  };
  return (
    <div className="vice-preview">
      <div className="vice-preview-head">{option.key}美德</div>
      {option.fills.map((f, i) => {
        const pw = f.body.match(/\{\{([^}]+)\}\}/);
        const powerT = pw ? pw[1].trim() : undefined;
        const mech = f.body
          .replace(/\{\{[^}]+\}\}/g, "")
          .split("\n")
          .map((ln) => ln.replace(/^@@\.\w+\s*/gm, "").trim())
          .filter((ln) => ln && /[\u4e00-\u9fff]/.test(ln))
          .join("\n")
          .replace(/\n{2,}/g, "\n")
          .trim();
        return (
          <div key={i} className="vice-preview-row">
            <div className="vice-preview-label">{LABELS[f.keyword] ?? f.keyword}</div>
            <div className="vice-preview-body">
              {mech && <WikiBody body={mech} fields={fields} lookup={lookup} />}
              {powerT && <WikiBody body={"你获得[[" + powerT + "]]威能"} fields={fields} lookup={lookup} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 战争祭司领域按钮的悬浮预览卡片：汇总展示该领域个别等级小节的机械收益与赠送威能（只读）。
// 样式与学派法师预览一致（标签行 + 清一色中文规则正文，未含英文风味），并过滤英文行、裁剪威能链接的英文别名。
function zhOnlyBody(body: string): string {
  return body
    .split("\n")
    // 去掉「!!! 领域随意威能」等小节标题的 ! 前缀，避免被 wikiToHtml 转成 <h4/h5/h6>（会造成预览里字号异常与多余空行）
    .map((l) => l.replace(/^!{1,}\s*/, "").trim())
    // 威能链接缩写为中文别名，隐藏英文
    .map((l) => l.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_m, t) => `[[${cnTitle(t)}]]`))
    // 去掉纯英文风味行与空行（剩下中文机制正文）
    .filter((l) => /[\u4e00-\u9fff]/.test(l))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
function DomainPreview({ option, fields, lookup }: {
  option: WarpriestDomainOption;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
}) {
  const rows = useMemo(() => {
    // 挑选代表性小节：1级特性和威能 / 引导神力 / 5级特性 / 10级特性（避免预览过长的遭遇威能列表）
    const picked: WarpriestDomainSection[] = [];
    const seen = new Set<string>();
    for (const sec of option.sections) {
      if (sec.level > 10 || sec.level === 3 || sec.level === 7) continue; // 只保留 1/5/10 的英雄级领域小节
      if (seen.has(sec.type)) continue;
      seen.add(sec.type);
      picked.push(sec);
    }
    return picked;
  }, [option.sections]);
  const labelOf = (sec: WarpriestDomainSection) => {
    if (sec.type === "all") return "领域特性和威能";
    if (sec.type === "channel") return "引导神力";
    if (sec.type === "encounter") return "领域遭遇威能";
    return "领域特性";
  };
  return (
    <div className="vice-preview">
      <div className="vice-preview-head">{option.name}</div>
      {rows.length === 0 && <div className="vice-preview-row"><div className="vice-preview-body"><span className="hint">无数据</span></div></div>}
      {rows.map((sec, i) => (
        <div key={i} className="vice-preview-row">
          <div className="vice-preview-label">{labelOf(sec)}</div>
          <div className="vice-preview-body">
            <WikiBody body={zhOnlyBody(sec.body)} fields={fields} lookup={lookup} />
          </div>
        </div>
      ))}
    </div>
  );
}

// 折叠特性悬停预览（只读）：普通特性渲染正文；选择型特性列出选项名与描述
function FeaturePreview({ section, fields, lookup }: {
  section: FeatureSection;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
}) {
  const parsed = useMemo(() => parseClassFeatureOptions(section.body), [section.body]);
  return (
    <div className="pf-fold-pop-body">
      <div className="pf-fold-pop-title">{featTitle(section.title).replace(/^\d+级[：:]\s*/, "")}</div>
      {parsed.selectable ? (
        <>
          {parsed.intro && <FeatureBody body={prose(parsed.intro)} fields={fields} lookup={lookup} />}
          <div className="pf-fold-pop-opts">
            {parsed.options.map((o, i) => (
              <div key={i} className="pf-fold-pop-opt">
                <div className="pf-fold-pop-opt-name">{o.label}</div>
                {o.desc && <FeatureBody body={o.desc} fields={fields} lookup={lookup} />}
              </div>
            ))}
          </div>
        </>
      ) : (
        section.body && <FeatureBody body={section.body} fields={fields} lookup={lookup} />
      )}
    </div>
  );
}

// 精华职业特性折叠：未达前提等级时折叠为「标题 + 等级徽标」行，悬停预览内容；
// 达到前提等级（expanded）后直接渲染完整交互内容。
function FeatureFold({ section, level, expanded, fields, lookup, children }: {
  section: FeatureSection;
  level: number;
  expanded: boolean;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
  children: ReactNode;
}) {
  if (expanded) return <>{children}</>;
  return (
    <div className="pf-item">
      <SmartHover className="pf-fold" popClass="pf-fold-pop" pop={<FeaturePreview section={section} fields={fields} lookup={lookup} />}>
        <span className="pf-fold-name">{featTitle(section.title).replace(/^\d+级[：:]\s*/, "")}</span>
        <span className="pf-fold-level">Lv{level}</span>
      </SmartHover>
    </div>
  );
}

// 提取职业特性区域之外 <div class="sidebar">…</div> 内的「!!! 小节」规则正文（如圣武士「神圣制裁」），
// 作为独立规则折叠小节返回（样式与兽王折叠一致）。作用域限定在特性区域之后、并剔除特性区域本身，
// 避免重复提取已在特性正文中渲染的 sidebar（如守望者形态威能）
function sidebarRuleSections(sourceText: string): FeatureSection[] {
  const feats = classFeaturesHtml(sourceText);
  const featM = sourceText.match(/^! [^\n]*职业特性[^\n]*\n/m);
  const after = featM && featM.index !== undefined ? sourceText.slice(featM.index + featM[0].length) : sourceText;
  const scope = feats ? after.replace(feats, "") : after;
  const out: FeatureSection[] = [];
  const re = /<div class="sidebar">([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    const parts = m[1].split(/^(?=!!! )/m);
    for (const p of parts) {
      const sm = p.match(/^!!!\s+(.+?)\s*\n([\s\S]*)$/);
      if (!sm) continue;
      const title = sm[1].trim();
      const body = sm[2]
        .replace(/^@@\.\w+\s*/gm, "")
        .replace(/^@@\s*$/gm, "")
        .replace(/^\s*$/gm, "")
        .trim();
      if (title && body) out.push({ title, body });
    }
  }
  return out;
}

// 学派法师：学派悬浮预览（学徒/专家/大师收益）
function MageSchoolPreview({ option, fields, lookup }: { option: MageSchool; fields: Record<string, string>; lookup: (target: string) => Entry | undefined }) {
  return (
    <div className="vice-preview">
      <div className="vice-preview-head">{option.name}</div>
      {option.apprentice && <div className="vice-preview-row"><div className="vice-preview-label">学徒级学派法师</div><FeatureBody body={option.apprentice} fields={fields} lookup={lookup} hideFlavor className="vice-preview-body" /></div>}
      {option.expert && <div className="vice-preview-row"><div className="vice-preview-label">专家级学派法师</div><FeatureBody body={option.expert} fields={fields} lookup={lookup} hideFlavor className="vice-preview-body" /></div>}
      {option.master && <div className="vice-preview-row"><div className="vice-preview-label">大师级学派法师</div><FeatureBody body={option.master} fields={fields} lookup={lookup} hideFlavor className="vice-preview-body" /></div>}
    </div>
  );
}

// —— 学派法师：单等级魔法学派选择（按等级嵌入对应特性条目内） ——
// 各等级选择点如下，各自渲染独立的 chips 行 + 当前选中学派的收益正文：
//   s1（1级学徒）第一学派：全部学派
//   s2（4级学徒）第二学派：排除第一学派
//   ex（5级专家）专家级：A/B 单选；ex8（8级专家）自动获得第二学派专家收益（无按钮，直接展示）
//   ma（10级大师）大师级：A/B 单选
// 特性正文保留规则原文（见 wiki「选择一种魔法学派。你获得…收益」），按钮与收益在此行内追加。
function MageSchoolStage({ stage, options, s1Key, s2Key, exKey, maKey, s1, s2, exSel, maSel, fields, lookup, onChoose }: {
  stage: "s1" | "s2" | "ex" | "ex8" | "ma";
  options: MageSchool[];
  s1Key: string; s2Key: string; exKey: string; maKey: string;
  s1: string; s2: string; exSel: string; maSel: string;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
  onChoose: (key: string, label: string | string[]) => void;
}) {
  const optA = options.find((o) => o.key === s1);
  const optB = options.find((o) => o.key === s2);
  const chip = (option: MageSchool, ck: string, sel: string) => (
    <SmartHover key={ck + option.key} portal className={"exe-guild-chip ms-chip" + (sel === option.key ? " selected" : "")} popClass="exe-chip-pop" pop={<MageSchoolPreview option={option} fields={fields} lookup={lookup} />} onClick={() => onChoose(ck, sel === option.key ? "" : option.key)}>
      {option.key}
    </SmartHover>
  );
  // 各等级：标题标签 + chips + 选中收益正文
  let label: string;
  let chips: ReactNode;
  let benefit: string | undefined;
  let note: string | undefined;
  if (stage === "s1") {
    label = "选择第一魔法学派";
    chips = options.map((o) => chip(o, s1Key, s1));
    benefit = optA?.apprentice;
  } else if (stage === "s2") {
    label = "选择第二魔法学派（与第一学派不同）";
    chips = options.filter((o) => o.key !== s1).map((o) => chip(o, s2Key, s2));
    benefit = optB?.apprentice;
  } else if (stage === "ex") {
    label = "选择专家级学派（在所选两学派间选一）";
    chips = optA && optB ? <>{chip(optA, exKey, exSel)}{chip(optB, exKey, exSel)}</> : null;
    benefit = mageExExpert(optA, optB, exSel);
  } else if (stage === "ex8") {
    label = "专家级收益（8级自动获得第二学派）";
    chips = null;
    benefit = optB?.expert;
    note = optB ? `第二学派「${optB.key}」的专家级收益` : undefined;
  } else {
    label = "选择大师级学派（在所选两学派间选一）";
    chips = optA && optB ? <>{chip(optA, maKey, maSel)}{chip(optB, maKey, maSel)}</> : null;
    benefit = mageMaMaster(optA, optB, maSel);
  }
  return (
    <div className="ms-stage-block">
      <div className="ms-label">{label}</div>
      {chips && <div className="exe-guild">{chips}</div>}
      {benefit && <div className="ms-benefit"><FeatureBody body={benefit} fields={fields} lookup={lookup} hideFlavor /></div>}
      {note && <div className="ms-note">{note}</div>}
    </div>
  );
}
// 判定学派法师占位特性所属的等级选择阶段：
//   「学徒级学派法师」1级→s1（第一学派）、4级→s2（第二学派）；
//   「专家级学派法师」5级→ex（专家级选择）、8级→ex8（自动第二学派）；
//   「大师级学派法师」→ma（大师级选择）；其余返回 undefined
function mageStageOf(title: string): "s1" | "s2" | "ex" | "ex8" | "ma" | undefined {
  const t = cnTitle(title);
  const lv = featureLevel(title);
  if (t.includes("学徒级学派法师")) return lv === 1 ? "s1" : lv === 4 ? "s2" : undefined;
  if (t.includes("专家级学派法师")) return lv === 5 ? "ex" : lv === 8 ? "ex8" : undefined;
  if (t.includes("大师级学派法师")) return "ma";
  return undefined;
}
// 专家/大师：从 A/B 中依据所选 key 取对应学派收益正文
function mageExExpert(optA: MageSchool | undefined, optB: MageSchool | undefined, exSel: string): string | undefined {
  if (optA?.key === exSel) return optA.expert;
  if (optB?.key === exSel) return optB.expert;
  return undefined;
}
function mageMaMaster(optA: MageSchool | undefined, optB: MageSchool | undefined, maSel: string): string | undefined {
  if (optA?.key === maSel) return optA.master;
  if (optB?.key === maSel) return optB.master;
  return undefined;
}

// 单个职业的能力块（classTrait + 职业特性以条目展示 / 简略擅长行）
function ClassFeatureBlock({ entry, detail, level, choices, onChoose, lookup, classes, magicSchools, panelIds, onAddPowers, onTrackClassPowers, onRemovePowers, onTrackClassFeats, onRemoveFeats, onTrackClassRituals, onRemoveClassRituals, featureOnly, domains }: {
  entry: Entry;
  detail: boolean;
  level: number;
  choices: Record<string, string | string[]>;
  onChoose: (key: string, label: string | string[]) => void;
  lookup: (target: string) => Entry | undefined;
  classes: Entry[]; // 全量职业条目（混职「原版职业特性」折叠解析目标基础职业用）
  magicSchools?: Entry[]; // 全量魔法学派条目（学派法师「魔法学派」选择用）
  panelIds: Set<string>;
  onAddPowers: (powers: Entry[]) => void;
  onTrackClassPowers?: (powers: Entry[]) => void; // 记录职业授予威能 id（不加入面板），供更换职业时移除
  onRemovePowers?: (ids: string[]) => void; // 特性选择变化时移除「不再授予」的威能（如野性力量切换选项）
  onTrackClassFeats?: (feats: Entry[]) => void; // 记录职业赠送专长 id（不占用常规专长槽位）
  onRemoveFeats?: (ids: string[]) => void; // 特性选择变化时移除「不再赠送」的专长（如战斗流派切换选项）
  onTrackClassRituals?: (rituals: { entry: Entry; source: string }[]) => void; // 记录职业赠送仪式 id 及来源特性名（不占用仪式槽位）
  onRemoveClassRituals?: (ids: string[]) => void; // 特性选择变化时移除「不再赠送」的仪式
  featureOnly?: boolean; // 混职职业能力模式：仅渲染职业名 + 职业特性（隐藏该职业自己的 trait 与 lore，因已由合并块展示）
  domains?: Entry[]; // 全量领域条目（战争祭司「领域」选择用）
}) {
  // 带层级表的职业（如黑暗卫士）：提取各层级表（英雄/典范/传奇），按层级插入到对应层级的第一个特性前，
  // 并从特性/lore 解析源中剥离，避免在原区块重复渲染
  const levelTables = useMemo(() => extractLevelTables(entry.sourceText), [entry.sourceText]);
  // 各层级表插入锚点：按 caption 判定应放在哪个层级的第一个特性前（英雄=1 级前 / 典范=11 / 传奇=21）
  const levelTableAnchors = useMemo(
    () =>
      levelTables.map((t) => {
        const cap = (t.match(/<caption>([^<]*)<\/caption>/) || [])[1] || "";
        if (/典范/.test(cap)) return 11;
        if (/传奇/.test(cap)) return 21;
        return 1;
      }),
    [levelTables]
  );
  const classSrc = useMemo(() => (levelTables.length ? stripLevelTables(entry.sourceText) : entry.sourceText), [levelTables, entry.sourceText]);
  // 带层级表的职业：典范/传奇层级是否生效，取决于所选典范之道/传奇天命与该职业是否相关。
  // 未选择对应条目时视为相关（显示该职业本层级的默认特性）；只有明确选了「无关」条目才隐藏该层级。
  // 没有层级表的职业不受影响（恒显示全部层级特性）。
  const hasLevelTable = levelTables.length > 0;
  // 取消典范/传奇相关性对职业特性的影响：无论选择相关或无关的典范道/传奇天命，
  // 职业的典范(11-20)与传奇(21+)层级特性及层级表都始终显示、数据始终生效。
  const paragonRelevant = true;
  const epicRelevant = true;
  const tierVisible = useCallback((title: string): boolean => {
    if (!hasLevelTable) return true;
    const lv = featureLevel(title);
    if (lv >= 11 && lv <= 20) return paragonRelevant;
    if (lv >= 21) return epicRelevant;
    return true;
  }, [hasLevelTable, paragonRelevant, epicRelevant]);
  const trait = classTraitHtml(classSrc);
  const features = classFeaturesHtml(classSrc);
  const summary = classSummary(classSrc);
  const classLore = useMemo(() => splitClassLore(classSrc), [classSrc]);
  // 黑暗卫士：支配 / 暴怒 败德二选一（具体效果在败德条目中，选中后用其填充占位特性）
  const vice = useMemo(() => blackguardVices(entry, lookup), [entry, lookup]);
  const viceKey = vice ? entry.id + "::败德" : undefined;
  const viceChosen = vice && viceKey ? (typeof choices[viceKey] === "string" ? choices[viceKey] : "") : "";
  const viceOpt = useMemo(() => (vice && viceChosen ? vice.options.find((o) => o.key === viceChosen) : undefined), [vice, viceChosen]);
  // 契约选择：缚影师三选一（精类/星辰/阴暗 Binder）、魔剑士五选一（精类/炼狱/星辰/阴暗/元素）。
  // 效果在独立契约条目中，选中后填充占位特性并自动授予契约威能。
  const pact = useMemo(() => binderPacts(entry, lookup) ?? hexbladePacts(entry, lookup), [entry, lookup]);
  const pactKey = pact ? entry.id + "::契约" : undefined;
  const pactChosen = pact && pactKey ? (typeof choices[pactKey] === "string" ? choices[pactKey] : "") : "";
  const pactOpt = useMemo(() => (pact && pactChosen ? pact.options.find((o) => o.key === pactChosen) : undefined), [pact, pactChosen]);
  // 战争祭司：领域选择（效果在领域条目中，选中后填充对应等级+类型的占位特性并自动授予领域威能）
  const wpr = useMemo(() => warpriestDomains(entry, domains), [entry, domains]);
  const wprKey = wpr ? entry.id + "::领域" : undefined;
  const wprChosen = wpr && wprKey ? (typeof choices[wprKey] === "string" ? choices[wprKey] : "") : "";
  const wprOpt = useMemo(() => (wpr && wprChosen ? wpr.options.find((o) => o.key === wprChosen) : undefined), [wpr, wprChosen]);
  // 圣骑兵：美德二选一（牺牲/英勇；具体效果在美德条目中，选中后填充占位特性）
  const virt = useMemo(() => cavalierVirtues(entry, lookup), [entry, lookup]);
  const virtKey = virt ? entry.id + "::美德" : undefined;
  const virtChosen = virt && virtKey ? (typeof choices[virtKey] === "string" ? choices[virtKey] : "") : "";
  const virtOpt = useMemo(() => (virt && virtChosen ? virt.options.find((o) => o.key === virtChosen) : undefined), [virt, virtChosen]);
  // 学派法师：魔法学派选择（参考缚影师契约的简洁 chips，忠实还原 5/10 级专家/大师在 A/B 间选择）。
  // 收益在独立「魔法学派」条目中，选中后填充回对应等级占位特性；选择值存学派短名（如「塑能」）。
  const mageSchoolOpts = useMemo(() => parseMageSchools(entry, magicSchools), [entry, magicSchools]);
  const mage1Key = entry.id + "::魔法学派1";
  const mage2Key = entry.id + "::魔法学派2";
  const mageExKey = entry.id + "::魔法学派专家";
  const mageMaKey = entry.id + "::魔法学派大师";
  const mage1 = typeof choices[mage1Key] === "string" ? choices[mage1Key] : "";
  const mage2Raw = typeof choices[mage2Key] === "string" ? choices[mage2Key] : "";
  const mage2 = mage2Raw === mage1 ? "" : mage2Raw; // 4级须与1级不同：变更1级后旧第二学派视为未选
  // 专家/大师级仅在 A/B（第一/第二学派）间有效：变更学派后旧选择视为未选
  const mageExSelRaw = typeof choices[mageExKey] === "string" ? choices[mageExKey] : "";
  const mageMaSelRaw = typeof choices[mageMaKey] === "string" ? choices[mageMaKey] : "";
  const mageExSel = mageExSelRaw === mage1 || mageExSelRaw === mage2 ? mageExSelRaw : "";
  const mageMaSel = mageMaSelRaw === mage1 || mageMaSelRaw === mage2 ? mageMaSelRaw : "";
  // 解析职业特性后，若已选败德或契约，则把对应占位特性正文替换为选中条目对应小节的机械内容（保留{{powerRef}}模板自动授予威能）。
  // 学派法师的学派收益不在此处替换正文（保留各等级特性的规则原文），而是由各等级特性条目内的 MageSchoolStage 独立选择、展示。
  const parsed = useMemo(() => {
    if (!features) return undefined;
    const p = parseFeatureSections(features);
    // 战争祭司：把「1级：治愈真言」挪到「1级：引导神力威能」下方（与该级其他领域相关特性一组展示），与是否已选领域无关
    const reorderHeal = (arr: FeatureSection[]): FeatureSection[] => {
      if (!wpr) return arr;
      const cT = (s: FeatureSection) => cnTitle(s.title);
      const heal = arr.findIndex((s) => cT(s).startsWith("1级：治愈真言"));
      const chan = arr.findIndex((s) => cT(s).startsWith("1级：引导神力威能"));
      if (heal >= 0 && chan >= 0 && heal < chan) {
        const [item] = arr.splice(heal, 1);
        arr.splice(chan + 1, 0, item);
      }
      return arr;
    };
    if (!viceOpt && !pactOpt && !wprOpt && !virtOpt) return { ...p, sections: reorderHeal([...p.sections]) };
    const viceFind = (title: string) => (viceOpt ? VICE_FILL_KEYWORDS.find((k) => title.includes(k)) : undefined);
    // 魔剑士契约：按「去掉等级前缀后的中文特性名」精确匹配占位特性（避免误伤「进阶契约武器」等含重叠词的真实特性）；
    // 缚影师契约：沿用关键词子串匹配（标题如「契约之赐」「契约学识」「契约遭遇威能」）。
    const pactFind = (title: string) => {
      if (!pactOpt) return undefined;
      if (pact?.kind === "hexblade") {
        const name = cnTitle(title).replace(/^\d+级[：:]\s*/, "").trim();
        return pactOpt.fills.some((f) => f.keyword === name) ? name : undefined;
      }
      return PACT_FILL_KEYWORDS.find((k) => title.includes(k));
    };
    const virtFind = (title: string) => (virtOpt ? VIRTUE_FILL_KEYWORDS.find((k) => title.includes(k)) : undefined);
    // 战争祭司：把领域占位特性替换为所选领域对应「等级+类型」小节内容；{{威能}} 已在 warpriestDomains 里还原为 [[威能]]，随正文自动授予并悬浮预览
    const domFill = (s: FeatureSection): FeatureSection | undefined => {
      if (!wprOpt) return undefined;
      const type = domainTypeOf(s.title);
      if (!type) return undefined;
      const sec = wprOpt.sections.find((d) => d.level === featureLevel(s.title) && d.type === type);
      return sec ? { ...s, body: sec.body, powerRef: s.powerRef } : undefined;
    };
    const mapped = p.sections.map((s) => {
      const t = cnTitle(s.title);
      let fill: BinderPactFill | BlackguardViceFill | VirtueFill | undefined;
      let kw = viceFind(t);
      if (kw) fill = viceOpt?.fills.find((f) => f.keyword === kw);
      if (!fill) {
        kw = pactFind(t);
        if (kw) fill = pactOpt?.fills.find((f) => f.keyword === kw);
      }
      if (!fill) {
        kw = virtFind(t);
        if (kw) fill = virtOpt?.fills.find((f) => f.keyword === kw);
      }
      if (fill) {
        const refM = fill.body.match(/\{\{([^}]+)\}\}/);
        const powerRef = refM ? refM[1].trim() : s.powerRef;
        const body = refM ? fill.body.replace(/\{\{[^}]+\}\}/g, "").trim() : fill.body;
        return { ...s, body, powerRef };
      }
      return domFill(s) ?? s;
    });
    return { ...p, sections: reorderHeal(mapped) };
  }, [features, viceOpt, pactOpt, wprOpt, virtOpt, wpr, pact]);
  // 主职业条目里被解析成特性段落的「支配 Domination / 暴怒 Fury」小节：作为败德选择的风味展示，
  // 不再当作普通特性单独渲染在下方（避免两段风味同时出现）
  const viceDescTitles = useMemo(() => (vice ? new Set(vice.descTitles) : new Set<string>()), [vice]);
  const pactDescTitles = useMemo(() => (pact ? new Set(pact.descTitles) : new Set<string>()), [pact]);
  const virtDescTitles = useMemo(() => (virt ? new Set(virt.descTitles) : new Set<string>()), [virt]);
  const groups = useMemo(() => (parsed ? detectReplacementGroups(parsed.sections) : new Map<string, AltGroup>()), [parsed]);
  const altSet = useMemo(() => new Set([...groups.values()].flatMap((g: AltGroup) => g.alts.map((a: FeatureSection) => a.title))), [groups]);
  // 权势者仪态（HoF 可选职业特性）：开关型启用后从若干权势者仪态中多选；可选数量随等级递增（1→2、13→3、17→4）
  const signsSection = useMemo(() => (parsed ? parsed.sections.find((s) => s.title.startsWith("权势者仪态")) : undefined), [parsed]);
  const signsKey = signsSection ? entry.id + "::" + signsSection.title : undefined;
  const signsListKey = signsSection ? entry.id + "::signs" : undefined;
  const signsOn = !!signsKey && choices[signsKey] === "on";
  const signsChosen = signsListKey ? choiceVals(choices[signsListKey]) : [];
  const signsCount = level < 13 ? 2 : level < 17 ? 3 : 4;
  // 保护者「召唤自然盟友」：抽出单独渲染（含按等级折叠的野兽数据）
  const summonSection = useMemo(() => (parsed ? parsed.sections.find((s) => cnTitle(s.title) === "召唤自然盟友") : undefined), [parsed]);
  const summonAspect = useMemo(() => resolvePrimalAspect(choices, [entry]), [choices, entry]);
  // 哨兵「动物伙伴」季节联动：读取「自然循环之侍从」所选季节，联动展示对应动物伙伴数据卡
  const seasonSection = useMemo(() => (parsed ? parsed.sections.find((s) => cnTitle(s.title).includes("自然循环之侍从")) : undefined), [parsed]);
  const companionSeason = useMemo(() => {
    if (!seasonSection) return undefined;
    const v = choices[entry.id + "::" + seasonSection.title];
    return Array.isArray(v) ? v[0] : typeof v === "string" ? v : undefined;
  }, [seasonSection, choices, entry.id]);
  // 刺客（行刑者）：三工会选择（血红正义/低语联盟/忍者之道）；选中的工会落地相应武器擅长与赠送威能
  const exe = useMemo(() => executionerGuilds(entry.sourceText), [entry.sourceText]);
  const exeKey = exe ? entry.id + "::刺客公会" : undefined;
  const exeGuildTitles = useMemo(() => (exe ? new Set(exe.options.map((o) => cnTitle(o.key))) : new Set<string>()), [exe]);
  // 提炼多处复用的「基础多选 + N 个『额外…』追加单选」模式（共用同一选项池，互斥去重）：
  //  - 战士（骑士/杀手等）：「战士架势」+「额外战士架势」
  //  - 游荡者（盗贼）：「游荡者技巧」+「额外游荡者技巧」
  // 检测：标题以「额外」开头且正文引用「从1级X的选项中」的为追加项，据此反推基础项名。
  type ExtraGroup = {
    baseName: string;
    base?: FeatureSection;
    extras: FeatureSection[];
    options: { label: string; desc: string }[];
  };
  const extraChoiceGroups = useMemo<ExtraGroup[]>(() => {
    if (!parsed) return [];
    const out: ExtraGroup[] = [];
    const seen = new Set<string>();
    for (const s of parsed.sections) {
      if (!tierVisible(s.title)) continue;
      const body = s.body ?? "";
      // 追加项的正文必须是「从1级「X」的选项中…获得额外X」的引用行（X=基础选项池名）。
      // 兼容两种命名：战士/盗贼的标题含「额外X」，斥候的标题为「N级：X」且不含「额外」。
      const m = body.match(/从1级「?([^」的]+?)」?的选项/);
      if (!m) continue;
      const baseName = m[1].trim();
      if (seen.has(baseName)) continue;
      // 基础特性：同名标题、且正文是真正的选项列表（不含「从1级…的选项」引用行）。
      // 找不到选项池则跳过（防止把交叉引用的描述性正文误判为追加项）。
      const base = parsed.sections.find(
        (b) => b !== s && cnTitle(b.title).includes(baseName) && !/从1级/.test(b.body ?? "")
      );
      if (!base) continue;
      seen.add(baseName);
      // 追加项判定：标题含「额外X」（战士/盗贼），或标题为「N级：X」的同名不同级变体（斥候，N>基础级）。
      // 用「去掉等级前缀与额外前缀后的纯中文名 === baseName」精确匹配，避免被含 baseName 子串的无关特性误判。
      const extraName = (t: string) => {
        const c = cnTitle(t).replace(/^\d+级[：:]\s*/, "").replace(/^额外/, "").trim();
        return c.includes(baseName);
      };
      const extras = parsed.sections.filter(
        (x) =>
          tierVisible(x.title) &&
          x !== base &&
          extraName(x.title) &&
          // 排除普通同名但非追加引用行的占位/说明特性（如「进阶双武器攻击」的说明里带「荒野面貌」字样）
          /从1级/.test(x.body ?? "")
      );
      if (extras.length === 0) { seen.delete(baseName); continue; }
      out.push({
        baseName,
        base,
        extras,
        options: base ? parseClassFeatureOptions(base.body).options : [],
      });
    }
    return out;
  }, [parsed, tierVisible]);
  const extraSet = useMemo(() => new Set(extraChoiceGroups.flatMap((g) => g.extras.map((s) => s.title))), [extraChoiceGroups]);
  const groupOfExtra = (title: string): ExtraGroup | undefined => extraChoiceGroups.find((g) => g.extras.some((e) => e.title === title));
  // 某组（基础 + 各追加项）已选的全部选项下标集合
  const allChosenInGroup = (g: ExtraGroup): Set<string> => {
    const set = new Set<string>();
    const addVals = (k: string) => { const v = choices[k]; if (Array.isArray(v)) v.forEach((x) => set.add(x)); else if (typeof v === "string" && v) set.add(v); };
    if (g.base) addVals(entry.id + "::" + g.base.title);
    for (const e of g.extras) addVals(entry.id + "::" + e.title);
    return set;
  };
  // 某次「额外…」追加项可选项 = 该组全部已选 减 本次已选（自身可选/可取消，其余已占用则置灰）
  const takenFor = (s: FeatureSection): Set<string> => {
    const g = groupOfExtra(s.title);
    if (!g) return new Set();
    const own = choices[entry.id + "::" + s.title];
    const t = allChosenInGroup(g);
    if (Array.isArray(own)) own.forEach((x) => t.delete(x));
    else if (typeof own === "string") t.delete(own);
    return t;
  };
  // 游侠·猎人「射艺流派 ↔ 强化破坏射击」联动：
  // 13级「强化破坏射击」按 1级所选远程武器自动匹配（弓之猎人→齐射弓箭，弩之猎人→惩戒弩箭）。
  // 仅作为未显式选择时的建议默认值；玩家若刻意选择另一款武器特性（如弓弩双修）仍可手动覆盖。
  const ARROW_VOLLEY = "齐射弓箭 Volley of Arrows";
  const BOLT_PUNISH = "惩戒弩箭 Punishing Quarrel";
  const archeryLinkedDefault = useMemo(() => {
    const style = parsed?.sections.find((s) => cnTitle(s.title) === "1级：射艺流派");
    const v = style ? choices[entry.id + "::" + style.title] : "";
    if (typeof v === "string" && v) {
      if (/弩之猎人|Crossbow/i.test(v)) return BOLT_PUNISH;
      if (/弓之猎人|Bow/i.test(v)) return ARROW_VOLLEY;
    }
    return undefined;
  }, [parsed, entry.id, choices]);
  const isEnhancedShot = (title: string) => cnTitle(title).replace(/^\d+级[：:]\s*/, "") === "强化破坏射击";
  const effSectionChosen = (title: string) => {
    const v = choices[entry.id + "::" + title];
    if (isEnhancedShot(title) && (v == null || v === "")) return archeryLinkedDefault;
    return v;
  };
  const normalSections = useMemo(() => (parsed ? parsed.sections.filter((s) => !groups.has(s.title) && !altSet.has(s.title) && s !== signsSection && s !== summonSection && !viceDescTitles.has(s.title.trim()) && !pactDescTitles.has(s.title.trim()) && !virtDescTitles.has(s.title.trim()) && !exeGuildTitles.has(cnTitle(s.title)) && !(exe && cnTitle(s.title) === "刺客公会") && tierVisible(s.title) && !extraSet.has(s.title)) : []), [parsed, groups, altSet, signsSection, summonSection, viceDescTitles, pactDescTitles, virtDescTitles, exeGuildTitles, exe, tierVisible, extraSet]);
  // 兽王：把「兽王」特性抽出来单独渲染（排到特性列表末尾），并据此启用「成为兽王」互斥逻辑
  const beastSection = useMemo(() => (parsed ? parsed.sections.find((s) => cnTitle(s.title) === "兽王") : undefined), [parsed]);
  // 特性区域之外的 sidebar 规则小节（如圣武士「神圣制裁」），按兽王折叠样式渲染
  const sidebarRules = useMemo(() => sidebarRuleSections(entry.sourceText), [entry.sourceText]);
  const beastMasterKey = beastSection ? entry.id + "::beast-master" : undefined;
  const beastPartnerKey = beastSection ? entry.id + "::beast-partner" : undefined;
  const beastOn = !!beastMasterKey && choices[beastMasterKey] === "on";
  const chosenBeast = beastPartnerKey ? (typeof choices[beastPartnerKey] === "string" ? choices[beastPartnerKey] : "") : "";
  // 开关型特性：正文以「当你选择该职业特性时」开头、且非可选列表（如督军「射手督军」），做成开/关选择
  const toggleSections = useMemo(() => {
    if (!parsed) return [];
    return parsed.sections.filter((s) => {
      if (s === beastSection) return false;
      if (!tierVisible(s.title)) return false;
      const b = (s.body ?? "").trim();
      if (!/^当你选择(?:该|此)职业特性时/.test(b)) return false;
      // 排除本身已含「从下列选项中选择」「选择一个」等选项列表的特性
      return !parseClassFeatureOptions(b).selectable;
    });
  }, [parsed, beastSection, tierVisible]);
  const toggleSet = useMemo(() => new Set(toggleSections.map((s) => s.title)), [toggleSections]);
  // 多替换组特性：正文含 ≥2 个独立替换对（如牧师「引导神力」），用 MultiReplacementBlock 渲染
  const multiSections = useMemo(() => {
    if (!parsed) return [];
    return parsed.sections.filter((s) => s !== beastSection && !toggleSet.has(s.title) && !!parseReplacementPairs(s.body ?? "") && tierVisible(s.title));
  }, [parsed, beastSection, toggleSet, tierVisible]);
  const multiSet = useMemo(() => new Set(multiSections.map((s) => s.title)), [multiSections]);
  // 特性按原始来源顺序交错渲染：普通特性 + 替代组 base + 额外战士架势 统一按等级排入列表头部位置，
  // 避免替代组选择器与额外架势被挤到所有（如 30 级）特性之后显示。
  const srcIndex = useMemo(() => {
    const m = new Map<string, number>();
    parsed?.sections.forEach((s, i) => m.set(s.title, i));
    return m;
  }, [parsed]);
  const rowSections = useMemo(() => {
    const items = [
      ...normalSections,
      ...extraChoiceGroups.flatMap((g) => g.extras),
      ...[...groups.values()].map((g) => g.base).filter((s) => !(beastOn && beastMasterKey && cnTitle(s.title) === "准确射击")),
    ];
    return items
      .filter((s) => s !== beastSection && !toggleSet.has(s.title) && !multiSet.has(s.title) && featureReachable(s.title, level) && !(beastOn && beastMasterKey && cnTitle(s.title) === "战斗流派"))
      .sort((a, b) => (srcIndex.get(a.title) ?? 0) - (srcIndex.get(b.title) ?? 0));
  }, [normalSections, extraChoiceGroups, groups, srcIndex, beastSection, toggleSet, multiSet, level, beastOn, beastMasterKey]);
  // 选中工会的赠送威能/专长（正文「''增益：''你获得[[威能]]…」；忍者之道另含武器擅长）
  const exeChosen = exe && exeKey ? (typeof choices[exeKey] === "string" ? choices[exeKey] : "") : "";
  const exeBody = useMemo(() => (exe && exeChosen ? exe.options.find((o) => o.key === exeChosen)?.body : undefined), [exe, exeChosen]);
  const exeGranted = useMemo(() => {
    const powers: Entry[] = []; const feats: Entry[] = []; const rituals: Entry[] = [];
    if (!exeBody) return { powers, feats, rituals };
    const seenP = new Set<string>(); const seenF = new Set<string>(); const seenR = new Set<string>();
    for (const t of wikiLinkTargets(exeBody)) {
      const e = lookup(t); if (!e) continue;
      if (e.category === "power" && !seenP.has(e.id)) { seenP.add(e.id); powers.push(e); }
      else if (e.category === "feat" && !seenF.has(e.id)) { seenF.add(e.id); feats.push(e); }
      else if (e.category === "ritual" && !seenR.has(e.id)) { seenR.add(e.id); rituals.push(e); }
    }
    return { powers, feats, rituals };
  }, [exeBody, lookup]);
  // 精华职业：职业特性按等级折叠，达到前提等级才展开
  const essential = ESSENTIALS_CLASS_IDS.has(entry.id);
  const featOpen = (s: FeatureSection) => !essential || level >= featureLevel(s.title);

  // 计算某职业特性在当前 choices 状态下授予的威能/赠送专长/赠送仪式（供自动加入 + 手动按钮）
  const grantedOf = (s: FeatureSection): { powers: Entry[]; feats: Entry[]; rituals: Entry[] } => {
    const powers: Entry[] = [];
    const feats: Entry[] = [];
    const rituals: Entry[] = [];
    const add = (e?: Entry) => { if (e && e.category === "power" && !powers.some((x) => x.id === e.id)) powers.push(e); };
    // 从正文「获得[[专长]]作为…专长」赠送句中收集赠送专长，同样按等级门槛过滤
    const addFeatText = (text?: string) => {
      if (!text) return;
      const gates = levelGatedWikiLinks(text);
      for (const t of grantedFeatLinks(text)) {
        const g = gates.get(t);
        if (g !== undefined && level < g) continue;
        const e = lookup(t);
        if (e && e.category === "feat" && !feats.some((x) => x.id === e.id)) feats.push(e);
      }
    };
    // 从正文「仪式书…：[[仪式]]」等赠送句中收集赠送仪式，同样按等级门槛过滤
    const addRitualText = (text?: string) => {
      if (!text) return;
      const gates = levelGatedWikiLinks(text);
      for (const t of grantedRitualLinks(text, lookup)) {
        const g = gates.get(t);
        if (g !== undefined && level < g) continue;
        const e = lookup(t);
        if (e && e.category === "ritual" && !rituals.some((x) => x.id === e.id)) rituals.push(e);
      }
    };
    const addGrantedText = (text?: string) => { addFeatText(text); addRitualText(text); };
    const key = entry.id + "::" + s.title;
    // 替代组：外层选择 base 或其替代项
    if (groups.has(s.title)) {
      const g = groups.get(s.title)!;
      const outerSel = typeof choices[key] === "string" ? choices[key] : "";
      if (outerSel === cleanDisplayName(g.base.title)) {
        // 选中 base：base 自身的选择型（如战士武器天赋选单手/双手）与正文内引用
        const ip = parseClassFeatureOptions(g.base.body);
        const innerVals = choiceVals(choices[key + "::inner"]);
        if (ip.selectable) {
          for (const o of ip.options) {
            if (!innerVals.includes(o.label)) continue;
            if (!o.desc) add(lookup(o.label));
            else for (const e of optionGrantedPowers(o.desc, choices[key + "::inner"], lookup)) add(e);
            addGrantedText(o.desc);
          }
        }
        for (const e of optionGrantedPowers(g.base.body ?? "", choices[key + "::inner"], lookup)) add(e);
        addGrantedText(g.base.body);
      } else {
        const alt = g.alts.find((a) => cleanDisplayName(a.title) === outerSel);
        if (alt) {
          for (const e of optionGrantedPowers(alt.body ?? "", undefined, lookup)) add(e);
          addGrantedText(alt.body);
        }
      }
      return { powers, feats, rituals };
    }
    if (altSet.has(s.title)) {
      const outerSel = typeof choices[key] === "string" ? choices[key] : "";
      if (outerSel === cleanDisplayName(s.title)) {
        for (const e of optionGrantedPowers(s.body ?? "", undefined, lookup)) add(e);
        addGrantedText(s.body);
      }
      return { powers, feats, rituals };
    }
    // 开关型特性：开启后正文内的威能
    if (toggleSet.has(s.title)) {
      if (choices[key] === "on") {
        for (const e of optionGrantedPowers(s.body ?? "", undefined, lookup)) add(e);
        addGrantedText(s.body);
      }
      return { powers, feats, rituals };
    }
    // 多替换组：每组当前生效项 = 已选 ?? 默认被替代项
    if (multiSet.has(s.title)) {
      const p = parseReplacementPairs(s.body ?? "");
      if (p) for (const [gi, g] of p.groups.entries()) {
        const raw = choices[key + "::g" + gi];
        const cur = typeof raw === "string" ? raw : "";
        add(lookup(cur || g.base));
      }
      return { powers, feats, rituals };
    }
    if (s === beastSection) return { powers, feats, rituals }; // 野兽伙伴不是威能条目
    // 「额外…」追加单选（如额外战士架势 / 额外游荡者技巧）：只授予本次单独选中的一个威能
    if (extraSet.has(s.title)) {
      const v = typeof choices[key] === "string" ? choices[key] : "";
      if (v) { const e = lookup(v); if (e && e.category === "power" && !powers.some((x) => x.id === e.id)) powers.push(e); }
      return { powers, feats, rituals };
    }
    // 「选择一个额外专长：[[X]]或[[Y]]」二选一专长（如行刑者「多才防御」）：按所选授予对应专长
    const fc = featChoiceData(s.body ?? "");
    if (fc) {
      const v = typeof choices[key] === "string" ? choices[key] : "";
      if (v) {
        const e = lookup(v);
        if (e && e.category === "feat" && !feats.some((x) => x.id === e.id)) feats.push(e);
      }
      return { powers, feats, rituals };
    }
    // 元素使「提升元素」：正文用 {{元素提升（气/土/火/水）…}} 四个模板引用对应专精的威能，
    // 只授予与所选「元素专精」匹配的那一个，并随专精切换自动更换。
    if (cnTitle(s.title) === "提升元素") {
      const specKey = entry.id + "::元素专精 Elemental Specialty";
      const spec = typeof choices[specKey] === "string" ? choices[specKey] : "";
      const specEl = cnTitle(spec).replace(/元素使$/, "").trim(); // 气/土/火/水
      const EN: Record<string, string> = { "气": "Air", "土": "Earth", "火": "Fire", "水": "Water" };
      if (EN[specEl]) add(lookup("元素提升（" + specEl + "） Elemental Escalation (" + EN[specEl] + ")"));
      else if (s.powerRef) add(lookup(s.powerRef)); // 未选专精时回退到默认（正文第一个模板）
      return { powers, feats, rituals };
    }
    // 普通 / 选择型特性
    const parsedOpt = parseClassFeatureOptions(s.body);
    if (parsedOpt.selectable) {
      const chosenVals = choiceVals(choices[key]);
      // 选择型特性引言中可能明确「获得[[专长]]作为…额外专长」（如元素法师的奥术魔宠），
      // 该基础赠送与选项选择无关，需始终授予（grantedFeatLinks 只匹配明确赠送句式）。
      addGrantedText(parsedOpt.intro);
      if (parsedOpt.forceDefault) {
        // 4c「代替」型（如机关术士「治疗注射」、邪术师「魔能爆」）：
        // 始终授予引言中提到的非选项基础威能（如「治疗注射：混合药物」），
        // 替换项取「已选 ?? 默认保留项」（未选时默认生效原威能）。
        const optLabels = new Set(parsedOpt.options.map((o) => o.label));
        for (const t of wikiLinkTargets(parsedOpt.intro ?? "")) {
          if (!optLabels.has(t)) add(lookup(t));
        }
        const effective = chosenVals.length > 0 ? chosenVals[0] : parsedOpt.forceDefault;
        const opt = parsedOpt.options.find((o) => o.label === effective);
        if (opt) {
          if (!opt.desc) add(lookup(opt.label));
          else for (const e of optionGrantedPowers(opt.desc, choices[key + "::inner"], lookup)) add(e);
          addFeatText(opt.desc);
        }
      } else {
        for (const o of parsedOpt.options) {
          if (!chosenVals.includes(o.label)) continue;
          // 选项本身即威能（如保护者「原力协调」的大气精魂等）：直接授予该威能；
          // 否则从选项描述中提取 [[威能]]（如炼狱契约的子二选一）
          const optEntry = lookup(o.label);
          if (optEntry && optEntry.category === "power") {
            add(optEntry);
          } else if (!o.desc) {
            add(lookup(o.label));
          } else {
            for (const e of optionGrantedPowers(o.desc, choices[key + "::inner"], lookup)) add(e);
          }
          addGrantedText(o.desc);
        }
      }
    } else {
      // 哨兵季节变体特性（13级自然循环典范 / 17级动物伙伴威能）：只对所选季节的小节生效，
      // 只授予该季节小节内的 [[威能]]（如17级仅授予暴狼扑击/巨熊耐力/微风携运中的对应一个），
      // 随季节切换自动增删。
      const seasonSub = seasonSubOf(s.body ?? "", companionSeason);
      if (seasonSub) {
        const { intro } = splitSeasonVariant(s.body ?? "");
        const filtered = (intro + "\n" + seasonSub.body).replace(/^\s*$/gm, "").trim();
        const gates = levelGatedWikiLinks(filtered);
        for (const t of wikiLinkTargets(filtered)) {
          const g = gates.get(t);
          if (g !== undefined && level < g) continue;
          add(lookup(t));
        }
        addGrantedText(seasonSub.body);
        return { powers, feats, rituals };
      }
      // 普通特性：正文内所有 [[威能]] 链接均授予；但「N级时，你获得[[X]]」的威能需达到对应等级才加入（如野蛮人「狂暴打击」5级）；
      // 「如果你有[[X]]」等条件句中的链接只是前提说明，不授予（如法师（学派法师）19级「每日威能」的[[召唤暗影仆从]]）。
      const gates = levelGatedWikiLinks(s.body);
      const cond = conditionalGrantLinks(s.body);
      for (const t of wikiLinkTargets(s.body)) {
        if (cond.has(t)) continue;
        const g = gates.get(t);
        if (g !== undefined && level < g) continue;
        add(lookup(t));
      }
      // 特性正文以 {{威能}} 模板引用自身威能（如保护者「自然生长」）时直接授予对应威能；
      // 仅当正文明确「获得下列…威能」（如专业射手「获得下列3个威能」）时，才同时授予全部模板引用，
      // 避免把剑法术「获得3个…威能」、召唤自然盟友等「选项池/示例召唤生物」误判为全部授予。
      const explicitGrantAll = /获得(下列|以下|这些)[^。！？\n]{0,20}?(威能|能力|奥义)/.test(s.body ?? "");
      const refs = explicitGrantAll ? (s.powerRefs && s.powerRefs.length ? s.powerRefs : s.powerRef ? [s.powerRef] : []) : s.powerRef ? [s.powerRef] : [];
      for (const ref of refs) add(lookup(ref));
      addGrantedText(s.body);
    }
    return { powers, feats, rituals };
  };

  // 战争祭司：所选领域全部威能（按最小等级门槛过滤）。领域威能大多已随占位特性填充自动授予，
  // 此处额外兜底涵盖未被任何占位特性接收的典范/史诗领域威能（如 12/16/20/22 级领域辅助/每日威能）。
  const domainGranted = useMemo(() => {
    const out: Entry[] = [];
    if (!wprOpt) return out;
    const seen = new Set<string>();
    for (const pw of wprOpt.powers) {
      if (level < pw.level) continue;
      const e = lookup(pw.title);
      if (e && e.category === "power" && !seen.has(e.id)) { seen.add(e.id); out.push(e); }
    }
    return out;
  }, [wprOpt, lookup, level]);

  // 全部特性（含替代组 base/alt、开关、多替换）当前授予的威能集合
  const allGranted = useMemo(() => {
    const out: Entry[] = [];
    const seen = new Set<string>();
    const secs: FeatureSection[] = [
      ...normalSections.filter((s) => featureReachable(s.title, level)),
      ...[...groups.values()].flatMap((g) => [g.base, ...g.alts]).filter((s) => featureReachable(s.title, level) && tierVisible(s.title)),
      ...toggleSections.filter((s) => featureReachable(s.title, level)),
      ...multiSections.filter((s) => featureReachable(s.title, level)),
      ...(beastSection && featureReachable(beastSection.title, level) ? [beastSection] : []),
    ];
    for (const s of secs) {
      for (const e of grantedOf(s).powers) {
        if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
      }
    }
    for (const e of exeGranted.powers) {
      if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
    }
    for (const e of domainGranted) {
      if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalSections, groups, altSet, toggleSections, multiSections, beastSection, choices, lookup, level, exeGranted, tierVisible, domainGranted]);
  // 全部特性当前赠送的专长集合（仅明确「获得[[专长]]作为…专长」的）
  const allGrantedFeats = useMemo(() => {
    const out: Entry[] = [];
    const seen = new Set<string>();
    const secs: FeatureSection[] = [
      ...normalSections.filter((s) => featureReachable(s.title, level)),
      ...[...groups.values()].flatMap((g) => [g.base, ...g.alts]).filter((s) => featureReachable(s.title, level) && tierVisible(s.title)),
      ...toggleSections.filter((s) => featureReachable(s.title, level)),
      ...multiSections.filter((s) => featureReachable(s.title, level)),
      ...(beastSection && featureReachable(beastSection.title, level) ? [beastSection] : []),
    ];
    for (const s of secs) {
      for (const e of grantedOf(s).feats) {
        if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
      }
    }
    for (const e of exeGranted.feats) {
      if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalSections, groups, altSet, toggleSections, multiSections, beastSection, choices, lookup, level, exeGranted, tierVisible]);
  // 全部特性当前赠送的仪式集合（正文「仪式书…：[[仪式]]」赠送的仪式类链接），同时记录来源职业特性名（供角标显示）
  const allGrantedRituals = useMemo(() => {
    const out: { entry: Entry; source: string }[] = [];
    const seen = new Set<string>();
    const secs: FeatureSection[] = [
      ...normalSections.filter((s) => featureReachable(s.title, level)),
      ...[...groups.values()].flatMap((g) => [g.base, ...g.alts]).filter((s) => featureReachable(s.title, level) && tierVisible(s.title)),
      ...toggleSections.filter((s) => featureReachable(s.title, level)),
      ...multiSections.filter((s) => featureReachable(s.title, level)),
      ...(beastSection && featureReachable(beastSection.title, level) ? [beastSection] : []),
    ];
    for (const s of secs) {
      const source = cleanDisplayName(featTitle(s.title));
      for (const e of grantedOf(s).rituals) {
        if (!seen.has(e.id)) { seen.add(e.id); out.push({ entry: e, source }); }
      }
    }
    for (const e of exeGranted.rituals) {
      if (!seen.has(e.id)) { seen.add(e.id); out.push({ entry: e, source: "刺客公会" }); }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalSections, groups, altSet, toggleSections, multiSections, beastSection, choices, lookup, level, exeGranted, tierVisible]);
  const grantedKey = useMemo(() => allGranted.map((p) => p.id).sort().join("|"), [allGranted]);
  const grantedFeatKey = useMemo(() => allGrantedFeats.map((f) => f.id).sort().join("|"), [allGrantedFeats]);
  const grantedRitualKey = useMemo(() => allGrantedRituals.map((r) => r.entry.id).sort().join("|"), [allGrantedRituals]);
  // 自动加入/移除：挂载时记录并补入缺失威能；choice/level 变化带来「新授予」威能时自动加入，
  // 并把「不再授予」的威能（如野性力量切换选项后的旧威能）从面板移除，保证面板只保留当前选择。
  const prevGrantedKey = useRef<string | null>(null);
  useEffect(() => {
    if (prevGrantedKey.current === null) {
      prevGrantedKey.current = grantedKey;
      if (allGranted.length > 0) {
        // 首次挂载：记录为「职业授予」供更换职业移除，并把尚未进面板的已授予威能自动加入
        if (onTrackClassPowers) onTrackClassPowers(allGranted);
        const missing = allGranted.filter((p) => !panelIds.has(p.id));
        if (missing.length) onAddPowers(missing);
      }
      return;
    }
    if (prevGrantedKey.current === grantedKey) return;
    const prevSet = new Set(prevGrantedKey.current.split("|").filter(Boolean));
    prevGrantedKey.current = grantedKey;
    const curSet = new Set(allGranted.map((p) => p.id));
    const removed = [...prevSet].filter((id) => !curSet.has(id));
    if (removed.length && onRemovePowers) onRemovePowers(removed);
    const newly = allGranted.filter((p) => !prevSet.has(p.id));
    if (newly.length) onAddPowers(newly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantedKey]);
  // 赠送专长自动记录/移除：挂载时记录职业赠送专长；choice 变化带来「新赠送」专长时记录、
  // 把「不再赠送」的专长从记录移除（如战斗流派切换选项后旧流派赠送的专长）。
  const prevFeatKey = useRef<string | null>(null);
  useEffect(() => {
    if (prevFeatKey.current === null) {
      prevFeatKey.current = grantedFeatKey;
      if (allGrantedFeats.length > 0 && onTrackClassFeats) onTrackClassFeats(allGrantedFeats);
      return;
    }
    if (prevFeatKey.current === grantedFeatKey) return;
    const prevSet = new Set(prevFeatKey.current.split("|").filter(Boolean));
    prevFeatKey.current = grantedFeatKey;
    const curSet = new Set(allGrantedFeats.map((f) => f.id));
    const removed = [...prevSet].filter((id) => !curSet.has(id));
    if (removed.length && onRemoveFeats) onRemoveFeats(removed);
    const newly = allGrantedFeats.filter((f) => !prevSet.has(f.id));
    if (newly.length && onTrackClassFeats) onTrackClassFeats(newly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantedFeatKey]);
  // 赠送仪式自动记录/移除：挂载时记录职业赠送仪式；choice 变化带来「新赠送」仪式时记录、
  // 把「不再赠送」的仪式从记录移除。
  const prevRitualKey = useRef<string | null>(null);
  useEffect(() => {
    if (prevRitualKey.current === null) {
      prevRitualKey.current = grantedRitualKey;
      if (allGrantedRituals.length > 0 && onTrackClassRituals) onTrackClassRituals(allGrantedRituals);
      return;
    }
    if (prevRitualKey.current === grantedRitualKey) return;
    const prevSet = new Set(prevRitualKey.current.split("|").filter(Boolean));
    prevRitualKey.current = grantedRitualKey;
    const curSet = new Set(allGrantedRituals.map((r) => r.entry.id));
    const removed = [...prevSet].filter((id) => !curSet.has(id));
    if (removed.length && onRemoveClassRituals) onRemoveClassRituals(removed);
    const newly = allGrantedRituals.filter((r) => !prevSet.has(r.entry.id));
    if (newly.length && onTrackClassRituals) onTrackClassRituals(newly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantedRitualKey]);

  if (detail) {
    return (
      <div className="class-detail">
        <div className="pf-entry-title">{cleanDisplayName(entry.name)}</div>
        {trait && !featureOnly && <div className="class-trait" dangerouslySetInnerHTML={{ __html: wikiToHtml(splitTraitLabels(trait), entry.fields).replace(/\n{2,}/g, "\n").replace(/\n/g, "<br/>") }} />}
        {!featureOnly && classLore.length > 0 && (
          <div className="race-lore cls-lore">
            {classLore.map((sec, i) => (
              <details key={`cls-lore-${i}`} className="lore-fold">
                <summary>
                  <span className="lore-fold-title">{sec.title ?? "职业简介"}</span>
                  <span className="material-symbols-outlined lore-fold-ic">expand_more</span>
                </summary>
                <div className="class-features"><WikiBody body={sec.body} fields={entry.fields} lookup={lookup} /></div>
              </details>
            ))}
          </div>
        )}
        <div className={featureOnly ? "class-ft-heading-sub" : "pf-entry-title class-ft-heading"}>{`${cleanDisplayName(entry.name)}具有下列职业特性`}</div>
        {vice && (
          <div className="exe-block">
            {vice.intro && <div className="exe-intro"><WikiBody body={prose(plainWikiLinks(vice.intro))} fields={entry.fields} lookup={lookup} /></div>}
            <div className="exe-guild">
              {vice.options.map((o) => (
                <SmartHover key={o.key} portal className={"exe-guild-chip" + (viceChosen === o.key ? " selected" : "")} popClass="exe-chip-pop" pop={<VicePreview option={o} fields={entry.fields} lookup={lookup} />} onClick={() => viceKey && onChoose(viceKey, o.key)}>
                  {o.key}败德
                </SmartHover>
              ))}
            </div>
            {viceOpt && viceOpt.flavor && <div className="exe-guild-flavor"><WikiBody body={prose(viceOpt.flavor)} fields={entry.fields} lookup={lookup} /></div>}
          </div>
        )}
        {pact && (
          <div className="exe-block">
            {pact.intro && <div className="exe-intro"><WikiBody body={prose(plainWikiLinks(pact.intro))} fields={entry.fields} lookup={lookup} /></div>}
            <div className="exe-guild">
              {pact.options.map((o) => (
                <SmartHover key={o.key} portal className={"exe-guild-chip" + (pactChosen === o.key ? " selected" : "")} popClass="exe-chip-pop" pop={<PactPreview option={o} fields={entry.fields} lookup={lookup} />} onClick={() => pactKey && onChoose(pactKey, o.key)}>
                  {o.key}契约
                </SmartHover>
              ))}
            </div>
            {pactOpt && pactOpt.flavor && <div className="exe-guild-flavor"><WikiBody body={prose(pactOpt.flavor)} fields={entry.fields} lookup={lookup} /></div>}
          </div>
        )}
        {virt && (
          <div className="exe-block">
            {virt.intro && <div className="exe-intro"><WikiBody body={prose(plainWikiLinks(virt.intro))} fields={entry.fields} lookup={lookup} /></div>}
            <div className="exe-guild">
              {virt.options.map((o) => (
                <SmartHover key={o.key} portal className={"exe-guild-chip" + (virtChosen === o.key ? " selected" : "")} popClass="exe-chip-pop" pop={<VirtuePreview option={o} fields={entry.fields} lookup={lookup} />} onClick={() => virtKey && onChoose(virtKey, o.key)}>
                  {o.key}美德
                </SmartHover>
              ))}
            </div>
            {virtOpt && virtOpt.flavor && <div className="exe-guild-flavor"><WikiBody body={prose(virtOpt.flavor)} fields={entry.fields} lookup={lookup} /></div>}
          </div>
        )}
        {wpr && (
          <div className="exe-block">
            <div className="exe-intro"><WikiBody body="选择牧师所追随的领域。选定后，领域将赋予你领域特性与相关威能。" fields={entry.fields} lookup={lookup} /></div>
            <div className="exe-guild">
              {wpr.options.map((o) => (
                <SmartHover key={o.key} portal className={"exe-guild-chip" + (wprChosen === o.key ? " selected" : "")} popClass="exe-chip-pop" pop={<DomainPreview option={o} fields={entry.fields} lookup={lookup} />} onClick={() => wprKey && onChoose(wprKey, o.key)}>
                  {o.name}
                </SmartHover>
              ))}
            </div>
            {wprOpt && <div className="exe-guild-flavor">已选择「{wprOpt.name}」</div>}
          </div>
        )}
        {exe && (
          <div className="exe-block">
            {exe.intro && <div className="exe-intro"><WikiBody body={prose(exe.intro)} fields={entry.fields} lookup={lookup} /></div>}
            <div className="exe-guild">
              {exe.options.map((o) => (
                <button key={o.key} type="button" className={"exe-guild-chip" + (exeChosen === o.key ? " selected" : "")} onClick={() => exeKey && onChoose(exeKey, o.key)}>
                  {cleanDisplayName(o.key)}
                </button>
              ))}
            </div>
            {exe.table && <div className="exe-table" dangerouslySetInnerHTML={{ __html: exe.table }} />}
          </div>
        )}
        {parsed && parsed.sections.length > 0 ? (
          <div className="pf-list">
            {(() => {
              // 已插入的层级表下标（每张表只插入一次，放在对应层级第一个特性之前）
              const emitted = new Set<number>();
              const rows = rowSections;
              return rows.map((s, i) => {
                const L = featureLevel(s.title);
                const pl = cnTitle(s.title).includes("用毒") ? parsePoi(s.body ?? "") : undefined;
                const grp = groups.get(s.title);
                const extraGroup = groupOfExtra(s.title);
                const isExtra = extraGroup !== undefined;
                const isCompanion = cnTitle(s.title).includes("动物伙伴") && !cnTitle(s.title).includes("威能") && !grp && !isExtra && !pl;
                // 哨兵季节变体普通特性（13级自然循环典范 / 17级动物伙伴威能）：仅展示所选季节对应小节
                const seasonSub = seasonSubOf(s.body ?? "", companionSeason);
                const lvInserts = levelTables.map((t, ti) => {
                  const anchor = levelTableAnchors[ti];
                  if (!emitted.has(ti) && L >= anchor && tierVisible(s.title)) {
                    emitted.add(ti);
                    return <div key={`lv-table-${ti}`} className="hero-level-table"><WikiBody body={t} fields={entry.fields} lookup={lookup} /></div>;
                  }
                  return null;
                }).filter((n): n is React.ReactElement => n !== null);
                return (
              <Fragment key={i}>
                {lvInserts}
                <FeatureFold section={s} level={featureLevel(s.title)} expanded={featOpen(s)} fields={entry.fields} lookup={lookup}>
                  <>
                    {pl ? (
                      <PoisonUseBlock section={s} detail fields={entry.fields} choiceKey={entry.id + "::" + s.title} chosen={choices[entry.id + "::" + s.title]} level={level} onChoose={onChoose} lookup={lookup} />
                    ) : isExtra ? (
                      <ExtraStanceBlock section={s} detail choiceKey={entry.id + "::" + s.title} options={extraGroup.options} chosen={choices[entry.id + "::" + s.title]} taken={takenFor(s)} onChoose={onChoose} lookup={lookup} />
                    ) : grp ? (
                      <ReplacementGroupItem group={grp} detail fields={entry.fields}
                        outerKey={entry.id + "::" + grp.base.title}
                        outerChosen={choices[entry.id + "::" + grp.base.title]}
                        innerKey={entry.id + "::" + grp.base.title + "::inner"}
                        innerChosen={choices[entry.id + "::" + grp.base.title + "::inner"]}
                        onChoose={onChoose} lookup={lookup} />
                    ) : isCompanion ? (
                      <AnimalCompanionBlock section={s} detail fields={entry.fields} season={companionSeason} lookup={lookup} />
                    ) : seasonSub ? (
                      <SeasonVariantBlock section={s} detail fields={entry.fields} season={companionSeason} lookup={lookup} />
                    ) : (
                      <ClassFeatureItem section={s} fields={entry.fields} choiceKey={entry.id + "::" + s.title} chosen={effSectionChosen(s.title)} innerChosen={choices[entry.id + "::" + s.title + "::inner"]} onChoose={onChoose} lookup={lookup} />
                    )}
                    {featureOnly && !grp && !isExtra && (() => { const oi = originalFeatureInfo(s.body ?? "", s.title, classes); return oi ? (
                      <details className="hy-orig-fold">
                        <summary>原版职业特性</summary>
                        <div className="hy-orig-fold-body">
                          <ClassFeatureItem section={oi.section} fields={oi.entry.fields} choiceKey={entry.id + "::orig::" + oi.section.title} chosen={choices[entry.id + "::orig::" + oi.section.title]} innerChosen={choices[entry.id + "::orig::" + oi.section.title + "::inner"]} onChoose={onChoose} lookup={lookup} />
                        </div>
                      </details>
                    ) : null; })()}
                    {(() => { const st = mageStageOf(s.title); return st && !grp && !isExtra ? (
                      <MageSchoolStage stage={st} options={mageSchoolOpts} s1Key={mage1Key} s2Key={mage2Key} exKey={mageExKey} maKey={mageMaKey} s1={mage1} s2={mage2} exSel={mageExSel} maSel={mageMaSel} fields={entry.fields} lookup={lookup} onChoose={onChoose} />
                    ) : null; })()}
                  </>
                </FeatureFold>
                {exe && exeChosen && cnTitle(s.title).includes("公会攻击") && (
                  <div className="exe-guild-content">
                    {(() => {
                      const opt = exe.options.find((o) => o.key === exeChosen);
                      return (
                        <>
                          {opt?.intro && <div className="exe-guild-intro"><WikiBody body={prose(opt.intro)} fields={entry.fields} lookup={lookup} /></div>}
                          {exeBody && <div className="exe-guild-body"><WikiBody body={prose(exeBody)} fields={entry.fields} lookup={lookup} /></div>}
                        </>
                      );
                    })()}
                  </div>
                )}
              </Fragment>
              );
              });
            })()}
            {summonSection && (
              <FeatureFold section={summonSection} level={featureLevel(summonSection.title)} expanded={featOpen(summonSection)} fields={entry.fields} lookup={lookup}>
                <PrimalSummonBlock section={summonSection} detail fields={entry.fields} aspect={summonAspect} lookup={lookup} />
              </FeatureFold>
            )}
            {multiSet.size > 0 && multiSections.filter((s) => featureReachable(s.title, level)).map((s) => (
              <FeatureFold key={s.title} section={s} level={featureLevel(s.title)} expanded={featOpen(s)} fields={entry.fields} lookup={lookup}>
                <>
                  <MultiReplacementBlock section={s} detail fields={entry.fields} baseKey={entry.id + "::" + s.title}
                    chosen={parseReplacementPairs(s.body ?? "")!.groups.map((_, gi) => choices[entry.id + "::" + s.title + "::g" + gi] as string | undefined)}
                    onChoose={onChoose} lookup={lookup} />
                </>
              </FeatureFold>
            ))}
            {beastSection && beastMasterKey && (
              <FeatureFold section={beastSection} level={featureLevel(beastSection.title)} expanded={featOpen(beastSection)} fields={entry.fields} lookup={lookup}>
                <BeastMasterBlock section={beastSection} detail fields={entry.fields} on={beastOn} chosen={chosenBeast} toggleKey={beastMasterKey} beastKey={beastPartnerKey!} onChoose={onChoose} lookup={lookup} />
              </FeatureFold>
            )}
            {signsSection && signsKey && (
              <FeatureFold section={signsSection} level={featureLevel(signsSection.title)} expanded={featOpen(signsSection)} fields={entry.fields} lookup={lookup}>
                <SignsBlock section={signsSection} detail fields={entry.fields} count={signsCount} chosen={signsChosen} on={signsOn} toggleKey={signsKey} listKey={signsListKey!} onChoose={onChoose} lookup={lookup} />
              </FeatureFold>
            )}
            {toggleSections.filter((s) => featureReachable(s.title, level)).map((s) => (
              <FeatureFold key={s.title} section={s} level={featureLevel(s.title)} expanded={featOpen(s)} fields={entry.fields} lookup={lookup}>
                <>
                  <ToggleFeatureBlock section={s} detail fields={entry.fields} on={choices[entry.id + "::" + s.title] === "on"} toggleKey={entry.id + "::" + s.title} onChoose={onChoose} lookup={lookup} />
                </>
              </FeatureFold>
            ))}
            {sidebarRules.map((s) => (
              <details className="beast-sub" key={s.title}>
                <summary>{featTitle(s.title).trim()}</summary>
                {s.body && <div className="beast-sub-body"><div className="pf-body"><WikiBody body={prose(s.body)} fields={entry.fields} lookup={lookup} indent /></div></div>}
              </details>
            ))}
          </div>
        ) : features ? (
          <div className="class-features"><WikiBody body={features} fields={entry.fields} lookup={lookup} /></div>
        ) : !trait ? (
          <div className="class-features"><WikiBody body={entry.sourceText} fields={entry.fields} lookup={lookup} /></div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="class-summary">
      <div className="pf-entry-title">{cleanDisplayName(entry.name)}</div>
      {!featureOnly && entry.fields["role"] && <div className="cls-sum-row"><span className="cls-sum-label">职位</span><span className="cls-sum-value">{entry.fields["role"]}</span></div>}
      {!featureOnly && entry.fields["power source"] && <div className="cls-sum-row"><span className="cls-sum-label">威能来源</span><span className="cls-sum-value">{entry.fields["power source"]}</span></div>}
      {!featureOnly && summary.map((s) => (
        <div key={s.label} className="cls-sum-row"><span className="cls-sum-label">{s.label}</span><span className="cls-sum-value">{s.value}</span></div>
      ))}
      {parsed && parsed.sections.length > 0 ? (
        // 简洁模式：直接展示已选择/已生效的特性与选项（隐藏风味文字），不再用悬停弹出
        <div className="pf-list compact cls-compact">
          {vice && (
            <div className="exe-block compact">
              <div className="exe-guild">
                {vice.options.map((o) => (
                  <SmartHover key={o.key} portal className={"exe-guild-chip" + (viceChosen === o.key ? " selected" : "")} popClass="exe-chip-pop" pop={<VicePreview option={o} fields={entry.fields} lookup={lookup} />} onClick={() => viceKey && onChoose(viceKey, o.key)}>
                    {o.key}败德
                  </SmartHover>
                ))}
              </div>
              {viceOpt && viceOpt.flavor && <div className="exe-guild-flavor"><WikiBody body={prose(viceOpt.flavor)} fields={entry.fields} lookup={lookup} /></div>}
            </div>
          )}
          {pact && (
            <div className="exe-block compact">
              <div className="exe-guild">
                {pact.options.map((o) => (
                  <SmartHover key={o.key} portal className={"exe-guild-chip" + (pactChosen === o.key ? " selected" : "")} popClass="exe-chip-pop" pop={<PactPreview option={o} fields={entry.fields} lookup={lookup} />} onClick={() => pactKey && onChoose(pactKey, o.key)}>
                    {o.key}契约
                  </SmartHover>
                ))}
              </div>
              {pactOpt && pactOpt.flavor && <div className="exe-guild-flavor"><WikiBody body={prose(pactOpt.flavor)} fields={entry.fields} lookup={lookup} /></div>}
            </div>
          )}
          {virt && (
            <div className="exe-block compact">
              <div className="exe-guild">
                {virt.options.map((o) => (
                  <SmartHover key={o.key} portal className={"exe-guild-chip" + (virtChosen === o.key ? " selected" : "")} popClass="exe-chip-pop" pop={<VirtuePreview option={o} fields={entry.fields} lookup={lookup} />} onClick={() => virtKey && onChoose(virtKey, o.key)}>
                    {o.key}美德
                  </SmartHover>
                ))}
              </div>
              {virtOpt && virtOpt.flavor && <div className="exe-guild-flavor"><WikiBody body={prose(virtOpt.flavor)} fields={entry.fields} lookup={lookup} /></div>}
            </div>
          )}
          {wpr && (
            <div className="exe-block compact">
              <div className="exe-guild">
                {wpr.options.map((o) => (
                  <SmartHover key={o.key} portal className={"exe-guild-chip" + (wprChosen === o.key ? " selected" : "")} popClass="exe-chip-pop" pop={<DomainPreview option={o} fields={entry.fields} lookup={lookup} />} onClick={() => wprKey && onChoose(wprKey, o.key)}>
                    {o.name}
                  </SmartHover>
                ))}
              </div>
              {wprOpt && <div className="exe-guild-flavor">已选择「{wprOpt.name}」</div>}
            </div>
          )}
          {exe && (
            <div className="exe-block compact">
              <div className="exe-guild">
                {exe.options.map((o) => (
                  <button key={o.key} type="button" className={"exe-guild-chip" + (exeChosen === o.key ? " selected" : "")} onClick={() => exeKey && onChoose(exeKey, o.key)}>
                    {cleanDisplayName(o.key)}
                  </button>
                ))}
              </div>
              {exe.table && <div className="exe-table" dangerouslySetInnerHTML={{ __html: exe.table }} />}
            </div>
          )}
          {(() => {
            // 简洁模式隐藏层级表，不在此处插入
            return rowSections.filter((s) => featOpen(s)).map((s, i) => {
            const pl = cnTitle(s.title).includes("用毒") ? parsePoi(s.body ?? "") : undefined;
            const grp = groups.get(s.title);
            const extraGroup = groupOfExtra(s.title);
            const isExtra = extraGroup !== undefined;
            const opt = parseClassFeatureOptions(s.body);
            const choiceKey = entry.id + "::" + s.title;
            const chosen = effSectionChosen(s.title);
            const chosenVals = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
            if (isExtra) {
              return <Fragment key={i}><ExtraStanceBlock section={s} detail={false} choiceKey={choiceKey} options={extraGroup.options} chosen={chosen} taken={takenFor(s)} onChoose={onChoose} lookup={lookup} /></Fragment>;
            }
            if (grp) {
              return <Fragment key={i}>
                <ReplacementGroupItem group={grp} detail={false} fields={entry.fields}
                  outerKey={entry.id + "::" + grp.base.title}
                  outerChosen={choices[entry.id + "::" + grp.base.title]}
                  innerKey={entry.id + "::" + grp.base.title + "::inner"}
                  innerChosen={choices[entry.id + "::" + grp.base.title + "::inner"]}
                  onChoose={onChoose} lookup={lookup} />
              </Fragment>;
            }
            if (pl) {
              // 用毒/进阶用毒：折叠 + 多选毒药配方
              return <Fragment key={i}><PoisonUseBlock section={s} detail={false} fields={entry.fields} choiceKey={choiceKey} chosen={chosen} level={level} onChoose={onChoose} lookup={lookup} /></Fragment>;
            }
            if (!opt.selectable) {
              if (cnTitle(s.title).includes("动物伙伴") && !cnTitle(s.title).includes("威能")) {
                // 哨兵「动物伙伴」：简洁模式走专属渲染（风味隐藏、收益+所选伙伴、规则折叠）
                return <Fragment key={i}><AnimalCompanionBlock section={s} detail={false} fields={entry.fields} season={companionSeason} lookup={lookup} /></Fragment>;
              }
              const seasonSubC = seasonSubOf(s.body ?? "", companionSeason);
              if (seasonSubC) {
                // 哨兵季节变体特性（13级自然循环典范 / 17级动物伙伴威能）：简洁模式仅显示所选季节的收益
                return <Fragment key={i}><SeasonVariantBlock section={s} detail={false} fields={entry.fields} season={companionSeason} lookup={lookup} /></Fragment>;
              }
              // 普通特性：直接展示机械效果正文（风味段已随章节切分被排除）。
              // 若该特性以「获得下列N个威能」列出子威能小节（如专业射手），简洁模式直接剔除这些子威能块，
              // 因为威能已展示在威能面板，避免与正文重复堆叠。
              const gp = extractGrantPowers(s.body, s.powerRefs?.length ? s.powerRefs : s.powerRef ? [s.powerRef] : [], lookup);
              return (
                <Fragment key={i}>
                  
                  <div className="cls-feat">
                    <div className="cls-feat-name">{cleanDisplayName(featTitle(s.title))}</div>
                    {gp.main && <FeatureBody body={gp.main} fields={entry.fields} lookup={lookup} className="cls-feat-note" hideFlavor />}
                    {(() => { const st = mageStageOf(s.title); return st ? (
                      <MageSchoolStage stage={st} options={mageSchoolOpts} s1Key={mage1Key} s2Key={mage2Key} exKey={mageExKey} maKey={mageMaKey} s1={mage1} s2={mage2} exSel={mageExSel} maSel={mageMaSel} fields={entry.fields} lookup={lookup} onChoose={onChoose} />
                    ) : null; })()}
                  </div>
                </Fragment>
              );
            }
            const count = opt.count ?? 1;
            const multiple = count > 1;
            const selected = opt.options.filter((o) => chosenVals.includes(o.label));
            return (
              <Fragment key={i}>
                
                <div className={"cls-feat" + (selected.length ? " set" : " unset")}>
                  <div className="cls-feat-name">{cleanDisplayName(featTitle(s.title))}</div>
                  {selected.length === 0 ? (
                    <div className="cls-feat-sub">{multiple ? `未选 0/${count}` : "未选择"}</div>
                  ) : (
                    multiple && <div className="cls-feat-count">已选 {chosenVals.length}/{count}</div>
                  )}
                  {selected.map((o, j) =>
                    o.desc ? (
                      <div key={j} className="cls-feat-compact-optname">
                        <OptionOrSubChoice label={o.label} desc={splitSidebarSubs(o.desc).main ?? ""} innerKey={choiceKey + "::inner"} innerChosen={choices[choiceKey + "::inner"]} onChoose={onChoose} fields={entry.fields} lookup={lookup} compact />
                      </div>
                    ) : (
                      <SmartHover key={j} className="cls-feat-opt" popClass="cls-option-pop" pop={lookup(o.label) ? <EntryCard entry={lookup(o.label)!} /> : undefined}>
                        {cleanDisplayName(o.label)}
                      </SmartHover>
                    )
                  )}
                  <OptSubFold options={opt.options} fields={entry.fields} lookup={lookup} />
                </div>
              </Fragment>
            );
            });
          })()}
          {summonSection && featOpen(summonSection) && (
            <PrimalSummonBlock section={summonSection} detail={false} fields={entry.fields} aspect={summonAspect} lookup={lookup} />
          )}
          {beastSection && beastMasterKey && featOpen(beastSection) && (
            <BeastMasterBlock section={beastSection} detail={false} fields={entry.fields} on={beastOn} chosen={chosenBeast} toggleKey={beastMasterKey} beastKey={beastPartnerKey!} onChoose={onChoose} lookup={lookup} />
          )}
          {signsSection && signsKey && featOpen(signsSection) && (
            <SignsBlock section={signsSection} detail={false} fields={entry.fields} count={signsCount} chosen={signsChosen} on={signsOn} toggleKey={signsKey} listKey={signsListKey!} onChoose={onChoose} lookup={lookup} />
          )}
          {toggleSections.filter((s) => featureReachable(s.title, level) && featOpen(s)).map((s) => (
            <Fragment key={s.title}>
              <ToggleFeatureBlock section={s} detail={false} fields={entry.fields} on={choices[entry.id + "::" + s.title] === "on"} toggleKey={entry.id + "::" + s.title} onChoose={onChoose} lookup={lookup} />
            </Fragment>
          ))}
          {multiSet.size > 0 && multiSections.filter((s) => featureReachable(s.title, level) && featOpen(s)).map((s) => (
            <Fragment key={s.title}>
              <MultiReplacementBlock section={s} detail={false} fields={entry.fields} baseKey={entry.id + "::" + s.title}
                chosen={parseReplacementPairs(s.body ?? "")!.groups.map((_, gi) => choices[entry.id + "::" + s.title + "::g" + gi] as string | undefined)}
                onChoose={onChoose} lookup={lookup} />
            </Fragment>
          ))}
        </div>
      ) : summary.length === 0 ? (
        <div className="class-features"><WikiBody body={entry.sourceText} fields={entry.fields} lookup={lookup} /></div>
      ) : null}
    </div>
  );
}

// 典范/天命特性段列表：详细=特性块+完整威能卡；简洁=特性标题+威能compact行（威能仅供查看，不做管理）
function FeatureSectionList({ sections, detail, fields, powerOf, panelIds, onAddPowers }: { sections: FeatureSection[]; detail: boolean; fields: Record<string, string>; powerOf: (id: string) => Entry | undefined; panelIds: Set<string>; onAddPowers: (powers: Entry[]) => void }) {
  // 自动加入：选定典范/天命后其授予威能自动进面板（无需手动按钮）；待 powerMap 加载完成后亦会触发补入
  const missing = sections.filter((s) => s.powerRef).map((s) => powerOf(s.powerRef!)).filter((p): p is Entry => !!p && !panelIds.has(p.id));
  const missingKey = missing.map((p) => p.id).sort().join("|");
  const prevMissing = useRef(missingKey);
  useEffect(() => {
    if (prevMissing.current === missingKey) return;
    prevMissing.current = missingKey;
    if (missing.length) onAddPowers(missing);
  });
  if (sections.length === 0) return null;
  return (
    <div className={"pf-list" + (detail ? "" : " compact")}>
      {sections.map((s, i) => {
        const p = s.powerRef ? powerOf(s.powerRef) : undefined;
        if (detail) {
          if (p) return (
            <div key={i} className="pf-power">
              <div className="pf-title">{s.title}</div>
              <EntryCard entry={p} />
            </div>
          );
          return (
            <div key={i} className="pf-item">
              <div className="pf-title">{s.title}</div>
              {s.body && <div className="pf-body" dangerouslySetInnerHTML={{ __html: wikiToHtml(s.body, fields) }} />}
            </div>
          );
        }
        if (p) {
          return (
            <SmartHover key={i} className="compact-row" popClass="compact-pop" title={p.name} pop={<EntryCard entry={p} />}>
              <span className="cr-dot" style={{ background: p.usage === "at-will" ? POWER_COLORS.atWill : p.usage === "encounter" ? POWER_COLORS.encounter : p.usage === "daily" ? POWER_COLORS.daily : POWER_COLORS.utility }} />
              <span className="cr-name">{p.name}{p.nameEn ? " " + p.nameEn : ""}</span>
              <span className="cr-sub">L{p.level}{p.usageZh ? " · " + p.usageZh : ""}</span>
            </SmartHover>
          );
        }
        return <div key={i} className="pf-title-only">{s.title}</div>;
      })}
    </div>
  );
}

// 主题威能的逐项行（额外特性 5/10级 威能与可选威能共用）：按小节最低等级门限控制「加入/移除」。
// 无法解析的引用降级显示为「未收录」，不进入威能面板。
function ThemePowerRows(props: {
  powers: { title: string; ref: string; power: Entry | undefined }[];
  mode: string;
  level: number;
  panelIds: Set<string>;
  onToggle: (power: Entry) => void;
}) {
  return (
    <>
      {props.powers.map((o, i) => {
        if (!o.power) return (
          <div key={i} className="theme-power-line unresolved" title={`「${o.ref}」不在威能库中，无法加入威能面板。`}>{o.title}：{o.ref}（未收录）</div>
        );
        const pw: Entry = o.power;
        const inPanel = props.panelIds.has(pw.id);
        const unlocked = props.level >= tierLevel(o.title);
        return (
          <div key={o.ref} className="theme-power-line">
            <SmartHover className="theme-power-name" popClass="compact-pop" title={pw.name} pop={<EntryCard entry={pw} />}>
              <span className="cr-dot" style={{ background: pw.usage === "at-will" ? POWER_COLORS.atWill : pw.usage === "encounter" ? POWER_COLORS.encounter : pw.usage === "daily" ? POWER_COLORS.daily : POWER_COLORS.utility }} />
              <span className="cr-sub">{o.title}：</span>
              <span className="cr-name">{pw.name}{pw.nameEn ? " " + pw.nameEn : ""}</span>
              <span className="cr-sub">L{pw.level}{pw.usageZh ? " · " + pw.usageZh : ""}</span>
            </SmartHover>
            {props.mode === "edit" && (unlocked ? (
              <button type="button" className="sg-step" title={inPanel ? "从威能面板移除" : "加入威能面板"} onClick={() => props.onToggle(pw)}>{inPanel ? "移除" : "加入"}</button>
            ) : (
              <span className="theme-lock-badge" title={`需 ${tierLevel(o.title)} 级`}>需 {tierLevel(o.title)} 级</span>
            ))}
          </div>
        );
      })}
    </>
  );
}

// 主题正文章节渲染：参照职业能力面板的处理方式——
// 位于「起始特性」之前的 lore 章节（扮演/创建及子节）及 intro 折叠展示（fold=true）；
// 从「起始特性」起的机制章节（起始/额外/可选威能及子节）直接平铺展开（fold=false），
// 便于玩家直接阅读功效；具体威能交互仍由下方「起始威能/额外威能/可选威能」列表承担。
function ThemeChapters(props: {
  sections: ThemeSection[];
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
  fold: boolean; // 本层是否用折叠框（机制层 false → 直接展开；lore 层 true → 折叠）
}) {
  if (!props.fold) {
    // 机制章节：平铺展示（标题 + 正文），不套折叠框
    return (
      <>
        {props.sections.map((sec, i) => (
          <div key={i} className="theme-flat">
            {sec.title && (
              <div className="theme-flat-title">
                <span className="theme-flat-level">{sec.title}</span>
              </div>
            )}
            {sec.body.replace(/^\s*$/gm, "").trim().length > 0 && (
              <div className="class-features"><WikiBody body={sec.body} fields={props.fields} lookup={props.lookup} /></div>
            )}
            {sec.subs.length > 0 && <ThemeChapters sections={sec.subs} fields={props.fields} lookup={props.lookup} fold={false} />}
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {props.sections.map((sec, i) => {
        const title = sec.title ?? "主题简介";
        const hasBody = sec.body.replace(/^\s*$/gm, "").trim().length > 0;
        return (
          <details key={i} className={`theme-fold${sec.title ? "" : " theme-fold-intro"}`} open={false}>
            <summary>
              <span className="theme-fold-title">{title}</span>
              <span className="material-symbols-outlined theme-fold-ic">expand_more</span>
            </summary>
            <div className="theme-fold-body">
              {hasBody && (
                <div className="class-features">
                  <WikiBody body={sec.body} fields={props.fields} lookup={props.lookup} />
                </div>
              )}
              {sec.subs.length > 0 && <ThemeChapters sections={sec.subs} fields={props.fields} lookup={props.lookup} fold />}
            </div>
          </details>
        );
      })}
    </>
  );
}

function ModInputs(props: {
  sources: { key: string; label: string }[];
  mods: Record<string, number>;
  onChange: (k: string, v: string) => void;
  neg?: Set<string>;
}) {
  return (
    <div className="def-bonus">
      {props.sources.map((s) => {
        const isNeg = !!props.neg?.has(s.key);
        return (
          <label key={s.key} className="def-bonus-item">
            <span>{s.label}</span>
            {isNeg ? (
              <span className="def-bonus-neg">
                <span className="def-bonus-minus">−</span>
                <input type="number" min={0} max={50} value={props.mods[s.key] ?? 0} onChange={(e) => props.onChange(s.key, e.target.value.replace(/[^0-9]/g, ""))} />
              </span>
            ) : (
              <input type="number" min={-20} max={50} value={props.mods[s.key] ?? 0} onChange={(e) => props.onChange(s.key, e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}

function DefenseCell(props: {
  label: string;
  value: number;
  mods: Record<DefenseBonusSource, number>;
  mode: "edit" | "render";
  onChange: (src: DefenseBonusSource, v: string) => void;
}) {
  const total = DEFENSE_BONUS_SOURCES.reduce((s, k) => s + (props.mods[k] ?? 0), 0);
  return (
    <div className="defense-item">
      <span>{props.label}</span>
      <span className="defense-value">{props.value}</span>
      {props.mode === "edit" ? (
        <div className="def-bonus">
          {DEFENSE_BONUS_SOURCES.map((s) => (
            <label key={s} className="def-bonus-item">
              <span>{DEF_BONUS_LABELS[s]}</span>
              <input type="number" min={-20} max={50} value={props.mods[s] ?? 0} onChange={(e) => props.onChange(s, e.target.value)} />
            </label>
          ))}
        </div>
      ) : (
        total !== 0 && <div className="def-bonus-total">{total > 0 ? "+" + total : String(total)}</div>
      )}
    </div>
  );
}

function fmtMod(n: number): string {
  return n >= 0 ? "+" + n : String(n);
}

// 亚种增益正文中，英文风味段在前的，重排为「中文增益在前、英文在后」，并去掉两者间的空行。
// keepEnglish=false（简洁模式）时仅保留中文增益段，隐藏英文风味及其上的空白行。
function reorderBenefitBody(body: string, keepEnglish = true): string {
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 0) return "";
  const isChinese = (p: string) => {
    const cjk = (p.match(/[\u4e00-\u9fff]/g) || []).length;
    const lat = (p.match(/[A-Za-z]/g) || []).length;
    return cjk > 0 && cjk >= lat;
  };
  const cn = paras.filter(isChinese);
  if (!keepEnglish) return cn.join("\n");
  const en = paras.filter((p) => !isChinese(p));
  if (cn.length === 0 || en.length === 0) return body;
  return [...cn, ...en].join("\n");
}

// 特性名只取中文部分（去掉后面的英文）
function chineseName(s: string): string {
  const i = s.search(/[A-Za-z]/);
  return i < 0 ? s.trim() : s.slice(0, i).trim();
}

// 从亚种增益的「增益：」行提取擅长信息，合成一行可被擅长解析器识别的内容
// （武器「XX武器擅长：」/ 盾牌「盾牌擅长：」/ 法器「法器：」，值只保留武器/法器名）。
// 返回 null 表示该增益不涉及擅长，此时仅移除被替代的基础特性行。
function subraceProfLine(b: { title: string; body: string }): string | null {
  const gain = b.body.match(/增益[：:]\s*([^\n]+)/)?.[1];
  if (!gain) return null;
  // 法器擅长：你获得法珠、法杖和魔杖的法器擅长
  if (gain.includes("法器")) {
    const m = gain.match(/你获得(.+?)的法器擅长/);
    if (!m) return null;
    return `''法器：''${m[1].trim()}`;
  }
  // 武器/盾牌擅长：你获得X的擅长
  const m = gain.match(/你获得(.+?)的擅长/);
  if (!m) return null;
  const names = m[1].trim();
  if (b.title.includes("盾牌")) return `''盾牌擅长：''${names}`;
  const title = b.title.includes("武器擅长") ? b.title : `${b.title}武器擅长`;
  return `''${title}：''${names}`;
}

// 种族威能授予所需上下文：基础内部替代(raceSwaps) + 亚种增益(subraceBenefits)
interface RacePowerCtx {
  swaps?: Record<string, boolean>;
  subBenefits?: Record<string, boolean>;
  subByBase: Map<string, { title: string; body: string }>; // 被替代的基础特性名 → 亚种增益
}

// 计算种族应授予威能：基础种族内部的可替代特性（如「龙惧」替代「龙息」）互斥，
// 且亚种增益（如「腐蚀传统」替代「龙息」并授予威能）优先于基础/替代，按对应选择取舍。
function raceGrantedPowerEntries(
  ct: string,
  ctx: RacePowerCtx,
  lookup: (t: string) => Entry | undefined
): Entry[] {
  const traits = parseRaceTraitLines(ct);
  const altForBase = new Map<string, (typeof traits)[number]>();
  for (const t of traits) if (t.replaces && t.replaces !== t.name) altForBase.set(t.replaces, t);
  const out: Entry[] = [];
  const seen = new Set<string>();
  const addPowers = (body: string) => {
    for (const n of wikiLinkTargets(body)) {
      const e = lookup(n);
      if (e && e.category === "power" && !seen.has(e.id)) { seen.add(e.id); out.push(e); }
    }
  };
  for (const t of traits) {
    if (t.replaces) continue; // 可替代特性不独立授予，由其基础特性按选择授予
    const sub = ctx.subByBase.get(t.name);
    if (sub && ctx.subBenefits?.[sub.title]) { addPowers(sub.body); continue; } // 亚种增益已应用
    const alt = altForBase.get(t.name);
    if (alt && ctx.swaps?.[alt.name]) addPowers(alt.body);
    else addPowers(t.body);
  }
  return out;
}

// 抵御详情弹窗：逐项展示 AC/强韧/反射/意志的完整计算过程
function DefenseDetailDialog(props: {
  stats: DerivedStats;
  acMods: Record<DefenseBonusSource, number>;
  fortMods: Record<DefenseBonusSource, number>;
  refMods: Record<DefenseBonusSource, number>;
  willMods: Record<DefenseBonusSource, number>;
  classDefSources: Record<DefenseKey, { value: number; source: string }[]>;
  cls?: ClassStats;
  raceDefs?: RaceDefenseBonus;
  acKey?: AbilityKey;
  heavyArmor?: boolean;
  className?: string;
  raceName?: string;
  onClose: () => void;
}) {
  const { stats, acMods, fortMods, refMods, willMods, classDefSources, cls, raceDefs, acKey, heavyArmor, className, raceName, onClose } = props;
  const abilityLabel = (k: AbilityKey) => ABILITY_LABELS[k].zh;
  // 每一项防御的明细行：[标签, 数值文本]；数值为 0 的加值行不展示
  type Row = { label: string; value: string; auto?: boolean };
  const baseRows = (def: DefenseKey, mods: Record<DefenseBonusSource, number>, abilityText: string, abilityVal: number, classBonus: number, raceBonus: number): Row[] => {
    const rows: Row[] = [];
    rows.push({ label: "基础", value: "10", auto: true });
    if (stats.halfLevel !== 0) rows.push({ label: "½等级", value: "+" + stats.halfLevel, auto: true });
    if (abilityVal !== 0) rows.push({ label: def === "ac" ? "属性调整" : "属性调整（取高）", value: abilityText, auto: true });
    if (def !== "ac") {
      if (classBonus !== 0) rows.push({ label: className ?? "职业", value: fmtMod(classBonus), auto: true });
      if (raceBonus !== 0) rows.push({ label: raceName ?? "种族", value: fmtMod(raceBonus), auto: true });
    }
    for (const k of DEFENSE_BONUS_SOURCES) {
      const v = mods[k] ?? 0;
      if (v !== 0) rows.push({ label: DEF_BONUS_LABELS[k], value: fmtMod(v) });
    }
    // 职业特性自动加值：逐项标注来源
    for (const s of classDefSources[def] ?? []) {
      if (s.value !== 0) rows.push({ label: s.source, value: fmtMod(s.value), auto: true });
    }
    return rows;
  };
  // AC 属性调整文本：实际生效的 acKey（如力量/体质/感知）或默认 敏捷/智力 取高；重甲不加属性调整
  const acAbilityText = (() => {
    if (heavyArmor) return "重甲（无属性调整）";
    if (acKey) return abilityLabel(acKey) + " " + fmtMod(stats.mods[acKey]) + "（取代 敏捷/智力）";
    return "敏捷/智力 取高 " + fmtMod(Math.max(stats.mods.dex, stats.mods.int));
  })();
  const acAbilityVal = heavyArmor ? 0 : (acKey ? Math.max(stats.mods[acKey], stats.mods.dex, stats.mods.int) : Math.max(stats.mods.dex, stats.mods.int));
  const acRows = baseRows("ac", acMods, acAbilityText, acAbilityVal, 0, 0);
  const fortAbility = (() => {
    const v = Math.max(stats.mods.str, stats.mods.con);
    const win = stats.mods.str >= stats.mods.con ? "力量" : "体质";
    return win + " " + fmtMod(v);
  })();
  const fortAbilityVal = Math.max(stats.mods.str, stats.mods.con);
  const refAbility = (() => {
    const v = Math.max(stats.mods.dex, stats.mods.int);
    const win = stats.mods.dex >= stats.mods.int ? "敏捷" : "智力";
    return win + " " + fmtMod(v);
  })();
  const refAbilityVal = Math.max(stats.mods.dex, stats.mods.int);
  const willAbility = (() => {
    const v = Math.max(stats.mods.wis, stats.mods.cha);
    const win = stats.mods.wis >= stats.mods.cha ? "感知" : "魅力";
    return win + " " + fmtMod(v);
  })();
  const willAbilityVal = Math.max(stats.mods.wis, stats.mods.cha);
  const fortRows = baseRows("fort", fortMods, fortAbility, fortAbilityVal, cls?.fort ?? 0, raceDefs?.fort ?? 0);
  const refRows = baseRows("ref", refMods, refAbility, refAbilityVal, cls?.ref ?? 0, raceDefs?.ref ?? 0);
  const willRows = baseRows("will", willMods, willAbility, willAbilityVal, cls?.will ?? 0, raceDefs?.will ?? 0);
  const blocks: { label: string; value: number; rows: Row[] }[] = [
    { label: "AC", value: stats.ac, rows: acRows },
    { label: "强韧", value: stats.fort, rows: fortRows },
    { label: "反射", value: stats.ref, rows: refRows },
    { label: "意志", value: stats.will, rows: willRows },
  ];
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog def-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">防御计算详情</span>
          <div className="picker-head-btns">
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="def-detail-grid">
          {blocks.map((b) => (
            <div key={b.label} className="def-detail-block">
              <div className="def-detail-title">{b.label} <span className="def-detail-total">{b.value}</span></div>
              <div className="def-detail-rows">
                {b.rows.map((r, i) => (
                  <div key={i} className={"def-detail-row" + (r.auto ? " auto" : "")}>
                    <span className="ddr-label">{r.label}</span>
                    <span className="ddr-value">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

// 属性详情弹窗：逐项展示每项属性的构成（基础值 + 种族加成）与调整值，风格仿照「抵御」详情弹窗
function AbilityDetailDialog(props: {
  abilities: Record<AbilityKey, number>;
  bonus: Partial<Record<AbilityKey, number>>;
  effective: Record<AbilityKey, number>;
  mods: Record<AbilityKey, number>;
  raceName?: string;
  onClose: () => void;
}) {
  const { abilities, bonus, effective, mods, raceName, onClose } = props;
  type Row = { label: string; value: string; auto?: boolean };
  const blocks: { key: AbilityKey; score: number; mod: string; rows: Row[] }[] = ABILITIES.map((k) => {
    const rows: Row[] = [{ label: "基础", value: String(abilities[k]), auto: true }];
    const b = bonus[k];
    if (b) rows.push({ label: `种族加成（${raceName ?? "种族"}）`, value: "+" + b });
    rows.push({ label: "调整值", value: fmtMod(mods[k]), auto: true });
    return { key: k, score: effective[k], mod: fmtMod(mods[k]), rows };
  });
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog def-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">属性计算详情</span>
          <div className="picker-head-btns">
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="def-detail-grid">
          {blocks.map((b) => (
            <div key={b.key} className="def-detail-block">
              <div className="def-detail-title">
                {ABILITY_LABELS[b.key].zh}
                <span className="def-detail-total">{b.score}</span>
                <span className="attr-detail-mod">{b.mod}</span>
              </div>
              <div className="def-detail-rows">
                {b.rows.map((r, i) => (
                  <div key={i} className={"def-detail-row" + (r.auto ? " auto" : "")}>
                    <span className="ddr-label">{r.label}</span>
                    <span className="ddr-value">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

// 生命详情弹窗：逐项展示生命值、重伤值、回复值、回复力的构成，风格仿照「抵御」详情弹窗
function LifeDetailDialog(props: {
  className?: string;
  maxHpTotal: number;
  bloodiedTotal: number;
  surgeValueTotal: number;
  surgesTotal: number;
  baseHp: number;
  conScore: number;
  hpPerLevel: number;
  level: number;
  conMod: number;
  baseSurges: number;
  hpBonus: number;
  surgeBonus: number;
  surgeValueBonus: number;
  onClose: () => void;
}) {
  const { className, maxHpTotal, bloodiedTotal, surgeValueTotal, surgesTotal, baseHp, conScore, hpPerLevel, level, conMod, baseSurges, hpBonus, surgeBonus, surgeValueBonus, onClose } = props;
  type Row = { label: string; value: string; auto?: boolean };
  const perLevel = hpPerLevel * Math.max(0, level - 1);
  const hpRows: Row[] = [{ label: "职业起始生命" + (className ? "（" + className + "）" : ""), value: "+" + baseHp, auto: true }];
  hpRows.push({ label: "体质值", value: "+" + conScore, auto: true });
  if (perLevel !== 0) hpRows.push({ label: `每级生命×（等级−1） ${hpPerLevel}×${level - 1}`, value: "+" + perLevel, auto: true });
  if (hpBonus !== 0) hpRows.push({ label: "额外生命值", value: "+" + hpBonus });
  const bloodiedRows: Row[] = [{ label: "生命值一半", value: String(bloodiedTotal), auto: true }];
  const surgeValueRows: Row[] = [{ label: "生命值四分之一", value: String(Math.floor(maxHpTotal / 4)), auto: true }];
  if (surgeValueBonus !== 0) surgeValueRows.push({ label: "额外回复值", value: "+" + surgeValueBonus });
  const surgeRows: Row[] = [{ label: "职业基础回复力" + (className ? "（" + className + "）" : ""), value: String(baseSurges), auto: true }];
  if (conMod !== 0) surgeRows.push({ label: "体质调整", value: fmtMod(conMod), auto: true });
  if (surgeBonus !== 0) surgeRows.push({ label: "额外回复力", value: "+" + surgeBonus });
  const blocks: { label: string; value: number; rows: Row[] }[] = [
    { label: "生命值", value: maxHpTotal, rows: hpRows },
    { label: "重伤值", value: bloodiedTotal, rows: bloodiedRows },
    { label: "回复值", value: surgeValueTotal, rows: surgeValueRows },
    { label: "回复力", value: surgesTotal, rows: surgeRows },
  ];
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog def-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">生命计算详情</span>
          <div className="picker-head-btns">
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="def-detail-grid">
          {blocks.map((b) => (
            <div key={b.label} className="def-detail-block">
              <div className="def-detail-title">{b.label} <span className="def-detail-total">{b.value}</span></div>
              <div className="def-detail-rows">
                {b.rows.map((r, i) => (
                  <div key={i} className={"def-detail-row" + (r.auto ? " auto" : "")}>
                    <span className="ddr-label">{r.label}</span>
                    <span className="ddr-value">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

// 移动力详情弹窗：逐项展示基础速度与各类加成的构成
function SpeedDetailDialog(props: {
  display: string;
  baseSpeed: string;
  speedMods: SpeedMods;
  primalSpeed: number;
  armorSpeed: number;
  onClose: () => void;
}) {
  const { display, baseSpeed, speedMods, primalSpeed, armorSpeed, onClose } = props;
  type Row = { label: string; value: string; auto?: boolean };
  const sm = speedMods;
  const rows: Row[] = [{ label: "种族基础速度", value: baseSpeed + " 格", auto: true }];
  if (sm.power !== 0) rows.push({ label: "威能", value: "+" + sm.power });
  if (sm.feat !== 0) rows.push({ label: "专长", value: "+" + sm.feat });
  if (armorSpeed < 0) rows.push({ label: "防具减值（重甲）", value: String(armorSpeed), auto: true });
  if (sm.item !== 0) rows.push({ label: "物品", value: "+" + sm.item });
  if (sm.other !== 0) rows.push({ label: "其他", value: "+" + sm.other });
  if (primalSpeed !== 0) rows.push({ label: "原力掠食者", value: "+" + primalSpeed });
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog def-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">移动力计算详情</span>
          <div className="picker-head-btns">
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="def-detail-grid">
          <div className="def-detail-block">
            <div className="def-detail-title">速度 <span className="def-detail-total">{display}</span></div>
            <div className="def-detail-rows">
              {rows.map((r, i) => (
                <div key={i} className={"def-detail-row" + (r.auto ? " auto" : "")}>
                  <span className="ddr-label">{r.label}</span>
                  <span className="ddr-value">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// 先攻详情弹窗：逐项展示先攻加值的构成
function InitiativeDetailDialog(props: {
  dexMod: number;
  halfLevel: number;
  other: number;
  total: number;
  onClose: () => void;
}) {
  const { dexMod, halfLevel, other, total, onClose } = props;
  type Row = { label: string; value: string; auto?: boolean };
  const rows: Row[] = [{ label: "敏捷调整", value: fmtMod(dexMod), auto: true }];
  if (halfLevel !== 0) rows.push({ label: "½等级", value: "+" + halfLevel, auto: true });
  if (other !== 0) rows.push({ label: "其他", value: "+" + other });
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog def-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">先攻计算详情</span>
          <div className="picker-head-btns">
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="def-detail-grid">
          <div className="def-detail-block">
            <div className="def-detail-title">先攻 <span className="def-detail-total">{total}</span></div>
            <div className="def-detail-rows">
              {rows.map((r, i) => (
                <div key={i} className={"def-detail-row" + (r.auto ? " auto" : "")}>
                  <span className="ddr-label">{r.label}</span>
                  <span className="ddr-value">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const VISION_OPTIONS = ["普通视觉", "昏暗视觉", "黑暗视觉"];
const FIVE_ALIGNMENTS = ["守序善良", "善良", "无阵营", "邪恶", "混乱邪恶"];
const NINE_ALIGNMENTS = [
  "守序善良", "守序中立", "守序邪恶",
  "中立善良", "绝对中立", "中立邪恶",
  "混乱善良", "混乱中立", "混乱邪恶",
];

// 技能详情弹窗：逐项展示每项技能的构成（属性调整 + ½等级 + 受训/技能多才 + 种族 + 护甲减值 + 其他），风格仿照「防御」详情弹窗
function SkillDetailDialog(props: {
  blocks: { label: string; trained: boolean; value: number; rows: { label: string; value: string }[] }[];
  onClose: () => void;
}) {
  const { blocks, onClose } = props;
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog def-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">技能计算详情</span>
          <div className="picker-head-btns">
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="def-detail-grid">
          {blocks.map((b) => (
            <div key={b.label} className="def-detail-block">
              <div className="def-detail-title">
                {b.label}{b.trained ? <span className="skill-detail-trained">受训</span> : ""} <span className="def-detail-total">{b.value}</span>
              </div>
              <div className="def-detail-rows">
                {b.rows.map((r, i) => (
                  <div key={i} className="def-detail-row auto">
                    <span className="ddr-label">{r.label}</span>
                    <span className="ddr-value">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function AlignmentField(props: { value?: string; mode: "edit" | "render"; onClick: () => void }) {
  if (props.mode === "render") {
    return (
      <button type="button" className="render-field render-click" onClick={props.onClick} title="阵营（点击选择）">
        <span className="render-name">阵营</span>
        {props.value ? <span className="render-value">{props.value}</span> : <span className="render-empty">−</span>}
      </button>
    );
  }
  return (
    <div className="alignment-field" onClick={props.onClick} title="点击选择阵营">
      <FilledTextField label="阵营" value={props.value ?? ""} readOnly onClick={props.onClick}>
        <span slot="trailing-icon" className="material-symbols-outlined">arrow_drop_down</span>
      </FilledTextField>
    </div>
  );
}

function VisionField(props: { value?: string; mode: "edit" | "render"; onChange: (v: string) => void }) {
  if (props.mode === "render") {
    return (
      <div className="render-field">
        <span className="render-name">视觉</span>
        {props.value ? <span className="render-value">{props.value}</span> : <span className="render-empty">−</span>}
      </div>
    );
  }
  const cur = props.value ?? "";
  return (
    <FilledSelect label="视觉" value={cur} onChange={(e) => props.onChange((e.target as any).value ?? "")}>
      <SelectOption value="">未设置</SelectOption>
      {cur && !VISION_OPTIONS.includes(cur) && <SelectOption value={cur}>{cur}</SelectOption>}
      {VISION_OPTIONS.map((o) => <SelectOption key={o} value={o}>{o}</SelectOption>)}
    </FilledSelect>
  );
}

function TextField(props: { label: string; value: string; onChange: (v: string) => void; wide?: boolean; type?: string; mode?: "edit" | "render"; big?: boolean }) {
  if (props.mode === "render") {
    const cls = "render-field" + (props.wide ? " render-wide" : "") + (props.big ? " render-big" : "");
    return (
      <div className={cls}>
        <span className="render-name">{props.label}</span>
        {props.value ? <span className="render-value">{props.value}</span> : <span className="render-empty">−</span>}
      </div>
    );
  }
  const cls2 = (props.wide ? "field-wide" : "") + (props.big ? " field-big" : "");
  return (
    <div className={cls2}>
      <FilledTextField label={props.label} value={props.value} type={props.type as any} onInput={(e) => props.onChange((e.target as any).value)} />
    </div>
  );
}

function PickField(props: { label: string; displayName?: string; disabled?: boolean; mode: "edit" | "render"; onClick: () => void }) {
  if (props.mode === "render") {
    return (
      <button type="button" className="render-field render-click" onClick={props.onClick} disabled={props.disabled} title={props.label}>
        <span className="render-name">{props.label}</span>
        {props.displayName ? <span className="render-value">{props.displayName}</span> : <span className="render-empty">−</span>}
      </button>
    );
  }
  return (
    <button type="button" className="pick-field" onClick={props.onClick} disabled={props.disabled} title={props.label}>
      <span className="pf-label">{props.label}</span>
      <span className={props.displayName ? "pf-value" : "pf-placeholder"}>{props.displayName ?? "请选择"}</span>
      <span className="material-symbols-outlined pf-icon">expand_more</span>
    </button>
  );
}

// 混职职业能力：合并两个混职职业的 trait（职位/威能来源/关键属性/防具/武器/法器/防御加值/HP/职业技能等）。
// 详细模式用普通职业 trait 同样的斜体段落样式渲染；简洁模式切换为与普通职业一致的紧凑行样式（.cls-sum-row）。
function HybridAbilityBlock({ entry, entry2, detail }: { entry: Entry; entry2: Entry; detail: boolean }) {
  const t = mergedClassTraitText([entry, entry2]);
  if (!t) return null;
  if (detail) {
    return (
      <div className="class-trait hybrid-merged" dangerouslySetInnerHTML={{ __html: wikiToHtml(splitTraitLabels(t), entry.fields).replace(/\n{2,}/g, "\n").replace(/\n/g, "<br/>") }} />
    );
  }
  const allow = new Set(["职位", "威能来源", "防具擅长", "武器擅长"]);
  const rows = t.split("\n").map((line) => {
    const m = line.match(/^''(.+?)：''(.+)$/);
    return m ? { label: m[1], value: m[2] } : null;
  }).filter((r): r is { label: string; value: string } => !!r && allow.has(r.label));
  return (
    <div className="hybrid-merged compact">
      {rows.map((r, i) => (
        <div key={i} className="cls-sum-row"><span className="cls-sum-label">{r.label}</span><span className="cls-sum-value">{r.value}</span></div>
      ))}
    </div>
  );
}

export default function CharacterSheet({
  layout = "single",
  mode,
  char,
  setChar,
}: {
  layout: "single" | "double";
  mode: "edit" | "render";
  char: Character;
  setChar: React.Dispatch<React.SetStateAction<Character>>;
}) {
  const [races, setRaces] = useState<Entry[]>([]);
  // 种族选择弹窗展示顺序：按出处系列分组排序（不影响数据存储与逻辑查找）
  const sortedRaces = useMemo(() => sortRaces(races), [races]);
  const [classes, setClasses] = useState<Entry[]>([]);
  const [paragonPaths, setParagonPaths] = useState<Entry[]>([]);
  const [epicDestinies, setEpicDestinies] = useState<Entry[]>([]);
  const [feats, setFeats] = useState<Entry[]>([]);
  const [items, setItems] = useState<Entry[]>([]);
  const [powers, setPowers] = useState<Entry[]>([]);
  const [rituals, setRituals] = useState<Entry[]>([]);
  const [creatures, setCreatures] = useState<Entry[]>([]);
  const [vices, setVices] = useState<Entry[]>([]);
  const [pacts, setPacts] = useState<Entry[]>([]);
  const [magicSchools, setMagicSchools] = useState<Entry[]>([]);
  const [domains, setDomains] = useState<Entry[]>([]);
  const [virtues, setVirtues] = useState<Entry[]>([]);
  const [themes, setThemes] = useState<Entry[]>([]);
  const [relations, setRelations] = useState<{ powerByGrantedBy: Record<string, string[]> }>({ powerByGrantedBy: {} });
  const [picker, setPicker] = useState<null | "class" | "race" | "paragon" | "epic" | "theme">(null);
  const [slotPicker, setSlotPicker] = useState<null | { kind: "power"; cat: keyof PowerSlots; index: number } | { kind: "feat"; index: number }>(null);
  const [featChoicePicker, setFeatChoicePicker] = useState<null | { index: number; featName: string; label: string; options: FeatOption[]; weaponPool?: BaseWeapon[]; categories?: string[]; implementPool?: BaseImplement[]; implTier?: "basic" | "superior"; hybridGroups?: HybridTalentGroup[] }>(null);
  // 替换型专长（如「威能替换你的N级辅助威能」）：选择后弹面板询问将新威能填入哪个格子。
  // targetCat：被替换威能所在的槽位类别，弹窗只显示该类别相关栏位（无关栏位不出现）。
  const [replacementPicker, setReplacementPicker] = useState<null | { index: number; newPowerId: string; hint: string; targetCat?: keyof PowerSlots }>(null);
  const [equipPicker, setEquipPicker] = useState<null | { kind: "fixed" | "other" | "consumable" | "wondrous"; index: number }>(null);
  const [blockDetail, setBlockDetail] = useState<{ powers: boolean; feats: boolean; equipment: boolean; rituals: boolean }>({ powers: true, feats: true, equipment: true, rituals: true });

  const [abilityMode, setAbilityMode] = useState<"free" | "buy">("free");
  const [boostUsed, setBoostUsed] = useState(0);
  const [buyPresetOpen, setBuyPresetOpen] = useState(false);
  const [classFeatDetail, setClassFeatDetail] = useState(true);
  const [hybridDetailOpen, setHybridDetailOpen] = useState(false);
  const [alignmentOpen, setAlignmentOpen] = useState(false);
  const [profOpen, setProfOpen] = useState(false);
  const [earnInput, setEarnInput] = useState("");
  const [spendInput, setSpendInput] = useState("");
  const [autoCostOpen, setAutoCostOpen] = useState(false);
  const [ritualPickerSlot, setRitualPickerSlot] = useState<number | null>(null);
  const [ritualKind, setRitualKind] = useState<"ritual" | "practice">("ritual"); // 仪式面板切换：仪式魔法 / 武术奥义
  const [defDetailOpen, setDefDetailOpen] = useState(false);
  const [abilityDetailOpen, setAbilityDetailOpen] = useState(false);
  const [lifeDetailOpen, setLifeDetailOpen] = useState(false);
  const [speedDetailOpen, setSpeedDetailOpen] = useState(false);
  const [initDetailOpen, setInitDetailOpen] = useState(false);
  const [skillDetailOpen, setSkillDetailOpen] = useState(false);
  const [slotMode, setSlotMode] = useState<null | "mark" | "swap">(null);
  const [swapPicker, setSwapPicker] = useState<null | { kind: "power"; cat: keyof PowerSlots; index: number } | { kind: "equip"; ekind: "fixed" | "other" | "consumable" | "wondrous"; index: number }>(null);
  const [basePicker, setBasePicker] = useState<null | { kind: "weapon" | "armor" | "shield"; index: number }>(null);
  const [skillDetail, setSkillDetail] = useState(true);
  const [raceDetail, setRaceDetail] = useState(false);
  const [subraceOpen, setSubraceOpen] = useState(false);
  const [pathDetail, setPathDetail] = useState(true);
  const [destinyDetail, setDestinyDetail] = useState(true);
  const [presetOrder, setPresetOrder] = useState<AbilityKey[]>([...ABILITIES]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  useEffect(() => {
    // 数据全量读取（loaders 缓存保证只请求一次）；渲染层用增量加载避免卡顿
    void loadCategory("race").then(setRaces).catch(console.error);
    void loadCategory("class").then(setClasses).catch(console.error);
    void loadCategory("paragon-path").then(setParagonPaths).catch(console.error);
    void loadCategory("epic-destiny").then(setEpicDestinies).catch(console.error);
    void loadCategory("feat").then(setFeats).catch(console.error);
    void loadCategory("equipment").then(setItems).catch(console.error);
    void loadCategory("power").then(setPowers).catch(console.error);
    void loadCategory("ritual").then(setRituals).catch(console.error);
    void loadCategory("creature").then(setCreatures).catch(console.error);
    void loadCategory("vice").then(setVices).catch(console.error);
    void loadCategory("pact").then(setPacts).catch(console.error);
    void loadCategory("magic-school").then(setMagicSchools).catch(console.error);
    void loadCategory("domain").then(setDomains).catch(console.error);
    void loadCategory("virtue").then(setVirtues).catch(console.error);
    void loadCategory("theme").then(setThemes).catch(console.error);
    void loadRelations().then(setRelations).catch(console.error);
  }, []);

  function openPowerPicker(cat: keyof PowerSlots, index: number) {
    setSlotPicker({ kind: "power", cat, index });
  }
  function openFeatPicker(index: number) {
    setSlotPicker({ kind: "feat", index });
  }
  function openEquipPicker(kind: "fixed" | "other" | "consumable" | "wondrous", index: number) {
    setEquipPicker({ kind, index });
  }
  // —— 使用标记（斜线遮罩）与储备交换 ——
  const powerUsedKey = (cat: keyof PowerSlots, index: number) => cat + "-" + index;
  const equipUsedKey = (kind: "fixed" | "other" | "consumable" | "wondrous", index: number) => (kind === "fixed" ? "e" : kind === "other" ? "o" : kind === "consumable" ? "c" : "w") + "-" + index;
  const isPowerUsed = (cat: keyof PowerSlots, index: number) => !!char.powerUsed?.[powerUsedKey(cat, index)];
  const isEquipUsed = (kind: "fixed" | "other" | "consumable" | "wondrous", index: number) => !!char.equipmentUsed?.[equipUsedKey(kind, index)];
  function togglePowerUsed(cat: keyof PowerSlots, index: number) {
    const key = powerUsedKey(cat, index);
    setChar((p) => {
      const used = { ...(p.powerUsed ?? {}) };
      if (used[key]) delete used[key]; else used[key] = true;
      return { ...p, powerUsed: used };
    });
  }
  function toggleEquipUsed(kind: "fixed" | "other" | "consumable" | "wondrous", index: number) {
    const key = equipUsedKey(kind, index);
    setChar((p) => {
      const used = { ...(p.equipmentUsed ?? {}) };
      if (used[key]) delete used[key]; else used[key] = true;
      return { ...p, equipmentUsed: used };
    });
  }
  // 交换弹窗：点击储备项 → 与槽位内容对调（空槽则仅移入并清空储备位）；不自动新建槽位，避免反复点击产生混乱
  function swapReserveItem(pick: NonNullable<typeof swapPicker>, reserveIndex: number) {
    setChar((p) => {
      const reserve = pick.kind === "power" ? p.spellbook : p.backpack;
      const old = reserve[reserveIndex];
      if (!old) return p;
      let slotOld: string | undefined;
      let powerSlots = p.powerSlots;
      let equipmentSlots = p.equipmentSlots;
      let otherSlots = p.otherSlots;
      let consumableSlots = p.consumableSlots;
      let wondrousSlots = p.wondrousSlots;
      if (pick.kind === "power") {
        slotOld = p.powerSlots[pick.cat][pick.index];
        powerSlots = setPowerSlot(powerSlots, pick.cat, pick.index, old);
      } else {
        const arr = pick.ekind === "fixed" ? p.equipmentSlots : pick.ekind === "other" ? p.otherSlots : pick.ekind === "consumable" ? p.consumableSlots : p.wondrousSlots;
        slotOld = arr[pick.index];
        const nextArr = setEquipmentSlot(arr, pick.index, old);
        if (pick.ekind === "fixed") equipmentSlots = nextArr;
        else if (pick.ekind === "other") otherSlots = nextArr;
        else if (pick.ekind === "consumable") consumableSlots = nextArr;
        else wondrousSlots = nextArr;
      }
      const nextReserve = reserve.map((s, i) => (i === reserveIndex ? (slotOld ?? "") : s));
      const ppRec = pick.kind === "power" && pick.cat === "atWill" ? hybridPowerPoints({ classId: p.classId, classId2: p.classId2, powerSlots }, resolveClassId, resolvePowerId) : undefined;
      return { ...p, spellbook: pick.kind === "power" ? nextReserve : p.spellbook, backpack: pick.kind === "equip" ? nextReserve : p.backpack, powerSlots, equipmentSlots, otherSlots, consumableSlots, wondrousSlots, ...(ppRec !== undefined ? { powerPoints: ppRec } : {}) };
    });
    setSwapPicker(null);
  }
  // 仅收入储备：槽位内容存入储备（无空槽自动新建），槽位清空
  function collectToReserve(pick: NonNullable<typeof swapPicker>) {
    setChar((p) => {
      let slotOld: string | undefined;
      let powerSlots = p.powerSlots;
      let equipmentSlots = p.equipmentSlots;
      let otherSlots = p.otherSlots;
      let consumableSlots = p.consumableSlots;
      let wondrousSlots = p.wondrousSlots;
      if (pick.kind === "power") {
        slotOld = p.powerSlots[pick.cat][pick.index];
        powerSlots = clearPowerSlot(powerSlots, pick.cat, pick.index);
      } else {
        const arr = pick.ekind === "fixed" ? p.equipmentSlots : pick.ekind === "other" ? p.otherSlots : pick.ekind === "consumable" ? p.consumableSlots : p.wondrousSlots;
        slotOld = arr[pick.index];
        const nextArr = clearEquipmentSlot(arr, pick.index);
        if (pick.ekind === "fixed") equipmentSlots = nextArr;
        else if (pick.ekind === "other") otherSlots = nextArr;
        else if (pick.ekind === "consumable") consumableSlots = nextArr;
        else wondrousSlots = nextArr;
      }
      if (!slotOld) return p;
      const reserve = pick.kind === "power" ? p.spellbook : p.backpack;
      const emptyIdx = reserve.findIndex((s) => !s);
      const nextReserve = emptyIdx >= 0 ? reserve.map((s, i) => (i === emptyIdx ? slotOld : s)) : [...reserve, slotOld];
      return { ...p, spellbook: pick.kind === "power" ? nextReserve : p.spellbook, backpack: pick.kind === "equip" ? nextReserve : p.backpack, powerSlots, equipmentSlots, otherSlots, consumableSlots, wondrousSlots };
    });
    setSwapPicker(null);
  }
  // 槽位点击总入口：优先响应标记/交换模式；遮罩槽位锁定（不可更换/交换）
  function onPowerSlotClick(cat: keyof PowerSlots, index: number) {
    const id = char.powerSlots[cat][index] ?? "";
    if (slotMode === "mark") { if (id) togglePowerUsed(cat, index); return; }
    if (slotMode === "swap") {
      if (char.powerUsed?.[powerUsedKey(cat, index)]) return;
      setSwapPicker({ kind: "power", cat, index });
      return;
    }
    if (char.powerUsed?.[powerUsedKey(cat, index)]) return;
    openPowerPicker(cat, index);
  }
  function onEquipSlotClick(kind: "fixed" | "other" | "consumable" | "wondrous", index: number) {
    const arr = kind === "fixed" ? char.equipmentSlots : kind === "other" ? char.otherSlots : kind === "consumable" ? char.consumableSlots : char.wondrousSlots;
    const id = arr[index];
    if (slotMode === "mark") { if (id) toggleEquipUsed(kind, index); return; }
    if (slotMode === "swap") {
      if (char.equipmentUsed?.[equipUsedKey(kind, index)]) return;
      setSwapPicker({ kind: "equip", ekind: kind, index });
      return;
    }
    if (char.equipmentUsed?.[equipUsedKey(kind, index)]) return;
    openEquipPicker(kind, index);
  }

  const raceEntry = useMemo(() => races.find((r) => r.id === char.raceId), [races, char.raceId]);
  const classEntry = useMemo(() => classes.find((c) => c.id === char.classId), [classes, char.classId]);
  const paragonPathEntry = useMemo(() => paragonPaths.find((p) => p.id === char.paragonPathId), [paragonPaths, char.paragonPathId]);
  const epicDestinyEntry = useMemo(() => epicDestinies.find((d) => d.id === char.epicDestinyId), [epicDestinies, char.epicDestinyId]);
  const pathParse = useMemo(() => (paragonPathEntry ? parseFeatureSections(paragonPathEntry.sourceText) : { hasTitle: false, sections: [] as FeatureSection[] }), [paragonPathEntry]);
  const destinyParse = useMemo(() => (epicDestinyEntry ? parseFeatureSections(epicDestinyEntry.sourceText) : { hasTitle: false, sections: [] as FeatureSection[] }), [epicDestinyEntry]);
  const classDisplay = useMemo(() => {
    const n1 = classEntry ? cleanDisplayName(classEntry.name) : undefined;
    if (!char.hybrid) return n1;
    const c2 = classes.find((c) => c.id === char.classId2);
    const n2 = c2 ? cleanDisplayName(c2.name) : undefined;
    if (n1 && n2) return "混职：" + n1 + " / " + n2;
    if (n1) return "混职：" + n1 + "（请选第二个）";
    return undefined;
  }, [char.hybrid, char.classId2, classEntry, classes]);
  const classEntry2 = useMemo(() => (char.hybrid ? classes.find((c) => c.id === char.classId2) : undefined), [classes, char.hybrid, char.classId2]);
  // 天赋元素法师「16级：元素典范」：其增益按「灵魔仆从」所选魔宠（土/风/炎/水/其他）而定，
  // 只保留与所选魔宠匹配的那一项，并随魔宠选择实时切换（无魔宠则保留提示）。
  const shaChosen = useMemo(() => {
    const keys = ([classEntry, classEntry2].filter(Boolean) as Entry[]).map((c) => c.id + "::灵魔仆从 Gen Servant");
    for (const k of keys) {
      const v = (char.classFeatureChoices ?? {})[k];
      if (typeof v === "string" && v) return v;
    }
    return "";
  }, [classEntry, classEntry2, char.classFeatureChoices]);
  const pathSections = useMemo(() => {
    if (!paragonPathEntry) return pathParse.sections;
    const chosenKeyword = cnTitle(shaChosen); // 土魔/风魔/炎魔/水魔/其他（魔宠）
    return pathParse.sections.map((s) => {
      if (!cnTitle(s.title).includes("元素典范")) return s;
      const opt = parseClassFeatureOptions(s.body ?? "");
      let pick = opt.options.find((o) => o.label === chosenKeyword);
      if (!pick) pick = opt.options.find((o) => o.label === "其他魔宠");
      if (!shaChosen) return { ...s, body: (s.body ?? "") + '<p class="hint">未选择魔宠：请先在「灵魔仆从」中选择你采用的魔宠。</p>' };
      if (!pick) return s;
      return { ...s, body: (opt.intro ?? "") + "\n<p>" + pick.label + "：" + pick.desc + "</p>" };
    });
  }, [paragonPathEntry, pathParse, shaChosen]);
  // 典范/天命选择限制：当前角色种族/职业名集合 + 全量名称（含纯中文名，匹配前置里的中文名）
  const restrictNames = useMemo(() => {
    const addName = (s: Set<string>, n: string) => {
      if (!n) return;
      s.add(n);
      s.add(cleanDisplayName(n));
      s.add(zhName(n));
      s.add(baseClassName(n));
    };
    const my = new Set<string>();
    if (raceEntry) addName(my, raceEntry.name);
    if (classEntry) addName(my, classEntry.name);
    if (classEntry2) addName(my, classEntry2.name);
    return {
      myNames: [...my],
      raceNames: races.flatMap((r) => [cleanDisplayName(r.name), zhName(r.name)]),
      classNames: classes.flatMap((c) => [cleanDisplayName(c.name), zhName(c.name)]),
    };
  }, [raceEntry, classEntry, classEntry2, races, classes]);
  // 混职：两个混职职业条目的数值相加（血量/回复力向下取整，防御加值累加）
  const cls = useMemo(() => {
    if (!classEntry) return undefined;
    const a = parseClassStats(classEntry.sourceText);
    if (!classEntry2) return a;
    const b = parseClassStats(classEntry2.sourceText);
    return {
      baseHp: Math.floor(a.baseHp + b.baseHp),
      hpPerLevel: Math.floor(a.hpPerLevel + b.hpPerLevel),
      surges: Math.floor(a.surges + b.surges),
      fort: a.fort + b.fort,
      ref: a.ref + b.ref,
      will: a.will + b.will,
    };
  }, [classEntry, classEntry2]);
  const raceInfo = useMemo(() => parseRaceAbilities(raceEntry), [raceEntry]);
  const bonus = useMemo(() => racialBonus(raceEntry, char.raceAbility2Choice), [raceEntry, char.raceAbility2Choice]);
  const effectiveAbilities = useMemo(() => applyAbilityBonus(char.abilities, bonus), [char.abilities, bonus]);
  const raceDefs = useMemo(() => parseRaceDefenses(raceEntry?.sourceText ?? ""), [raceEntry]);
  const featMap = useMemo(() => new Map(feats.map((f) => [f.id, f])), [feats]);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // —— 混职天赋 Hybrid Talent：已选选项授予的擅长 ——
  // 混职天赋已选选项授予的擅长 token（防具/盾牌/武器），合并进防具/盾牌/武器擅长判定
  const hybridProf = useMemo(
    () => hybridTalentProf(char, { classEntry, classEntry2, classes, featMap }),
    [char, classEntry, classEntry2, classes, featMap]
  );
  // 符文牧师「符文艺术」：愤怒之锤→军用锤/军用硬头锤擅长；平静之刃→军用重刃擅长（AC 改用感知在 defense 内判定）
  const { wrathful: runeWrathful, serene: runeSerene } = runicArtistry(char, [classEntry, classEntry2]);
  // 防御推导（装备自动加值 + 职业特性自动加值 + AC 属性替换 + 原力掠食者速度）：
  // 与速览页共用 defense.ts 的同一份实现，保证两页防御数字始终一致
  const defense = useMemo(
    () => deriveDefenses(char, { classEntry, classEntry2, classes, featMap, itemMap }),
    [char, classEntry, classEntry2, classes, featMap, itemMap]
  );
  const { acMods, fortMods, refMods, willMods, classDefSources, statDefenseMods, primalPredatorSpeed } = defense;
  // 实际生效的 AC 属性键（供防御详情展示「AC 属性调整」用的是哪个属性）
  const activeAcKey = defense.acKey;
  const stats = deriveStats({
    ...char,
    abilities: effectiveAbilities,
    defenseMods: statDefenseMods,
  }, cls, raceDefs, activeAcKey);
  // —— 生命板块：额外加值合计 + 当前值编辑 ——
  const hpBonus = char.hpBonus ?? 0;
  const surgeBonus = char.surgeBonus ?? 0;
  const surgeValueBonus = char.surgeValueBonus ?? 0;
  const maxHpTotal = stats.maxHp + hpBonus;
  const bloodiedTotal = Math.floor(maxHpTotal / 2);
  const surgeValueTotal = Math.floor(maxHpTotal / 4) + surgeValueBonus;
  const surgesTotal = stats.surges + surgeBonus;
  // 重甲速度减值按所穿护甲自动计入（链/鳞/板及重甲变体为 -1），无需手动填写
  const equippedArmorBase = char.baseItems?.[5] ? findBaseItem(char.baseItems[5]) : undefined;
  const equippedArmorSpeedPen = equippedArmorBase?.kind === "armor" && equippedArmorBase.armor ? equippedArmorBase.armor.speed : 0;
  const speedTotal = char.speedMods.power + char.speedMods.feat + char.speedMods.item + char.speedMods.other + primalPredatorSpeed + equippedArmorSpeedPen;
  const speedNum = parseInt(raceEntry?.speed ?? "", 10);
  const speedDisplay = Number.isNaN(speedNum) ? (raceEntry?.speed ?? "—") : speedNum + speedTotal + " 格";

  const powerMap = useMemo(() => new Map(powers.map((p) => [p.id, p])), [powers]);
  const themeMap = useMemo(() => new Map(themes.map((t) => [t.id, t])), [themes]);
  const ritualMap = useMemo(() => new Map(rituals.map((r) => [r.id, r])), [rituals]);
  const creatureMap = useMemo(() => new Map(creatures.map((c) => [c.id, c])), [creatures]);
  const viceMap = useMemo(() => new Map(vices.map((v) => [v.id, v])), [vices]);
  const pactMap = useMemo(() => new Map(pacts.map((v) => [v.id, v])), [pacts]);
  const magicSchoolMap = useMemo(() => new Map(magicSchools.map((s) => [s.id, s])), [magicSchools]);
  const domainMap = useMemo(() => new Map(domains.map((d) => [d.id, d])), [domains]);
  const virtueMap = useMemo(() => new Map(virtues.map((v) => [v.id, v])), [virtues]);
  // 所选主题条目
  const themeEntry = useMemo(() => (char.themeId ? themeMap.get(char.themeId) : undefined), [themeMap, char.themeId]);
  // 主题威能引用 → 威能条目：先精确匹配 id；查不到则按中文前缀兜底（id 英文名可能与正文引用的不同）
  const resolveThemeRef = useMemo(
    () => (ref: string) => {
      const hit = powerMap.get(ref);
      if (hit) return hit;
      // id 是「中文 英文」双语：英文名仅在库中幂等存在同名条目时兜底匹配，避免中文前缀相同的不同威能被误配
      // （如主题引用的「灵活移动 Stick and Move」不应命中中文同为「灵活移动」的「灵活移动 Shifty Maneuver」）
      const split = ref.trim().split(/\s+/);
      const cn = split[0];
      const en = split.slice(1).join(" ").toLowerCase();
      if (!cn) return undefined;
      if (en) {
        const enHit = powers.find((p) => p.nameEn?.toLowerCase() === en);
        if (enHit) return enHit;
        return undefined;
      }
      return powers.find((p) => p.id.startsWith(cn + " ")) ?? powerMap.get(cn) ?? undefined;
    },
    [powerMap, powers]
  );
  // 起始特性威能（含未收录引用，供展示）与可解析的起始威能
  const themeStartingRefs = useMemo(
    () => (themeEntry ? themeStarting(themeEntry, resolveThemeRef) : []),
    [themeEntry, resolveThemeRef]
  );
  const themeStartEntry = themeStartingRefs.filter((s) => s.power).map((s) => s.power);
  // 额外特性（5级/10级）授予的威能（排除与起始重复的增强引用）
  const themeExtraP = useMemo(
    () => (themeEntry ? themeExtraPowers(themeEntry, resolveThemeRef) : []),
    [themeEntry, resolveThemeRef]
  );
  // 可选威能小节（2/6/10级等备选威能，一节可含多个）
  const themeOptPowers = useMemo(
    () => (themeEntry ? themeOptionalPowers(themeEntry, resolveThemeRef) : []),
    [themeEntry, resolveThemeRef]
  );
  // 职业赠送专长条目/名称（不占用常规专长槽位，但参与擅长/攻击伤害等专长相关计算）
  const grantedFeatEntries = useMemo(
    () => (char.classGrantedFeatIds ?? []).map((id) => featMap.get(id)).filter((x): x is Entry => !!x),
    [char.classGrantedFeatIds, featMap]
  );
  const grantedFeatNameList = useMemo(() => grantedFeatEntries.map((f) => f.name), [grantedFeatEntries]);
  // 职业赠送仪式条目（置顶展示，不占用仪式槽位）
  const grantedRitualEntries = useMemo(
    () => (char.classGrantedRitualIds ?? []).map((id) => ritualMap.get(id)).filter((x): x is Entry => !!x),
    [char.classGrantedRitualIds, ritualMap]
  );
  // 选择型专长的已选对象（键 = 槽位下标 → { cat, item }）
  const featChoicesList = useMemo(
    () =>
      Object.entries(char.featChoices)
        .map(([idx, item]) => {
          const f = featMap.get(char.featSlots[Number(idx)]);
          const info = f ? featChoiceInfo(f) : null;
          return { cat: (info?.cat ?? "weapon") as "weapon" | "implement", item };
        })
        .filter((c) => c.item),
    [char.featChoices, char.featSlots, featMap]
  );
  // 亚种：解析所有含「属于[[原种族]]的亚种」的条目，按键为原种族显示名（如「矮人 Dwarf」）
  const subracesByBase = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const r of races) {
      const info = parseSubraceInfo(r.sourceText);
      if (info) {
        const list = map.get(info.baseRaceName) ?? [];
        list.push(r);
        map.set(info.baseRaceName, list);
      }
    }
    return map;
  }, [races]);
  const raceBaseName = raceEntry ? `${raceEntry.name} ${raceEntry.nameEn ?? ""}`.trim() : "";
  const subraces = raceEntry ? (subracesByBase.get(raceBaseName) ?? []) : [];
  const subraceEntry = useMemo(() => (char.subraceId ? subraces.find((s) => s.id === char.subraceId) : undefined), [char.subraceId, subraces]);
  const subraceInfo = useMemo(() => (subraceEntry ? parseSubraceInfo(subraceEntry.sourceText) : undefined), [subraceEntry]);
  const subraceName = subraceEntry?.name ?? "";
  // 亚种增益应用到种族文本：被替代的基础特性行替换为增益的「擅长」行（用于擅长计算）
  const effectiveRaceText = useMemo(() => {
    if (!raceEntry || !subraceInfo) return raceEntry?.sourceText;
    let text = raceEntry.sourceText;
    for (const b of subraceInfo.benefits) {
      if (char.subraceBenefits?.[b.title] === false || !b.replaces) continue;
      const line = subraceProfLine(b);
      const esc = b.replaces.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // 匹配被替代的基础特性行（''名称：''…至下一特性行/文本末尾）
      const re = new RegExp(`^''${esc}：''[^\\n]*(?:\\n(?!''[^：:]*：'')[^\\n]*)*`, "m");
      text = text.replace(re, line ?? "");
    }
    return text;
  }, [raceEntry, subraceInfo, char.subraceBenefits]);
  // 武器擅长 token 集：职业（含混职）/种族 的「武器擅长」行 + 已选专长白名单 + 选择型专长选定对象
  const archerWarlordOn = !!classEntry && Object.entries(char.classFeatureChoices ?? {}).some(([k, v]) => k.startsWith(classEntry!.id + "::射手督军") && v === "on");
  // 前线领袖（Battlefront Leader）：替代组「战斗领袖」的替代项，选中时获得重盾擅长（以键前缀+选中值前缀判断）
  const frontLineLeaderOn = !!classEntry && Object.entries(char.classFeatureChoices ?? {}).some(([k, v]) => k.startsWith(classEntry!.id + "::战斗领袖") && String(v).startsWith("前线领袖"));
  // 刺客（行刑者）三工会选择 → 忍者之道的额外武器擅长（手里剑/锁镰）
  const exeGuildChosen = classEntry ? (typeof (char.classFeatureChoices ?? {})[classEntry.id + "::刺客公会"] === "string" ? String((char.classFeatureChoices ?? {})[classEntry.id + "::刺客公会"]) : "") : "";
  const exeNinjaWeapons = exeGuildChosen === "忍者之道" ? ["手里剑", "锁镰"] : [];
  const proficiencyTokens = useMemo(
    () => {
      const tokens = collectProficiencyTokens({
        classText: classEntry?.sourceText,
        classText2: classEntry2?.sourceText,
        raceText: effectiveRaceText,
        featNames: [...char.featSlots.map((id) => featMap.get(id)?.name ?? ""), ...grantedFeatNameList],
        featChoiceTokens: featChoicesList.map((c) => c.item.split(/\s/)[0]),
      });
      // 射手督军：获得军用远程武器擅长（失去的链甲/轻盾在防具/盾牌处处理）
      if (archerWarlordOn) tokens.add("军用远程");
      // 符文牧师「符文艺术」：愤怒之锤→军用锤/军用硬头锤；平静之刃→军用重刃
      if (runeWrathful) { tokens.add("军用锤"); tokens.add("军用硬头锤"); }
      if (runeSerene) tokens.add("军用重刃");
      // 混职天赋选项：正文「获得X的擅长」中的武器 token
      for (const w of hybridProf.weapon) tokens.add(w);
      // 刺客（行刑者）忍者之道：手里剑/锁镰擅长
      for (const w of exeNinjaWeapons) tokens.add(w);
      return tokens;
    },
    [classEntry, classEntry2, effectiveRaceText, char.featSlots, featMap, featChoicesList, archerWarlordOn, grantedFeatNameList, runeWrathful, runeSerene, hybridProf, exeNinjaWeapons]
  );
  // 已擅长武器条目（供「选择基础武器」/擅长武器专长弹窗左下角「已擅长武器」展示）
  const proficientWeaponInfos = useMemo<WeapInfo[]>(
    () =>
      BASE_WEAPONS.filter((w) => isProficient(w, proficiencyTokens))
        .map((w) => ({ id: baseItemId("weapon", w.name), name: w.name, main: w.dice, sub: w.traits && w.traits !== "—" ? w.traits : w.group })),
    [proficiencyTokens]
  );
  // 已擅长的法器组：职业（含混职）/种族「法器：」行 + 选择型法器专长选定的法器；用于法器面板「已擅长/未擅长」
  const proficientImplGroups = useMemo(() => {
    const implChoices: { cat: "implement"; item: string }[] = [];
    for (const idxStr of Object.keys(char.featChoices ?? {})) {
      const idx = Number(idxStr);
      const featEntry = featMap.get(char.featSlots[idx]);
      const info = featEntry ? featChoiceInfo(featEntry) : null;
      if (info?.cat === "implement") implChoices.push({ cat: "implement", item: char.featChoices?.[idx] ?? "" });
    }
    return collectImplementGroups({ classText: classEntry?.sourceText, classText2: classEntry2?.sourceText, raceText: effectiveRaceText, featChoices: implChoices });
  }, [char.featSlots, char.featChoices, featMap, classEntry, classEntry2, effectiveRaceText]);
  // 防具/盾牌擅长 token 集：职业（含混职）/种族 + 已选「盔甲擅长/盾牌擅长」专长（含职业赠送专长）；用于专长前置「擅长鳞甲」类判定
  const featNameList = useMemo(() => [...char.featSlots.map((id) => featMap.get(id)?.name ?? ""), ...grantedFeatNameList], [char.featSlots, featMap, grantedFeatNameList]);
  const armorTokens = useMemo(
    () => {
      const tokens = collectArmorTokens(classEntry?.sourceText, classEntry2?.sourceText, effectiveRaceText, featNameList);
      // 射手督军：失去链甲擅长（token 可能以「链甲；轻盾」合并形式存在，按包含匹配删除）
      if (archerWarlordOn) for (const t of [...tokens]) if (t.includes("链甲") || t.includes("轻盾")) tokens.delete(t);
      // 前线领袖：获得重盾擅长
      if (frontLineLeaderOn) tokens.add("重盾");
      // 混职天赋选项：正文「获得X的擅长」中的防具/盾牌 token
      for (const a of hybridProf.armor) tokens.add(a);
      return tokens;
    },
    [classEntry, classEntry2, effectiveRaceText, featNameList, archerWarlordOn, frontLineLeaderOn, hybridProf]
  );
  const shieldTokens = useMemo(
    () => {
      const tokens = collectShieldTokens(classEntry?.sourceText, classEntry2?.sourceText, effectiveRaceText, featNameList);
      // 射手督军：失去轻盾擅长
      if (archerWarlordOn) for (const t of [...tokens]) if (t.includes("轻盾") || t.includes("链甲")) tokens.delete(t);
      // 前线领袖：获得重盾擅长（盾牌归类到盾牌 token）
      if (frontLineLeaderOn) tokens.add("重盾");
      // 混职天赋选项：正文「获得X的擅长」中的盾牌 token
      for (const s of hybridProf.shield) tokens.add(s);
      return tokens;
    },
    [classEntry, classEntry2, effectiveRaceText, featNameList, archerWarlordOn, frontLineLeaderOn, hybridProf]
  );
  // 擅长总览（装备面板「擅长」弹窗）：职业/种族/专长提供的武器、法器、防具擅长
  const profSources = useMemo(
    () => {
      const sources = collectProficiencySources({
        className: classEntry ? cleanDisplayName(classEntry.name) : "职业",
        className2: classEntry2 ? cleanDisplayName(classEntry2.name) : undefined,
        classText: classEntry?.sourceText,
        classText2: classEntry2?.sourceText,
        raceName: raceEntry ? cleanDisplayName(raceEntry.name) : "种族",
        raceText: effectiveRaceText,
        featNames: [...char.featSlots.map((id) => featMap.get(id)?.name ?? ""), ...grantedFeatNameList],
        featChoices: featChoicesList,
      });
      // 射手督军：失去链甲/轻盾擅长，获得军用远程武器擅长 → 调整擅长总览
      if (archerWarlordOn) {
        for (const src of sources) {
          for (const g of src.groups) {
            if (g.cat === "防具") g.items = g.items.filter((it) => !it.includes("链甲") && !it.includes("轻盾"));
          }
        }
        const cls = sources.find((s) => classEntry && s.source === cleanDisplayName(classEntry.name));
        if (cls) {
          const wp = cls.groups.find((g) => g.cat === "武器");
          if (wp) { if (!wp.items.includes("军用远程")) wp.items.push("军用远程"); }
          else cls.groups.push({ cat: "武器", items: ["军用远程"] });
        } else {
          sources.push({ source: classEntry ? cleanDisplayName(classEntry.name) : "职业", groups: [{ cat: "武器", items: ["军用远程"] }] });
        }
      }
      // 前线领袖：获得重盾擅长 → 在职业来源的防具组加入重盾
      if (frontLineLeaderOn) {
        const cls2 = sources.find((s) => classEntry && s.source === cleanDisplayName(classEntry.name))
          ?? (classEntry ? (() => { const n = { source: cleanDisplayName(classEntry.name), groups: [] as ProfGroup[] }; sources.push(n); return n; })() : undefined);
        if (cls2) {
          const ar = cls2.groups.find((g) => g.cat === "防具");
          if (ar) { if (!ar.items.includes("重盾")) ar.items.push("重盾"); }
          else cls2.groups.push({ cat: "防具", items: ["重盾"] });
        }
      }
      // 符文牧师「符文艺术」：愤怒之锤→军用锤/军用硬头锤；平静之刃→军用重刃 → 加入职业来源的武器组
      if (runeWrathful || runeSerene) {
        const addWeapon = sources.find((s) => classEntry && s.source === cleanDisplayName(classEntry.name))
          ?? (classEntry ? (() => { const n = { source: cleanDisplayName(classEntry.name), groups: [] as ProfGroup[] }; sources.push(n); return n; })() : undefined);
        if (addWeapon) {
          let wp = addWeapon.groups.find((g) => g.cat === "武器");
          if (!wp) { wp = { cat: "武器", items: [] }; addWeapon.groups.push(wp); }
          for (const it of [runeWrathful ? ["军用锤", "军用硬头锤"] : [], runeSerene ? ["军用重刃"] : []].flat()) {
            if (!wp.items.includes(it)) wp.items.push(it);
          }
        }
      }
      return sources;
    },
    [classEntry, classEntry2, effectiveRaceText, char.featSlots, featMap, featChoicesList, archerWarlordOn, frontLineLeaderOn, grantedFeatNameList, runeWrathful, runeSerene]
  );
  // 混职天赋选项授予的擅长，作为独立来源追加到「擅长」弹窗（防具/盾牌/武器）
  const hybridProfSources = useMemo(() => {
    if (hybridProf.armor.length + hybridProf.shield.length + hybridProf.weapon.length === 0) return [] as { source: string; groups: ProfGroup[] }[];
    const groups: ProfGroup[] = [];
    if (hybridProf.weapon.length) groups.push({ cat: "武器", items: hybridProf.weapon });
    const defItems = [...hybridProf.armor, ...hybridProf.shield];
    if (defItems.length) groups.push({ cat: "防具", items: defItems });
    return [{ source: "混职天赋", groups }];
  }, [hybridProf]);
  const swapList = swapPicker
    ? (() => {
        const reserve = swapPicker.kind === "power" ? char.spellbook : char.backpack;
        const out: { ri: number; id: string; name: string; sub: string; color: string }[] = [];
        reserve.forEach((id, ri) => {
          if (!id) return;
          if (swapPicker.kind === "power") {
            const e = powerMap.get(id);
            out.push({ ri, id, name: e?.name ?? id, sub: (e?.usage ?? "") + (e?.level ? " · L" + e.level : ""), color: e ? (e.usage === "at-will" ? POWER_COLORS.atWill : e.usage === "encounter" ? POWER_COLORS.encounter : e.usage === "daily" ? POWER_COLORS.daily : POWER_COLORS.utility) : "#8a8a8a" });
          } else {
            const e = itemMap.get(id);
            out.push({ ri, id, name: e?.name ?? id, sub: (e?.itemCategory ?? "") + (e?.itemLevel ? " · L" + e.itemLevel : ""), color: ITEM_COLOR });
          }
        });
        return out;
      })()
    : [];
  const swapCurId = swapPicker
    ? (swapPicker.kind === "power" ? char.powerSlots[swapPicker.cat][swapPicker.index] ?? "" : ((swapPicker.ekind === "fixed" ? char.equipmentSlots : swapPicker.ekind === "other" ? char.otherSlots : swapPicker.ekind === "consumable" ? char.consumableSlots : char.wondrousSlots)[swapPicker.index] ?? ""))
    : "";
  const swapCurName = swapCurId ? ((swapPicker?.kind === "power" ? powerMap.get(swapCurId)?.name : itemMap.get(swapCurId)?.name) ?? swapCurId) : "";
  // 自动花销：基础物品 + 魔法装备（增强档位对应等级价格）+ 冒险装备手动价格
  const autoCosts = useMemo(() => {
    const list: { label: string; cost: number }[] = [];
    for (const idxStr of Object.keys(char.baseItems)) {
      const idx = parseInt(idxStr, 10);
      // 已附魔（该槽位装备了有等级表的魔法物品）：基础武器/护甲价格不再计入（附魔价含基础物）
      const mag = char.equipmentSlots[idx];
      if (mag) {
        const me = itemMap.get(mag);
        if (me && itemLevels(me.itemLevel).length) continue;
      }
      const f = findBaseItem(char.baseItems[idx]);
      if (!f) continue;
      const name = f.weapon?.name ?? f.armor?.name ?? f.shield?.name ?? f.implement?.name ?? "";
      const price = f.weapon?.price ?? f.armor?.price ?? f.shield?.price ?? f.implement?.price ?? 0;
      if (name) list.push({ label: "基础·" + name, cost: price });
    }
    char.equipmentSlots.forEach((id, idx) => {
      if (!id) return;
      const e = itemMap.get(id);
      if (!e) return;
      const levels = itemLevels(e.itemLevel);
      if (!levels.length) return;
      const tier = Math.min(char.equipmentEnhance[idx] ?? 1, levels.length);
      const lv = levels[tier - 1];
      list.push({ label: e.name + " +" + enhancementBonusForLevel(lv), cost: priceForLevel(lv) });
    });
    for (const a of char.adventureItems) {
      if (a.name && a.cost > 0) list.push({ label: a.name, cost: a.cost });
    }
    // 已学会的仪式按市场价格计入自动花销（含职业赠送的置顶仪式）
    const autoRitualIds = new Set<string>([...(char.ritualSlots ?? []).filter((x): x is string => !!x), ...(char.classGrantedRitualIds ?? [])]);
    for (const id of autoRitualIds) {
      if (!id) continue;
      const r = ritualMap.get(id);
      if (!r) continue;
      const cost = ritualMarketPrice(r);
      if (cost > 0) list.push({ label: "仪式·" + r.name, cost });
    }
    return list;
  }, [char, itemMap, ritualMap]);
  const autoTotal = autoCosts.reduce((s, x) => s + x.cost, 0);
  const moneyBalance = char.money.earned - char.money.spent - autoTotal;
  const trainedCount = useMemo(() => {
    if (!classEntry) return 0;
    const a = parseTrainedSkillCount(classEntry.sourceText);
    if (!classEntry2) return a;
    return 3 + a + parseTrainedSkillCount(classEntry2.sourceText);
  }, [classEntry, classEntry2]);
  // 职业内置自动受训技能（如刺客的隐秘）——由职业来源派生，更换职业时随之重建
  const classAutoTrained = useMemo(() => {
    const names: string[] = [];
    if (classEntry) names.push(...parseBuiltinTrainedSkills(classEntry.sourceText));
    if (classEntry2) names.push(...parseBuiltinTrainedSkills(classEntry2.sourceText));
    return [...new Set(names)];
  }, [classEntry, classEntry2]);
  // 职业技能池（供点选受训）：主职与混职去重合并，按技能面板标准顺序（SKILL_TABLE）排序
  const classSkillPool = useMemo(() => {
    const pool = new Map<string, { name: string; ability: AbilityKey }>();
    for (const e of [classEntry, classEntry2]) {
      if (!e) continue;
      for (const s of parseClassSkills(e.sourceText)) if (!pool.has(s.name)) pool.set(s.name, s);
    }
    const order = new Map(SKILL_TABLE.map((s, i) => [s.name, i]));
    return [...pool.values()].sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99));
  }, [classEntry, classEntry2]);
  // 装备的基础护甲（槽位 5）名称：供自动计算护甲减值
  const equippedArmorName = useMemo(() => {
    const b = char.baseItems?.[5] ? findBaseItem(char.baseItems[5]) : undefined;
    return b?.kind === "armor" && b.armor ? b.armor.name : undefined;
  }, [char.baseItems]);
  // 有效受训技能 = 杂项受训 + 职业内置自动受训 + 职业点选受训
  const effectiveTrained = useMemo(
    () => [...new Set([...char.trainedSkills, ...classAutoTrained, ...char.classTrainedSkills])],
    [char.trainedSkills, classAutoTrained, char.classTrainedSkills]
  );
  const trainedSet = useMemo(() => new Set(effectiveTrained), [effectiveTrained]);
  // 技能巧手：未受训技能检定 +1（含主职与混职），更换职业时随职业选项重建自动移除
  const hasSkillVersatility = useMemo(
    () => [classEntry, classEntry2].some((e) => !!e && /^!!\s*技能巧手 Skill Versatility/m.test(e.sourceText)),
    [classEntry, classEntry2]
  );
  const levelInfo = useMemo(() => (char.level >= 1 ? LEVELS[char.level - 1] : undefined), [char.level]);
  const isBoostLevel = levelInfo?.abilityBoost === "两个 +1";
  // 技能详情弹窗的构成数据（与技能面板 total 计算口径一致）
  const skillDetailBlocks = useMemo(
    () => SKILL_TABLE.map((s) => {
      const trained = trainedSet.has(s.name);
      const sm = char.skillMods[s.name] ?? { race: 0, other: 0, armor: 0 };
      const hasArmor = ARMOR_PENALTY_SKILLS.has(s.name);
      const skillVersatility = hasSkillVersatility && !trained ? 1 : 0;
      const armorPen = hasArmor ? Math.abs(armorPenaltyFor(equippedArmorName)) : 0;
      const abilityVal = stats.mods[s.ability];
      const rows: { label: string; value: string }[] = [{ label: "属性调整（" + ABILITY_LABELS[s.ability].zh + "）", value: fmtMod(abilityVal) }];
      if (stats.halfLevel !== 0) rows.push({ label: "½等级", value: "+" + stats.halfLevel });
      if (trained) rows.push({ label: "受训", value: "+5" });
      else if (skillVersatility) rows.push({ label: "技能多才", value: "+1" });
      if (sm.race !== 0) rows.push({ label: "种族", value: fmtMod(sm.race) });
      if (armorPen !== 0) rows.push({ label: "护甲减值", value: fmtMod(-armorPen) });
      if (sm.other !== 0) rows.push({ label: "其他", value: fmtMod(sm.other) });
      const total = abilityVal + stats.halfLevel + (trained ? 5 : 0) + skillVersatility + sm.race + sm.other - armorPen;
      return { label: s.name, trained, value: total, rows };
    }),
    [trainedSet, hasSkillVersatility, equippedArmorName, stats, char.skillMods]
  );
  const raceTrait = useMemo(() => (raceEntry ? raceTraitHtml(raceEntry.sourceText) : undefined), [raceEntry]);
  const raceBody = useMemo(() => (raceEntry ? raceBodyHtml(raceEntry.sourceText) : undefined), [raceEntry]);
  const raceLoreSections = useMemo(() => (raceBody ? splitRaceLore(raceBody) : []), [raceBody]);
  // 亚种 lore 直接「替换」对应的基础 lore 小节（无需切换按钮）：按标题中文段匹配（同类别或共享≥3字前缀），
  // 匹配到的位置用亚种小节顶替，名称用【亚种名】标识；未匹配的基础小节保留，未匹配的亚种小节追加末尾。
  const mergedLore = useMemo(() => {
    if (!subraceInfo || subraceInfo.loreSections.length === 0) return raceLoreSections.map((s) => ({ section: s, sub: false }));
    const catKey = (t?: string) => (t ?? "").trim().split(/\s/)[0] || "";
    const covers = (subKey: string, baseKey: string): boolean => {
      if (!subKey || !baseKey) return false;
      if (subKey === baseKey || subKey.startsWith(baseKey) || baseKey.startsWith(subKey)) return true;
      let n = 0;
      while (n < subKey.length && n < baseKey.length && subKey[n] === baseKey[n]) n++;
      return n >= 3;
    };
    const used = new Set<number>();
    const list = raceLoreSections.map((sec) => {
      const k = catKey(sec.title);
      const m = subraceInfo.loreSections.findIndex((sub, j) => k && !used.has(j) && covers(catKey(sub.title), k));
      if (m < 0) return { section: sec, sub: false };
      used.add(m);
      return { section: subraceInfo.loreSections[m], sub: true };
    });
    subraceInfo.loreSections.forEach((sub, j) => { if (!used.has(j)) list.push({ section: sub, sub: true }); });
    return list;
  }, [raceLoreSections, subraceInfo]);
  // 选择/清除亚种：选中时默认应用全部增益（替代对应基础特性），清除时清空
  const setSubrace = (id?: string) => {
    if (!id) {
      setChar({ ...char, subraceId: undefined, subraceBenefits: {} });
      return;
    }
    const entry = subraces.find((s) => s.id === id);
    const info = entry ? parseSubraceInfo(entry.sourceText) : undefined;
    const applied: Record<string, boolean> = {};
    if (info) for (const b of info.benefits) applied[b.title] = true;
    // 选中亚种时清空基础内部替代（如「龙惧」），避免与亚种增益（如「腐蚀传统」代替「龙息」）在同一条特性上互相冲突
    setChar({ ...char, subraceId: id, subraceBenefits: applied, raceSwaps: {} });
  };
  // 被替代的基础特性名 → 亚种增益（含正文，用于授予增益自带的威能）
  const subraceBenefitByBase = useMemo(() => {
    const map = new Map<string, { title: string; body: string }>();
    if (subraceInfo) for (const b of subraceInfo.benefits) if (b.replaces) map.set(b.replaces, { title: b.title, body: b.body });
    return map;
  }, [subraceInfo]);
  // 基础种族 classTrait 的结构化特性行（raceTraitHtml 已剔除体型/速度/视觉）
  const raceTraits = useMemo(() => {
    if (!raceEntry) return [];
    const body = raceTraitHtml(raceEntry.sourceText);
    return body ? parseRaceTraitLines(body) : [];
  }, [raceEntry]);
  // 简洁模式：仅保留「技能奖励」之后的实用特性（身高/体重/属性调整/语言/技能奖励等已自动填写的条目不再展示）
  const compactRaceTraits = useMemo(() => {
    const i = raceTraits.findIndex((t) => /技能/.test(t.name));
    return i >= 0 ? raceTraits.slice(i + 1) : raceTraits;
  }, [raceTraits]);
  // 基础种族内部的可替代特性：被替代特性名（如「龙息」）→ 替代特性行（如「龙惧」）
  const raceAltForBase = useMemo(() => {
    const map = new Map<string, (typeof raceTraits)[number]>();
    for (const t of raceTraits) if (t.replaces && t.replaces !== t.name) map.set(t.replaces, t);
    return map;
  }, [raceTraits]);
  const slotCounts = levelInfo ? levelInfo.powers : { atWill: 0, encounter: 0, daily: 0, utility: 0 };
  const featSlotCount = levelInfo ? levelInfo.feats : 0;
  const effFeatCount = char.featSlotOverride ?? featSlotCount;
  // 实际渲染的槽位数：以「自定义/等级默认」与数组长度的较大者为准，
  // 避免「恢复」后数组里仍有额外已填充槽位时，计数与渲染不一致。
  const featRenderCount = Math.max(effFeatCount, char.featSlots.length);
  // 仪式槽位数：默认随角色等级（4E 规则无上限，可手动 +/− 覆盖）
  const effRitualCount = char.ritualSlotOverride ?? char.level;
  const ritualRenderCount = Math.max(effRitualCount, (char.ritualSlots ?? []).length);
  // 德鲁伊「自然平衡 Balance of Nature」：随意攻击威能槽位由默认 2 个改为 3 个（换其他职业自动恢复）
  const isDruidBalance = useMemo(
    () => [classEntry, classEntry2].some((e) => !!e && /^!!\s*自然平衡/m.test(e.sourceText)),
    [classEntry, classEntry2]
  );
  const effPowerCount = (cat: keyof PowerSlots): number => {
    if (cat === "special") return char.powerSlots.special.length;
    const o = char.powerSlotOverrides?.[cat];
    if (o !== undefined) return o;
    if (cat === "atWill" && isDruidBalance) return Math.max(3, slotCounts[cat]);
    return slotCounts[cat];
  };

  // 威能面板当前含有的全部威能 id（供职业特性「已加入」判定）
  const panelIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of SLOT_CATS) for (const id of char.powerSlots[c.key]) if (id) set.add(id);
    return set;
  }, [char.powerSlots]);
  // 把特性授予的威能加入威能面板：优先按威能名尾缀（攻击N/辅助N）归类，否则按 grantedPowerCategory
  // 落入对应空位（无空位则顺延追加一格，避免威能丢失）。种族/职业/专长赠送威能均遵守此规则。
  function onAddPowers(powers: Entry[]) {
    setChar((p) => {
      const slots = { ...p.powerSlots };
      const used = new Set<string>();
      for (const c of SLOT_CATS) for (const id of slots[c.key]) if (id) used.add(id);
      for (const pw of powers) {
        if (!pw || used.has(pw.id)) continue;
        const cat = grantedPowerSlot(pw.usage, pw.powerKind, pw.name);
        if (!cat) continue;
        const arr = [...slots[cat]];
        const idx = arr.findIndex((x) => !x);
        if (idx >= 0) arr[idx] = pw.id;
        else arr.push(pw.id);
        slots[cat] = arr;
        used.add(pw.id);
      }
      return { ...p, powerSlots: slots };
    });
  }

  // 记录「职业授予威能」id（不加入面板）：更换职业时据此从威能面板移除
  const trackClassPowers = (powers: Entry[]) => {
    if (!powers || powers.length === 0) return;
    setChar((p) => ({
      ...p,
      classGrantedPowerIds: Array.from(new Set([...p.classGrantedPowerIds, ...powers.map((x) => x.id)])),
    }));
  };
  // 职业特性授予威能：加入面板 + 记录 id（供更换职业移除）
  const onAddClassPowers = (powers: Entry[]) => {
    onAddPowers(powers);
    trackClassPowers(powers);
  };
  // 特性选择变化时，把「不再授予」的职业威能从面板移除并取消记录（如野性力量切换选项、降级不满足门槛）
  const onRemoveClassPowers = (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    setChar((p) => {
      const idSet = new Set(ids);
      const slots = { ...p.powerSlots };
      for (const c of SLOT_CATS) {
        slots[c.key] = slots[c.key].map((id) => (id && idSet.has(id) ? "" : id));
      }
      return { ...p, powerSlots: slots, classGrantedPowerIds: p.classGrantedPowerIds.filter((id) => !idSet.has(id)) };
    });
  };
  // 种族授予的辅助威能：选择加入面板（种族/辅助槽），取消选择时移除
  const toggleRacePower = (power: Entry) => {
    if (!power) return;
    if (panelIds.has(power.id)) {
      onRemoveClassPowers([power.id]);
      setChar((p) => ({ ...p, raceGrantedPowerIds: (p.raceGrantedPowerIds ?? []).filter((id) => id !== power.id) }));
    } else {
      onAddPowers([power]);
      setChar((p) => ({ ...p, raceGrantedPowerIds: Array.from(new Set([...(p.raceGrantedPowerIds ?? []), power.id])) }));
    }
  };
  // 主题（Theme）威能联动：选择/更换主题时移除旧主题已加入面板的威能，并自动加入新主题「起始特性」赠送的
  // 单一威能（若起始特性为多个择一或不可解析，则不自动加，交由用户在面板点选）。
  const applyTheme = (themeId: string) => {
    const entry = themeMap.get(themeId);
    const start = entry ? themeStartingPowers(entry, resolveThemeRef) : [];
    const auto = start.length === 1 ? start : [];
    setChar((p) => {
      const gone = new Set(p.themeGrantedPowerIds ?? []);
      const slots = { ...p.powerSlots };
      for (const c of SLOT_CATS) slots[c.key] = slots[c.key].map((id) => (id && gone.has(id) ? "" : id));
      const used = new Set<string>();
      for (const c of SLOT_CATS) for (const id of slots[c.key]) if (id) used.add(id);
      for (const pw of auto) {
        if (used.has(pw.id)) continue;
        const cat = grantedPowerSlot(pw.usage, pw.powerKind, pw.name);
        if (!cat) continue;
        const arr = [...slots[cat]];
        const idx = arr.findIndex((x) => !x);
        if (idx >= 0) arr[idx] = pw.id;
        else arr.push(pw.id);
        slots[cat] = arr;
        used.add(pw.id);
      }
      return { ...p, powerSlots: slots, themeId, themeGrantedPowerIds: auto.map((x) => x.id) };
    });
  };
  // 清除主题：移除该主题已加入面板的全部威能
  const clearTheme = () => {
    setChar((p) => {
      const gone = new Set(p.themeGrantedPowerIds ?? []);
      const slots = { ...p.powerSlots };
      for (const c of SLOT_CATS) slots[c.key] = slots[c.key].map((id) => (id && gone.has(id) ? "" : id));
      return { ...p, powerSlots: slots, themeId: undefined, themeGrantedPowerIds: [] };
    });
  };
  // 主题可选威能（及多选起始威能）：参照种族辅助威能，点选加入面板、再次点选择移除
  const toggleThemePower = (power: Entry) => {
    if (!power) return;
    if (panelIds.has(power.id)) {
      onRemoveClassPowers([power.id]);
      setChar((p) => ({ ...p, themeGrantedPowerIds: (p.themeGrantedPowerIds ?? []).filter((id) => id !== power.id) }));
    } else {
      onAddPowers([power]);
      setChar((p) => ({ ...p, themeGrantedPowerIds: Array.from(new Set([...(p.themeGrantedPowerIds ?? []), power.id])) }));
    }
  };
  // 选择/更换种族时：自动填充技能种族加值、语言槽，自动加入种族授予威能（特性内 [[...]] 威能，
  // 如半身人「死里逃生」）。辅助威能需用户手动选择。
  // 特性自动授予与手动选择分离：切换基础内部替代/亚种增益时仅重算自动授予部分，手动选择的辅助威能保留；
  // 更换种族时清空全部种族威能（含手动选择），防止遗留。
  const prevRaceIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    setChar((p) => {
      // 无种族且无任何种族威能记录时，无需重算（默认角色的技能/语言已初始化）
      if (!raceEntry && (p.raceAutoGrantedPowerIds ?? []).length === 0 && (p.raceGrantedPowerIds ?? []).length === 0) return p;
      if (prevRaceIdRef.current === undefined) prevRaceIdRef.current = raceEntry?.id;
      const prevRaceId = prevRaceIdRef.current;
      const raceChanged = raceEntry?.id !== prevRaceId;
      prevRaceIdRef.current = raceEntry?.id;
      let newRace: Entry[] = [];
      const newIds = new Set<string>();
      if (raceEntry) {
        const ct = (raceEntry.sourceText.match(/@@\.classTrait\s+"""([\s\S]*?)"""/) || [])[1] ?? "";
        // 综合基础内部替代(龙惧↔龙息)与亚种增益(腐蚀传统↔龙息等)后，计算应授予的威能集合
        newRace = raceGrantedPowerEntries(ct, { swaps: p.raceSwaps, subBenefits: p.subraceBenefits, subByBase: subraceBenefitByBase }, (t) => wikiLookup(t));
        for (const pw of newRace) newIds.add(pw.id);
      }
      // 旧的自动授予集合（切换特性时重算），与手动选择的辅助威能区分开
      const oldAuto = new Set(p.raceAutoGrantedPowerIds ?? []);
      const oldManual = (p.raceGrantedPowerIds ?? []).filter((id) => !oldAuto.has(id));
      // 仅清空需要重算的部分：切换特性只清旧自动；更换种族则自动+手动全部清空
      const clearIds = new Set<string>();
      for (const id of oldAuto) clearIds.add(id);
      if (raceChanged) for (const id of oldManual) clearIds.add(id);
      const slots = { ...p.powerSlots };
      if (clearIds.size > 0) {
        for (const c of SLOT_CATS) slots[c.key] = slots[c.key].map((id) => (id && clearIds.has(id) ? "" : id));
      }
      const used = new Set<string>();
      for (const c of SLOT_CATS) for (const id of slots[c.key]) if (id) used.add(id);
      for (const pw of newRace) {
        if (used.has(pw.id)) continue;
        const cat = grantedPowerCategory(pw.usage, pw.powerKind);
        if (!cat) continue;
        const arr = [...slots[cat]];
        const idx = arr.findIndex((x) => !x);
        if (idx >= 0) arr[idx] = pw.id;
        else arr.push(pw.id);
        slots[cat] = arr;
        used.add(pw.id);
      }
      const { skills, languages } = raceEntry ? parseRaceAutofill(raceEntry.sourceText) : { skills: {}, languages: [""] };
      const sm = { ...p.skillMods };
      for (const s of SKILL_TABLE) {
        const cur = sm[s.name] ?? { race: 0, other: 0, armor: 0 };
        cur.race = skills[s.name] ?? 0;
        sm[s.name] = cur;
      }
      const keepManual = raceChanged ? [] : oldManual;
      return { ...p, powerSlots: slots, skillMods: sm, languages, raceAutoGrantedPowerIds: [...newIds], raceGrantedPowerIds: Array.from(new Set([...keepManual, ...newIds])) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceEntry, powerMap, char.raceSwaps, char.subraceBenefits, subraceBenefitByBase]);

  // 记录「职业赠送专长」id（不占用常规专长槽位）：展示与更换职业时据此清除
  const trackClassFeats = (feats: Entry[]) => {
    if (!feats || feats.length === 0) return;
    setChar((p) => ({
      ...p,
      classGrantedFeatIds: Array.from(new Set([...p.classGrantedFeatIds, ...feats.map((x) => x.id)])),
    }));
  };
  // 特性选择变化时，把「不再赠送」的职业专长从记录移除（如战斗流派切换选项后旧流派赠送的专长）
  const onRemoveClassFeats = (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    setChar((p) => ({ ...p, classGrantedFeatIds: p.classGrantedFeatIds.filter((id) => !ids.includes(id)) }));
  };

  // 记录「职业赠送仪式」id 及来源特性名（置顶展示，不占用仪式槽位）：更换职业时据此清除
  const trackClassRituals = (rituals: { entry: Entry; source: string }[]) => {
    if (!rituals || rituals.length === 0) return;
    setChar((p) => ({
      ...p,
      classGrantedRitualIds: Array.from(new Set([...p.classGrantedRitualIds, ...rituals.map((x) => x.entry.id)])),
      classGrantedRitualSources: { ...p.classGrantedRitualSources, ...Object.fromEntries(rituals.map((x) => [x.entry.id, x.source])) },
    }));
  };
  // 特性选择变化时，把「不再赠送」的职业仪式从记录移除（连同来源特性名）
  const onRemoveClassRituals = (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    setChar((p) => {
      const sources = { ...p.classGrantedRitualSources };
      for (const id of ids) delete sources[id];
      return { ...p, classGrantedRitualIds: p.classGrantedRitualIds.filter((id) => !ids.includes(id)), classGrantedRitualSources: sources };
    });
  };

  // —— 专长赠送威能 / 威能替换 ——
  // 选择专长时把赠送威能加入面板，并记录「专长槽位 → 赠送威能 id」，清空/更换专长时据此移除。
  // 前提与职业特性相关的专长（如「引导神力」类专长）赠送的威能送入「种族/职业威能」；其余按威能后缀/用法归类。
  const addFeatGrantedPowers = (idx: number, feat: Entry, powers: Entry[]) => {
    if (!powers || powers.length === 0) return;
    const toSpecial = featPrereqClassFeature(feat);
    setChar((p) => {
      const slots = { ...p.powerSlots };
      const used = new Set<string>();
      for (const c of SLOT_CATS) for (const id of slots[c.key]) if (id) used.add(id);
      for (const pw of powers) {
        if (!pw || used.has(pw.id)) continue;
        const cat = toSpecial ? "special" : grantedPowerSlot(pw.usage, pw.powerKind, pw.name);
        if (!cat) continue;
        const arr = [...slots[cat]];
        const i = arr.findIndex((x) => !x);
        if (i >= 0) arr[i] = pw.id;
        else arr.push(pw.id);
        slots[cat] = arr;
        used.add(pw.id);
      }
      return { ...p, powerSlots: slots, featGrantedPowerIds: { ...p.featGrantedPowerIds, [idx]: powers.map((x) => x.id) } };
    });
  };
  // 清空/更换专长：把该槽位赠送的威能从面板移除，并清除记录
  const removeFeatGrantedPowers = (idx: number) => {
    setChar((p) => {
      const prevIds = p.featGrantedPowerIds?.[idx] ?? [];
      if (prevIds.length === 0) return p;
      const idSet = new Set(prevIds);
      const slots = { ...p.powerSlots };
      for (const c of SLOT_CATS) {
        slots[c.key] = slots[c.key].map((id) => (id && idSet.has(id) ? "" : id));
      }
      const featGrantedPowerIds = { ...p.featGrantedPowerIds };
      delete featGrantedPowerIds[idx];
      return { ...p, powerSlots: slots, featGrantedPowerIds };
    });
  };
  // 选择型专长选定选项：记录到 featChoices，并为混职天赋选项落地「赠送威能」（清除旧选项的旧威能）
  const handleFeatChoice = (item: string) => {
    const picker = featChoicePicker;
    if (!picker) return;
    const idx = picker.index;
    const isHybrid = picker.hybridGroups && picker.hybridGroups.length > 0;
    // 先移除旧选项赠送的威能（武器/法器专长无赠送，为空操作）
    removeFeatGrantedPowers(idx);
    setChar((p) => ({ ...p, featChoices: { ...p.featChoices, [idx]: item } }));
    if (isHybrid) {
      const f = featMap.get(char.featSlots[idx]);
      const r = resolveHybridOption(picker.hybridGroups!, item);
      if (f && r) {
        const gates = levelGatedWikiLinks(r.body);
        const powers: Entry[] = [];
        for (const t of wikiLinkTargets(r.body)) {
          const g = gates.get(t);
          if (g !== undefined && char.level < g) continue;
          const e = wikiLookup(t);
          if (e && e.category === "power") powers.push(e);
        }
        if (powers.length) addFeatGrantedPowers(idx, f, powers);
      }
    }
    setFeatChoicePicker(null);
  };
  // 替换型专长：用户选定格子后，把新威能填入该槽位并记录
  const fillFeatReplacementSlot = (idx: number, newPowerId: string, cat: keyof PowerSlots, index: number) => {
    setChar((p) => ({
      ...p,
      powerSlots: setPowerSlot(p.powerSlots, cat, index, newPowerId),
      featGrantedPowerIds: { ...p.featGrantedPowerIds, [idx]: [newPowerId] },
    }));
    setReplacementPicker(null);
  };
  // 替换型专长弹窗的格子列表：威能面板全部类别 × 槽位（含空位与等级标签）
  const replSlotGroups = useMemo<ReplSlotGroup[]>(
    () =>
      SLOT_CATS.map((cat) => {
        const arr = char.powerSlots[cat.key] ?? [];
        const isSpecial = cat.key === "special";
        const lvls = isSpecial ? [] : powerSlotLevels(cat.key as "atWill", char.level);
        const fallbackLv = lvls.length ? lvls[lvls.length - 1] : undefined;
        const count = Math.max(isSpecial ? arr.length : effPowerCount(cat.key), arr.length);
        return {
          key: cat.key,
          label: cat.label,
          color: cat.color,
          items: Array.from({ length: count }, (_, i) => ({ id: arr[i] ?? "", level: isSpecial ? undefined : (lvls[i] ?? fallbackLv) })),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [char.powerSlots, char.level, isDruidBalance, slotCounts, char.powerSlotOverrides]
  );

  function addEarn() {
    const n = parseInt(earnInput, 10);
    if (!Number.isNaN(n) && n > 0) setChar((p) => ({ ...p, money: { ...p.money, earned: p.money.earned + n } }));
    setEarnInput("");
  }

  function addSpend() {
    const n = parseInt(spendInput, 10);
    if (!Number.isNaN(n) && n > 0) setChar((p) => ({ ...p, money: { ...p.money, spent: p.money.spent + n } }));
    setSpendInput("");
  }

  function setLevel(v: number) {
    const lv = Math.max(0, Math.min(30, v));
    if (lv >= 1 && LEVELS[lv - 1].abilityBoost === "两个 +1") setBoostUsed(0);
    setChar((p) => ({
      ...p,
      level: lv,
      xp: lv === 0 ? "0" : String(xpForLevel(lv)),
      paragonPathId: lv < 11 ? undefined : p.paragonPathId,
      epicDestinyId: lv < 21 ? undefined : p.epicDestinyId,
      powerPoints: hybridPowerPoints(p, resolveClassId, resolvePowerId) ?? psionicPowerPoints(p.classId, lv) ?? p.powerPoints,
    }));
  }

  function onXpChange(v: string) {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n) && n >= 0) {
      const info = levelFromXp(n);
      setChar((p) => ({ ...p, xp: v, level: info.level }));
    } else {
      setChar((p) => ({ ...p, xp: v }));
    }
  }

  function applyPreset(values: number[]) {
    setChar((prev) => {
      const next = { ...prev.abilities };
      presetOrder.forEach((k, idx) => { next[k] = values[idx]; });
      return { ...prev, abilities: next };
    });
    setBuyPresetOpen(false);
  }

  function onSorterDrop(i: number) {
    if (dragIndex === null || dragIndex === i) {
      setDragIndex(null);
      setDragOver(null);
      return;
    }
    setPresetOrder((o) => {
      const arr = [...o];
      const [moved] = arr.splice(dragIndex, 1);
      arr.splice(i, 0, moved);
      return arr;
    });
    setDragIndex(null);
    setDragOver(null);
  }

  function setDefenseMod(k: DefenseKey, src: DefenseBonusSource, v: string) {
    const n = parseInt(v, 10);
    const val = Number.isNaN(n) ? 0 : Math.max(-20, Math.min(50, n));
    setChar((p) => ({ ...p, defenseMods: { ...p.defenseMods, [k]: { ...p.defenseMods[k], [src]: val } } }));
  }

  function setSpeedMod(k: keyof SpeedMods, v: string) {
    const n = parseInt(v, 10);
    const val = Number.isNaN(n) ? 0 : Math.max(-20, Math.min(50, n));
    setChar((p) => ({ ...p, speedMods: { ...p.speedMods, [k]: val } }));
  }

  function setInitMod(k: keyof InitMods, v: string) {
    const n = parseInt(v, 10);
    const val = Number.isNaN(n) ? 0 : Math.max(-20, Math.min(50, n));
    setChar((p) => ({ ...p, initMods: { ...p.initMods, [k]: val } }));
  }

  function setSkillMod(name: string, key: keyof SkillMods[string], v: string) {
    const n = parseInt(v, 10);
    const val = Number.isNaN(n) ? 0 : Math.max(-20, Math.min(50, n));
    setChar((p) => {
      const cur = p.skillMods[name] ?? { race: 0, other: 0, armor: 0 };
      return { ...p, skillMods: { ...p.skillMods, [name]: { ...cur, [key]: val } } };
    });
  }

  function setAbility(k: AbilityKey, v: number) {
    const clamped = Math.min(30, Math.max(8, v));
    const old = char.abilities[k];
    setChar((prev) => ({ ...prev, abilities: { ...prev.abilities, [k]: clamped } }));
    if (abilityMode === "buy") {
      // 18 以上只能由升级 +1 提供：计为已用的升级提升次数
      if (clamped > old && old >= 18) setBoostUsed((u) => Math.min(2, u + 1));
      if (clamped < old && clamped >= 18) setBoostUsed((u) => Math.max(0, u - 1));
    }
  }

  // 技能条勾选：自由切换受训，不受职业技能数量上限约束；与职业技能列表双向同步
  function toggleTrained(name: string) {
    setChar((p) => {
      // 职业自动受训由职业推导，不可手动切换
      if (classAutoTrained.includes(name)) return p;
      const inTrained = p.trainedSkills.includes(name);
      const inClass = p.classTrainedSkills.includes(name);
      if (inTrained) {
        // 取消杂项受训；若该技能同时为职业点选受训，一并取消，保持两处一致
        return {
          ...p,
          trainedSkills: p.trainedSkills.filter((s) => s !== name),
          classTrainedSkills: inClass ? p.classTrainedSkills.filter((s) => s !== name) : p.classTrainedSkills,
        };
      }
      if (inClass) {
        // 仅由职业点选受训（如从职业技能列表勾选）：取消职业点选
        return { ...p, classTrainedSkills: p.classTrainedSkills.filter((s) => s !== name) };
      }
      // 自由勾选：写入杂项受训，不占用职业受训名额（其他来源也能提供额外受训）
      return { ...p, trainedSkills: [...p.trainedSkills, name] };
    });
  }

  // 职业受训点选：从职业技能池中选择（上限 = 职业额外受训数），更换职业时清除；
  // 若该技能已由技能条（杂项）勾选，则点击列表取消的是杂项受训
  function toggleClassTrained(name: string) {
    setChar((p) => {
      const inClass = p.classTrainedSkills.includes(name);
      const inMisc = p.trainedSkills.includes(name);
      if (inMisc) {
        return { ...p, trainedSkills: p.trainedSkills.filter((s) => s !== name) };
      }
      if (inClass) return { ...p, classTrainedSkills: p.classTrainedSkills.filter((s) => s !== name) };
      if (trainedCount > 0 && p.classTrainedSkills.length >= trainedCount) return p;
      return { ...p, classTrainedSkills: [...p.classTrainedSkills, name] };
    });
  }

  function setAdvItem(i: number, patch: Partial<{ name: string; cost: number }>) {
    setChar((p) => {
      const arr = [...p.adventureItems];
      while (arr.length <= i) arr.push({ name: "", cost: 0 });
      arr[i] = { ...arr[i], ...patch };
      return { ...p, adventureItems: arr };
    });
  }

  function setLang(i: number, v: string) {
    setChar((p) => {
      const arr = [...p.languages];
      arr[i] = v.trim();
      return { ...p, languages: arr };
    });
  }

  // 仪式：按槽位选择/清空；默认槽位数随角色等级，可通过 +/− 覆盖
  function openRitualPicker(index: number) {
    setRitualPickerSlot(index);
  }
  function selectRitualSlot(index: number, id: string) {
    setChar((p) => ({ ...p, ritualSlots: setRitualSlot(p.ritualSlots ?? [], index, id) }));
  }
  function clearRitualSlotAt(index: number) {
    setChar((p) => ({ ...p, ritualSlots: clearRitualSlot(p.ritualSlots ?? [], index) }));
  }
  function growRitualSlots() {
    setChar((p) => {
      const base = p.level;
      const eff = p.ritualSlotOverride ?? base;
      const render = Math.max(eff, (p.ritualSlots ?? []).length);
      const desired = Math.max(0, Math.min(30, render + 1));
      return { ...p, ritualSlots: padEmpty(p.ritualSlots ?? [], desired), ritualSlotOverride: desired === base ? undefined : desired };
    });
  }
  function reduceRitualSlots() {
    setChar((p) => {
      const base = p.level;
      const eff = p.ritualSlotOverride ?? base;
      const render = Math.max(eff, (p.ritualSlots ?? []).length);
      const desired = Math.max(0, render - 1);
      return { ...p, ritualSlots: trimTrailingEmpty(p.ritualSlots ?? [], desired), ritualSlotOverride: desired === base ? undefined : desired };
    });
  }
  function restoreRitualOverride() {
    setChar((p) => ({ ...p, ritualSlotOverride: undefined, ritualSlots: trimTrailingEmpty(p.ritualSlots ?? [], p.level) }));
  }

  // 某类别威能的等级默认槽位数（含德鲁伊「自然平衡」对随意威能特判）
  const powerDefaultCount = (cat: keyof PowerSlots): number => {
    if (cat === "special") return char.powerSlots.special.length;
    if (cat === "atWill" && isDruidBalance) return Math.max(3, slotCounts.atWill);
    return slotCounts[cat];
  };
  function growPowerSlots(cat: keyof PowerSlots) {
    setChar((p) => {
      const base = powerDefaultCount(cat);
      const eff = p.powerSlotOverrides?.[cat] ?? base;
      const render = Math.max(eff, p.powerSlots[cat].length);
      const desired = Math.max(0, Math.min(20, render + 1));
      const overrides = { ...(p.powerSlotOverrides ?? {}) };
      if (desired === base) delete overrides[cat]; else overrides[cat] = desired;
      return {
        ...p,
        powerSlots: { ...p.powerSlots, [cat]: padEmpty(p.powerSlots[cat], desired) },
        powerSlotOverrides: overrides,
      };
    });
  }
  function reducePowerSlots(cat: keyof PowerSlots) {
    setChar((p) => {
      const base = powerDefaultCount(cat);
      const eff = p.powerSlotOverrides?.[cat] ?? base;
      const render = Math.max(eff, p.powerSlots[cat].length);
      const desired = Math.max(0, render - 1);
      const overrides = { ...(p.powerSlotOverrides ?? {}) };
      if (desired === base) delete overrides[cat]; else overrides[cat] = desired;
      return {
        ...p,
        powerSlots: { ...p.powerSlots, [cat]: trimTrailingEmpty(p.powerSlots[cat], desired) },
        powerSlotOverrides: overrides,
      };
    });
  }
  function restorePowerOverride(cat: keyof PowerSlots) {
    setChar((p) => {
      const o = { ...(p.powerSlotOverrides ?? {}) };
      delete o[cat];
      return { ...p, powerSlotOverrides: o, powerSlots: { ...p.powerSlots, [cat]: trimTrailingEmpty(p.powerSlots[cat], powerDefaultCount(cat)) } };
    });
  }
  function growFeatSlots() {
    setChar((p) => {
      const base = featSlotCount;
      const eff = p.featSlotOverride ?? base;
      const render = Math.max(eff, p.featSlots.length);
      const desired = Math.max(0, Math.min(20, render + 1));
      return { ...p, featSlots: padEmpty(p.featSlots, desired), featSlotOverride: desired === base ? undefined : desired };
    });
  }
  function reduceFeatSlots() {
    setChar((p) => {
      const base = featSlotCount;
      const eff = p.featSlotOverride ?? base;
      const render = Math.max(eff, p.featSlots.length);
      const desired = Math.max(0, render - 1);
      return { ...p, featSlots: trimTrailingEmpty(p.featSlots, desired), featSlotOverride: desired === base ? undefined : desired };
    });
  }
  function restoreFeatOverride() {
    setChar((p) => ({ ...p, featSlotOverride: undefined, featSlots: trimTrailingEmpty(p.featSlots, featSlotCount) }));
  }

  // 行动资源面板：行动点 / 里程碑 / 灵能点（位于经验下方，尺寸与原先一致）
  const resourcePanel = (
    <div className="resource-panel">
      <div className="resource-item">
        <span className="field-label">行动点</span>
        {mode === "render" ? (
          <span className="level-value">{char.actionPoints}</span>
        ) : (
          <div className="stepper">
            <button type="button" className="step" onClick={() => setChar({ ...char, actionPoints: Math.max(0, char.actionPoints - 1) })}>−</button>
            <span className="level-value">{char.actionPoints}</span>
            <button type="button" className="step" onClick={() => setChar({ ...char, actionPoints: Math.min(5, char.actionPoints + 1) })}>+</button>
            <button type="button" className="step reset" title="重置行动点" onClick={() => setChar({ ...char, actionPoints: 1 })}>↺</button>
          </div>
        )}
      </div>
      <div className="resource-item">
        <span className="field-label">里程碑</span>
        {mode === "render" ? (
          <span className="level-value">{char.milestones ?? 0}</span>
        ) : (
          <div className="stepper">
            <button type="button" className="step" onClick={() => setChar({ ...char, milestones: Math.max(0, (char.milestones ?? 0) - 1), actionPoints: Math.max(0, char.actionPoints - 1) })}>−</button>
            <span className="level-value">{char.milestones ?? 0}</span>
            <button type="button" className="step" onClick={() => setChar({ ...char, milestones: Math.min(99, (char.milestones ?? 0) + 1), actionPoints: Math.min(5, char.actionPoints + 1) })}>+</button>
            <button type="button" className="step reset" title="重置里程碑" onClick={() => setChar({ ...char, milestones: 0 })}>↺</button>
          </div>
        )}
      </div>
      <div className="resource-item">
        <span className="field-label">灵能点</span>
        {mode === "render" ? (
          <span className="level-value">{char.powerPoints ?? 0}</span>
        ) : (
          <div className="stepper">
            <button type="button" className="step" onClick={() => setChar({ ...char, powerPoints: Math.max(0, (char.powerPoints ?? 0) - 1) })}>−</button>
            <span className="level-value">{char.powerPoints ?? 0}</span>
            <button type="button" className="step" onClick={() => setChar({ ...char, powerPoints: Math.min(99, (char.powerPoints ?? 0) + 1) })}>+</button>
            <button type="button" className="step reset" title="重置灵能点" onClick={() => setChar({ ...char, powerPoints: hybridPowerPoints(char, resolveClassId, resolvePowerId) ?? psionicPowerPoints(char.classId, char.level) ?? 0 })}>↺</button>
          </div>
        )}
      </div>
    </div>
  );

  const topCol = (
    <section className="block topbar">
        <div className="topbar-head">
          <span className="block-title">角色信息</span>
        </div>
        <div className="topbar-flex">
          <div className="portrait-col">
            <PortraitFrame />
            {mode === "render" ? (
              <div className="render-field"><span className="render-name">等级</span><span className="render-value">{char.level}</span></div>
            ) : (
              <div className="field">
                <span className="field-label">等级</span>
                <div className="stepper">
                  <button type="button" className="step" onClick={() => setLevel(char.level - 1)}>−</button>
                  <span className="level-value">{char.level}</span>
                  <button type="button" className="step" onClick={() => setLevel(char.level + 1)}>+</button>
                </div>
              </div>
            )}
            <TextField label="经验" value={char.xp ?? ""} onChange={(v) => onXpChange(v)} type="number" mode={mode} />
            {layout === "double" && resourcePanel}
          </div>
          <div className="info-rows">
            <div className="info-row row-1">
              <TextField label="姓名" value={char.name} onChange={(v) => setChar({ ...char, name: v })} mode={mode} big />
            </div>
            <div className="info-row row-2">
              <PickField label="种族" displayName={subraceEntry ? subraceEntry.name : raceEntry?.name} mode={mode} onClick={() => setPicker("race")} />
              <PickField label="英雄职阶" displayName={classDisplay} mode={mode} onClick={() => setPicker("class")} />
              <PickField label={char.level >= 11 ? "典范之道" : "典范之道（11级解锁）"} displayName={paragonPathEntry?.name} disabled={char.level < 11} mode={mode} onClick={() => setPicker("paragon")} />
              <PickField label={char.level >= 21 ? "传奇天命" : "传奇天命（21级解锁）"} displayName={epicDestinyEntry?.name} disabled={char.level < 21} mode={mode} onClick={() => setPicker("epic")} />
            </div>
            <div className="info-row row-3">
              <TextField label="性别" value={char.gender ?? ""} onChange={(v) => setChar({ ...char, gender: v })} mode={mode} />
              <TextField label="年龄" value={char.age ?? ""} onChange={(v) => setChar({ ...char, age: v })} mode={mode} />
              <TextField label="体型" value={char.size ?? ""} onChange={(v) => setChar({ ...char, size: v })} mode={mode} />
              <TextField label="身高" value={char.height ?? ""} onChange={(v) => setChar({ ...char, height: v })} mode={mode} />
              <TextField label="体重" value={char.weight ?? ""} onChange={(v) => setChar({ ...char, weight: v })} mode={mode} />
              {layout === "double" && <VisionField value={char.vision} mode={mode} onChange={(v) => setChar({ ...char, vision: v })} />}
            </div>
            <div className="info-row row-4">
              <AlignmentField value={char.alignment} mode={mode} onClick={() => setAlignmentOpen(true)} />
              <TextField label="信仰" value={char.faith ?? ""} onChange={(v) => setChar({ ...char, faith: v })} mode={mode} />
              {layout === "single" && <VisionField value={char.vision} mode={mode} onChange={(v) => setChar({ ...char, vision: v })} />}
              <TextField label="冒险团队与组织" value={char.organization ?? ""} onChange={(v) => setChar({ ...char, organization: v })} wide mode={mode} />
            </div>
            <div className="info-row row-lang">
              {layout === "single" && resourcePanel}
              <span className="field-label">语言</span>
              {char.languages.map((v, i) => (
                mode === "render" ? (v ? <span key={i} className="lang-chip">{v}</span> : null)
                : <input key={i} className="lang-input" value={v} placeholder={"语言 " + (i + 1)} onChange={(e) => setLang(i, e.target.value)} />
              ))}
              {mode === "edit" && (
                <span className="lang-steps">
                  <button type="button" className="sg-step" title="减少语言槽" onClick={() => setChar((p) => ({ ...p, languages: p.languages.slice(0, -1) }))}>−</button>
                  <button type="button" className="sg-step" title="增加语言槽" onClick={() => setChar((p) => ({ ...p, languages: [...p.languages, ""] }))}>+</button>
                </span>
              )}
            </div>
          </div>
        </div>
    </section>
  );
  const leftTop = (
    <>
      <div className="stat-layout">
        <div className="stat-col">
          <div className="mini-block">
            <div className="mb-head">
              <span className="mb-label">先攻</span>
              <button type="button" className="def-detail-btn" onClick={() => setInitDetailOpen(true)} title="查看先攻加值的构成">查看详情</button>
            </div>
            <span className="mb-value">{fmtMod(stats.initiative + char.initMods.other)}</span>
            {mode === "edit" ? (
              <ModInputs sources={[{ key: "other", label: "其他" }]} mods={char.initMods} onChange={(k, v) => setInitMod(k as keyof InitMods, v)} />
            ) : (
              char.initMods.other !== 0 && <div className="def-bonus-total">{char.initMods.other > 0 ? "+" + char.initMods.other : String(char.initMods.other)}</div>
            )}
          </div>
          <div className="mini-block">
            <div className="mb-head">
              <span className="mb-label">属性</span>
              {abilityMode === "buy" && (isBoostLevel || boostUsed > 0 ? (
                <span className="buy-badge">提升 {boostUsed}/2</span>
              ) : (
                <button type="button" className={buyPointsUsed(char.abilities) > BUY_POINTS ? "buy-badge clickable over" : "buy-badge clickable"} onClick={() => setBuyPresetOpen(true)} title="点击选择常用购点组合">
                  购点 {BUY_POINTS - buyPointsUsed(char.abilities)}/{BUY_POINTS}
                </button>
              ))}
            </div>
            <div className="ability-actions-row">
              <span className="ability-actions-left">
                <label className="buy-switch" title="22 购点法：起始 8、10、10、10、10、10">
                  <span>购点</span>
                  <Switch selected={abilityMode === "buy"} onChange={(e) => setAbilityMode((e.target as any).selected ? "buy" : "free")} />
                </label>
              </span>
              <button type="button" className="def-detail-btn" onClick={() => setAbilityDetailOpen(true)} title="查看每项属性的基础值与种族加成构成">查看详情</button>
            </div>
            {raceInfo && (raceInfo.one || raceInfo.two.length > 0) && (
              <div className="race-bonus-inline">
                <span className="race-bonus">种族加成：</span>
                {raceInfo.one && <span className="rb-item">+2 {ABILITY_LABELS[raceInfo.one].zh}</span>}
                {raceInfo.two.length === 1 && <span className="rb-item">+2 {ABILITY_LABELS[raceInfo.two[0]].zh}</span>}
                {raceInfo.two.length > 1 && mode === "render" && <span className="rb-item">+2 {ABILITY_LABELS[char.raceAbility2Choice ?? raceInfo.two[0]].zh}</span>}
                {raceInfo.two.length > 1 && mode === "edit" && (
                  <span className="rb-choice">
                    <span className="rb-item">+2</span>
                    <select className="rb-select" value={char.raceAbility2Choice ?? raceInfo.two[0]} onChange={(e) => setChar({ ...char, raceAbility2Choice: e.target.value as AbilityKey })}>
                      {raceInfo.two.map((k) => <option key={k} value={k}>{ABILITY_LABELS[k].zh}</option>)}
                    </select>
                  </span>
                )}
              </div>
            )}
            <div className="ability-table">
              {ABILITIES.map((k) => (
                <div className="ability-col" key={k}>
                  <div className="ac-head">{ABILITY_LABELS[k].zh} <span className="ac-en">{ABILITY_LABELS[k].en}</span></div>
                  <div className="ac-body"><span className="ac-score">{effectiveAbilities[k]}</span><span className="ac-mod">{fmtMod(stats.mods[k])}</span></div>
                  <div className="ac-step">
                    <button type="button" className="step" onClick={() => setAbility(k, char.abilities[k] - 1)}>−</button>
                    <button type="button" className="step" onClick={() => setAbility(k, char.abilities[k] + 1)}>+</button>
                  </div>
                  {bonus[k] ? <div className="ac-note">基础 {char.abilities[k]} +2</div> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="stat-col">
          <div className="mini-block">
            <span className="mb-label">感知</span>
            <div className="mb-pair">
              <div className="mb-pair-item"><span>被动侦查</span><span className="mb-pair-value">{stats.passivePerception}</span></div>
              <div className="mb-pair-item"><span>被动洞察</span><span className="mb-pair-value">{stats.passiveInsight}</span></div>
            </div>
          </div>
          <div className="mini-block">
            <div className="mb-head">
              <span className="mb-label">抵御</span>
              <button type="button" className="def-detail-btn" onClick={() => setDefDetailOpen(true)} title="查看各防御属性的详细计算过程">查看详情</button>
            </div>
            <div className="defense-grid">
              <DefenseCell label="AC" value={stats.ac} mods={acMods} mode={mode} onChange={(src, v) => setDefenseMod("ac", src, v)} />
              <DefenseCell label="强韧" value={stats.fort} mods={fortMods} mode={mode} onChange={(src, v) => setDefenseMod("fort", src, v)} />
              <DefenseCell label="反射" value={stats.ref} mods={refMods} mode={mode} onChange={(src, v) => setDefenseMod("ref", src, v)} />
              <DefenseCell label="意志" value={stats.will} mods={willMods} mode={mode} onChange={(src, v) => setDefenseMod("will", src, v)} />
            </div>
          </div>
        </div>
        <div className="stat-col">
          <div className="mini-block">
            <div className="mb-head">
              <span className="mb-label">移动力</span>
              <button type="button" className="def-detail-btn" onClick={() => setSpeedDetailOpen(true)} title="查看基础速度与各类加成构成">查看详情</button>
            </div>
            <span className="mb-value">{speedDisplay}<span className="mb-unit">速度(格)</span></span>
            {mode === "edit" ? (
              <ModInputs
                sources={[
                  { key: "power", label: "威能" },
                  { key: "feat", label: "专长" },
                  { key: "item", label: "物品" },
                  { key: "other", label: "其他" },
                ]}
                mods={char.speedMods}
                onChange={(k, v) => setSpeedMod(k as keyof SpeedMods, v)}
              />
            ) : (
              speedTotal !== 0 && <div className="def-bonus-total">{speedTotal > 0 ? "+" + speedTotal : String(speedTotal)}</div>
            )}
          </div>
          <div className="mini-block tall">
            <div className="mb-head">
              <span className="mb-label">生命</span>
              <button type="button" className="def-detail-btn" onClick={() => setLifeDetailOpen(true)} title="查看生命值、重伤值、回复值、回复力的构成">查看详情</button>
            </div>
            {/* 当前剩余值与临时生命值统一由速览页管理，这里只呈现推导出的上限与派生值 */}
            <div className="health-list">
              <div className="health-main">
                <div className="health-main-row">
                  <span className="hl-label">生命值</span>
                  <span className="hl-now"><span className="hl-value">{maxHpTotal}</span></span>
                </div>
              </div>
              <div className="health-row"><span>重伤值</span><span className="hl-now small">{bloodiedTotal}</span></div>
              <div className="health-row"><span>回复值</span><span className="hl-now small">{surgeValueTotal}</span></div>
              <div className="health-row"><span>回复力</span><span className="hl-now small">{surgesTotal}</span></div>
            </div>
            <div className="hp-extra">
              <div className="hp-extra-row"><span>额外生命值</span><input type="number" value={hpBonus} onChange={(e) => setChar((p) => ({ ...p, hpBonus: Math.floor(Number(e.target.value) || 0) }))} /></div>
              <div className="hp-extra-row"><span>额外回复力</span><input type="number" value={surgeBonus} onChange={(e) => setChar((p) => ({ ...p, surgeBonus: Math.floor(Number(e.target.value) || 0) }))} /></div>
              <div className="hp-extra-row"><span>额外回复值</span><input type="number" value={surgeValueBonus} onChange={(e) => setChar((p) => ({ ...p, surgeValueBonus: Math.floor(Number(e.target.value) || 0) }))} /></div>

            </div>
          </div>
        </div>
      </div>
          </>
  );
  // 装备槽位增强加值：槽位无魔法物品或无可增强档位时返回 0；否则取所选增强档位对应等级的真实验证加值（档位默认 1）
  const enhanceOf = (slot: number): number => {
    const id = char.equipmentSlots[slot];
    if (!id) return 0;
    const e = itemMap.get(id);
    if (!e) return 0;
    const levels = itemLevels(e.itemLevel);
    if (!levels.length) return 0;
    const tier = Math.min(char.equipmentEnhance[slot] ?? 1, levels.length);
    return enhancementBonusForLevel(levels[tier - 1]);
  };
  // 伤害骰：取自所选槽位（主手/副手）基础武器的伤害骰；无基础武器/非武器则空
  const diceOf = (slot: number): string => {
    const baseId = char.baseItems[slot];
    const base = baseId ? findBaseItem(baseId) : undefined;
    return base?.kind === "weapon" ? (base.weapon?.dice ?? "") : "";
  };
  // 擅长加值：所选槽位基础武器的擅长加值；未装备武器/非武器为 0。
  // override=true 时视为擅长（忽略自动判定，用于选择型专长等无法自动判定的情况）
  const profOf = (slot: number, override: boolean): number => {
    const baseId = char.baseItems[slot];
    const base = baseId ? findBaseItem(baseId) : undefined;
    if (base?.kind !== "weapon" || !base.weapon) return 0;
    return override || isProficient(base.weapon, proficiencyTokens) ? base.weapon.prof : 0;
  };
  // 攻击/伤害数值来源（供「职业加值」「专长加值」单元格点击后选择）：
  // 职业特性（含混职）中提及「攻击骰」的条目 → 职业加值来源
  const classAttackSources = useMemo(
    () => collectClassSources([classEntry?.sourceText, classEntry2?.sourceText], "攻击骰", char.level),
    [classEntry, classEntry2, char.level]
  );
  // 已选专长中提及「攻击骰」的 → 攻击面板专长加值来源（含职业赠送专长）
  const featAttackSources = useMemo(
    () => collectFeatSources([...char.featSlots.map((id) => featMap.get(id)), ...grantedFeatEntries], "攻击骰", char.level),
    [char.featSlots, featMap, char.level, grantedFeatEntries]
  );
  // 已选专长中提及「伤害骰」的 → 伤害面板专长加值来源（含职业赠送专长）
  const featDamageSources = useMemo(
    () => collectFeatSources([...char.featSlots.map((id) => featMap.get(id)), ...grantedFeatEntries], "伤害骰", char.level),
    [char.featSlots, featMap, char.level, grantedFeatEntries]
  );
  // 攻击/伤害：数据面板下方并排（攻击在左、伤害在右），单栏与双栏均通栏展示
  const combatRow = (
    <div className="combat-row">
      <CombatPanels char={char} setChar={setChar} mods={stats.mods} halfLevel={stats.halfLevel} enhanceOf={enhanceOf} diceOf={diceOf} profOf={profOf} mode={mode} classAttackSources={classAttackSources} featAttackSources={featAttackSources} featDamageSources={featDamageSources} />
    </div>
  );
  // 职业特性「选择一个」选项：记录所选值（键 = "职业ID::特性标题"；多选型如戏法存字符串数组）
  const setClassFeatureChoice = (key: string, label: string | string[]) => {
    const next = { ...char.classFeatureChoices };
    if (Array.isArray(label)) {
      if (label.length === 0) delete next[key];
      else next[key] = label;
    } else if (label) {
      next[key] = label;
    } else {
      delete next[key];
    }
    setChar({ ...char, classFeatureChoices: next });
  };
  // 职业特性正文中的 [[威能/专长/野兽]] 超链接 → 悬浮卡片查找
  const wikiLookup = useMemo(
    () => (target: string) => powerMap.get(target) ?? featMap.get(target) ?? itemMap.get(target) ?? ritualMap.get(target) ?? creatureMap.get(target) ?? viceMap.get(target) ?? pactMap.get(target) ?? magicSchoolMap.get(target) ?? domainMap.get(target) ?? virtueMap.get(target),
    [powerMap, featMap, itemMap, ritualMap, creatureMap, viceMap, pactMap, magicSchoolMap, domainMap, virtueMap]
  );
  // 威能条目解析（混职灵能点选项按「可强化」关键字与等级计算用）
  const resolvePowerId = useMemo(() => (id: string) => powerMap.get(id), [powerMap]);
  // 职业条目解析（混职灵能点选项按「灵能强化（混职）」特性检测用）
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const resolveClassId = useMemo(() => (id: string) => classById.get(id), [classById]);
  // 专长赠送威能自动补入（与职业特性行为一致）：数据加载后扫描当前已选专长一次，
  // 把「应赠送但尚未进入威能面板」的威能自动加入；替换型专长需玩家手动选格子，跳过。
  const featGrantScanned = useRef(false);
  useEffect(() => {
    if (feats.length === 0 || powers.length === 0 || featGrantScanned.current) return;
    featGrantScanned.current = true;
    if (!char.featSlots || char.featSlots.length === 0) return;
    const missingByIdx: { idx: number; feat: Entry; powers: Entry[] }[] = [];
    char.featSlots.forEach((id, idx) => {
      if (!id) return;
      const f = featMap.get(id);
      if (!f || featReplacementInfo(f, wikiLookup)) return;
      const granted = featGrantedPowers(f, wikiLookup).filter((p) => !panelIds.has(p.id));
      if (granted.length) missingByIdx.push({ idx, feat: f, powers: granted });
    });
    if (missingByIdx.length === 0) return;
    setChar((p) => {
      let slots = p.powerSlots;
      const featGrantedPowerIds = { ...p.featGrantedPowerIds };
      for (const { idx, feat, powers } of missingByIdx) {
        const toSpecial = featPrereqClassFeature(feat);
        const used = new Set<string>();
        for (const c of SLOT_CATS) for (const id of slots[c.key]) if (id) used.add(id);
        const added: string[] = [];
        for (const pw of powers) {
          if (!pw || used.has(pw.id)) continue;
          const cat = toSpecial ? "special" : grantedPowerSlot(pw.usage, pw.powerKind, pw.name);
          if (!cat) continue;
          const arr = [...slots[cat]];
          const i = arr.findIndex((x) => !x);
          if (i >= 0) arr[i] = pw.id;
          else arr.push(pw.id);
          slots = { ...slots, [cat]: arr };
          used.add(pw.id);
          added.push(pw.id);
        }
        if (added.length) featGrantedPowerIds[idx] = Array.from(new Set([...(featGrantedPowerIds[idx] ?? []), ...added]));
      }
      return { ...p, powerSlots: slots, featGrantedPowerIds };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feats, powers]);
  const raceClassCol = (
    <><section className="block">
        <div className="block-head">
          <h3 className="block-title">种族特性</h3>
          <div className="race-head-actions">
            {raceEntry && subraces.length > 0 && (
              <button
                type="button"
                className={`mode-chip subrace-chip${subraceOpen || char.subraceId ? " active" : ""}${subraceOpen ? " open" : ""}`}
                onClick={() => setSubraceOpen((p) => !p)}
                title="选择亚种：亚种增益可替换基础种族的对应特性"
              >
                <span className="material-symbols-outlined mode-chip-ic">category</span>
                {char.subraceId ? `亚种：${subraceName}` : "亚种"}
              </button>
            )}
            <button type="button" className="mode-chip" onClick={() => setRaceDetail((p) => !p)}>
              <span className="material-symbols-outlined mode-chip-ic">{raceDetail ? "density_small" : "density_large"}</span>
              {raceDetail ? "简洁" : "详细"}
            </button>
          </div>
        </div>
        {raceEntry ? (
          <>
            <div className="pf-entry-title">{subraceEntry ? subraceEntry.name : raceEntry.name}</div>
            {subraces.length > 0 && subraceOpen && (
              <div className="subrace-chooser">
                <span className="subrace-chooser-label">亚种：</span>
                {subraces.map((s) => {
                  const sinfo = parseSubraceInfo(s.sourceText);
                  const tip = sinfo?.benefits.map((b) => `${b.title}（替代「${b.replaces ?? "原特性"}」）`).join("；") ?? "选择该亚种以替换对应的种族特性";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`subrace-opt${char.subraceId === s.id ? " active" : ""}`}
                      onClick={() => setSubrace(char.subraceId === s.id ? undefined : s.id)}
                      title={tip}
                    >
                      {s.name}
                    </button>
                  );
                })}
                {char.subraceId && (
                  <button type="button" className="subrace-opt clear" onClick={() => setSubrace(undefined)}>基础种族</button>
                )}
              </div>
            )}
            <div className="race-detail">
              {raceTraits.length > 0 && (
                <div className="race-trait">
                  {(raceDetail ? raceTraits : compactRaceTraits).map((t, i) => {
                    // 三选一：同一基础特性同时被「基础内部替代」（龙惧替代龙息）与「亚种增益」（腐蚀传统/复仇震击替代龙息）替换时，
                    // 展示三个互斥选项（基础 / 替代 / 亚种），选中其一即自动停用其余，并同步到威能面板。
                    const multiSub = subraceBenefitByBase.get(t.name);
                    const multiSwap = raceAltForBase.get(t.name);
                    if (multiSub && multiSwap) {
                      const subActive = char.subraceBenefits?.[multiSub.title] !== false;
                      const swapActive = !!char.raceSwaps?.[multiSwap.name];
                      const baseActive = !subActive && !swapActive;
                      const pick = (kind: "base" | "swap" | "sub") => {
                        const rs = { ...(char.raceSwaps ?? {}) };
                        const sb = { ...(char.subraceBenefits ?? {}) };
                        rs[multiSwap.name] = kind === "swap";
                        sb[multiSub.title] = kind === "sub";
                        setChar({ ...char, raceSwaps: rs, subraceBenefits: sb });
                      };
                      const activeBody = subActive
                        ? `''${chineseName(multiSub.title)}：''${reorderBenefitBody(multiSub.body, raceDetail)}`
                        : swapActive
                          ? `''${chineseName(multiSwap.name)}：''${reorderBenefitBody(multiSwap.body, raceDetail)}`
                          : `''${chineseName(t.name)}：''${t.body}`;
                      return (
                        <div key={i} className={`race-trait-line sr-replaceable${subActive || swapActive ? " replaced" : ""}`}>
                          <div className="race-trait-row">
                            {raceDetail && (
                              <div className="race-trait-opts">
                                <button
                                  type="button"
                                  className={`sr-tag${baseActive ? " active" : ""}`}
                                  onClick={() => pick("base")}
                                  title={baseActive ? "当前为原始特性" : `切回原始特性「${chineseName(t.name)}」`}
                                >
                                  <span className="material-symbols-outlined sr-ic">swap_horiz</span>
                                  {chineseName(t.name)}
                                </button>
                                <button
                                  type="button"
                                  className={`sr-tag${swapActive ? " active" : ""}`}
                                  onClick={() => pick("swap")}
                                  title={swapActive ? `当前已用「${chineseName(multiSwap.name)}」替代` : `改用「${chineseName(multiSwap.name)}」替代`}
                                >
                                  <span className="material-symbols-outlined sr-ic">swap_horiz</span>
                                  {chineseName(multiSwap.name)}
                                </button>
                                <button
                                  type="button"
                                  className={`sr-tag${subActive ? " active" : ""}`}
                                  onClick={() => pick("sub")}
                                  title={subActive ? `当前已用亚种增益「${chineseName(multiSub.title)}」替代` : `改用亚种增益「${chineseName(multiSub.title)}」替代`}
                                >
                                  <span className="material-symbols-outlined sr-ic">swap_horiz</span>
                                  {chineseName(multiSub.title)}
                                </button>
                              </div>
                            )}
                            <div className="race-trait-content">
                              <WikiBody body={activeBody} fields={raceEntry.fields} lookup={wikiLookup} />
                            </div>
                          </div>
                        </div>
                      );
                    }
                    const repl = subraceBenefitByBase.get(t.name);
                    if (!repl) {
                      // 基础种族内部可替代特性（如 「龙惧」 替代 「龙息」）不可独立展示，并入其基础特性的切换
                      const raceAlt = raceAltForBase.get(t.name);
                      if (t.replaces && raceAltForBase.has(t.replaces)) return null;
                      if (raceAlt) {
                        const altName = raceAlt.name;
                        const swapApplied = !!char.raceSwaps?.[altName];
                        const pickAlt = (useAlt: boolean) => setChar({ ...char, raceSwaps: { ...(char.raceSwaps ?? {}), [altName]: useAlt } });
                        const activeBody = swapApplied ? `''${altName}：''${reorderBenefitBody(raceAlt.body, raceDetail)}` : `''${t.name}：''${t.body}`;
                        return (
                          <div key={i} className={`race-trait-line sr-replaceable${swapApplied ? " replaced" : ""}`}>
                            <div className="race-trait-row">
                              {raceDetail && (
                                <div className="race-trait-opts">
                                  <button
                                    type="button"
                                    className={`sr-tag${!swapApplied ? " active" : ""}`}
                                    onClick={() => pickAlt(false)}
                                    title={!swapApplied ? `当前为原始特性` : `切回原始特性「${chineseName(t.name)}」`}
                                  >
                                    <span className="material-symbols-outlined sr-ic">swap_horiz</span>
                                    {chineseName(t.name)}
                                  </button>
                                  <button
                                    type="button"
                                    className={`sr-tag${swapApplied ? " active" : ""}`}
                                    onClick={() => pickAlt(true)}
                                    title={swapApplied ? `当前已用「${chineseName(altName)}」替代` : `改用「${chineseName(altName)}」替代`}
                                  >
                                    <span className="material-symbols-outlined sr-ic">swap_horiz</span>
                                    {chineseName(altName)}
                                  </button>
                                </div>
                              )}
                              <div className="race-trait-content">
                                <WikiBody
                                  body={activeBody}
                                  fields={raceEntry.fields}
                                  lookup={wikiLookup}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={i} className="race-trait-line">
                          <WikiBody body={`''${t.name}：''${t.body}`} fields={raceEntry.fields} lookup={wikiLookup} />
                        </div>
                      );
                    }
                    // 可用亚种特性替换的基础特性：与三选一一致，提供「原始特性 / 亚种增益」两个按钮互斥选择
                    const applied = char.subraceBenefits?.[repl.title] !== false;
                    const pickSub = (useSub: boolean) => {
                      const sb = { ...(char.subraceBenefits ?? {}) };
                      sb[repl.title] = useSub;
                      setChar({ ...char, subraceBenefits: sb });
                    };
                    const activeBody = applied ? `''${repl.title}：''${reorderBenefitBody(repl.body, raceDetail)}` : `''${t.name}：''${t.body}`;
                    return (
                      <div key={i} className={`race-trait-line sr-replaceable${applied ? " replaced" : ""}`}>
                        <div className="race-trait-row">
                          {raceDetail && (
                            <div className="race-trait-opts">
                              <button
                                type="button"
                                className={`sr-tag${!applied ? " active" : ""}`}
                                onClick={() => pickSub(false)}
                                title={!applied ? `当前为原始特性` : `切回原始特性「${chineseName(t.name)}」`}
                              >
                                <span className="material-symbols-outlined sr-ic">swap_horiz</span>
                                {chineseName(t.name)}
                              </button>
                              <button
                                type="button"
                                className={`sr-tag${applied ? " active" : ""}`}
                                onClick={() => pickSub(true)}
                                title={applied ? `当前已用亚种增益「${chineseName(repl.title)}」替代` : `改用亚种增益「${chineseName(repl.title)}」替代`}
                              >
                                <span className="material-symbols-outlined sr-ic">swap_horiz</span>
                                {chineseName(repl.title)}
                              </button>
                            </div>
                          )}
                          <div className="race-trait-content">
                            <WikiBody
                              body={activeBody}
                              fields={raceEntry.fields}
                              lookup={wikiLookup}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {raceDetail && mergedLore.length > 0 && (
                <div className="race-lore">
                  {mergedLore.map((item, i) => {
                    const sec = item.section;
                    const isSub = item.sub;
                    // 辅助威能：小节标题不折叠，仅各威能的描述文本折叠
                    // （标题可能为「XX辅助威能」或「XX种族威能」，如龙裔）
                    if (!isSub && sec.title && (sec.title.includes("辅助威能") || sec.title.includes("种族威能"))) {
                      const aux = splitAuxPowers(sec.body);
                      return (
                        <div key={`${raceDetail}-aux-${i}`} className="lore-powers">
                          <div className="lore-powers-title">{sec.title}</div>
                          {aux.intro && (
                            <details key={`${raceDetail}-aux-intro-${i}`} className="lore-fold">
                              <summary>
                                <span className="lore-fold-title">简介</span>
                                <span className="material-symbols-outlined lore-fold-ic">expand_more</span>
                              </summary>
                              <div className="class-features"><WikiBody body={aux.intro} fields={raceEntry.fields} lookup={wikiLookup} /></div>
                            </details>
                          )}
                          {aux.powers.map((p, j) => {
                            const power = p.title ? powerMap.get(p.title) : undefined;
                            const selected = !!power && panelIds.has(power.id);
                            return (
                              <details key={`${raceDetail}-aux-${i}-${j}`} className="lore-fold">
                                <summary>
                                  {power && (
                                    <button
                                      type="button"
                                      className={`lore-powers-toggle${selected ? " on" : ""}`}
                                      onClick={(e) => { e.stopPropagation(); toggleRacePower(power); }}
                                      title={selected ? "取消选择，从威能面板移除" : "选择此威能，填入对应的威能框"}
                                    >
                                      {selected ? "取消选择" : "选择此威能"}
                                    </button>
                                  )}
                                  {power ? (
                                    <SmartHover className="lore-fold-title lore-powers-hover" popClass="wiki-ref-pop" pop={<EntryCard entry={power} />}>{p.title}</SmartHover>
                                  ) : (
                                    <span className="lore-fold-title">{p.title}</span>
                                  )}
                                  <span className="material-symbols-outlined lore-fold-ic">expand_more</span>
                                </summary>
                                {p.body && <div className="class-features"><WikiBody body={p.body} fields={raceEntry.fields} lookup={wikiLookup} /></div>}
                              </details>
                            );
                          })}
                        </div>
                      );
                    }
                    return (
                      <details key={`${raceDetail}-lore-${i}`} className="lore-fold">
                        <summary>
                          {isSub && <span className="lore-fold-badge">{subraceName}</span>}
                          <span className="lore-fold-title">{sec.title ?? "种族背景"}</span>
                          <span className="material-symbols-outlined lore-fold-ic">expand_more</span>
                        </summary>
                        <div className="class-features"><WikiBody body={sec.body} fields={raceEntry.fields} lookup={wikiLookup} /></div>
                      </details>
                    );
                  })}
                </div>
              )}
              {!raceTrait && !raceBody && <pre className="feature-text">{stripWiki(raceEntry.sourceText)}</pre>}
            </div>
          </>
        ) : <p className="hint">请先选择种族。</p>}
      </section>

      <section className="block">
        <div className="block-head">
          <h3 className="block-title">{char.hybrid ? "混职职业能力" : "职业能力"}</h3>
          <div className="block-head-actions">
            {char.hybrid && classEntry2 && (
              <button type="button" className="mode-chip" onClick={() => setHybridDetailOpen(true)}>详情</button>
            )}
            <button type="button" className="mode-chip" onClick={() => setClassFeatDetail((p) => !p)}>
              <span className="material-symbols-outlined mode-chip-ic">{classFeatDetail ? "density_small" : "density_large"}</span>
              {classFeatDetail ? "简洁" : "详细"}
            </button>
          </div>
        </div>
        {classEntry ? (
          <>
            {char.hybrid && classEntry2 && <HybridAbilityBlock entry={classEntry} entry2={classEntry2} detail={classFeatDetail} />}
            <ClassFeatureBlock key={classEntry.id} entry={classEntry} detail={classFeatDetail} level={char.level} choices={char.classFeatureChoices} onChoose={setClassFeatureChoice} lookup={wikiLookup} classes={classes} magicSchools={magicSchools} panelIds={panelIds} onAddPowers={onAddClassPowers} onTrackClassPowers={trackClassPowers} onRemovePowers={onRemoveClassPowers} onTrackClassFeats={trackClassFeats} onRemoveFeats={onRemoveClassFeats} onTrackClassRituals={trackClassRituals} onRemoveClassRituals={onRemoveClassRituals} featureOnly={char.hybrid} domains={domains} />
            {classEntry2 && (
              <div className="hy-class-feat-sep">
                <ClassFeatureBlock key={classEntry2.id} entry={classEntry2} detail={classFeatDetail} level={char.level} choices={char.classFeatureChoices} onChoose={setClassFeatureChoice} lookup={wikiLookup} classes={classes} magicSchools={magicSchools} panelIds={panelIds} onAddPowers={onAddClassPowers} onTrackClassPowers={trackClassPowers} onRemovePowers={onRemoveClassPowers} onTrackClassFeats={trackClassFeats} onRemoveFeats={onRemoveClassFeats} onTrackClassRituals={trackClassRituals} onRemoveClassRituals={onRemoveClassRituals} featureOnly={char.hybrid} domains={domains} />
              </div>
            )}
          </>
        ) : <p className="hint">请先选择职业。</p>}
      </section>

      {hybridDetailOpen && classEntry && classEntry2 && createPortal(
        <div className="picker-overlay" onClick={() => setHybridDetailOpen(false)}>
          <div className="picker-dialog class-dialog base-dialog hybrid-detail-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span className="picker-title">混职职业原始数据</span>
              <div className="picker-head-btns">
                <button type="button" className="crop-btn" onClick={() => setHybridDetailOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="hybrid-detail-grid">
              {[classEntry, classEntry2].map((e) => {
                const t = classTraitHtml(e.sourceText);
                return (
                  <div key={e.id} className="hybrid-detail-col">
                    <div className="hybrid-detail-name">{cleanDisplayName(e.name)}</div>
                    {t ? (
                      <div className="class-trait" dangerouslySetInnerHTML={{ __html: wikiToHtml(splitTraitLabels(t), e.fields).replace(/\n{2,}/g, "\n").replace(/\n/g, "<br/>") }} />
                    ) : <p className="hint">无 trait 数据。</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      
      {char.level >= 11 && (
        <section className="block">
          <div className="block-head">
            <h3 className="block-title">典范特性</h3>
            <button type="button" className="mode-chip" onClick={() => setPathDetail((p) => !p)}>
            <span className="material-symbols-outlined mode-chip-ic">{pathDetail ? "density_small" : "density_large"}</span>
            {pathDetail ? "简洁" : "详细"}
          </button>
          </div>
          {paragonPathEntry ? (
            <div className="race-detail">
              {pathParse.sections.length > 0 ? (
                <>
                  {pathParse.hasTitle && <div className="pf-entry-title">{cleanDisplayName(paragonPathEntry.name)}</div>}
                  {pathDetail && pathParse.intro && <div className="pf-intro" dangerouslySetInnerHTML={{ __html: wikiToHtml(pathParse.intro, paragonPathEntry.fields) }} />}
                  <FeatureSectionList sections={pathSections} detail={pathDetail} fields={paragonPathEntry.fields} powerOf={(id) => powerMap.get(id)} panelIds={panelIds} onAddPowers={onAddPowers} />
                </>
              ) : (
                <pre className="feature-text">{stripWiki(paragonPathEntry.sourceText)}</pre>
              )}
            </div>
          ) : <p className="hint">请先选择典范之道。</p>}
        </section>
      )}
      {char.level >= 21 && (
        <section className="block">
          <div className="block-head">
            <h3 className="block-title">天命特性</h3>
            <button type="button" className="mode-chip" onClick={() => setDestinyDetail((p) => !p)}>
            <span className="material-symbols-outlined mode-chip-ic">{destinyDetail ? "density_small" : "density_large"}</span>
            {destinyDetail ? "简洁" : "详细"}
          </button>
          </div>
          {epicDestinyEntry ? (
            <div className="race-detail">
              {destinyParse.sections.length > 0 ? (
                <>
                  {destinyParse.hasTitle && <div className="pf-entry-title">{cleanDisplayName(epicDestinyEntry.name)}</div>}
                  {destinyDetail && destinyParse.intro && <div className="pf-intro" dangerouslySetInnerHTML={{ __html: wikiToHtml(destinyParse.intro, epicDestinyEntry.fields) }} />}
                  <FeatureSectionList sections={destinyParse.sections} detail={destinyDetail} fields={epicDestinyEntry.fields} powerOf={(id) => powerMap.get(id)} panelIds={panelIds} onAddPowers={onAddPowers} />
                </>
              ) : (
                <pre className="feature-text">{stripWiki(epicDestinyEntry.sourceText)}</pre>
              )}
            </div>
          ) : <p className="hint">请先选择传奇天命。</p>}
        </section>
      )}

    </>
  );
  const skillsCol = (
    <>
<section className="block">
        <div className="block-head">
          <h3 className="block-title">技能（{effectiveTrained.length}）</h3>
          <button type="button" className="def-detail-btn" onClick={() => setSkillDetailOpen(true)} title="查看每项技能的加值构成">查看详情</button>
          <button type="button" className="mode-chip" onClick={() => setSkillDetail((p) => !p)}>
            <span className="material-symbols-outlined mode-chip-ic">{skillDetail ? "density_small" : "density_large"}</span>
            {skillDetail ? "简洁" : "详细"}
          </button>
        </div>
        {skillDetail ? (
          <>
          <div className="skill-table">
            {SKILL_TABLE.map((s) => {
              const trained = trainedSet.has(s.name);
              const sm = char.skillMods[s.name] ?? { race: 0, other: 0, armor: 0 };
              const hasArmor = ARMOR_PENALTY_SKILLS.has(s.name);
              const skillVersatility = hasSkillVersatility && !trained ? 1 : 0;
              const total = stats.mods[s.ability] + stats.halfLevel + (trained ? 5 : 0) + skillVersatility + sm.race + sm.other - (hasArmor ? Math.abs(armorPenaltyFor(equippedArmorName)) : 0);
              return (
                <div key={s.name} className={trained ? "skill-item trained" : "skill-item"} onClick={() => toggleTrained(s.name)} title="点击切换受训">
                  <span className="skill-check">{trained ? "✓" : ""}</span>
                  <span className="skill-name">{s.name}</span>
                  <span className="skill-total">{fmtMod(total)}</span>
                  <span className="skill-ability">{ABILITY_LABELS[s.ability].zh}</span>
                  <span className="skill-mods" onClick={(e) => e.stopPropagation()}>
                    {hasArmor && (
                      <label className="skill-mod" title="护甲减值（由已装备护甲自动计算）"><span>护甲</span><span className="skill-mod-minus">−</span><span className={"skill-mod-armor" + (armorPenaltyFor(equippedArmorName) !== 0 ? " pen" : "")}>{Math.abs(armorPenaltyFor(equippedArmorName))}</span></label>
                    )}
                    <label className="skill-mod" title="种族加值"><span>种族</span><input type="number" min={-20} max={50} value={sm.race} onChange={(e) => setSkillMod(s.name, "race", e.target.value)} /></label>
                    <label className="skill-mod" title="其他加值"><span>其他</span><input type="number" min={-20} max={50} value={sm.other} onChange={(e) => setSkillMod(s.name, "other", e.target.value)} /></label>
                  </span>
                </div>
              );
            })}
          </div>
          {classSkillPool.length > 0 && (
            <div className="cls-skill-pick">
              <div className="csp-title">
                <span>职业技能受训（{classSkillPool.filter((s) => trainedSet.has(s.name)).length}/{trainedCount}）</span>
              </div>
              <div className="csp-list">
                {classSkillPool.map((s) => {
                  const auto = classAutoTrained.includes(s.name);
                  const sel = trainedSet.has(s.name);
                  const cls = auto ? "csp-item auto" : sel ? "csp-item active" : "csp-item";
                  return (
                    <button key={s.name} type="button" className={cls} onClick={() => !auto && toggleClassTrained(s.name)}
                      title={auto ? "职业自动受训" : sel ? "已受训（点击取消）" : "点击受训"}>
                      <span className="csp-name">{s.name}</span>
                      <span className="csp-ability">{ABILITY_LABELS[s.ability].zh}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          </>
        ) : (
          <div className="skill-compact">
            {SKILL_TABLE.map((s) => {
              const trained = trainedSet.has(s.name);
              const sm = char.skillMods[s.name] ?? { race: 0, other: 0, armor: 0 };
              const hasArmor = ARMOR_PENALTY_SKILLS.has(s.name);
              const skillVersatility = hasSkillVersatility && !trained ? 1 : 0;
              const total = stats.mods[s.ability] + stats.halfLevel + (trained ? 5 : 0) + skillVersatility + sm.race + sm.other - (hasArmor ? Math.abs(armorPenaltyFor(equippedArmorName)) : 0);
              return (
                <div key={s.name} className={trained ? "skill-compact-row trained" : "skill-compact-row"} title="简略模式为静态展示，受训请在详细模式中切换">
                  <span className="sc-name">{s.name}</span>
                  <span className="sc-total">{fmtMod(total)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

    </>
  );
  const leftCol = (
    <>
      {leftTop}
      {combatRow}
      {raceClassCol}
      {skillsCol}
    </>
  );
  const powersCol = (
    <>
      <section className="block">
        <div className="block-head">
          <h3 className="block-title">威能</h3>
                    <span className="head-actions">
            <button type="button" className={"mode-chip" + (slotMode === "mark" ? " active" : "")} title="开启后点击有内容的槽位切换「已使用」遮罩（再次点击解除）" onClick={() => setSlotMode((m) => (m === "mark" ? null : "mark"))}>
              <span className="mode-chip-ic">−</span>
              标记使用
            </button>
            <button type="button" className={"mode-chip" + (slotMode === "swap" ? " active" : "")} title="开启后点击槽位打开储备弹窗，挑选要交换进来的对象" onClick={() => setSlotMode((m) => (m === "swap" ? null : "swap"))}>
              <span className="mode-chip-ic">⇄</span>
              与储备交换
            </button>
          </span>
          <button type="button" className="mode-chip" onClick={() => setBlockDetail((p) => ({ ...p, powers: !p.powers }))}>
            <span className="material-symbols-outlined mode-chip-ic">{blockDetail.powers ? "density_small" : "density_large"}</span>
            {blockDetail.powers ? "简洁" : "详细"}
          </button>
        </div>
        {SLOT_CATS.map((cat) => {
          const isSpecial = cat.key === "special";
          // 各等级槽位应填充的威能等级（special 为种族/职业威能，无固定等级概念）
          const slotLvls = cat.key === "special" ? [] : powerSlotLevels(cat.key as "atWill", char.level);
          const effCount = isSpecial ? char.powerSlots.special.length : effPowerCount(cat.key);
          const filled = char.powerSlots[cat.key].filter(Boolean).length;
          // 实际渲染槽位数：以「等级默认/自定义」与数组长度较大者为准（恢复后仅显示应有的空位数）
          const count = Math.max(effCount, char.powerSlots[cat.key].length);
          const customized = !isSpecial && char.powerSlotOverrides?.[cat.key] !== undefined;
          return (
            <div key={cat.key} className="selected-group">
              <div className="sg-title">
                {cat.key !== "utility" && cat.key !== "special" && <span className="sg-dot" style={{ background: cat.color }} />}
                {cat.label}
                <span className="sg-count">（{filled}/{count}）</span>
                {isSpecial ? (
                  <>
                    <button type="button" className="sg-step" disabled={!!slotMode} title="减少槽位" onClick={() => setChar((p) => ({ ...p, powerSlots: { ...p.powerSlots, special: trimTrailingEmpty(p.powerSlots.special, Math.max(0, p.powerSlots.special.length - 1)).map((x) => x ?? "") } }))}>−</button>
                    <button type="button" className="sg-step" disabled={!!slotMode} title="增加槽位" onClick={() => setChar((p) => ({ ...p, powerSlots: { ...p.powerSlots, special: padEmpty(p.powerSlots.special, Math.min(20, p.powerSlots.special.length + 1)).map((x) => x ?? "") } }))}>+</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="sg-step" disabled={!!slotMode} title="减少槽位" onClick={() => reducePowerSlots(cat.key)}>−</button>
                    <button type="button" className="sg-step" disabled={!!slotMode} title="增加槽位" onClick={() => growPowerSlots(cat.key)}>+</button>
                  </>
                )}
                {customized && <span className="sg-custom">自定义</span>}
                {customized && <button type="button" className="sg-restore" title="恢复跟随等级" onClick={() => restorePowerOverride(cat.key)}>恢复</button>}
              </div>
              {blockDetail.powers ? (
                <div className="power-grid">
                  {Array.from({ length: count }, (_, i) => {
                    const id = char.powerSlots[cat.key][i] ?? "";
                    const p = id ? powerMap.get(id) : undefined;
                    if (p) {
                      return (
                        <div key={i} className={"slot-filled" + (isPowerUsed(cat.key, i) ? " slot-used" : "")} onClick={() => onPowerSlotClick(cat.key, i)} title={isPowerUsed(cat.key, i) ? "已标记使用（锁定）" : "点击更换"}>
                          <EntryCard entry={p} />
                        </div>
                      );
                    }
                    return (
                      <button key={i} type="button" className="slot-empty" onClick={() => onPowerSlotClick(cat.key, i)}>
                        <span className="material-symbols-outlined">add</span>
                        <span>{isSpecial ? "选择" + cat.label : slotLevelText(slotLvls[i], cat.label)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="compact-list">
                  {Array.from({ length: count }, (_, i) => {
                    const id = char.powerSlots[cat.key][i] ?? "";
                    const p = id ? powerMap.get(id) : undefined;
                    if (p) {
                      return (
                        <div key={i} className={"compact-row" + (isPowerUsed(cat.key, i) ? " slot-used" : "")} onClick={() => onPowerSlotClick(cat.key, i)} title={isPowerUsed(cat.key, i) ? "已标记使用（锁定）" : "点击更换"}>
                          <span className="cr-dot" style={{ background: cat.key === "utility" || cat.key === "special" ? (p.usage === "at-will" ? POWER_COLORS.atWill : p.usage === "encounter" ? POWER_COLORS.encounter : p.usage === "daily" ? POWER_COLORS.daily : POWER_COLORS.utility) : cat.color }} />
                          <span className="cr-name">{p.name}{p.nameEn ? " " + p.nameEn : ""}</span>
                          <span className="cr-sub">L{p.level}{p.usageZh ? " · " + p.usageZh : ""}</span>
                          <IconButton className="slot-x" title={isPowerUsed(cat.key, i) || slotMode ? "锁定" : "清空槽位"} aria-label="清空槽位" onClick={(e) => { e.stopPropagation(); if (slotMode || isPowerUsed(cat.key, i)) return; setChar((c) => ({ ...c, powerSlots: clearPowerSlot(c.powerSlots, cat.key, i) })); }}><span className="material-symbols-outlined">close</span></IconButton>
                          <div className="compact-pop"><EntryCard entry={p} /></div>
                        </div>
                      );
                    }
                    return (
                      <button key={i} type="button" className="compact-empty" onClick={() => onPowerSlotClick(cat.key, i)}>＋ {isSpecial ? "选择" + cat.label : slotLevelText(slotLvls[i], cat.label)}</button>
                    );
                  })}
                </div>
              )}
              {count === 0 && filled === 0 && (
                <div className="sg-none">暂无{cat.label}槽位，可点击 ＋ 手动添加</div>
              )}
            </div>
          );
        })}
      </section>

          </>
  );
  const rightRest = (
    <>
<section className="block">
        <div className="block-head">
          <h3 className="block-title">装备</h3>
                    <span className="head-actions">
            <button type="button" className={"mode-chip" + (slotMode === "mark" ? " active" : "")} title="开启后点击有内容的槽位切换「已使用」遮罩（再次点击解除）" onClick={() => setSlotMode((m) => (m === "mark" ? null : "mark"))}>
              <span className="mode-chip-ic">−</span>
              标记使用
            </button>
            <button type="button" className={"mode-chip" + (slotMode === "swap" ? " active" : "")} title="开启后点击槽位打开储备弹窗，挑选要交换进来的对象" onClick={() => setSlotMode((m) => (m === "swap" ? null : "swap"))}>
              <span className="mode-chip-ic">⇄</span>
              与储备交换
            </button>
          </span>
          <button type="button" className="mode-chip" title="查看职业、种族、专长提供的武器、法器、防具擅长" onClick={() => setProfOpen(true)}>
            <span className="material-symbols-outlined mode-chip-ic">workspace_premium</span>
            擅长
          </button>
          <button type="button" className="mode-chip" onClick={() => setBlockDetail((p) => ({ ...p, equipment: !p.equipment }))}>
            <span className="material-symbols-outlined mode-chip-ic">{blockDetail.equipment ? "density_small" : "density_large"}</span>
            {blockDetail.equipment ? "简洁" : "详细"}
          </button>
        </div>
        <div className="equip-layout">
          <nav className="equip-nav">
            {EQUIP_GROUPS.map((g) => (
              <button key={g.label} type="button" className="equip-nav-btn" title={g.label} onClick={() => document.getElementById("equip-g-" + g.label)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{g.label.slice(0, 1)}</button>
            ))}
            <button type="button" className="equip-nav-btn" onClick={() => document.getElementById("equip-g-其他")?.scrollIntoView({ behavior: "smooth", block: "start" })}>他</button>
            <button type="button" className="equip-nav-btn" title="消耗品" onClick={() => document.getElementById("equip-g-消耗品")?.scrollIntoView({ behavior: "smooth", block: "start" })}>耗</button>
            <button type="button" className="equip-nav-btn" title="冒险装备" onClick={() => document.getElementById("equip-g-冒险装备")?.scrollIntoView({ behavior: "smooth", block: "start" })}>冒</button>
            <button type="button" className="equip-nav-btn" title="奇物" onClick={() => document.getElementById("equip-g-奇物")?.scrollIntoView({ behavior: "smooth", block: "start" })}>奇</button>
          </nav>
          <div className="equip-groups">
        {EQUIP_GROUPS.map((g) => {
          const filled = g.slots.filter((s) => char.equipmentSlots[s.index]).length;
          return (
            <div key={g.label} id={"equip-g-" + g.label} className="selected-group">
              <div className="sg-title">
                {g.label}
                <span className="sg-count">（{filled}/{g.slots.length}）</span>
              </div>
              <EquipGroupSlots
                slots={g.slots.map((s) => char.equipmentSlots[s.index])}
                detail={blockDetail.equipment}
                names={(i) => g.slots[i].name}
                items={(i) => { const id = char.equipmentSlots[g.slots[i].index]; return id ? itemMap.get(id) : undefined; }}
                picker={(i) => onEquipSlotClick("fixed", g.slots[i].index)}
                clear={(i) => { if (slotMode) return; setChar((c) => ({ ...c, equipmentSlots: clearEquipmentSlot(c.equipmentSlots, g.slots[i].index) })); }}
                usedOf={(i) => isEquipUsed("fixed", g.slots[i].index)}
                baseKind={g.kind}
                baseOf={(i) => char.baseItems[g.slots[i].index]}
                onBaseClick={(i) => { if (slotMode || isEquipUsed("fixed", g.slots[i].index)) return; g.kind && setBasePicker({ kind: g.kind, index: g.slots[i].index }); }}
                levelsOf={(i) => { const id = char.equipmentSlots[g.slots[i].index]; const e = id ? itemMap.get(id) : undefined; return e ? itemLevels(e.itemLevel) : []; }}
                enhanceOf={(i) => char.equipmentEnhance[g.slots[i].index] ?? 1}
                onEnhance={(i, tier) => setChar((c) => ({ ...c, equipmentEnhance: { ...c.equipmentEnhance, [g.slots[i].index]: tier } }))}
              />
            </div>
          );
        })}
          <div id="equip-g-奇物" className="equip-sub">
            <div className="sg-title">
              奇物
              <span className="sg-count">（{char.wondrousSlots.filter(Boolean).length}/{char.wondrousSlots.length}）</span>
              <button type="button" className="sg-step" disabled={!!slotMode} title="减少槽位" onClick={() => setChar((p) => ({ ...p, wondrousSlots: resizeSlots(p.wondrousSlots, p.wondrousSlots.length - 1) }))}>−</button>
              <button type="button" className="sg-step" disabled={!!slotMode} title="增加槽位" onClick={() => setChar((p) => ({ ...p, wondrousSlots: resizeSlots(p.wondrousSlots, p.wondrousSlots.length + 1) }))}>+</button>
            </div>
            <EquipGroupSlots
              slots={char.wondrousSlots}
              detail={blockDetail.equipment}
              names={(i) => "奇物 " + (i + 1)}
              items={(i) => { const id = char.wondrousSlots[i]; return id ? itemMap.get(id) : undefined; }}
              picker={(i) => onEquipSlotClick("wondrous", i)}
              clear={(i) => { if (slotMode) return; setChar((c) => ({ ...c, wondrousSlots: clearEquipmentSlot(c.wondrousSlots, i) })); }}
              usedOf={(i) => isEquipUsed("wondrous", i)}
            />
          </div>
          <div id="equip-g-其他" className="equip-sub">
            <div className="sg-title">
              其他
              <span className="sg-count">（{char.otherSlots.filter(Boolean).length}/{char.otherSlots.length}）</span>
              <button type="button" className="sg-step" disabled={!!slotMode} title="减少槽位" onClick={() => setChar((p) => ({ ...p, otherSlots: resizeSlots(p.otherSlots, p.otherSlots.length - 1) }))}>−</button>
              <button type="button" className="sg-step" disabled={!!slotMode} title="增加槽位" onClick={() => setChar((p) => ({ ...p, otherSlots: resizeSlots(p.otherSlots, p.otherSlots.length + 1) }))}>+</button>
            </div>
            <EquipGroupSlots
              slots={char.otherSlots}
              detail={blockDetail.equipment}
              names={(i) => "其他 " + (i + 1)}
              items={(i) => { const id = char.otherSlots[i]; return id ? itemMap.get(id) : undefined; }}
              picker={(i) => onEquipSlotClick("other", i)}
              clear={(i) => { if (slotMode) return; setChar((c) => ({ ...c, otherSlots: clearEquipmentSlot(c.otherSlots, i) })); }}
              usedOf={(i) => isEquipUsed("other", i)}
            />
          </div>
          <div id="equip-g-消耗品" className="equip-sub">
            <div className="sg-title">
              消耗品
              <span className="sg-count">（{char.consumableSlots.filter(Boolean).length}/{char.consumableSlots.length}）</span>
              <button type="button" className="sg-step" disabled={!!slotMode} title="减少槽位" onClick={() => setChar((p) => ({ ...p, consumableSlots: resizeSlots(p.consumableSlots, p.consumableSlots.length - 1) }))}>−</button>
              <button type="button" className="sg-step" disabled={!!slotMode} title="增加槽位" onClick={() => setChar((p) => ({ ...p, consumableSlots: resizeSlots(p.consumableSlots, p.consumableSlots.length + 1) }))}>+</button>
            </div>
            <EquipGroupSlots
              slots={char.consumableSlots}
              detail={blockDetail.equipment}
              names={(i) => "消耗品 " + (i + 1)}
              items={(i) => { const id = char.consumableSlots[i]; return id ? itemMap.get(id) : undefined; }}
              picker={(i) => onEquipSlotClick("consumable", i)}
              clear={(i) => { if (slotMode) return; setChar((c) => ({ ...c, consumableSlots: clearEquipmentSlot(c.consumableSlots, i) })); }}
              usedOf={(i) => isEquipUsed("consumable", i)}
            />
          </div>
          <div id="equip-g-冒险装备" className="equip-sub">
            <div className="sg-title">
              冒险装备
              <span className="sg-count">（{char.adventureItems.filter(Boolean).length}/{char.adventureItems.length}）</span>
              <button type="button" className="sg-step" title="减少槽位" onClick={() => setChar((p) => ({ ...p, adventureItems: p.adventureItems.slice(0, -1) }))}>−</button>
              <button type="button" className="sg-step" title="增加槽位" onClick={() => setChar((p) => ({ ...p, adventureItems: [...p.adventureItems, { name: "", cost: 0 }] }))}>+</button>
            </div>
            <div className="adv-list">
              {char.adventureItems.map((a, i) => (
                <div key={i} className="adv-line">
                  {mode === "render" ? (
                    <>
                      {a.name && <span className="lang-chip">{a.name}</span>}
                      {a.cost > 0 && <span className="adv-cost">{a.cost} gp</span>}
                    </>
                  ) : (
                    <>
                      <input className="lang-input adv-name-input" value={a.name} placeholder={"冒险装备 " + (i + 1)} onChange={(e) => setAdvItem(i, { name: e.target.value })} />
                      <input className="lang-input adv-cost-input" type="number" min={0} value={a.cost || ""} placeholder="gp" onChange={(e) => setAdvItem(i, { cost: parseInt(e.target.value, 10) || 0 })} />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
      </section>





      <section className="block">
        <div className="block-head">
          <h3 className="block-title">金钱</h3>
        </div>
        <div className="money-grid">
          <div className="money-block">
            <div className="money-title">收入（累计）</div>
            <div className="money-value">{char.money.earned.toLocaleString("zh-CN")} gp</div>
            <div className="money-add">
              <input type="number" className="money-input" value={earnInput} placeholder="新增收入" onChange={(e) => setEarnInput(e.target.value)} />
              <button type="button" className="sf-chip" onClick={addEarn}>＋ 确定</button>
            </div>
          </div>
          <div className="money-block">
            <div className="money-title">手动花销（累计）</div>
            <div className="money-value">{char.money.spent.toLocaleString("zh-CN")} gp</div>
            <div className="money-add">
              <input type="number" className="money-input" value={spendInput} placeholder="新增花销" onChange={(e) => setSpendInput(e.target.value)} />
              <button type="button" className="sf-chip" onClick={addSpend}>＋ 确定</button>
            </div>
          </div>
          <div className="money-block">
            <div className="money-title">自动花销</div>
            <button type="button" className="money-value money-click" title="点击查看各项累计明细" onClick={() => setAutoCostOpen(true)}>{autoTotal.toLocaleString("zh-CN")} gp</button>
          </div>
          <div className="money-block">
            <div className="money-title">余额</div>
            <div className={"money-value" + (moneyBalance < 0 ? " negative" : "")}>{moneyBalance.toLocaleString("zh-CN")} gp</div>
          </div>
        </div>
      </section>

      <section className="block ritual-block">
        <div className="block-head">
          <h3 className="block-title">{ritualKind === "practice" ? "武术奥义" : "仪式"}</h3>
          <span className="ritual-counter">
            <span className="sg-count">（{(char.ritualSlots ?? []).filter(Boolean).length}/{ritualRenderCount}）</span>
            <button type="button" className="sg-step" title="减少槽位" onClick={reduceRitualSlots}>−</button>
            <button type="button" className="sg-step" title="增加槽位" onClick={growRitualSlots}>+</button>
            {char.ritualSlotOverride !== undefined && (
              <>
                <span className="sg-custom">自定义</span>
                <button type="button" className="sg-restore" title="恢复跟随等级" onClick={restoreRitualOverride}>恢复</button>
              </>
            )}
          </span>
          <span className="ritual-kind-toggle">
            <button type="button" className={"kind-chip" + (ritualKind === "ritual" ? " active" : "")} title="仪式魔法（需「仪式施法者」专长）" onClick={() => setRitualKind("ritual")}>仪式魔法</button>
            <button type="button" className={"kind-chip" + (ritualKind === "practice" ? " active" : "")} title="武术奥义（需「奥义学习」专长）" onClick={() => setRitualKind("practice")}>武术奥义</button>
          </span>
          <button type="button" className="mode-chip" onClick={() => setBlockDetail((p) => ({ ...p, rituals: !p.rituals }))}>
            <span className="material-symbols-outlined mode-chip-ic">{blockDetail.rituals ? "density_large" : "density_small"}</span>
            {blockDetail.rituals ? "详细" : "简洁"}
          </button>
        </div>
        {((char.ritualSlots ?? []).filter(Boolean).length === 0) && (char.classGrantedRitualIds ?? []).length === 0 && (
          <p className="hint">{ritualKind === "practice" ? "尚未掌握任何武术奥义。掌握武术奥义需要「奥义学习」专长，且需满足等级与关键技能受训要求，成本按市场价格计入自动花销。" : "尚未学会任何仪式。学会仪式需要「仪式施法者」专长，学习成本按市场价格计入自动花销。"}</p>
        )}
        {blockDetail.rituals ? (
          <div className="ritual-list">
            {grantedRitualEntries.length > 0 && (
              <div className="granted-rituals">
                {grantedRitualEntries.map((r) => {
                  const price = ritualMarketPrice(r);
                  return (
                    <div key={r.id} className="ritual-line gr-item" title={"职业特性「" + (char.classGrantedRitualSources?.[r.id] ?? "") + "」赠送（不占用仪式槽位）"}>
                      <div className="ritual-main">
                        <span className="ritual-name">
                          <SmartHover className="ritual-name-link" popClass="wiki-ref-pop" portal pop={<EntryCard entry={r} />}>
                            {r.name}{r.nameEn ? " " + r.nameEn : ""}
                          </SmartHover>
                        </span>
                        <span className="ritual-meta">
                          {r.ritualLevel ? "Lv" + r.ritualLevel : ""}
                          {r.ritualCategory ? " · " + r.ritualCategory : ""}
                          {r.keySkill ? " · 关键技能 " + r.keySkill : ""}
                        </span>
                      </div>
                      {price > 0 && <span className="ritual-cost" title="市场价格（计入自动花销）">{price.toLocaleString("zh-CN")} gp</span>}
                      <span className="gr-badge" title="来源职业特性">{char.classGrantedRitualSources?.[r.id] ?? "赠送"}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {Array.from({ length: ritualRenderCount }, (_, i) => {
              const id = (char.ritualSlots ?? [])[i] ?? "";
              const r = id ? ritualMap.get(id) : undefined;
              if (r) {
                const price = ritualMarketPrice(r);
                return (
                  <div key={i} className="ritual-line" onClick={() => mode === "edit" && openRitualPicker(i)} title={mode === "edit" ? "点击更换" : undefined}>
                    <div className="ritual-main">
                      <span className="ritual-name">
                        <SmartHover className="ritual-name-link" popClass="wiki-ref-pop" portal pop={<EntryCard entry={r} />}>
                          {r.name}{r.nameEn ? " " + r.nameEn : ""}
                        </SmartHover>
                      </span>
                      <span className="ritual-meta">
                        {r.ritualLevel ? "Lv" + r.ritualLevel : ""}
                        {r.ritualCategory ? " · " + r.ritualCategory : ""}
                        {r.keySkill ? " · 关键技能 " + r.keySkill : ""}
                      </span>
                    </div>
                    {price > 0 && <span className="ritual-cost" title="市场价格（计入自动花销）">{price.toLocaleString("zh-CN")} gp</span>}
                    {mode === "edit" && (
                      <button type="button" className="ritual-remove" title="清空槽位" onClick={(e) => { e.stopPropagation(); clearRitualSlotAt(i); }}>×</button>
                    )}
                  </div>
                );
              }
              return (
                <button key={i} type="button" className="compact-empty" onClick={() => openRitualPicker(i)}>＋ {ritualKind === "practice" ? "选择武术奥义" : "选择仪式"}</button>
              );
            })}
          </div>
        ) : (
          <div className="ritual-detail-list">
            {grantedRitualEntries.length > 0 && (
              <div className="granted-rituals">
                {grantedRitualEntries.map((r) => (
                  <div key={r.id} className="ritual-detail-item gr-item" title={"职业特性「" + (char.classGrantedRitualSources?.[r.id] ?? "") + "」赠送（不占用仪式槽位）"}>
                    <EntryCard entry={r} />
                    <span className="gr-badge" title="来源职业特性">{char.classGrantedRitualSources?.[r.id] ?? "赠送"}</span>
                  </div>
                ))}
              </div>
            )}
            {Array.from({ length: ritualRenderCount }, (_, i) => {
              const id = (char.ritualSlots ?? [])[i] ?? "";
              const r = id ? ritualMap.get(id) : undefined;
              if (r) {
                return (
                  <div key={i} className="ritual-detail-item" onClick={() => mode === "edit" && openRitualPicker(i)} title={mode === "edit" ? "点击更换" : undefined}>
                    <EntryCard entry={r} />
                  </div>
                );
              }
              return (
                <button key={i} type="button" className="ritual-slot-empty" onClick={() => openRitualPicker(i)}>
                  <span className="material-symbols-outlined">add</span>
                  <span>{ritualKind === "practice" ? "选择武术奥义" : "选择仪式"}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <section className="block theme-block">
        <div className="block-head">
          <h3 className="block-title">主题</h3>
          {themeEntry && <span className="theme-source">[{themeEntry.source}]</span>}
          {mode === "edit" && (
            <>
              <button type="button" className="mode-chip" onClick={() => setPicker("theme")}>{themeEntry ? "更换主题" : "选择主题"}</button>
              {themeEntry && <button type="button" className="mode-chip" onClick={clearTheme}>清除</button>}
            </>
          )}
        </div>
        {!themeEntry ? (
          <p className="hint">未选择主题。选择一个主题可获得其起始特性与专属威能。</p>
        ) : (
          <div className="theme-body">
            {(() => {
              // 主题正文按标题层级切分为章节树。参照职业面板：
              // 「主题简介」（无标题引言）与机制章节（起始特性起，含子节）直接平铺；
              // 其余 lore（扮演/创建及子节）默认折叠。威能交互由下方三个列表统一呈现。
              const themeSections = splitThemeSections(themeEntry.sourceText);
              const mechIdx = themeSections.findIndex((s) => s.title === THEME_MECH_START);
              const intro = themeSections.length > 0 && !themeSections[0].title ? [themeSections[0]] : [];
              const loreRest = intro.length ? themeSections.slice(1, mechIdx === -1 ? themeSections.length : mechIdx) : themeSections.slice(0, mechIdx === -1 ? themeSections.length : mechIdx);
              const mech = mechIdx === -1 ? [] : themeSections.slice(mechIdx);
              return (
                <>
                  {intro.length > 0 && <ThemeChapters sections={intro} fields={themeEntry.fields} lookup={wikiLookup} fold={false} />}
                  {loreRest.length > 0 && <ThemeChapters sections={loreRest} fields={themeEntry.fields} lookup={wikiLookup} fold />}
                  {mech.length > 0 && <ThemeChapters sections={mech} fields={themeEntry.fields} lookup={wikiLookup} fold={false} />}
                </>
              );
            })()}
            {themeStartingRefs.length > 0 && (
              <div className="theme-power-group">
                <div className="theme-power-head">起始特性威能</div>
                {themeStartingRefs.map((s, i) => {
                  if (!s.power) return (
                    <div key={i} className="theme-power-line unresolved" title="该威能不在威能库中，无法加入威能面板。">{s.ref}（未收录）</div>
                  );
                  const pw: Entry = s.power;
                  const inPanel = panelIds.has(pw.id);
                  const auto = themeStartEntry.length === 1;
                  return (
                    <div key={pw.id} className="theme-power-line">
                      <SmartHover className="theme-power-name" popClass="compact-pop" title={pw.name} pop={<EntryCard entry={pw} />}>
                        <span className="cr-dot" style={{ background: pw.usage === "at-will" ? POWER_COLORS.atWill : pw.usage === "encounter" ? POWER_COLORS.encounter : pw.usage === "daily" ? POWER_COLORS.daily : POWER_COLORS.utility }} />
                        <span className="cr-name">{pw.name}{pw.nameEn ? " " + pw.nameEn : ""}</span>
                        <span className="cr-sub">L{pw.level}{pw.usageZh ? " · " + pw.usageZh : ""}</span>
                      </SmartHover>
                      {mode === "edit" && (auto ? (
                        <span className="theme-auto-badge" title="起始特性赠送，已自动加入威能面板">已自动加入</span>
                      ) : (
                        <button type="button" className="sg-step" title={inPanel ? "从威能面板移除" : "加入威能面板"} onClick={() => toggleThemePower(pw)}>{inPanel ? "移除" : "加入"}</button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            {themeExtraP.length > 0 && (
              <div className="theme-power-group">
                <div className="theme-power-head">额外特性威能（5/10级）</div>
                <ThemePowerRows powers={themeExtraP} mode={mode} level={char.level} panelIds={panelIds} onToggle={toggleThemePower} />
              </div>
            )}
            {themeOptPowers.length > 0 && (
              <div className="theme-power-group">
                <div className="theme-power-head">可选威能（可替代职业/种族威能）</div>
                <ThemePowerRows powers={themeOptPowers} mode={mode} level={char.level} panelIds={panelIds} onToggle={toggleThemePower} />
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
  const featsCol = (
    <>
      <section className="block feats-block">
        <div className="block-head">
          <h3 className="block-title">专长</h3>
          <button type="button" className="mode-chip" onClick={() => setBlockDetail((p) => ({ ...p, feats: !p.feats }))}>
            <span className="material-symbols-outlined mode-chip-ic">{blockDetail.feats ? "density_small" : "density_large"}</span>
            {blockDetail.feats ? "简洁" : "详细"}
          </button>
        </div>
        <div className="selected-group">
          <div className="sg-title">
            专长
            <span className="sg-count">（{char.featSlots.filter(Boolean).length}/{featRenderCount}）</span>
            <button type="button" className="sg-step" title="减少槽位" onClick={reduceFeatSlots}>−</button>
            <button type="button" className="sg-step" title="增加槽位" onClick={growFeatSlots}>+</button>
            {char.featSlotOverride !== undefined && (
              <>
                <span className="sg-custom">自定义</span>
                <button type="button" className="sg-restore" title="恢复跟随等级" onClick={restoreFeatOverride}>恢复</button>
              </>
            )}
          </div>
          {blockDetail.feats ? (
            <div className="power-grid">
              {Array.from({ length: featRenderCount }, (_, i) => {
                const id = char.featSlots[i] ?? "";
                const f = id ? featMap.get(id) : undefined;
                if (f) {
                  // 详细模式：专长卡本体已直接展示全部内容，无需再 hover 弹出专长卡；仅保留正文中 [[威能]] 链接的悬浮预览
                  return (
                    <div key={i} className="slot-filled" onClick={() => openFeatPicker(i)} title="点击更换">
                      <EntryCard entry={f} lookup={wikiLookup} />
                      {isHybridTalentFeat(f) && char.featChoices?.[i] && (
                        <div className="feat-choice-label">{char.featChoices[i]}</div>
                      )}
                    </div>
                  );
                }
                return (
                  <button key={i} type="button" className="slot-empty" onClick={() => openFeatPicker(i)}>
                    <span className="material-symbols-outlined">add</span>
                    <span>选择专长</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="compact-list">
              {Array.from({ length: featRenderCount }, (_, i) => {
                const id = char.featSlots[i] ?? "";
                const f = id ? featMap.get(id) : undefined;
                if (f) {
                  return (
                    <div key={i} className="compact-row feat-line" onClick={() => openFeatPicker(i)} title="点击更换">
                      <span className="cr-dot" style={{ background: FEAT_COLOR }} />
                      <span className="cr-name">{f.name}：</span>
                      <span className="cr-sub">{compactFeatText(f)}</span>
                      <IconButton className="slot-x" title="清空槽位" aria-label="清空槽位" onClick={(e) => { e.stopPropagation(); setChar((c) => ({ ...c, featSlots: clearFeatSlot(c.featSlots, i) })); }}><span className="material-symbols-outlined">close</span></IconButton>
                      <div className="compact-pop">
                        <EntryCard entry={f} lookup={wikiLookup} />
                      </div>
                    </div>
                  );
                }
                return (
                  <button key={i} type="button" className="compact-empty" onClick={() => openFeatPicker(i)}>＋ 选择专长</button>
                );
              })}
            </div>
          )}
        </div>
        {(char.classGrantedFeatIds ?? []).length > 0 && (
          <div className="granted-feats">
            <div className="gf-title">奖励专长</div>
            <div className="compact-list">
              {char.classGrantedFeatIds.map((id) => {
                const f = featMap.get(id);
                if (!f) return null;
                return (
                  <div key={id} className="compact-row gf-item feat-line" title="奖励专长（不占用常规专长槽位）">
                    <span className="cr-dot" style={{ background: FEAT_COLOR }} />
                    <span className="cr-name">{f.name}：</span>
                    <span className="cr-sub">{compactFeatText(f)}</span>
                    <div className="compact-pop"><EntryCard entry={f} lookup={wikiLookup} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </>
  );
const rightCol = (
    <>
      {powersCol}
      {rightRest}
    </>
  );

return (
    <div className="sheet">
      {layout === "double" ? (
        <div className="layout-double">
          <div className="layout-top-row">
            <div className="lt-cell">{topCol}</div>
            <div className="lt-cell">{leftTop}</div>
          </div>
          {combatRow}
          <div className="col-left">
            {powersCol}
            {featsCol}
            {skillsCol}
            {raceClassCol}
          </div>
          <div className="col-right">{rightRest}</div>
        </div>
      ) : (
        <>
          {topCol}
          {leftCol}
          {rightCol}
        </>
      )}

      {picker === "class" && (
        <ClassPickerModal
          entries={classes}
          hybrid={!!char.hybrid}
          selectedIds={[char.classId, char.classId2].filter((x): x is string => !!x)}
          onSelect={(ids, isHybrid) => setChar((p) => {
            // 更换职业：移除旧职业授予的威能（随职业走），并清空记录
            const gone = new Set(p.classGrantedPowerIds ?? []);
            const slots = { ...p.powerSlots };
            for (const c of SLOT_CATS) {
              slots[c.key] = slots[c.key].map((id) => (id && gone.has(id) ? "" : id));
            }
            return {
              ...p,
              hybrid: isHybrid,
              classId: ids[0],
              classId2: ids[1],
              classTrainedSkills: [],
              classGrantedPowerIds: [],
              classGrantedFeatIds: [],
              classGrantedRitualIds: [],
              classGrantedRitualSources: {},
              powerSlots: slots,
              powerPoints: hybridPowerPoints({ classId: ids[0], classId2: ids[1], powerSlots: slots }, resolveClassId, resolvePowerId) ?? psionicPowerPoints(ids[0], p.level) ?? p.powerPoints,
            };
          })}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "race" && (
        <PickerModal
          title="选择种族"
          entries={sortedRaces}
          selectedId={char.raceId}
          onSelect={(id) => {
            const race = races.find((x) => x.id === id);
            // 若所选条目本身是亚种（如「金矮人」），自动转为父种族的种族身份并应用对应亚种状态（显示父种族面板）
            const subInfo = race ? parseSubraceInfo(race.sourceText) : undefined;
            const baseRace = subInfo ? races.find((x) => (x.name + " " + (x.nameEn ?? "")).trim() === subInfo.baseRaceName) : undefined;
            if (race && baseRace) {
              const applied: Record<string, boolean> = {};
              for (const b of subInfo!.benefits) applied[b.title] = true;
              setChar({ ...char, raceId: baseRace.id, subraceId: race.id, subraceBenefits: applied, raceSwaps: {}, vision: baseRace?.vision, size: baseRace?.size ?? char.size });
            } else {
              setChar({ ...char, raceId: id, subraceId: undefined, subraceBenefits: {}, raceSwaps: {}, vision: race?.vision, size: race?.size ?? char.size });
            }
            setSubraceOpen(false);
          }}
          onClose={() => setPicker(null)}
          renderSub={(e) => [e.abilityOne, e.abilityTwo, e.size ? "体型 " + e.size : "", e.speed ? "速度 " + e.speed : ""].filter(Boolean).join(" · ")}
          abilityFilter
        />
      )}
      {picker === "paragon" && (
        <PickerModal
          title="选择典范之道"
          entries={paragonPaths}
          selectedId={char.paragonPathId}
          onSelect={(id) => setChar({ ...char, paragonPathId: id })}
          onClear={() => setChar({ ...char, paragonPathId: undefined })}
          onClose={() => setPicker(null)}
          renderSub={(e) => e.prerequisite}
          restrict={{ level: char.level, raceNames: restrictNames.raceNames, classNames: restrictNames.classNames, myNames: restrictNames.myNames }}
        />
      )}
      {picker === "epic" && (
        <PickerModal
          title="选择传奇天命"
          entries={epicDestinies}
          selectedId={char.epicDestinyId}
          onSelect={(id) => setChar({ ...char, epicDestinyId: id })}
          onClear={() => setChar({ ...char, epicDestinyId: undefined })}
          onClose={() => setPicker(null)}
          renderSub={(e) => e.prerequisite}
          restrict={{ level: char.level, raceNames: restrictNames.raceNames, classNames: restrictNames.classNames, myNames: restrictNames.myNames }}
        />
      )}
      {picker === "theme" && (
        <PickerModal
          title="选择主题"
          entries={themes}
          selectedId={char.themeId}
          onSelect={(id) => { applyTheme(id); setPicker(null); }}
          onClear={() => { clearTheme(); setPicker(null); }}
          onClose={() => setPicker(null)}
          renderSub={(e) => "来源 " + e.source}
        />
      )}

      {slotPicker?.kind === "power" && (
        <PowerSlotPicker
          entries={powers}
          relations={relations}
          classEntry={classEntry}
          classEntry2={classEntry2}
          raceEntry={raceEntry}
          category={slotPicker.cat === "atWill" ? "at-will" : slotPicker.cat}
          currentLevel={char.level}
          currentId={char.powerSlots[slotPicker.cat][slotPicker.index] || undefined}
          onSelect={(id) => setChar((p) => {
            const powerSlots = setPowerSlot(p.powerSlots, slotPicker.cat, slotPicker.index, id);
            const rec = slotPicker.cat === "atWill" ? hybridPowerPoints({ ...p, powerSlots }, resolveClassId, resolvePowerId) : undefined;
            return { ...p, powerSlots, ...(rec !== undefined ? { powerPoints: rec } : {}) };
          })}
          onClear={() => setChar((p) => {
            const powerSlots = clearPowerSlot(p.powerSlots, slotPicker.cat, slotPicker.index);
            const rec = slotPicker.cat === "atWill" ? hybridPowerPoints({ ...p, powerSlots }, resolveClassId, resolvePowerId) : undefined;
            return { ...p, powerSlots, ...(rec !== undefined ? { powerPoints: rec } : {}) };
          })}
          onClose={() => setSlotPicker(null)}
        />
      )}
      {slotPicker?.kind === "feat" && (
        <FeatSlotPicker
          entries={feats}
          allRaces={races}
          allClasses={classes}
          currentLevel={char.level}
          currentId={char.featSlots[slotPicker.index] || undefined}
          lookup={wikiLookup}
          onSelect={(id) => {
            const f = featMap.get(id);
            const choice = f ? featChoiceInfo(f) : null;
            const idx = slotPicker.index;
            // 更换专长时，先移除该槽位旧专长赠送的威能
            removeFeatGrantedPowers(idx);
            setChar((p) => {
              const featChoices = { ...p.featChoices };
              delete featChoices[idx]; // 重新选择时清除旧选择
              return { ...p, featSlots: setFeatSlot(p.featSlots, idx, id), featChoices };
            });
            // 混职天赋 Hybrid Talent：不同于武器/法器选择，选项来自角色两个混职职业的「混职天赋选项」，故单独组装
            if (isHybridTalentFeat(f)) {
              const groups = hybridTalentGroups([classEntry, classEntry2], classes);
              if (groups.length > 0) {
                setFeatChoicePicker({ index: idx, featName: f?.name ?? "混职天赋", label: "从你的混职职业中，选择一个混职天赋选项", options: [], hybridGroups: groups });
              }
            }
            if (choice) {
              if (choice.cat === "weapon") {
                const weaponPool = BASE_WEAPONS.filter((w) => choice.options.some((o) => o.name === w.name));
                const categories = ["全部", ...(["简易", "军用", "优异", "双头"] as const).filter((c) => weaponPool.some((w) => (c === "双头" ? w.category.includes("双头") : w.category.startsWith(c))))];
                setFeatChoicePicker({ index: idx, featName: f?.name ?? "", label: choice.label, options: choice.options, weaponPool, categories });
              } else if (choice.cat === "implement") {
                const implementPool = BASE_IMPLEMENTS.filter((im) => choice.options.some((o) => implGroup(im.name) === o.name));
                setFeatChoicePicker({ index: idx, featName: f?.name ?? "", label: choice.label, options: choice.options, implementPool, implTier: choice.implTier });
              } else {
                setFeatChoicePicker({ index: idx, featName: f?.name ?? "", label: choice.label, options: choice.options });
              }
            }
            // 专长赠送/替换威能：替换型弹面板询问填入哪个格子；普通赠送自动加入威能面板
            if (f) {
              const repl = featReplacementInfo(f, wikiLookup);
              if (repl) {
                setReplacementPicker({ index: idx, newPowerId: repl.newPower.id, hint: repl.hint, targetCat: repl.targetCat });
              } else {
                const granted = featGrantedPowers(f, wikiLookup);
                if (granted.length) addFeatGrantedPowers(idx, f, granted);
              }
            }
          }}
          onClear={() => {
            removeFeatGrantedPowers(slotPicker.index);
            setChar((p) => {
              const featChoices = { ...p.featChoices };
              delete featChoices[slotPicker.index];
              return { ...p, featSlots: clearFeatSlot(p.featSlots, slotPicker.index), featChoices };
            });
          }}
          onClose={() => setSlotPicker(null)}
        />
      )}
      {equipPicker && (
        <ItemSlotPicker
          entries={items}
          slotName={equipPicker.kind === "fixed" ? EQUIPMENT_SLOTS[equipPicker.index] ?? "" : equipPicker.kind === "other" ? "其他" : equipPicker.kind === "consumable" ? "消耗品" : "奇物"}
          currentId={equipPicker.kind === "fixed" ? char.equipmentSlots[equipPicker.index] : equipPicker.kind === "other" ? char.otherSlots[equipPicker.index] : equipPicker.kind === "consumable" ? char.consumableSlots[equipPicker.index] : char.wondrousSlots[equipPicker.index]}
          onSelect={(id) => setChar((p) => ({
            ...p,
            equipmentSlots: equipPicker.kind === "fixed" ? setEquipmentSlot(p.equipmentSlots, equipPicker.index, id) : p.equipmentSlots,
            otherSlots: equipPicker.kind === "other" ? setEquipmentSlot(p.otherSlots, equipPicker.index, id) : p.otherSlots,
            consumableSlots: equipPicker.kind === "consumable" ? setEquipmentSlot(p.consumableSlots, equipPicker.index, id) : p.consumableSlots,
            wondrousSlots: equipPicker.kind === "wondrous" ? setEquipmentSlot(p.wondrousSlots, equipPicker.index, id) : p.wondrousSlots,
          }))}
          onClear={() => setChar((p) => ({
            ...p,
            equipmentSlots: equipPicker.kind === "fixed" ? clearEquipmentSlot(p.equipmentSlots, equipPicker.index) : p.equipmentSlots,
            otherSlots: equipPicker.kind === "other" ? clearEquipmentSlot(p.otherSlots, equipPicker.index) : p.otherSlots,
            consumableSlots: equipPicker.kind === "consumable" ? clearEquipmentSlot(p.consumableSlots, equipPicker.index) : p.consumableSlots,
            wondrousSlots: equipPicker.kind === "wondrous" ? clearEquipmentSlot(p.wondrousSlots, equipPicker.index) : p.wondrousSlots,
          }))}
          onClose={() => setEquipPicker(null)}
        />
      )}
      {swapPicker &&
        createPortal(
          <div className="picker-overlay" onClick={() => setSwapPicker(null)}>
            <div className="picker-dialog swap-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="picker-head">
                <span className="picker-title">从{swapPicker.kind === "power" ? "法术书" : "背包"}交换{swapCurId ? "（当前：" + swapCurName + "）" : "（空槽位）"}</span>
                <div className="picker-head-btns">
                  {swapCurId && <button type="button" className="crop-btn" onClick={() => collectToReserve(swapPicker)}>仅收入储备</button>}
                  <button type="button" className="crop-btn" onClick={() => setSwapPicker(null)}>关闭</button>
                </div>
              </div>
              <div className="swap-list">
                {swapList.length === 0 && <p className="hint">储备为空，暂无内容可交换。</p>}
                {swapList.map((it) => {
                  const e = swapPicker.kind === "power" ? powerMap.get(it.id) : itemMap.get(it.id);
                  return (
                    <button key={it.ri} type="button" className="swap-card" title="点击交换进槽位" onClick={() => swapReserveItem(swapPicker, it.ri)}>
                      {e ? <EntryCard entry={e} /> : <span className="swap-card-fallback"><span className="cr-dot" style={{ background: it.color }} />{it.name}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
      {defDetailOpen && (
        <DefenseDetailDialog
          stats={stats}
          acMods={acMods}
          fortMods={fortMods}
          refMods={refMods}
          willMods={willMods}
          classDefSources={classDefSources}
          cls={cls}
          raceDefs={raceDefs}
          acKey={activeAcKey}
          heavyArmor={isHeavyArmor(char)}
          className={classEntry ? cleanDisplayName(classEntry.name) : undefined}
          raceName={raceEntry ? cleanDisplayName(raceEntry.name) : undefined}
          onClose={() => setDefDetailOpen(false)}
        />
      )}
      {abilityDetailOpen && (
        <AbilityDetailDialog
          abilities={char.abilities}
          bonus={bonus}
          effective={effectiveAbilities}
          mods={stats.mods}
          raceName={raceEntry ? cleanDisplayName(raceEntry.name) : undefined}
          onClose={() => setAbilityDetailOpen(false)}
        />
      )}
      {lifeDetailOpen && (
        <LifeDetailDialog
          className={classEntry ? cleanDisplayName(classEntry.name) : undefined}
          maxHpTotal={maxHpTotal}
          bloodiedTotal={bloodiedTotal}
          surgeValueTotal={surgeValueTotal}
          surgesTotal={surgesTotal}
          baseHp={cls?.baseHp ?? 0}
          conScore={char.abilities.con}
          hpPerLevel={cls?.hpPerLevel ?? 0}
          level={char.level}
          conMod={stats.mods.con}
          baseSurges={cls?.surges ?? 0}
          hpBonus={hpBonus}
          surgeBonus={surgeBonus}
          surgeValueBonus={surgeValueBonus}
          onClose={() => setLifeDetailOpen(false)}
        />
      )}
      {speedDetailOpen && (
        <SpeedDetailDialog
          display={speedDisplay}
          baseSpeed={raceEntry?.speed ?? "—"}
          speedMods={char.speedMods}
          primalSpeed={primalPredatorSpeed}
          armorSpeed={equippedArmorSpeedPen}
          onClose={() => setSpeedDetailOpen(false)}
        />
      )}
      {initDetailOpen && (
        <InitiativeDetailDialog
          dexMod={stats.mods.dex}
          halfLevel={stats.halfLevel}
          other={char.initMods.other}
          total={stats.initiative + char.initMods.other}
          onClose={() => setInitDetailOpen(false)}
        />
      )}
      {skillDetailOpen && (
        <SkillDetailDialog
          blocks={skillDetailBlocks}
          onClose={() => setSkillDetailOpen(false)}
        />
      )}
      {alignmentOpen && (
        <SheetDialog
          open
          headline="选择阵营"
          sub={char.alignment ? "当前：" + char.alignment : "未设置"}
          onClose={() => setAlignmentOpen(false)}
          actions={<TextButton onClick={() => { setChar({ ...char, alignment: "" }); setAlignmentOpen(false); }}>清除阵营</TextButton>}
        >
          <div className="align-section">
            <div className="align-section-title">4e 五阵营</div>
            <div className="align-line">
              {FIVE_ALIGNMENTS.map((a) => (
                <button key={a} type="button" className={char.alignment === a ? "preset-item align-item active" : "preset-item align-item"} onClick={() => { setChar({ ...char, alignment: a }); setAlignmentOpen(false); }}>{a}</button>
              ))}
            </div>
          </div>
          <div className="align-section">
            <div className="align-section-title">九阵营</div>
            <div className="align-grid">
              {NINE_ALIGNMENTS.map((a) => (
                <button key={a} type="button" className={char.alignment === a ? "preset-item align-item active" : "preset-item align-item"} onClick={() => { setChar({ ...char, alignment: a }); setAlignmentOpen(false); }}>{a}</button>
              ))}
            </div>
          </div>
        </SheetDialog>
      )}
      {profOpen && (
        <SheetDialog
          open
          headline="擅长"
          sub="职业、种族、专长提供的武器、法器、防具擅长"
          onClose={() => setProfOpen(false)}
        >
          {profSources.length === 0 && hybridProfSources.length === 0 ? (
            <p className="hint">暂无可展示的擅长信息。</p>
          ) : (
            <div className="prof-sources">
              {[...profSources, ...hybridProfSources].map((s) => (
                <div key={s.source} className="prof-source">
                  <div className="prof-source-name">{s.source}</div>
                  {s.groups.map((g) => (
                    <div key={g.cat} className="prof-group">
                      <span className="prof-cat">{g.cat}</span>
                      <span className="prof-items">{g.items.length ? g.items.join("、") : "—"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </SheetDialog>
      )}
      {featChoicePicker && (
        <FeatChoiceDialog
          featName={featChoicePicker.featName}
          label={featChoicePicker.label}
          options={featChoicePicker.options}
          weaponPool={featChoicePicker.weaponPool}
          categories={featChoicePicker.categories}
          implementPool={featChoicePicker.implementPool}
          implTier={featChoicePicker.implTier}
          proficientImplGroups={proficientImplGroups}
          proficientInfos={proficientWeaponInfos}
          current={char.featChoices[featChoicePicker.index]}
          hybridGroups={featChoicePicker.hybridGroups}
          lookup={wikiLookup}
          onChoose={handleFeatChoice}
          onClose={() => setFeatChoicePicker(null)}
        />
      )}
      {replacementPicker && (
        <PowerReplacementDialog
          newPower={powerMap.get(replacementPicker.newPowerId) ?? powers[0]}
          hint={replacementPicker.hint}
          groups={replacementPicker.targetCat ? replSlotGroups.filter((g) => g.key === replacementPicker.targetCat) : replSlotGroups}
          powerOf={(id) => powerMap.get(id)}
          onPick={(cat, index) => fillFeatReplacementSlot(replacementPicker.index, replacementPicker.newPowerId, cat, index)}
          onClose={() => setReplacementPicker(null)}
        />
      )}
      {basePicker && (
        <BasePickerDialog
          kind={basePicker.kind}
          index={basePicker.index}
          baseId={char.baseItems[basePicker.index]}
          proficientInfos={proficientWeaponInfos}
          proficientImplGroups={proficientImplGroups}
          armorTokens={armorTokens}
          shieldTokens={shieldTokens}
          onSelect={(id) => { setChar((p) => ({ ...p, baseItems: { ...p.baseItems, [basePicker.index]: id } })); setBasePicker(null); }}
          onClear={() => { setChar((p) => { const b = { ...p.baseItems }; delete b[basePicker.index]; return { ...p, baseItems: b }; }); setBasePicker(null); }}
          onClose={() => setBasePicker(null)}
        />
      )}
      {autoCostOpen && (
        <SheetDialog open headline="自动花销明细" sub={"合计 " + autoTotal.toLocaleString("zh-CN") + " gp"} onClose={() => setAutoCostOpen(false)}>
          <div className="money-detail-list">
            {autoCosts.map((x) => (
              <div key={x.label} className="money-row"><span>{x.label}</span><span>{x.cost.toLocaleString("zh-CN")} gp</span></div>
            ))}
            {autoCosts.length === 0 && <p className="hint">暂无自动花销</p>}
          </div>
          <div className="money-detail-total">合计：{autoTotal.toLocaleString("zh-CN")} gp</div>
        </SheetDialog>
      )}
      {ritualPickerSlot !== null && (
        <RitualPicker
          entries={rituals}
          kind={ritualKind}
          currentLevel={char.level}
          currentId={char.ritualSlots?.[ritualPickerSlot] || undefined}
          onSelect={(id) => { selectRitualSlot(ritualPickerSlot, id); setRitualPickerSlot(null); }}
          onClear={() => { clearRitualSlotAt(ritualPickerSlot); setRitualPickerSlot(null); }}
          onClose={() => setRitualPickerSlot(null)}
        />
      )}
      {buyPresetOpen && (
        <SheetDialog open headline="快速购点（22 点预设）" onClose={() => setBuyPresetOpen(false)}>
          <div className="preset-sorter" title="拖动按钮调整属性取值顺序">
            {presetOrder.map((k, i) => (
              <button
                key={k}
                type="button"
                draggable
                className={"sorter-chip" + (dragOver === i ? " drag-over" : "")}
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => onSorterDrop(i)}
                onDragEnd={() => { setDragIndex(null); setDragOver(null); }}
              >
                <span className="material-symbols-outlined sorter-grip">drag_indicator</span>
                {ABILITY_LABELS[k].zh}
              </button>
            ))}
          </div>
          <div className="preset-list">
            {BUY_PRESETS.map((p) => (
              <button key={p.label} type="button" className="preset-item" onClick={() => applyPreset(p.values)}>
                <span className="preset-name">{presetOrder.map((k, idx) => ABILITY_LABELS[k].zh + " " + p.values[idx]).join(" · ")}</span>
                <span className="preset-label">{p.label}</span>
                <span className="preset-total">22/22</span>
              </button>
            ))}
          </div>
          <p className="preset-hint">上方按钮允许拖动排序，排序后，点击预设按当前顺序应用至属性，不含种族加值。</p>
        </SheetDialog>
      )}
    </div>
  );
}
