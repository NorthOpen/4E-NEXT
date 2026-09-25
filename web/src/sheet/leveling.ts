export interface PowerCounts {
  atWill: number;
  encounter: number;
  daily: number;
  utility: number;
}

export interface LevelInfo {
  level: number;
  xp: number;
  abilityBoost: string;
  gains: string[];
  feats: number;
  powers: PowerCounts;
  replacedPower: boolean;
}

function L(level: number, xp: number, abilityBoost: string, gains: string, feats: number, pw: [number, number, number, number], replaced: boolean): LevelInfo {
  return {
    level,
    xp,
    abilityBoost,
    gains: gains.split(/[；,，]/).map((s) => s.trim()).filter(Boolean),
    feats,
    powers: { atWill: pw[0], encounter: pw[1], daily: pw[2], utility: pw[3] },
    replacedPower: replaced,
  };
}

// 官方升级表：XP总值 / 属性值 / 威能与特性 / 已知专长 / 已知威能合计（随意/遭遇/每日/辅助）
export const LEVELS: LevelInfo[] = [
  L(1, 0, "参见种族", "职业特技；种族特性；获得 1 个专长；习得起始技能；获得 2 个随意攻击威能；获得 1 个遭遇攻击威能；获得 1 个每日攻击威能", 1, [2, 1, 1, 0], false),
  L(2, 1000, "-", "获得 1 个辅助威能；获得 1 个专长", 2, [2, 1, 1, 1], false),
  L(3, 2250, "-", "获得 1 个遭遇攻击威能", 2, [2, 2, 1, 1], false),
  L(4, 3750, "两个 +1", "获得 1 个专长", 3, [2, 2, 1, 1], false),
  L(5, 5500, "-", "获得 1 个每日攻击威能", 3, [2, 2, 2, 1], false),
  L(6, 7500, "-", "获得 1 个辅助威能；获得 1 个专长", 4, [2, 2, 2, 2], false),
  L(7, 10000, "-", "获得 1 个遭遇攻击威能", 4, [2, 3, 2, 2], false),
  L(8, 13000, "两个 +1", "获得 1 个专长", 5, [2, 3, 2, 2], false),
  L(9, 16500, "-", "获得 1 个每日攻击威能", 5, [2, 3, 3, 2], false),
  L(10, 20500, "-", "获得 1 个辅助威能；获得 1 个专长", 6, [2, 3, 3, 3], false),
  L(11, 26000, "全部 +1", "典范之道特技；获得 1 个专长；获得 1 个典范之道的遭遇攻击威能", 7, [2, 4, 3, 3], false),
  L(12, 32000, "-", "获得 1 个典范之道的辅助威能，获得 1 个专长", 8, [2, 4, 3, 4], false),
  L(13, 39000, "-", "替换 1 个遭遇攻击威能", 8, [2, 4, 3, 4], true),
  L(14, 47000, "两个 +1", "获得 1 个专长", 9, [2, 4, 3, 4], false),
  L(15, 57000, "-", "替换 1 个每日攻击威能", 9, [2, 4, 3, 4], true),
  L(16, 69000, "-", "典范之道特技；获得 1 个辅助威能；获得 1 个专长", 10, [2, 4, 3, 5], false),
  L(17, 83000, "-", "替换 1 个遭遇攻击威能", 10, [2, 4, 3, 5], true),
  L(18, 99000, "两个 +1", "获得 1 个专长", 11, [2, 4, 3, 5], false),
  L(19, 119000, "-", "替换 1 个每日攻击威能", 11, [2, 4, 3, 5], true),
  L(20, 143000, "-", "获得 1 个典范之道的每日攻击威能；获得 1 个专长", 12, [2, 4, 4, 5], false),
  L(21, 175000, "全部 +1", "传奇命运特技；获得 1 个专长", 13, [2, 4, 4, 5], false),
  L(22, 210000, "-", "获得 1 个辅助威能；获得 1 个专长", 14, [2, 4, 4, 6], false),
  L(23, 255000, "-", "替换 1 个遭遇攻击威能", 14, [2, 4, 4, 6], true),
  L(24, 310000, "两个 +1", "传奇命运特技；获得 1 个专长", 15, [2, 4, 4, 6], false),
  L(25, 375000, "-", "替换 1 个每日攻击威能", 15, [2, 4, 4, 6], true),
  L(26, 450000, "-", "获得 1 个传奇命运的辅助威能；获得 1 个专长", 16, [2, 4, 4, 7], false),
  L(27, 550000, "-", "替换 1 个遭遇攻击威能", 16, [2, 4, 4, 7], true),
  L(28, 675000, "两个 +1", "获得 1 个专长", 17, [2, 4, 4, 7], false),
  L(29, 825000, "-", "替换 1 个每日攻击威能", 17, [2, 4, 4, 7], true),
  L(30, 1000000, "-", "传奇命运特技；获得 1 个专长", 18, [2, 4, 4, 7], false),
];

export function levelFromXp(xp: number): LevelInfo {
  let best = LEVELS[0];
  for (const l of LEVELS) {
    if (xp >= l.xp) best = l;
  }
  return best;
}

/**
 * 该等级累计获得的**属性提升**次数。
 * 升级表里 4/8/14/18/24/28 级是「两个 +1」（任选两项各 +1），11/21 级是「全部 +1」。
 * 属性分配的提示词与校验都要用它：购点（基础值）之外，这些提升也必须分配完。
 */
export function abilityBoostCounts(level: number): { twoPlus: number; allPlus: number } {
  const lv = Math.max(1, Math.min(30, level));
  let twoPlus = 0;
  let allPlus = 0;
  for (const l of LEVELS) {
    if (l.level > lv) break;
    if (l.abilityBoost === "两个 +1") twoPlus++;
    else if (l.abilityBoost === "全部 +1") allPlus++;
  }
  return { twoPlus, allPlus };
}

export function xpForLevel(level: number): number {
  const l = LEVELS.find((x) => x.level === level);
  return l ? l.xp : 0;
}

// 官方升级表备注
export const NOTE_HP = "除此表所列之外，你每获得一个等级，总是可以得到更多的生命值。详情请查看你的职业描述。";
export const NOTE_REPLACE = "在这些等级，你可以用新等级的一个新威能替换一个已知威能。";
export const NOTE_HUMAN_FEAT = "人类在 1 级时获得一个额外专长。某些职业也允许你获得额外专长。";
