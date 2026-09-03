// 速览页数据推导：从人物页同一份存档（Character）与词条数据里，算出速览页需要的全部数值。
// 计算口径与人物页保持一致（属性=基础值+种族加值；生命/回复力=职业数据+体质；攻击/伤害=攻击面板同一公式），
// 因此两页显示的数字始终同步，速览页只做「读取 + 消耗记录」，不重复维护第二套数据。
import { useEffect, useMemo, useState } from "react";
import { loadCategory } from "../data/loaders";
import type { Entry } from "../data/types";
import {
  applyAbilityBonus,
  armorPenaltyFor,
  cleanDisplayName,
  deriveStats,
  isHeavyArmor,
  parseClassStats,
  parseRaceDefenses,
  racialBonus,
  parseBuiltinTrainedSkills,
  ABILITY_LABELS,
  ARMOR_PENALTY_SKILLS,
  SKILL_TABLE,
  type AbilityKey,
  type Character,
  type ClassStats,
  type DefenseKey,
} from "../sheet/character";
import { collectProficiencyTokens, isProficient } from "../sheet/proficiency";
import { deriveDefenses } from "../sheet/defense";
import { findBaseItem } from "../lib/baseitems";
import { itemLevels, enhancementBonusForLevel } from "../lib/levelprices";

export interface GlanceAttackLine {
  label: string;   // 这一对攻击/伤害的自定义名称（人物页填写，未填则为空）
  ability: AbilityKey;
  total: number;
}

export interface GlanceDamageLine {
  label: string;
  ability: AbilityKey;
  dice: string;
  total: number;
}

export interface GlanceSkillLine {
  name: string;
  ability: AbilityKey;
  total: number;
  trained: boolean;
}

export interface GlanceDefenseLine {
  key: DefenseKey;
  label: string;
  value: number;
  /** 构成明细（10 + ½等级 + 属性 + 各类加值），用于悬浮说明 */
  parts: { label: string; value: number }[];
}

export interface GlanceData {
  ready: boolean;            // 词条数据是否加载完成（未完成时数值可能仍为占位）
  raceName: string;
  className: string;
  abilities: Record<AbilityKey, number>; // 含种族加值的实际属性值
  mods: Record<AbilityKey, number>;      // 属性调整值
  halfLevel: number;
  maxHp: number;
  bloodied: number;
  surgeValue: number;   // 单次回复力回复量（含人物页手动覆盖）
  surges: number;       // 回复力总次数
  attacks: GlanceAttackLine[];
  damages: GlanceDamageLine[];
  defenses: GlanceDefenseLine[];
  skills: GlanceSkillLine[];
  powerMap: Map<string, Entry>;
  featMap: Map<string, Entry>;
  itemMap: Map<string, Entry>;
  classMap: Map<string, Entry>;
  enhanceOf: (slot: number) => number; // 装备槽位的增强加值（无魔法物品为 0）
}

const EMPTY_CLASS: ClassStats = { baseHp: 0, hpPerLevel: 0, surges: 0, fort: 0, ref: 0, will: 0 };

/** 加载速览页所需的五类词条（loaders 内部有缓存，与人物页共用同一份请求）。 */
export function useGlance(char: Character): GlanceData {
  const [races, setRaces] = useState<Entry[]>([]);
  const [classes, setClasses] = useState<Entry[]>([]);
  const [feats, setFeats] = useState<Entry[]>([]);
  const [items, setItems] = useState<Entry[]>([]);
  const [powers, setPowers] = useState<Entry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const cats: [string, (e: Entry[]) => void][] = [
      ["race", setRaces],
      ["class", setClasses],
      ["feat", setFeats],
      ["equipment", setItems],
      ["power", setPowers],
    ];
    void Promise.all(
      cats.map(([cat, set]) =>
        loadCategory(cat)
          .then((list) => {
            if (alive) set(list);
          })
          .catch(console.error)
      )
    ).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const powerMap = useMemo(() => new Map(powers.map((p) => [p.id, p])), [powers]);
  const featMap = useMemo(() => new Map(feats.map((f) => [f.id, f])), [feats]);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  return useMemo(() => {
    const raceEntry = races.find((r) => r.id === char.raceId);
    const classEntry = classes.find((c) => c.id === char.classId);
    const classEntry2 = char.hybrid ? classes.find((c) => c.id === char.classId2) : undefined;

    // 属性：基础值 + 种族加值（与人物页 effectiveAbilities 同口径）
    const abilities = applyAbilityBonus(char.abilities, racialBonus(raceEntry, char.raceAbility2Choice));
    // 职业数据：混职时两个职业的生命/回复力/防御加值相加（与人物页一致）
    const cls: ClassStats | undefined = classEntry
      ? (() => {
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
        })()
      : undefined;
    // 防御：与人物页共用 defense.ts（装备自动加值 + 职业特性加值 + AC 属性替换）
    const raceDefs = parseRaceDefenses(raceEntry?.sourceText ?? "");
    const defense = deriveDefenses(char, { classEntry, classEntry2, classes, featMap, itemMap });
    const stats = deriveStats(
      { ...char, abilities, defenseMods: defense.statDefenseMods },
      cls ?? EMPTY_CLASS,
      raceDefs,
      defense.acKey
    );
    // 防御构成明细：10 + ½等级 + 关联属性 + 职业/种族/装备各类加值
    const modSum = (k: DefenseKey) => {
      const m = defense.statDefenseMods[k];
      return m.feat + m.enhance + m.armor + m.shield + m.other;
    };
    const bestOf = (...keys: AbilityKey[]) => {
      let best = keys[0];
      for (const k of keys) if (stats.mods[k] > stats.mods[best]) best = k;
      return best;
    };
    const acAbility = defense.acKey ? bestOf(defense.acKey, "dex", "int") : bestOf("dex", "int");
    // 数值直接取 deriveStats 的结果（与人物页同一函数），parts 仅用于展示构成
    const defLine = (key: DefenseKey, label: string, ability: AbilityKey, classBonus: number, raceBonus: number): GlanceDefenseLine => ({
      key,
      label,
      value: stats[key],
      parts: [
        { label: "基础", value: 10 },
        { label: "½等级", value: stats.halfLevel },
        ...(key === "ac" && isHeavyArmor(char)
          ? []
          : [{ label: ABILITY_LABELS[ability].zh, value: stats.mods[ability] }]),
        ...(classBonus ? [{ label: "职业", value: classBonus }] : []),
        ...(raceBonus ? [{ label: "种族", value: raceBonus }] : []),
        ...(modSum(key) ? [{ label: "装备与其他", value: modSum(key) }] : []),
      ],
    });
    const defenses: GlanceDefenseLine[] = [
      defLine("ac", "AC", acAbility, 0, 0),
      defLine("fort", "强韧", bestOf("str", "con"), cls?.fort ?? 0, raceDefs.fort ?? 0),
      defLine("ref", "反射", bestOf("dex", "int"), cls?.ref ?? 0, raceDefs.ref ?? 0),
      defLine("will", "意志", bestOf("wis", "cha"), cls?.will ?? 0, raceDefs.will ?? 0),
    ];

    const maxHp = stats.maxHp + (char.hpBonus ?? 0);
    const bloodied = Math.floor(maxHp / 2);
    const surgeValueAuto = Math.floor(maxHp / 4) + (char.surgeValueBonus ?? 0);
    // 人物页允许手动改写回复值/回复力，速览页照单全收，避免两页数字打架
    const surgeValue = char.hpNow?.surgeValue ?? surgeValueAuto;
    const surges = stats.surges + (char.surgeBonus ?? 0);

    // —— 攻击/伤害：与攻击面板同一套自动取值 ——
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
    const diceOf = (slot: number): string => {
      const baseId = char.baseItems[slot];
      const base = baseId ? findBaseItem(baseId) : undefined;
      return base?.kind === "weapon" ? base.weapon?.dice ?? "" : "";
    };
    const profTokens = collectProficiencyTokens({
      classText: classEntry?.sourceText,
      classText2: classEntry2?.sourceText,
      raceText: raceEntry?.sourceText,
      featNames: [
        ...char.featSlots.map((id) => featMap.get(id)?.name ?? ""),
        ...(char.classGrantedFeatIds ?? []).map((id) => featMap.get(id)?.name ?? ""),
      ],
      featChoiceTokens: Object.values(char.featChoices ?? {}).map((v) => String(v).split(/\s/)[0]),
    });
    const profOf = (slot: number, override: boolean): number => {
      const baseId = char.baseItems[slot];
      const base = baseId ? findBaseItem(baseId) : undefined;
      if (base?.kind !== "weapon" || !base.weapon) return 0;
      return override || isProficient(base.weapon, profTokens) ? base.weapon.prof : 0;
    };

    const attacks: GlanceAttackLine[] = char.combatMods.attacks.map((r) => {
      const slot = (r.enhanceSlot ?? 0) >= 0 ? r.enhanceSlot ?? 0 : 0;
      const profSlot = (r.profSlot ?? 0) >= 0 ? r.profSlot ?? 0 : 0;
      return {
        label: (r.label ?? "").trim(),
        ability: r.ability,
        total:
          stats.halfLevel +
          stats.mods[r.ability] +
          r.classBonus +
          profOf(profSlot, !!r.profOverride) +
          r.feat +
          enhanceOf(slot) +
          r.other,
      };
    });
    const damages: GlanceDamageLine[] = char.combatMods.damages.map((r, i) => {
      const slot = (r.enhanceSlot ?? 0) >= 0 ? r.enhanceSlot ?? 0 : 0;
      return {
        label: (char.combatMods.attacks[i]?.label ?? "").trim(),
        ability: r.ability,
        dice: diceOf(slot),
        total: stats.mods[r.ability] + r.feat + enhanceOf(slot) + r.otherA + r.otherB,
      };
    });

    // —— 技能：与人物页技能面板同一公式（½等级 + 属性 + 受训5 + 技能巧手 + 种族/其他 − 护甲减值） ——
    const classAutoTrained = [
      ...(classEntry ? parseBuiltinTrainedSkills(classEntry.sourceText) : []),
      ...(classEntry2 ? parseBuiltinTrainedSkills(classEntry2.sourceText) : []),
    ];
    const trainedSet = new Set([...char.trainedSkills, ...classAutoTrained, ...(char.classTrainedSkills ?? [])]);
    const skillVersatile = [classEntry, classEntry2].some((e) => !!e && /^!!\s*技能巧手 Skill Versatility/m.test(e.sourceText));
    const armorBase = char.baseItems?.[5] ? findBaseItem(char.baseItems[5]) : undefined;
    const armorPen = Math.abs(armorPenaltyFor(armorBase?.kind === "armor" ? armorBase.armor?.name : undefined));
    const skills: GlanceSkillLine[] = SKILL_TABLE.map((s) => {
      const trained = trainedSet.has(s.name);
      const sm = char.skillMods[s.name] ?? { race: 0, other: 0, armor: 0 };
      return {
        name: s.name,
        ability: s.ability,
        trained,
        total:
          stats.mods[s.ability] +
          stats.halfLevel +
          (trained ? 5 : 0) +
          (skillVersatile && !trained ? 1 : 0) +
          sm.race +
          sm.other -
          (ARMOR_PENALTY_SKILLS.has(s.name) ? armorPen : 0),
      };
    });

    const classNames = [classEntry, classEntry2].filter((c): c is Entry => !!c).map((c) => cleanDisplayName(c.name));

    return {
      ready,
      raceName: raceEntry ? cleanDisplayName(raceEntry.name) : "",
      className: char.hybrid && classNames.length ? "混职：" + classNames.join(" / ") : classNames[0] ?? "",
      abilities,
      mods: stats.mods,
      halfLevel: stats.halfLevel,
      maxHp,
      bloodied,
      surgeValue,
      surges,
      attacks,
      damages,
      defenses,
      skills,
      powerMap,
      featMap,
      itemMap,
      classMap,
      enhanceOf,
    };
  }, [char, races, classes, powerMap, featMap, itemMap, classMap, ready]);
}