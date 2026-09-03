// 基础物品：武器/护甲本质是附魔，需依赖基础物品模板（数据由 scripts/extract-baseitems.mjs 从 wiki 生成）
import { BASE_WEAPONS, BASE_ARMORS, PROPERTY_DEFS } from "./baseitems-data";

export interface BaseWeapon {
  name: string;
  prof: number;   // 擅长加值（+2/+3；无则 0）
  dice: string;
  traits: string;
  category: string;
  group: string;
  range?: string; // 射程（如 "15/30"；近战为 "—"/undefined）
  price: number;
}

export interface BaseArmor {
  name: string;
  ac: number;
  category: string;
  masterwork: boolean;
  minEnhance: number;
  check: number; // 护甲检定减值（基于力量/敏捷/体质的技能检定）
  speed: number; // 护甲速度减值
  special: string;
  price: number;
}

// 副手护盾（4e 官方数据）
export interface BaseShield {
  name: string;
  ac: number;
  traits: string;
  price: number;
}

export const BASE_SHIELDS: BaseShield[] = [
  { name: "轻盾", ac: 1, traits: "副手", price: 5 },
  { name: "重盾", ac: 2, traits: "副手", price: 10 },
];

// 法器（施法用具，无伤害骰）；superior=true 为优异法器（来源：wiki「法器」页）
export interface BaseImplement {
  name: string;
  category: string;
  price: number;
  superior?: boolean;
  properties?: string;
}

export const BASE_IMPLEMENTS: BaseImplement[] = [
  { name: "圣徽", category: "神术", price: 10 },
  { name: "法珠", category: "奥术", price: 15 },
  { name: "权杖", category: "奥术", price: 12 },
  { name: "法杖", category: "奥术", price: 5 },
  { name: "魔杖", category: "奥术", price: 7 },
  { name: "气印", category: "灵能", price: 5 },
  // —— 优异法器 ——
  { name: "精准圣徽 Accurate symbol", category: "神术", price: 25, superior: true, properties: "精准" },
  { name: "星界圣徽 Astral symbol", category: "神术", price: 18, superior: true, properties: "远距，增能（光耀）" },
  { name: "防卫圣徽 Warding symbol", category: "神术", price: 21, superior: true, properties: "庇护，无滞" },
  { name: "愤怒圣徽 Wrathful symbol", category: "神术", price: 23, superior: true, properties: "高重击，无阻" },
  { name: "精准法珠 Accurate orb", category: "奥术", price: 30, superior: true, properties: "精准" },
  { name: "水晶法珠 Crystal orb", category: "奥术", price: 27, superior: true, properties: "增能（心灵），无阻" },
  { name: "绿石法珠 Greenstone orb", category: "奥术", price: 27, superior: true, properties: "增能（强酸），无滞" },
  { name: "石化法珠 Petrified orb", category: "奥术", price: 25, superior: true, properties: "增能（力场），压迫" },
  { name: "精准权杖 Accurate rod", category: "奥术", price: 25, superior: true, properties: "精准" },
  { name: "灰白权杖 Ashen rod", category: "奥术", price: 22, superior: true, properties: "增能（火焰），无误" },
  { name: "死骨权杖 Deathbone rod", category: "奥术", price: 22, superior: true, properties: "增能（暗蚀），无阻" },
  { name: "挑衅权杖 Defiant rod", category: "奥术", price: 18, superior: true, properties: "增能（光耀），庇护" },
  { name: "精准法杖 Accurate staff", category: "奥术", price: 20, superior: true, properties: "精准" },
  { name: "护卫法杖 Guardian staff", category: "奥术", price: 13, superior: true, properties: "增能（力场），庇护" },
  { name: "曲念法杖 Mindwarp staff", category: "奥术", price: 16, superior: true, properties: "远距，增能（心灵）" },
  { name: "迅雷法杖 Quickbeam staff", category: "奥术", price: 15, superior: true, properties: "增能（雷鸣），压迫" },
  { name: "回声魔典 Echo tome", category: "奥术", price: 15, superior: true, properties: "远距，无误" },
  { name: "禁制魔典 Forbidden tome", category: "奥术", price: 15, superior: true, properties: "致命，无滞" },
  { name: "恐怖魔典 Unspeakable tome", category: "奥术", price: 15, superior: true, properties: "高重击，无阻" },
  { name: "精准图腾 Accurate totem", category: "原力", price: 20, superior: true, properties: "精准" },
  { name: "远视图腾 Farseeing totem", category: "原力", price: 14, superior: true, properties: "致命，远距" },
  { name: "冰柱图腾 Icicle totem", category: "原力", price: 15, superior: true, properties: "高重击，增能（寒冰）" },
  { name: "风暴图腾 Storm totem", category: "原力", price: 18, superior: true, properties: "增能（雷鸣），无滞" },
  { name: "精准魔杖 Accurate wand", category: "奥术", price: 20, superior: true, properties: "精准" },
  { name: "灰烬魔杖 Cinder wand", category: "奥术", price: 18, superior: true, properties: "高重击，增能（火焰）" },
  { name: "龙牙魔杖 Dragontooth wand", category: "奥术", price: 18, superior: true, properties: "致命，无误" },
  { name: "花楸魔杖 Rowan wand", category: "奥术", price: 15, superior: true, properties: "远距，增能（闪电）" },
  { name: "精准匕首 Accurate dagger", category: "奥术", price: 25, superior: true, properties: "精准" },
  { name: "纵火匕首 Incendiary dagger", category: "奥术", price: 22, superior: true, properties: "增能（火焰），无误" },
  { name: "切割匕首 Lancing dagger", category: "奥术", price: 15, superior: true, properties: "高重击，增能（闪电）" },
  { name: "共鸣匕首 Resonating dagger", category: "奥术", price: 25, superior: true, properties: "增能（雷鸣），压迫" },
  { name: "精准气印 Accurate ki focus", category: "灵能", price: 25, superior: true, properties: "精准" },
  { name: "流畅气印 Fluid ki focus", category: "灵能", price: 30, superior: true, properties: "机动，庇护" },
  { name: "无情气印 Inexorable ki focus", category: "灵能", price: 35, superior: true, properties: "增能（力场），无滞" },
  { name: "钢铁气印 Iron ki focus", category: "灵能", price: 30, superior: true, properties: "致命，压迫" },
  { name: "强力气印 Mighty ki focus", category: "灵能", price: 25, superior: true, properties: "高重击，无误" },
  { name: "山岳气印 Mountain ki focus", category: "灵能", price: 30, superior: true, properties: "压迫，庇护" },
  { name: "平静气印 Serene ki focus", category: "灵能", price: 35, superior: true, properties: "增能（心灵），无阻" },
  { name: "超验气印 Transcendent ki focus", category: "灵能", price: 30, superior: true, properties: "闪烁，触及" },
];

export { BASE_WEAPONS, BASE_ARMORS, PROPERTY_DEFS };

// 基础物品 id 前缀：w: 武器 / a: 护甲 / s: 盾牌 / i: 法器
export function baseItemId(kind: "weapon" | "armor" | "shield" | "implement", name: string): string {
  const p = kind === "weapon" ? "w:" : kind === "armor" ? "a:" : kind === "shield" ? "s:" : "i:";
  return p + name;
}

export type BaseItemKind = "weapon" | "armor" | "shield" | "implement";

export function findBaseItem(id: string): { kind: BaseItemKind; weapon?: BaseWeapon; armor?: BaseArmor; shield?: BaseShield; implement?: BaseImplement } | undefined {
  if (id.startsWith("w:")) {
    const w = BASE_WEAPONS.find((x) => baseItemId("weapon", x.name) === id);
    return w ? { kind: "weapon", weapon: w } : undefined;
  }
  if (id.startsWith("a:")) {
    const a = BASE_ARMORS.find((x) => baseItemId("armor", x.name) === id);
    return a ? { kind: "armor", armor: a } : undefined;
  }
  if (id.startsWith("s:")) {
    const s = BASE_SHIELDS.find((x) => baseItemId("shield", x.name) === id);
    return s ? { kind: "shield", shield: s } : undefined;
  }
  if (id.startsWith("i:")) {
    const im = BASE_IMPLEMENTS.find((x) => baseItemId("implement", x.name) === id);
    return im ? { kind: "implement", implement: im } : undefined;
  }
  return undefined;
}

// 武器特性完整文本（名称 + 官方定义）
export function traitsText(traits: string): string {
  if (!traits || traits === "—" || traits === "-") return "";
  return traits.split(/[，,]/).map((t) => {
    const name = t.trim();
    if (!name) return "";
    const def = PROPERTY_DEFS[name];
    return def ? name + "：" + def : name;
  }).filter(Boolean).join("\n");
}