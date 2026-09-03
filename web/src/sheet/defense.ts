// 防御值推导（AC / 强韧 / 反射 / 意志）：装备自动加值 + 职业特性自动加值 + AC 属性替换规则。
// 从 CharacterSheet 抽出，人物页与速览页共用同一份实现，保证两页防御数字永远一致。
import type { Entry } from "../data/types";
import type { AbilityKey, Character, DefenseBonusSource, DefenseKey } from "./character";
import { findBaseItem } from "../lib/baseitems";
import { itemLevels, enhancementBonusForLevel } from "../lib/levelprices";
import { hybridTalentGroups, hybridTalentProfTokens, isHybridTalentFeat, resolveHybridOption } from "../lib/hybrid";

/** 推导所需的词条上下文（人物页与速览页各自加载后传入）。 */
export interface DefenseCtx {
  classEntry?: Entry;
  classEntry2?: Entry;
  classes: Entry[];                 // 混职天赋需要在全部职业里找选项来源
  featMap: Map<string, Entry>;      // 已选专长（混职天赋判定）
  itemMap?: Map<string, Entry>;      // 魔法物品（自动把「增强：」指向的防御计入对应防御加值）
}

export interface DefenseSource {
  value: number;
  source: string;
}

export interface DefenseDerived {
  acMods: Record<DefenseBonusSource, number>;
  fortMods: Record<DefenseBonusSource, number>;
  refMods: Record<DefenseBonusSource, number>;
  willMods: Record<DefenseBonusSource, number>;
  /** 职业特性自动加值明细（详情弹窗逐条标注来源，不混进「其他」手动格） */
  classDefSources: Record<DefenseKey, DefenseSource[]>;
  /** 传给 deriveStats 的最终加值（手动值 + 职业特性自动值） */
  statDefenseMods: Record<DefenseKey, Record<DefenseBonusSource, number>>;
  /** 生效的 AC 属性替换键（无替换时 undefined） */
  acKey?: AbilityKey;
  /** 原力掠食者：未穿重甲时速度 +1 */
  primalPredatorSpeed: number;
}

/** 副手槽(1)或臂部槽(7)装备的盾牌基础物品（臂部也可选盾牌，见 EQUIP_GROUPS）。 */
export function findShieldBase(c: Character): ReturnType<typeof findBaseItem> | undefined {
  for (const idx of [1, 7]) {
    const b = c.baseItems?.[idx] ? findBaseItem(c.baseItems[idx]) : undefined;
    if (b?.kind === "shield") return b;
  }
  return undefined;
}

export function hasShieldBase(c: Character): boolean {
  return !!findShieldBase(c);
}

// 装备自动防御加值：穿着防具/盾牌时，其 AC 加值（及防具对强韧/反射/意志的特殊加值）
// 自动填入对应防御来源单元格，无需手动录入。
export function autoDefenseBonuses(c: Character): Record<DefenseKey, Partial<Record<DefenseBonusSource, number>>> {
  const out: Record<DefenseKey, Partial<Record<DefenseBonusSource, number>>> = { ac: {}, fort: {}, ref: {}, will: {} };
  const armor = c.baseItems?.[5] ? findBaseItem(c.baseItems[5]) : undefined;
  const shield = findShieldBase(c);
  if (armor?.kind === "armor" && armor.armor) {
    out.ac.armor = armor.armor.ac ?? 0;
    const m = /([+-]\d+)\s*(强韧|反射|意志)/.exec(armor.armor.special || "");
    if (m) {
      const key = m[2] === "强韧" ? "fort" : m[2] === "反射" ? "ref" : "will";
      out[key].armor = parseInt(m[1], 10);
    }
  }
  if (shield?.kind === "shield" && shield.shield) {
    out.ac.shield = shield.shield.ac ?? 0;
  }
  return out;
}

// 解析物品正文「增强：」标注的增强适用目标（如 AC / 强韧、反射和意志 / 攻击骰和伤害骰）
function enhanceTargetOf(e: Entry): string {
  const text = String(e.details ?? "")
    .replace(/<<[^>]*>>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, " ")
    .replace(/\s+/g, " ");
  const m = text.match(/增强\s*[：:]\s*(.{0,20}?)(?=\s*(?:特性|威能|重击|特效|辅助威能|攻击威能|辅助|诅咒|$))/);
  return m ? m[1].trim().replace(/[。，、；;]+$/, "") : "";
}

// 魔法物品提供的防御增强加值：遍历装备槽位，按「增强：」指向的防御，把该物品的增强加值计入对应防御。
// 加值取该装备档位对应等级的增强加值；「增强：+N…」的固定增强则直接取 N。
export function magicDefenseEnhance(c: Character, itemMap: Map<string, Entry>): Partial<Record<DefenseKey, number>> {
  const out: Partial<Record<DefenseKey, number>> = {};
  (c.equipmentSlots ?? []).forEach((id, slot) => {
    if (!id) return;
    const e = itemMap.get(id);
    if (!e) return;
    const target = enhanceTargetOf(e);
    if (!target) return;
    let value = 0;
    const fixed = /^[+\+]?\s*(\d+)/.exec(target);
    if (fixed) {
      value = parseInt(fixed[1], 10);
    } else {
      const levels = itemLevels(e.itemLevel);
      if (!levels.length) return;
      const tier = Math.min(c.equipmentEnhance?.[slot] ?? 1, levels.length);
      value = enhancementBonusForLevel(levels[tier - 1]);
    }
    if (value <= 0) return;
    if (target.includes("AC")) out.ac = (out.ac ?? 0) + value;
    if (target.includes("强韧")) out.fort = (out.fort ?? 0) + value;
    if (target.includes("反射")) out.ref = (out.ref ?? 0) + value;
    if (target.includes("意志")) out.will = (out.will ?? 0) + value;
  });
  return out;
}

// 合并手动加值与装备自动加值：防具/盾牌来源以装备为准（装备决定），其余保留手动录入值
export function mergeDefenseMods(
  _k: DefenseKey,
  manual: Record<DefenseBonusSource, number>,
  auto: Partial<Record<DefenseBonusSource, number>>
): Record<DefenseBonusSource, number> {
  return {
    feat: manual.feat ?? 0,
    enhance: auto.enhance ?? manual.enhance ?? 0,
    armor: auto.armor ?? manual.armor ?? 0,
    shield: auto.shield ?? manual.shield ?? 0,
    other: manual.other ?? 0,
  };
}

// 解析当前生效的德鲁伊原力姿态：优先「原力姿态」直接选择（德鲁伊），其次「召唤自然盟友」手动覆盖，
// 最后「德鲁伊集会」派生（保护者：恢复集会→原力守护者、庇护集会→原力掠食者）
export function resolvePrimalAspect(choices: Record<string, string | string[]>, entries: (Entry | undefined)[]): string {
  for (const e of entries) {
    if (!e) continue;
    const direct = choices[e.id + "::原力姿态 Primal Aspect"];
    if (typeof direct === "string" && direct) return direct;
    const override = choices[e.id + "::召唤自然盟友 Summon Natural Ally::aspect"];
    if (typeof override === "string" && override) return override;
    const circle = choices[e.id + "::德鲁伊集会 Druid Circle"];
    if (typeof circle === "string" && circle) {
      if (circle.startsWith("恢复集会")) return "原力守护者 Primal Guardian";
      if (circle.startsWith("庇护集会")) return "原力掠食者 Primal Predator";
    }
  }
  return "";
}

/** 已选的混职天赋选项标题（遍历专长槽位，仅统计「混职天赋」且已做选择的槽位）。 */
export function selectedHybridTalentOptions(char: Character, featMap: Map<string, Entry>): string[] {
  const out: string[] = [];
  char.featSlots.forEach((id, idx) => {
    if (!id) return;
    const f = featMap.get(id);
    if (!f || !isHybridTalentFeat(f)) return;
    const choice = char.featChoices?.[idx];
    if (choice) out.push(String(choice));
  });
  return out;
}

/** 混职天赋选项授予的擅长 token（防具/盾牌/武器）。 */
export function hybridTalentProf(char: Character, ctx: DefenseCtx): { armor: string[]; shield: string[]; weapon: string[] } {
  const groups = hybridTalentGroups([ctx.classEntry, ctx.classEntry2], ctx.classes);
  const armor: string[] = [];
  const shield: string[] = [];
  const weapon: string[] = [];
  for (const title of selectedHybridTalentOptions(char, ctx.featMap)) {
    const r = resolveHybridOption(groups, title);
    if (!r) continue;
    const t = hybridTalentProfTokens(r.body);
    for (const a of t.armor) if (!armor.includes(a)) armor.push(a);
    for (const s of t.shield) if (!shield.includes(s)) shield.push(s);
    for (const w of t.weapon) if (!weapon.includes(w)) weapon.push(w);
  }
  return { armor, shield, weapon };
}

/** 符文牧师「符文艺术」所选流派（愤怒之锤 / 平静之刃）。 */
export function runicArtistry(char: Character, entries: (Entry | undefined)[]): { wrathful: boolean; serene: boolean } {
  let choice = "";
  for (const e of entries) {
    if (!e) continue;
    const v = char.classFeatureChoices[e.id + "::符文艺术 Runic Artistry"];
    if (typeof v === "string" && v) { choice = v; break; }
  }
  return { wrathful: choice.startsWith("愤怒之锤"), serene: choice.startsWith("平静之刃") };
}

function isHeavyArmor(c: Character): boolean {
  const armorBase = c.baseItems?.[5] ? findBaseItem(c.baseItems[5]) : undefined;
  return armorBase?.kind === "armor" && armorBase.armor?.category === "重甲";
}

function clothOrNoArmor(c: Character): boolean {
  const armor = c.baseItems?.[5] ? findBaseItem(c.baseItems[5]) : undefined;
  return !armor || (armor.kind === "armor" && (armor.armor?.name ?? "").includes("布甲"));
}

function classChoice(char: Character, entries: (Entry | undefined)[], key: string): string {
  for (const e of entries) {
    if (!e) continue;
    const v = char.classFeatureChoices[e.id + "::" + key];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

function hasFeature(entries: (Entry | undefined)[], re: RegExp): boolean {
  return entries.some((e) => !!e && re.test(e.sourceText));
}

/** AC 属性替换：守望者/术士/德鲁伊/巡者/符文牧师/混职天赋，均要求未穿重甲。 */
function acAbilityKey(char: Character, ctx: DefenseCtx): AbilityKey | undefined {
  const entries = [ctx.classEntry, ctx.classEntry2];
  const noHeavy = !isHeavyArmor(char);

  // 守望者「守护者之力」：大地之力/风暴之心→体质；野性之血/生命之灵→感知
  const guardian = ctx.classEntry
    ? (typeof char.classFeatureChoices[ctx.classEntry.id + "::守护者之力 Guardian Might"] === "string"
      ? (char.classFeatureChoices[ctx.classEntry.id + "::守护者之力 Guardian Might"] as string)
      : "")
    : "";
  if (guardian && noHeavy) {
    if (guardian.startsWith("大地之力") || guardian.startsWith("风暴之心")) return "con";
    if (guardian.startsWith("野性之血") || guardian.startsWith("生命之灵")) return "wis";
  }

  // 混职天赋选项：正文「当你未穿着重甲时，你可用体质调整值代替敏捷或智力调整值来决定AC」
  const groups = hybridTalentGroups(entries, ctx.classes);
  const hybridCon = selectedHybridTalentOptions(char, ctx.featMap).some((title) => {
    const r = resolveHybridOption(groups, title);
    return !!r && /当你未穿着重甲时.*体质调整值代替敏捷或智力.*AC/.test(r.body);
  });
  if (hybridCon && noHeavy) return "con";

  // 德鲁伊「原力守护者」（选择型）或哨兵固定特性 → 体质
  const primal = resolvePrimalAspect(char.classFeatureChoices, entries);
  const sentinelGuardian = hasFeature(entries, /^!!\s*[^\n]*原力守护者 Primal Guardian/m);
  if ((primal.startsWith("原力守护者") || sentinelGuardian) && noHeavy) return "con";

  // 术士「法术本源」：巨龙魔法/宇宙魔法 → 力量
  const sorcerer = ctx.classEntry
    ? (typeof char.classFeatureChoices[ctx.classEntry.id + "::法术本源 Spell Source"] === "string"
      ? (char.classFeatureChoices[ctx.classEntry.id + "::法术本源 Spell Source"] as string)
      : "")
    : "";
  if (sorcerer && noHeavy && (sorcerer.startsWith("巨龙魔法") || sorcerer.startsWith("宇宙魔法"))) return "str";

  // 巡者「灵魂束约」→ 力量
  if (classChoice(char, entries, "巡者束约 Seeker's Bond").startsWith("灵魂束约") && noHeavy) return "str";

  // 符文牧师「平静之刃」→ 感知
  if (runicArtistry(char, entries).serene && noHeavy) return "wis";

  return undefined;
}

/** 职业特性提供的自动防御加值明细。 */
function classDefenseSources(char: Character, ctx: DefenseCtx): Record<DefenseKey, DefenseSource[]> {
  const entries = [ctx.classEntry, ctx.classEntry2];
  const noHeavy = !isHeavyArmor(char);
  const tierBonus = char.level >= 21 ? 3 : char.level >= 11 ? 2 : 1;

  // 神罚使「信仰甲胄」：布甲/无甲且未用盾牌 → AC +3
  const armorOfFaith = hasFeature(entries, /^!!\s*信仰甲[胄冑]/m) && clothOrNoArmor(char) && !hasShieldBase(char) ? 3 : 0;
  // 野蛮人「蛮族机敏」：未穿重甲 → AC/反射 +1（11级+2、21级+3）
  const barbarianAgility = hasFeature(entries, /^!!\s*蛮族机敏/m) && noHeavy ? tierBonus : 0;
  // 武僧「无甲防御」：布甲/无甲且未用盾牌 → AC +2
  const unarmored = hasFeature(entries, /^!!\s*无甲防御 Unarmored Defense/m) && clothOrNoArmor(char) && !hasShieldBase(char) ? 2 : 0;
  // 剑术剑士「剑法防卫」：持重刃/轻刃 AC +1；单手持剑刃且另一手空 → +3
  const swordmage = (() => {
    if (!hasFeature(entries, /^!!\s*剑法防卫 Swordmage Warding/m)) return 0;
    const main = char.baseItems?.[0] ? findBaseItem(char.baseItems[0]) : undefined;
    if (!main || main.kind !== "weapon" || !main.weapon) return 0;
    if (!main.weapon.group.split(/[，,]/).some((g) => g === "重刃" || g === "轻刃")) return 0;
    const offHand = char.baseItems?.[1] ? findBaseItem(char.baseItems[1]) : undefined;
    if (!offHand && main.weapon.category.includes("·单手")) return 3;
    return 1;
  })();
  // 武僧「修士宗派」：凝息→强韧；石拳→意志
  const monk = classChoice(char, entries, "修士宗派 Monastic Tradition");
  const monkFort = monk.startsWith("凝息") ? tierBonus : 0;
  const monkWill = monk.startsWith("石拳") ? tierBonus : 0;
  // 狂战士「故土」：干燥沙漠（布甲/无甲且无盾）→ AC+3/反射+2；冰川冻土 → 强韧/意志 +1
  const heart = (() => {
    if (!hasFeature(entries, /^!!\s*故土 Heartland/m)) return { ac: 0, fort: 0, ref: 0, will: 0, source: "" };
    const terrain = classChoice(char, entries, "故土 Heartland");
    if (terrain.startsWith("干燥沙漠")) {
      const cond = clothOrNoArmor(char) && !hasShieldBase(char);
      return { ac: cond ? 3 : 0, fort: 0, ref: cond ? 2 : 0, will: 0, source: "故土（" + terrain + "）" };
    }
    if (terrain.startsWith("冰川冻土")) return { ac: 0, fort: 1, ref: 0, will: 1, source: "故土（" + terrain + "）" };
    return { ac: 0, fort: 0, ref: 0, will: 0, source: "" };
  })();

  return {
    ac: [
      { value: armorOfFaith, source: "信仰甲胄" },
      { value: barbarianAgility, source: "蛮族机敏" },
      { value: unarmored, source: "无甲防御" },
      { value: swordmage, source: "剑法防卫" },
      { value: heart.ac, source: heart.source },
    ].filter((s) => s.value !== 0),
    fort: [
      { value: monkFort, source: "修士宗派（凝息）" },
      { value: heart.fort, source: heart.source },
    ].filter((s) => s.value !== 0),
    ref: [
      { value: barbarianAgility, source: "蛮族机敏" },
      { value: heart.ref, source: heart.source },
    ].filter((s) => s.value !== 0),
    will: [
      { value: monkWill, source: "修士宗派（石拳）" },
      { value: heart.will, source: heart.source },
    ].filter((s) => s.value !== 0),
  };
}

/** 防御总推导：装备自动加值 + 手动加值 + 职业特性加值 + AC 属性替换。 */
export function deriveDefenses(char: Character, ctx: DefenseCtx): DefenseDerived {
  const classDefSources = classDefenseSources(char, ctx);
  const total = (def: DefenseKey) => (classDefSources[def] ?? []).reduce((s, x) => s + x.value, 0);
  const autoDef = autoDefenseBonuses(char);
  // 魔法物品（护甲→AC、颈部物品→强韧/反射/意志）提供的增强加值自动计入对应防御的「增强」来源
  const mEnh = ctx.itemMap ? magicDefenseEnhance(char, ctx.itemMap) : {};
  (Object.keys(mEnh) as DefenseKey[]).forEach((k) => {
    autoDef[k].enhance = mEnh[k];
  });
  const acMods = { ...mergeDefenseMods("ac", char.defenseMods.ac, autoDef.ac), other: char.defenseMods.ac.other ?? 0 };
  const fortMods = { ...mergeDefenseMods("fort", char.defenseMods.fort, autoDef.fort), other: char.defenseMods.fort.other ?? 0 };
  const refMods = { ...mergeDefenseMods("ref", char.defenseMods.ref, autoDef.ref), other: char.defenseMods.ref.other ?? 0 };
  const willMods = { ...mergeDefenseMods("will", char.defenseMods.will, autoDef.will), other: char.defenseMods.will.other ?? 0 };
  const primal = resolvePrimalAspect(char.classFeatureChoices, [ctx.classEntry, ctx.classEntry2]);
  return {
    acMods,
    fortMods,
    refMods,
    willMods,
    classDefSources,
    statDefenseMods: {
      ac: { ...acMods, other: acMods.other + total("ac") },
      fort: { ...fortMods, other: fortMods.other + total("fort") },
      ref: { ...refMods, other: refMods.other + total("ref") },
      will: { ...willMods, other: willMods.other + total("will") },
    },
    acKey: acAbilityKey(char, ctx),
    primalPredatorSpeed: primal.startsWith("原力掠食者") && !isHeavyArmor(char) ? 1 : 0,
  };
}
