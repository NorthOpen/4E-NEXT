import { findBaseItem, BASE_ARMORS } from "../lib/baseitems";

export type AbilityKey = "str" | "con" | "dex" | "int" | "wis" | "cha";

// 4E 标准技能表（名称 → 关联属性）
export const SKILL_TABLE: { name: string; ability: AbilityKey }[] = [
  { name: "运动", ability: "str" },
  { name: "坚韧", ability: "con" },
  { name: "杂技", ability: "dex" },
  { name: "隐秘", ability: "dex" },
  { name: "盗术", ability: "dex" },
  { name: "神秘", ability: "int" },
  { name: "历史", ability: "int" },
  { name: "宗教", ability: "int" },
  { name: "地城", ability: "wis" },
  { name: "医疗", ability: "wis" },
  { name: "洞察", ability: "wis" },
  { name: "自然", ability: "wis" },
  { name: "侦查", ability: "wis" },
  { name: "唬骗", ability: "cha" },
  { name: "交涉", ability: "cha" },
  { name: "威吓", ability: "cha" },
  { name: "市井", ability: "cha" },
];

// 受盔甲减值影响的技能
export const ARMOR_PENALTY_SKILLS = new Set(["运动", "坚韧", "杂技", "隐秘", "盗术"]);

// 基础护甲的「检定」/「速度」减值来自护甲表同名列（基于力量/敏捷/体质的技能检定；速度由重甲给出），
// 由名称精确匹配 BASE_ARMORS 数据（未装备或未知甲种时返回 0）。
/** 由基础护甲名推导护甲检定减值（技能面板用）。 */
export function armorPenaltyFor(name: string | undefined): number {
  if (!name) return 0;
  const a = BASE_ARMORS.find((x) => x.name === name);
  return a ? a.check : 0;
}

export type SkillMods = Record<string, { race: number; other: number; armor: number }>;

export function emptySkillMods(): SkillMods {
  const out: SkillMods = {};
  for (const s of SKILL_TABLE) out[s.name] = { race: 0, other: 0, armor: 0 };
  return out;
}

export const ABILITY_LABELS: Record<AbilityKey, { zh: string; en: string }> = {
  str: { zh: "力量", en: "Str" },
  con: { zh: "体质", en: "Con" },
  dex: { zh: "敏捷", en: "Dex" },
  int: { zh: "智力", en: "Int" },
  wis: { zh: "感知", en: "Wis" },
  cha: { zh: "魅力", en: "Cha" },
};

export interface PowerSlots {
  atWill: string[];
  encounter: string[];
  daily: string[];
  utility: string[];
  special: string[];
}

// 归一化加成结构：缺省的子字段补 0，避免求和时出现 undefined→NaN
// （旧存档/导入文件可能存了空对象 {} 作为 defenseMods/initMods 等，仅顶层 ?? 判断无法兜底）
function normDefenseMods(m: DefenseMods): DefenseMods {
  const out = emptyDefenseMods();
  for (const k of DEFENSE_BONUS_SOURCES) {
    out.ac[k] = m.ac?.[k] ?? 0;
    out.fort[k] = m.fort?.[k] ?? 0;
    out.ref[k] = m.ref?.[k] ?? 0;
    out.will[k] = m.will?.[k] ?? 0;
  }
  return out;
}
function normSpeedMods(m: SpeedMods): SpeedMods {
  return { power: m.power ?? 0, feat: m.feat ?? 0, item: m.item ?? 0, other: m.other ?? 0 };
}
function normInitMods(m: InitMods): InitMods {
  return { other: m.other ?? 0 };
}
function normSkillMods(m: SkillMods): SkillMods {
  const out = emptySkillMods();
  for (const s of SKILL_TABLE) {
    const e = m[s.name];
    out[s.name] = { race: e?.race ?? 0, other: e?.other ?? 0, armor: e?.armor ?? 0 };
  }
  return out;
}

// 迁移旧存档：补齐新增字段（localStorage 中旧版本保存的角色缺少这些字段）
export function migrateCharacter(c: Partial<Character>): Character {
  const base = { ...defaultCharacter(), ...(c as Character) };
  return {
    ...base,
    portraitOriginal: (base as { portraitOriginal?: string | null }).portraitOriginal ?? null,
    portraitCropped: (base as { portraitCropped?: string | null }).portraitCropped ?? null,
    defenseMods: normDefenseMods(base.defenseMods ?? emptyDefenseMods()),
    speedMods: normSpeedMods(base.speedMods ?? emptySpeedMods()),
    initMods: normInitMods(base.initMods ?? emptyInitMods()),
    skillMods: normSkillMods(base.skillMods ?? emptySkillMods()),
    combatMods: (() => {
      const c = base.combatMods ?? emptyCombatMods();
      // 旧存档可能把增强来源存为 -1（手动），现已删除手动，统一按 0（主手）处理
      const normAttack = (r: AttackRowData): AttackRowData => ({ ...r, enhanceSlot: (r.enhanceSlot ?? -1) >= 0 ? r.enhanceSlot : 0, profSlot: (r.profSlot ?? -1) >= 0 ? r.profSlot : 0, profOverride: r.profOverride ?? false });
      const normDamage = (r: DamageRowData): DamageRowData => ({ ...r, enhanceSlot: (r.enhanceSlot ?? -1) >= 0 ? r.enhanceSlot : 0 });
      const attacks = trimBlankRows((c.attacks ?? []).map(normAttack), isBlankAttack);
      const damages = trimBlankRows((c.damages ?? []).map(normDamage), isBlankDamage);
      // 存档中数组为空时，补回各一行的默认计算单元格（否则面板只有表头、无可计算单元格）；默认属性取角色最高属性
      const fallback = emptyCombatMods(highestAbilityKey(base.abilities ?? {}));
      const atk = attacks.length > 0 ? attacks : fallback.attacks;
      const dmg = damages.length > 0 ? damages : fallback.damages;
      // 攻击与伤害现在成对增减：旧存档两边行数可能不等，按较多的一边补齐，保证 index 一一对应
      const pairs = Math.max(atk.length, dmg.length);
      while (atk.length < pairs) atk.push({ ...fallback.attacks[0] });
      while (dmg.length < pairs) dmg.push({ ...fallback.damages[0] });
      return { attacks: atk, damages: dmg };
    })(),
    baseItems: (base as { baseItems?: Record<number, string> }).baseItems ?? {},
    powerSlots: {
      atWill: base.powerSlots?.atWill ?? [],
      encounter: base.powerSlots?.encounter ?? [],
      daily: base.powerSlots?.daily ?? [],
      utility: base.powerSlots?.utility ?? [],
      special: base.powerSlots?.special ?? ["", ""],
    },
    featSlots: base.featSlots ?? [],
    featChoices: (base as { featChoices?: Record<number, string> }).featChoices ?? {},
    classFeatureChoices: (base as { classFeatureChoices?: Record<string, string> }).classFeatureChoices ?? {},
    equipmentSlots: (base.equipmentSlots ?? []).slice(0, 12), // 原下标 12（奇物）已迁移至 wondrousSlots
    adventureItems: base.adventureItems && base.adventureItems.length ? base.adventureItems.map((x) => (typeof x === "string" ? { name: x, cost: 0 } : (x as { name: string; cost: number }))) : [{ name: "", cost: 0 }, { name: "", cost: 0 }],
    money: base.money ?? { earned: 0, spent: 0 },
    equipmentEnhance: base.equipmentEnhance ?? {},
    otherSlots: base.otherSlots ?? [],
    consumableSlots: base.consumableSlots ?? [],
    wondrousSlots: (() => {
      const fromField = (base as { wondrousSlots?: (string | undefined)[] }).wondrousSlots ?? [];
      if (fromField.length) return fromField;
      const old = (base.equipmentSlots ?? [])[12];
      return old ? [old] : [];
    })(),
    trainedSkills: base.trainedSkills ?? [],
  classTrainedSkills: (base as { classTrainedSkills?: string[] }).classTrainedSkills ?? [],
    // 职业特性授予、已加入威能面板的威能 id（更换职业时据此从威能面板移除）
    classGrantedPowerIds: (base as { classGrantedPowerIds?: string[] }).classGrantedPowerIds ?? [],
    // 种族授予、已加入威能面板的辅助威能 id（更换种族时据此从威能面板移除）
    raceGrantedPowerIds: (base as { raceGrantedPowerIds?: string[] }).raceGrantedPowerIds ?? [],
    // 种族特性自动授予的威能 id（特性内 [[威能]]，随基础替代/亚种增益切换变化）
    raceAutoGrantedPowerIds: (base as { raceAutoGrantedPowerIds?: string[] }).raceAutoGrantedPowerIds ?? [],
    // 职业赠送专长 id（不占用常规专长槽位，更换职业时据此清除）
    classGrantedFeatIds: (base as { classGrantedFeatIds?: string[] }).classGrantedFeatIds ?? [],
    // 仪式槽位与职业赠送仪式（不占用常规仪式槽位，更换职业时据此清除）
    ritualSlots: (base as { ritualSlots?: (string | undefined)[] }).ritualSlots ?? [],
    ritualSlotOverride: (base as { ritualSlotOverride?: number }).ritualSlotOverride,
    classGrantedRitualIds: (base as { classGrantedRitualIds?: string[] }).classGrantedRitualIds ?? [],
    classGrantedRitualSources: (base as { classGrantedRitualSources?: Record<string, string> }).classGrantedRitualSources ?? {},
    // 专长赠送威能记录（旧存档缺省为空对象）
    featGrantedPowerIds: (base as { featGrantedPowerIds?: Record<number, string[]> }).featGrantedPowerIds ?? {},
    languages: base.languages && base.languages.length ? base.languages : [""],
    actionPoints: base.actionPoints ?? 1,
    creation: base.creation ?? {
      personality: "",
      concept: "",
      background: (base as { background?: string }).background ?? "",
      notes: "",
    },
    hpNow: base.hpNow ?? {},
    hpBonus: base.hpBonus ?? 0,
    surgeBonus: base.surgeBonus ?? 0,
    surgeValueBonus: base.surgeValueBonus ?? 0,
    tempHp: base.tempHp ?? 0,
    spellbook: base.spellbook ?? [],
    backpack: base.backpack ?? [],
    powerUsed: base.powerUsed ?? {},
    equipmentUsed: base.equipmentUsed ?? {},
    featUsed: base.featUsed ?? {},
    milestones: base.milestones ?? 0,
    powerPoints: base.powerPoints ?? 0,
    // 旧存档没有 glance / 字段结构变过（defTemp 由数字改为四防对象）：统一走归一化
    glance: normGlance(base.glance),
  };
}

export interface Character {
  name: string;
  portraitOriginal?: string | null; // 立绘原图（随人物卡存储；已压缩，不随设置导出）
  portraitCropped?: string | null;  // 立绘裁切图（随人物卡存储）
  level: number;
  abilities: Record<AbilityKey, number>;
  defenseMods: DefenseMods;
  speedMods: SpeedMods;
  initMods: InitMods;
  skillMods: SkillMods;
  combatMods: CombatMods;
  raceId?: string;
  raceAbility2Choice?: AbilityKey;
  subraceId?: string; // 所选亚种 id（如「金矮人」），无则为基础种族
  subraceBenefits?: Record<string, boolean>; // 已应用的亚种增益（键 = 增益名）
  raceSwaps?: Record<string, boolean>; // 基础种族内部可替代特性的选择（键 = 替代特性名，如「龙惧」）
  classId?: string;
  classId2?: string;
  hybrid?: boolean;
  paragonPathId?: string;
  epicDestinyId?: string;
  xp?: string;
  gender?: string;
  age?: string;
  size?: string;
  vision?: string;
  height?: string;
  weight?: string;
  alignment?: string;
  faith?: string;
  organization?: string;
  powerSlots: PowerSlots;
  powerSlotOverrides?: Partial<Record<keyof PowerSlots, number>>;
  featSlots: string[];
  featSlotOverride?: number;
  featChoices: Record<number, string>; // 选择型专长的具体选择（键 = 专长槽位下标，值 = 所选内容如「长剑 Longsword」或「法珠」）
  classFeatureChoices: Record<string, string | string[]>; // 职业特性「选择一个」的选项（键 = "职业ID::特性标题"，值 = 所选选项名；多选型如戏法为字符串数组）
  equipmentSlots: (string | undefined)[];
  adventureItems: { name: string; cost: number }[];
  money: { earned: number; spent: number };
  equipmentEnhance: Record<number, number>;
  baseItems: Record<number, string>;
  otherSlots: (string | undefined)[];
  consumableSlots: (string | undefined)[];
  wondrousSlots: (string | undefined)[];
  trainedSkills: string[];
  classTrainedSkills: string[]; // 职业选择型受训技能（用户从职业技能列表点选，更换职业时清除）
  // 职业特性授予、已加入威能面板的威能 id（更换职业时据此从威能面板移除，实现威能随职业走）
  classGrantedPowerIds: string[];
  // 种族授予、已加入威能面板的辅助威能 id（更换种族时据此从威能面板移除）
  raceGrantedPowerIds: string[];
  // 种族特性自动授予的威能 id（特性内 [[威能]]，随基础替代/亚种增益切换变化；区别于手动选择的辅助威能）
  raceAutoGrantedPowerIds: string[];
  // 职业赠送专长 id（如德鲁伊/神导士的「仪式施法者」奖励专长；不占用常规专长槽位）
  classGrantedFeatIds: string[];
  // 仪式槽位（默认随角色等级，可手动覆盖数量）
  ritualSlots: (string | undefined)[];
  ritualSlotOverride?: number; // 仪式槽位数覆盖（undefined = 随等级）
  classGrantedRitualIds: string[]; // 职业赠送仪式 id（不占用常规仪式槽位，更换职业时据此清除）
  classGrantedRitualSources: Record<string, string>; // 赠送仪式 id → 来源职业特性名
  // 主题（Theme）：所选主题 id 与已加入威能面板的威能 id（起始特性赠送 + 被点选的可选威能；更换/清除主题时据此移除）
  themeId?: string;
  themeGrantedPowerIds: string[];
  // 专长槽位下标 → 该专长赠送的威能 id（选择专长自动加入威能面板；清空/更换专长时据此移除）
  featGrantedPowerIds: Record<number, string[]>;
  languages: string[];
  actionPoints: number;
  creation: CharacterCreation;
  // 生命：当前值（斜杠前，未填则回退自动总值）
  hpNow: Partial<Record<"max" | "bloodied" | "surgeValue" | "surges", number>>;
  hpBonus: number; // 额外生命值
  surgeBonus: number; // 额外回复力（次数）
  surgeValueBonus: number; // 额外回复值
  tempHp: number; // 临时生命值
  // 储备页：法术书（威能槽）与背包（装备槽）
  spellbook: string[];
  backpack: string[];
  // 使用标记：斜线遮罩（键 = "atWill-0" / "e-5" / "o-1" / "c-2"）
  powerUsed: Record<string, boolean>;
  equipmentUsed: Record<string, boolean>;
  // 专长使用标记（速览页，键 = 专长槽位下标 / 职业赠送专长 "g-<id>"）
  featUsed: Record<string, boolean>;
  milestones: number; // 里程碑记录
  powerPoints: number; // 灵能点
  glance: GlanceState; // 速览页临时追踪状态
}

// 人物创建：四个 Markdown 栏位
export interface CharacterCreation {
  personality: string; // 性格外貌
  concept: string;     // 人物设定
  background: string;  // 背景/主体奖励
  notes: string;       // 冒险笔记
}

export const CREATION_FIELDS: { key: keyof CharacterCreation; label: string; placeholder: string }[] = [
  { key: "personality", label: "性格外貌", placeholder: "外貌、性格、习惯、标志性物品……（支持 Markdown）" },
  { key: "concept", label: "人物设定", placeholder: "身份来历、动机目标、人际关系……（支持 Markdown）" },
  { key: "background", label: "背景/主体奖励", placeholder: "背景奖励、主题奖励、专长奖励……（支持 Markdown）" },
  { key: "notes", label: "冒险笔记", placeholder: "记录冒险历程、战役进度……（支持 Markdown）" },
];

// —— 速览页：一场游戏内的临时追踪状态（随人物卡存档，长休归零） ——
export interface GlanceState {
  atkTemp: number;       // 攻击临时加值（祝福/援护等，短时效果）
  dmgTemp: number;       // 伤害临时加值
  defTemp: Record<DefenseKey, number>; // 各防御的临时加值（掩蔽只加 AC/反射、回气加全部，需分别记）
  surgeTemp: number;     // 临时回复值加值（每次花回复力额外回复的生命值）
  itemDailyUsed: number; // 本日已使用的魔法物品每日威能次数
  secondWind: boolean;   // 本次遭遇是否已用过回气（Second Wind）
  deathFails: number;    // 死亡豁免失败次数（0-3）
}

export function emptyGlance(): GlanceState {
  return { atkTemp: 0, dmgTemp: 0, defTemp: { ac: 0, fort: 0, ref: 0, will: 0 }, surgeTemp: 0, itemDailyUsed: 0, secondWind: false, deathFails: 0 };
}

/** 归一化速览状态：旧存档的 defTemp 曾是单个「全防御」数字，这里摊到四防上，避免读出非对象值。 */
export function normGlance(raw: Partial<GlanceState> | undefined): GlanceState {
  const base = emptyGlance();
  if (!raw) return base;
  const dt: unknown = (raw as { defTemp?: unknown }).defTemp;
  const defTemp =
    typeof dt === "number"
      ? { ac: dt, fort: dt, ref: dt, will: dt }
      : { ...base.defTemp, ...((dt as Partial<Record<DefenseKey, number>>) ?? {}) };
  return { ...base, ...raw, defTemp };
}

export function defaultCharacter(): Character {
  // 购点法起始数组 10 10 10 10 10 8：8 落在随机一项属性上（每张新卡不同）
  const lowKey = ABILITY_KEYS[Math.floor(Math.random() * ABILITY_KEYS.length)];
  const abilities = { str: 10, con: 10, dex: 10, int: 10, wis: 10, cha: 10, [lowKey]: 8 } as Record<AbilityKey, number>;
  return {
    name: "未命名角色",
    portraitOriginal: null,
    portraitCropped: null,
    level: 1,
    abilities,
    xp: "",
    subraceId: undefined,
    subraceBenefits: {},
    gender: "",
    age: "",
    size: "",
    height: "",
    weight: "",
    alignment: "",
    faith: "",
    organization: "",
    powerSlots: { atWill: [], encounter: [], daily: [], utility: [], special: ["", ""] },
    defenseMods: emptyDefenseMods(),
    speedMods: emptySpeedMods(),
    initMods: emptyInitMods(),
    skillMods: emptySkillMods(),
    combatMods: emptyCombatMods(highestAbilityKey(abilities)),
    featSlots: [],
    featChoices: {},
    classFeatureChoices: {},
    equipmentSlots: [],
    adventureItems: [{ name: "", cost: 0 }, { name: "", cost: 0 }],
    money: { earned: 0, spent: 0 },
    equipmentEnhance: {},
    baseItems: {},
    otherSlots: [],
    consumableSlots: [],
    wondrousSlots: [],
    trainedSkills: [],
    classTrainedSkills: [],
    classGrantedPowerIds: [],
    raceGrantedPowerIds: [],
    raceAutoGrantedPowerIds: [],
    classGrantedFeatIds: [],
    ritualSlots: [],
    classGrantedRitualIds: [],
    classGrantedRitualSources: {},
    themeId: undefined,
    themeGrantedPowerIds: [],
    featGrantedPowerIds: {},
    languages: [""],
    actionPoints: 1,
    creation: { personality: "", concept: "", background: "", notes: "" },
    hpNow: {},
    hpBonus: 0,
    surgeBonus: 0,
    surgeValueBonus: 0,
    tempHp: 0,
    spellbook: [],
    backpack: [],
    powerUsed: {},
    equipmentUsed: {},
    featUsed: {},
    milestones: 0,
    powerPoints: 0,
    glance: emptyGlance(),
  };
}

export function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function flattenPowerSlots(slots: PowerSlots): string[] {
  return [...slots.atWill, ...slots.encounter, ...slots.daily, ...slots.utility];
}

// 职业特性授予的威能应进哪个威能面板空位：
// - 特性/种族/专长/套装类威能（powerKind=feature/racial/feat/item-set）→ 种族/职业威能（不占用标准空位）
// - 辅助威能 → 辅助空位；随意/遭遇/每日攻击 → 对应标准空位（占用标准空位）
// - 无法判定的其他类型 → 归入种族/职业威能（视为额外威能）
export function grantedPowerCategory(usage?: string, powerKind?: string): keyof PowerSlots | undefined {
  if (powerKind === "racial" || powerKind === "feat" || powerKind === "feature" || powerKind === "item-set") return "special";
  if (powerKind === "utility") return "utility";
  if (usage === "at-will") return "atWill";
  if (usage === "encounter") return "encounter";
  if (usage === "daily") return "daily";
  return "special";
}

// 威能名尾缀 → 槽位归类（自设/homebrew 威能常用「攻击N/辅助N」编码等级与频率）：
// - 攻击1 → 随意(atWill)；攻击N(N∈遭遇级) → 遭遇；攻击N(N∈每日级) → 每日
// - 辅助N → 辅助(utility)
// 用于种族/职业/专长赠送威能时，优先按名称尾缀决定落入哪个威能面板空位。
export const ENCOUNTER_POWER_LEVELS = new Set([3, 7, 11, 13, 17, 23, 27]);
export const DAILY_POWER_LEVELS = new Set([5, 9, 15, 19, 20, 25, 29]);
export function powerNameSlot(name?: string): keyof PowerSlots | undefined {
  if (!name) return undefined;
  let m = name.match(/(?:^|\s)攻击(\d+)\s*$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n === 1) return "atWill";
    if (ENCOUNTER_POWER_LEVELS.has(n)) return "encounter";
    if (DAILY_POWER_LEVELS.has(n)) return "daily";
    return undefined;
  }
  m = name.match(/(?:^|\s)辅助(\d+)\s*$/);
  if (m) return "utility";
  return undefined;
}

// 各频率「等级槽位」获得的角色等级（官方升级表；用于推导每个空位应填充的威能等级）
export const ENCOUNTER_SLOT_LEVELS = [1, 3, 7, 13, 17, 23, 27];
export const DAILY_SLOT_LEVELS = [1, 5, 9, 15, 19, 25, 29];
export const UTILITY_SLOT_LEVELS = [2, 6, 10, 16, 22];
// 典范/传奇槽位对应的具体威能等级（典范遭遇=11、典范每日=20、典范辅助=12、传奇辅助=26；随意无典范/传奇）
export const PARAGON_SLOT_LEVELS = { atWill: 1, encounter: 11, daily: 20, utility: 12 } as const;
export const LEGENDARY_SLOT_LEVEL = 26;
// 槽位等级：数字 = 具体等级；"paragon"/"legendary" = 典范/传奇槽位（无等级数字）
export type SlotLevel = number | "paragon" | "legendary";

// 授予威能应落入哪个槽位：优先按名称尾缀，否则回退到 usage/powerKind 规则。
// 种族/职业/专长赠送的辅助威能（如牧师「治愈真言」）不占 2/6/10/… 标准辅助槽位，一律送入「种族/职业威能」。
export function grantedPowerSlot(usage?: string, powerKind?: string, name?: string): keyof PowerSlots {
  const fromName = powerNameSlot(name);
  if (fromName === "utility") return "special";
  if (fromName) return fromName;
  const cat = grantedPowerCategory(usage, powerKind);
  if (cat === "utility") return "special";
  return cat ?? "special";
}

export function setPowerSlot(slots: PowerSlots, cat: keyof PowerSlots, index: number, id: string): PowerSlots {
  const arr = [...slots[cat]];
  while (arr.length <= index) arr.push("");
  arr[index] = id;
  return { ...slots, [cat]: arr };
}

export function clearPowerSlot(slots: PowerSlots, cat: keyof PowerSlots, index: number): PowerSlots {
  const arr = [...slots[cat]];
  if (arr[index] !== undefined) arr[index] = "";
  return { ...slots, [cat]: arr };
}

export function setFeatSlot(feats: string[], index: number, id: string): string[] {
  const arr = [...feats];
  while (arr.length <= index) arr.push("");
  arr[index] = id;
  return arr;
}

export function clearFeatSlot(feats: string[], index: number): string[] {
  const arr = [...feats];
  if (arr[index] !== undefined) arr[index] = "";
  return arr;
}

// 装备槽位（13 格，与 EQUIPMENT_SLOTS 下标对应）
export const EQUIPMENT_SLOTS: string[] = ["主手", "副手", "佩戴", "头部", "颈部", "护甲", "腰部", "臂部", "手部", "戒指", "戒指", "足部", "奇物"];

export function setEquipmentSlot(slots: (string | undefined)[], index: number, id: string): (string | undefined)[] {
  const arr = [...slots];
  while (arr.length <= index) arr.push(undefined);
  arr[index] = id;
  return arr;
}

export function clearEquipmentSlot(slots: (string | undefined)[], index: number): (string | undefined)[] {
  const arr = [...slots];
  if (arr[index] !== undefined) arr[index] = undefined;
  return arr;
}

// 仪式槽位（默认随角色等级；index 超出时自动补空槽）
export function setRitualSlot(slots: (string | undefined)[], index: number, id: string): (string | undefined)[] {
  const arr = [...slots];
  while (arr.length <= index) arr.push(undefined);
  arr[index] = id;
  return arr;
}

export function clearRitualSlot(slots: (string | undefined)[], index: number): (string | undefined)[] {
  const arr = [...slots];
  if (arr[index] !== undefined) arr[index] = undefined;
  return arr;
}

// 职业变体名 → 基础职业名（去括号变体 + 「混职」前缀），用于匹配 powerByGrantedBy
export function baseClassName(name: string): string {
  return name.replace(/（[^）]*）/g, "").replace(/^混职/, "").trim();
}

// 纯中文名：剥离英文后缀与（变体）括号，如 "战士 Fighter" → "战士"。用于匹配专长前提里的中文职业/种族名
export function zhName(name: string): string {
  const i = name.search(/[a-zA-Z]/);
  const base = i < 0 ? name : name.slice(0, i);
  return base.replace(/（[^（）]*）/g, "").replace(/^混职/, "").trim();
}

// 变种职业名解析：战士（武器大师）→ { parent: 战士, variant: 武器大师 }
export function parseVariant(name: string): { parent: string; variant?: string } {
  const m = name.match(/^(.+?)（(.+)）$/);
  if (m) return { parent: m[1], variant: m[2] };
  return { parent: name };
}

export function cleanDisplayName(name: string): string {
  const { parent, variant } = parseVariant(name);
  return variant ? parent + "·" + variant : name;
}

// 中文属性名 → AbilityKey
export const ABILITY_ZH: Record<string, AbilityKey> = {
  力量: "str", 体质: "con", 敏捷: "dex", 智力: "int", 感知: "wis", 魅力: "cha",
};

export interface RaceAbilityInfo {
  one?: AbilityKey;
  two: AbilityKey[];
}

export function parseRaceAbilities(race?: { abilityOne?: string; abilityTwo?: string }): RaceAbilityInfo {
  const one = race?.abilityOne ? ABILITY_ZH[race.abilityOne] : undefined;
  const two = (race?.abilityTwo ?? "")
    .split("或")
    .map((s) => ABILITY_ZH[s.trim()])
    .filter((k): k is AbilityKey => !!k);
  return { one, two };
}

export function racialBonus(race?: { abilityOne?: string; abilityTwo?: string }, choice?: AbilityKey): Partial<Record<AbilityKey, number>> {
  const { one, two } = parseRaceAbilities(race);
  const bonus: Partial<Record<AbilityKey, number>> = {};
  if (one) bonus[one] = 2;
  const picked = choice ?? two[0];
  if (picked) bonus[picked] = (bonus[picked] ?? 0) + 2;
  return bonus;
}

export function applyAbilityBonus(abilities: Record<AbilityKey, number>, bonus: Partial<Record<AbilityKey, number>>): Record<AbilityKey, number> {
  const out = { ...abilities };
  for (const [k, v] of Object.entries(bonus)) {
    if (v) out[k as AbilityKey] += v;
  }
  return out;
}

const ABBR_TO_KEY: Record<string, AbilityKey> = { STR: "str", CON: "con", DEX: "dex", INT: "int", WIS: "wis", CHA: "cha" };

export interface ClassSkill {
  name: string;
  ability: AbilityKey;
}

// 解析「职业技能：神秘(Int)、运动(Str)…」列表
export function parseClassSkills(text: string): ClassSkill[] {
  const m = text.match(/职业技能：[^\n]*/);
  if (!m) return [];
  const list = m[0].replace(/职业技能：/, "").replace(/''/g, "");
  const skills: ClassSkill[] = [];
  const re = /([^\s、，,()]+)\s*\((Str|Con|Dex|Int|Wis|Cha)\)/gi;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(list)) !== null) {
    const key = ABBR_TO_KEY[mm[2].toUpperCase()];
    if (key) skills.push({ name: mm[1], ability: key });
  }
  return skills;
}

export function parseTrainedSkillCount(text: string): number {
  const m = text.match(/选择(\d+)个(?:额外的)?受训技能/);
  return m ? parseInt(m[1], 10) : 0;
}

// 解析「受训技能：隐秘。1级时…」开头的内置自动受训技能（如刺客的隐秘）
export function parseBuiltinTrainedSkills(text: string): string[] {
  const m = text.match(/受训技能：([^。\n]*)/);
  if (!m) return [];
  return m[1]
    .replace(/''/g, "") // 原文为「''受训技能：''隐秘。」，去除引号标记
    .split(/[、，，,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export interface ClassStats {
  baseHp: number;
  hpPerLevel: number;
  surges: number;
  fort: number;
  ref: number;
  will: number;
}

export function parseClassStats(text: string): ClassStats {
  const pick = (re: RegExp): number => {
    const m = text.match(re);
    return m ? parseFloat(m[1]) : 0;
  };
  return {
    baseHp: pick(/起始HP：[^0-9]*(\d+(?:\.\d+)?)/),
    hpPerLevel: pick(/每级增加HP：[^0-9]*(\d+(?:\.\d+)?)/),
    surges: pick(/每日回复力：[^0-9]*(\d+(?:\.\d+)?)/),
    fort: pick(/\+(\d+(?:\.\d+)?)强韧/),
    ref: pick(/\+(\d+(?:\.\d+)?)反射/),
    will: pick(/\+(\d+(?:\.\d+)?)意志/),
  };
}

export type DefenseKey = "ac" | "fort" | "ref" | "will";

export const DEFENSE_BONUS_SOURCES = ["feat", "enhance", "armor", "shield", "other"] as const;
export type DefenseBonusSource = (typeof DEFENSE_BONUS_SOURCES)[number];

export type DefenseMods = Record<DefenseKey, Record<DefenseBonusSource, number>>;

export function emptyDefenseMods(): DefenseMods {
  return {
    ac: { feat: 0, enhance: 0, armor: 0, shield: 0, other: 0 },
    fort: { feat: 0, enhance: 0, armor: 0, shield: 0, other: 0 },
    ref: { feat: 0, enhance: 0, armor: 0, shield: 0, other: 0 },
    will: { feat: 0, enhance: 0, armor: 0, shield: 0, other: 0 },
  };
}

// 种族防御加值：解析正文「你在强韧/反射/意志上获得+N种族加值」
export interface RaceDefenseBonus {
  fort?: number;
  ref?: number;
  will?: number;
}

export function parseRaceDefenses(text: string): RaceDefenseBonus {
  const out: RaceDefenseBonus = {};
  const grab = (k: keyof RaceDefenseBonus, zh: string) => {
    const m = text.match(new RegExp("你在" + zh + "上获得\\+?(\\d+)种族加值"));
    if (m) out[k] = parseInt(m[1], 10);
  };
  grab("fort", "强韧");
  grab("ref", "反射");
  grab("will", "意志");
  return out;
}

export type SpeedMods = {
  power: number;
  feat: number;
  item: number;
  other: number;
};

export type InitMods = {
  other: number;
};

export function emptySpeedMods(): SpeedMods {
  return { power: 0, feat: 0, item: 0, other: 0 };
}

export function emptyInitMods(): InitMods {
  return { other: 0 };
}

// —— 攻击/伤害面板 ——
// 攻击行：½等级与属性调整值自动计算（属性由 ability 指定），其余为手动加值
export interface AttackRowData {
  label?: string;          // 该「攻击 + 伤害」对的自定义名称（如「长剑·主手」），两张表与速览页共用
  ability: AbilityKey;     // 关联属性（用于自动填充属性调整值）
  classBonus: number;      // 职业加值
  profBonus: number;       // 熟练加值（兼容旧存档的纯手动值，新版本由 profSlot 自动计算）
  profSlot?: number;       // 熟练加值来源装备槽位（0/1 = 主手/副手基础武器，自动取擅长加值；缺省按 0 处理）
  profOverride?: boolean;  // 手动视为擅长（覆盖自动擅长判定，用于选择型专长等无法自动判定的情况）
  feat: number;            // 专长加值
  enhanceSlot?: number;    // 增强加值来源装备槽位（0/1 = 主手/副手魔法物品，自动计算；缺省按 0 处理）
  other: number;           // 其他
}

// 伤害行：伤害骰由所选槽位（主手/副手）的基础武器自动获取，属性调整值自动计算，其余为手动加值
export interface DamageRowData {
  ability: AbilityKey;   // 关联属性（用于自动填充属性调整值）
  feat: number;          // 专长加值
  enhanceSlot?: number;  // 伤害骰/增强加值来源装备槽位（0/1 = 主手/副手，自动计算；缺省按 0 处理）
  otherA: number;        // 其他 1
  otherB: number;        // 其他 2
}

export interface CombatMods {
  attacks: AttackRowData[];
  damages: DamageRowData[];
}

// 返回属性值最高的属性键（并列时按 ABILITY_KEYS 顺序取第一个）
export function highestAbilityKey(abilities: Partial<Record<AbilityKey, number>>): AbilityKey {
  let best: AbilityKey = ABILITY_KEYS[0];
  let bestVal = -Infinity;
  for (const k of ABILITY_KEYS) {
    const v = abilities[k] ?? -Infinity;
    if (v > bestVal) { bestVal = v; best = k; }
  }
  return best;
}

export function emptyCombatMods(ability: AbilityKey = "str"): CombatMods {
  return {
    attacks: [
      { ability, classBonus: 0, profBonus: 0, profSlot: 0, profOverride: false, feat: 0, enhanceSlot: 0, other: 0 },
    ],
    damages: [
      { ability, feat: 0, enhanceSlot: 0, otherA: 0, otherB: 0 },
    ],
  };
}

// 判定空白的攻击/伤害行（全为 0），用于迁移时收敛旧存档的多余空行
function isBlankAttack(r: AttackRowData): boolean {
  return r.classBonus === 0 && r.profBonus === 0 && r.feat === 0 && r.other === 0;
}
function isBlankDamage(r: DamageRowData): boolean {
  return r.feat === 0 && r.otherA === 0 && r.otherB === 0;
}
function trimBlankRows<T>(rows: T[], isBlank: (r: T) => boolean): T[] {
  const out = [...rows];
  while (out.length > 1 && isBlank(out[out.length - 1])) out.pop();
  return out;
}

export interface DerivedStats {
  mods: Record<AbilityKey, number>;
  halfLevel: number;
  ac: number;
  fort: number;
  ref: number;
  will: number;
  initiative: number;
  maxHp: number;
  bloodied: number;
  surgeValue: number;
  hpPerLevel: number;
  surges: number;
  passiveInsight: number;
  passivePerception: number;
}

// 是否穿着重甲（链甲/鳞甲/板甲）：穿着重甲不能将属性调整值加到 AC 上，除非有特殊效果让其这么做。
export function isHeavyArmor(c: Character): boolean {
  const armorBase = c.baseItems?.[5] ? findBaseItem(c.baseItems[5]) : undefined;
  return armorBase?.kind === "armor" && armorBase.armor?.category === "重甲";
}

export function deriveStats(c: Character, cls?: ClassStats, raceDefs?: RaceDefenseBonus, acKey?: AbilityKey): DerivedStats {
  const halfLevel = Math.floor(c.level / 2);
  const mod = abilityModifier;
  const mods: Record<AbilityKey, number> = {
    str: mod(c.abilities.str),
    con: mod(c.abilities.con),
    dex: mod(c.abilities.dex),
    int: mod(c.abilities.int),
    wis: mod(c.abilities.wis),
    cha: mod(c.abilities.cha),
  };
  const cb = cls ?? { baseHp: 0, hpPerLevel: 0, surges: 0, fort: 0, ref: 0, will: 0 };
  const rd = raceDefs ?? {};
  const dm = c.defenseMods ?? emptyDefenseMods();
  const dSum = (k: DefenseKey): number => {
    const m = dm[k];
    return m ? m.feat + m.enhance + m.armor + m.shield + m.other : 0;
  };
  // 生命上限 = 职业起始 HP + 体质值 + 每级增加 HP ×（等级 − 1）
  const maxHp = cb.baseHp + c.abilities.con + cb.hpPerLevel * Math.max(0, c.level - 1);
  // AC 属性调整：默认取敏捷/智力较高者；守护者之力（守望者）等可改用其他属性。
  // 穿着重甲时属性调整值不计入 AC（万律书·护甲类型-重甲），除非有特殊效果允许。
  const acMod = isHeavyArmor(c) ? 0 : (acKey ? Math.max(mods[acKey], mods.dex, mods.int) : Math.max(mods.dex, mods.int));
  return {
    mods,
    halfLevel,
    ac: 10 + halfLevel + acMod + dSum("ac"),
    fort: 10 + halfLevel + Math.max(mods.str, mods.con) + cb.fort + dSum("fort") + (rd.fort ?? 0),
    ref: 10 + halfLevel + Math.max(mods.dex, mods.int) + cb.ref + dSum("ref") + (rd.ref ?? 0),
    will: 10 + halfLevel + Math.max(mods.wis, mods.cha) + cb.will + dSum("will") + (rd.will ?? 0),
    initiative: mods.dex + halfLevel,
    maxHp,
    bloodied: Math.floor(maxHp / 2),
    surgeValue: Math.floor(maxHp / 4),
    hpPerLevel: cb.hpPerLevel,
    surges: cb.surges + mods.con,
    passiveInsight: 10 + mods.wis + halfLevel,
    passivePerception: 10 + mods.wis + halfLevel,
  };
}

// 22 购点法（国内 4e 社群规则）：
// 起始数组 8、10、10、10、10、10（基准总花费 10 点），22 点预算用于提升。
// 花费表（从 10 起的累计）：11→1、12→2、13→3、14→5、15→7、16→9、17→12、18→16；
// 8→9 花 1、8→10 花 2；即从 8 起累计 8:0、9:1、10:2、11:3、12:4、13:5、14:7、15:9、16:11、17:14、18:18。
export const BUY_POINTS = 22;

export const ABILITY_KEYS: AbilityKey[] = ["str", "con", "dex", "int", "wis", "cha"];

const BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9, 16: 11, 17: 14, 18: 18 };

export function abilityBuyCost(score: number): number {
  if (score <= 8) return 0;
  if (score >= 18) return 18;
  return BUY_COST[score];
}

// 已用购点（不含种族加值）；初始数组基准 10 点
export function buyPointsUsed(abilities: Record<AbilityKey, number>): number {
  return ABILITY_KEYS.reduce((sum, k) => sum + abilityBuyCost(abilities[k]), 0) - 10;
}
