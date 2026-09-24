import type { Entry, PowerBlock } from "../data/types";
import { wikiToHtml } from "./wikirender";
import { mdToHtml } from "./markdown";
import { itemLevels, enhancementBonusForLevel } from "./levelprices";

// 私设编辑器：schema 驱动的表单定义。每种分类对应一批可表单化的标量字段。
// 正文统一走 sourceText，默认 Markdown（bodyFormat="md"）；旧条目的 wikitext 正文（bodyFormat="wiki"）继续按原语法渲染。
// 保存时派生 details，使 EntryCard 与预览都能完整渲染。

/** 按正文格式渲染 HTML。 */
export function renderBody(src: string, format: "md" | "wiki", fields: Record<string, string> = {}): string {
  return format === "wiki" ? wikiToHtml(src, fields) : mdToHtml(src);
}

const WIKI_MARKS = [/^!{1,4}\s/m, /''[^']+''/, /\/\/[^/\n]+\/\//, /\[\[[^\]]+\]\]/, /\{\{!!/];

/** 判断条目正文格式：优先看标记，其次按旧 wikitext 特征推断。 */
export function detectBodyFormat(entry: Entry): "md" | "wiki" {
  if (entry.bodyFormat === "md" || entry.bodyFormat === "wiki") return entry.bodyFormat;
  const src = entry.sourceText ?? "";
  return WIKI_MARKS.some((re) => re.test(src)) ? "wiki" : "md";
}

export type FieldType = "text" | "longtext" | "select" | "tags" | "multichips";

export interface SheetField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  /** multichips 链接分隔符（默认 "/"） */
  delimiter?: string;
  /** multichips 分组候选（带解释，悬停可见）；设置后优先于 options 渲染 */
  groups?: KeywordGroup[];
}

// —— 各类型专属编辑控件的枚举取值（依据原版数据 / 4e 规则表）——
// 4E 标准技能表（复用 character.ts 的 SKILL_TABLE 名称）
export const SKILLS: string[] = [
  "运动", "坚韧", "杂技", "隐秘", "盗术", "神秘", "历史", "宗教",
  "地城", "医疗", "洞察", "自然", "侦查", "唬骗", "交涉", "威吓", "市井",
];
// 6 项属性能调值 + 官方出现的「无」
export const SIX_ABILITIES = ["力量", "敏捷", "体质", "智力", "感知", "魅力", "无"];
// 威能动作类型（原版取值）
export const ACTION_TYPES = [
  "标准动作", "移动动作", "次要动作", "自由动作", "借机动作", "即时中断", "即时反应", "无动作",
];
// 威能射程/范围模板（分组镜像官方高频格式）。
// 每个模板项含 类型前缀 + 可选数字位（n1/n2），由 EntryEditor 组合成完整 range 字符串：
//   fixed       → 无数字位，prefix 即完整值（如「自身」「远程武器」）
//   仅 n1       → prefix + n1 + n1.suffix（如 近战{n1}、近战武器 + {n1}触及）
//   n1 + n2     → prefix + n1 + n2.prefix + n2 + n2.suffix（如 区域{n1}爆发{n2}）
export interface RangeTemplateItem {
  /** 按钮显示文本 */
  label: string;
  /** 类型前缀；fixed 时即完整值 */
  prefix: string;
  /** 固定值模板（无数字位） */
  fixed?: boolean;
  /** 第一个数字位（数字后缀文本，如「触及」） */
  n1?: { suffix?: string };
  /** 第二个数字位（数字前分隔文本，如「爆发」；数字后缀文本） */
  n2?: { prefix?: string; suffix?: string };
  /** 第一个数字输入框的提示（如「距离」「爆发半径」） */
  n1Label?: string;
  /** 第二个数字输入框的提示（如「区域半径」） */
  n2Label?: string;
}
export const RANGE_TEMPLATES: { group: string; items: RangeTemplateItem[] }[] = [
  {
    group: "自身类",
    items: [
      { label: "自身", prefix: "自身", fixed: true },
      { label: "个人", prefix: "个人", fixed: true },
    ],
  },
  {
    group: "近战类",
    items: [
      { label: "近战武器", prefix: "近战武器", fixed: true },
      { label: "近战触及", prefix: "近战触及", fixed: true },
      { label: "近战 + N", prefix: "近战", n1: {}, n1Label: "距离" },
      { label: "近战武器 + N触及", prefix: "近战武器 + ", n1: { suffix: "触及" }, n1Label: "触及距离" },
    ],
  },
  {
    group: "远程类",
    items: [
      { label: "远程 + N", prefix: "远程", n1: {}, n1Label: "距离" },
      { label: "远程武器", prefix: "远程武器", fixed: true },
      { label: "远程可见", prefix: "远程可见", fixed: true },
    ],
  },
  {
    group: "爆发/冲击类",
    items: [
      { label: "近程爆发 + N", prefix: "近程爆发", n1: {}, n1Label: "爆发半径" },
      { label: "近程冲击 + N", prefix: "近程冲击", n1: {}, n1Label: "冲击半径" },
      { label: "近程墙 + N", prefix: "近程墙", n1: {}, n1Label: "墙长" },
    ],
  },
  {
    group: "区域类",
    items: [
      { label: "区域N爆发M", prefix: "区域", n1: {}, n2: { prefix: "爆发" }, n1Label: "区域半径", n2Label: "爆发半径" },
      { label: "区域N墙M", prefix: "区域", n1: {}, n2: { prefix: "墙" }, n1Label: "区域半径", n2Label: "墙长" },
    ],
  },
  { group: "其他", items: [{ label: "特殊", prefix: "特殊", fixed: true }] },
];
/** 全部射程模板项（平铺，供解析当前值回填） */
export const RANGE_TEMPLATE_ITEMS: RangeTemplateItem[] = RANGE_TEMPLATES.flatMap((g) => g.items);
/** 由模板项 + 数字位组合成完整 range 字符串（如 远程 + 10 → 「远程10」） */
export function composeRange(t: RangeTemplateItem, n1: string, n2: string): string {
  if (t.fixed) return t.prefix;
  if (!t.n1) return t.prefix;
  if (!t.n2) return `${t.prefix}${n1}${t.n1.suffix ?? ""}`;
  return `${t.prefix}${n1}${t.n2.prefix ?? ""}${n2}${t.n2.suffix ?? ""}`;
}
/** 把 range 字符串反向解析为「模板项 + 数字位」，无法识别（自由组合）时返回 null */
export function parseRange(val: string): { tpl: RangeTemplateItem; n1: string; n2: string } | null {
  const v = val.trim();
  for (const t of RANGE_TEMPLATE_ITEMS) {
    if (t.fixed && v === t.prefix) return { tpl: t, n1: "", n2: "" };
  }
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dyn = RANGE_TEMPLATE_ITEMS.filter((t) => !t.fixed).sort((a, b) => b.prefix.length - a.prefix.length);
  for (const t of dyn) {
    if (!t.n2) {
      const re = new RegExp(`^${esc(t.prefix)}(\\d+)${esc(t.n1?.suffix ?? "")}$`);
      const m = v.match(re);
      if (m) return { tpl: t, n1: m[1], n2: "" };
    } else {
      const re = new RegExp(`^${esc(t.prefix)}(\\d+)${esc(t.n2.prefix ?? "")}(\\d+)${esc(t.n2.suffix ?? "")}$`);
      const m = v.match(re);
      if (m) return { tpl: t, n1: m[1], n2: m[2] };
    }
  }
  return null;
}
// —— 威能关键词（分组管理，解释参考万律「术语表」）——
// 分组镜像官方关键词语义：伤害类型 / 效果类型 / 附件类型 / 力量来源 / 其他。
// desc 摘录自 reference 分类「术语表」；悬停候选词可查看解释。
export interface KeywordItem {
  kw: string;
  /** 关键词解释（万律术语表），悬停显示 */
  desc: string;
}
export interface KeywordGroup {
  label: string;
  hint?: string;
  items: KeywordItem[];
}
export const POWER_KEYWORD_GROUPS: KeywordGroup[] = [
  {
    label: "伤害类型",
    hint: "威能造成该类型伤害（术语表·伤害类型）",
    items: [
      { kw: "强酸", desc: "一种伤害类型。" },
      { kw: "寒冰", desc: "一种伤害类型。具有该关键字的生物与寒冰有强烈的关联。" },
      { kw: "火焰", desc: "一种伤害类型。具有该关键字的生物与火焰有强烈的关联。" },
      { kw: "力场", desc: "一种伤害类型。" },
      { kw: "闪电", desc: "一种伤害类型。" },
      { kw: "暗蚀", desc: "一种伤害类型。" },
      { kw: "毒素", desc: "一种伤害和效果类型。毒素威能会造成非伤害的中毒效果、毒素伤害，或两者皆有。" },
      { kw: "心灵", desc: "一种伤害类型。" },
      { kw: "光耀", desc: "一种伤害类型。" },
      { kw: "雷鸣", desc: "一种伤害类型。" },
    ],
  },
  {
    label: "效果类型",
    hint: "定义威能效果机制的关键字（术语表·效果类型）",
    items: [
      { kw: "可强化", desc: "具有可强化关键字的威能带有可选的强化，角色可以通过花费灵能点来强化。" },
      { kw: "灵气", desc: "灵气是从一个生物上散发的持续效果。" },
      { kw: "野兽", desc: "野兽威能只能连同野兽伙伴一起使用。" },
      { kw: "野兽形态", desc: "角色只能在野兽形态下才可以使用野兽形态威能。" },
      { kw: "引导神力", desc: "引导神力威能允许生物利用神的魔法。每场遭遇只能使用不超过一个。" },
      { kw: "魅惑", desc: "魅惑威能以某种方式控制一个生物的动作。" },
      { kw: "咒法", desc: "咒法威能会产生咒法物，它是魔法能量的创造物，类似生物、物体或其他现象。" },
      { kw: "恐惧", desc: "恐惧威能会激发惊恐。" },
      { kw: "医疗", desc: "医疗威能会恢复生命值，通常是立即恢复生命值，或给予再生。" },
      { kw: "幻术", desc: "幻术威能会欺骗精神或感官。如果幻术威能会造成伤害，则那伤害本身并不是幻觉。" },
      { kw: "鼓舞", desc: "鼓舞威能会给予它们的使用者临时生命值。" },
      { kw: "变形", desc: "变形威能会以某种方式改变生物的物理形态。" },
      { kw: "狂暴", desc: "狂暴威能允许使用者进入威能中指明的狂暴状态。" },
      { kw: "厉喝", desc: "厉喝威能通常会给目标的攻击骰造成减值。" },
      { kw: "可靠", desc: "如果可靠威能对所有目标都失手，该威能不消耗。" },
      { kw: "符文", desc: "符文威能会引导威能中指明的符文魔法。" },
      { kw: "睡眠", desc: "睡眠威能会使生物失去意识。" },
      { kw: "精魂", desc: "精魂威能只能连同精魂伙伴一起使用。" },
      { kw: "架势", desc: "当一个角色使用架势威能时，该角色会进入某种架势。" },
      { kw: "召唤", desc: "具有召唤关键字的威能会从其他地方神奇地召来生物来为召唤者服务。" },
      { kw: "传送", desc: "传送威能会将生物或物体从一个地方立刻转移到另一个地方。" },
      { kw: "区域", desc: "具有区域关键字的威能会创造持续一轮或更久的魔法区域。" },
      { kw: "套路", desc: "一个套路威能包含了一个攻击招数和一个移动招数，实际上就是两个子威能。" },
    ],
  },
  {
    label: "附件类型",
    hint: "标明威能可通过何种法器/武器使用（术语表·附件类型）",
    items: [
      { kw: "法器", desc: "标明威能可以通过法器使用，例如魔杖。冒险者必须擅长法器才能在威能中使用它。" },
      { kw: "武器", desc: "标明威能可通过武器使用，这武器也可以是徒手攻击。" },
    ],
  },
  {
    label: "力量来源",
    hint: "威能所属的魔法/力量体系（无独立词条，按职业力量来源）",
    items: [
      { kw: "奥术", desc: "奥术力量来源。通过研习与智识引导的魔法。" },
      { kw: "武术", desc: "武术力量来源。经由武器与战技引导的力量。" },
      { kw: "神术", desc: "神术力量来源。通过信仰与神祇授予的力量。" },
      { kw: "灵能", desc: "灵能力量来源。经由心灵与意志引导的力量。" },
      { kw: "原力", desc: "原力力量来源。经由自然与精魂引导的力量。" },
      { kw: "影能", desc: "影能力量来源。经由阴影位面引导的力量。" },
    ],
  },
  {
    label: "其他",
    hint: "官方威能中出现的高频词（无独立术语条目）",
    items: [
      { kw: "领域", desc: "领域关键词威能（常与「领域；可变」搭配），与神导士/圣武士领域来源相关。" },
      { kw: "元素", desc: "与元素力量相关的威能（德鲁伊元素、塑水者等）。" },
      { kw: "死灵", desc: "奥术死灵派系威能，多与暗蚀/影能搭配。" },
      { kw: "塑能", desc: "奥术塑能派系威能，直接塑造能量造成效果。" },
      { kw: "惑控", desc: "奥术惑控派系威能，影响生物的心智。" },
      { kw: "幽影", desc: "与阴影、影界相关的威能，多与暗蚀搭配。" },
      { kw: "剑法术", desc: "法师剑法术威能，结合剑术与法术。" },
    ],
  },
];
/** 威能关键词候选（平铺自分组，供搜索/旧逻辑使用） */
export const POWER_KEYWORDS: string[] = POWER_KEYWORD_GROUPS.flatMap((g) => g.items.map((i) => i.kw));
// 职业职责
export const ROLES = ["防御者", "领导者", "控制者", "打击者"];
// 威能来源（可复合）
export const POWER_SOURCES = ["奥术", "武术", "神术", "原力", "灵能", "影能"];
// 种族体型
export const RACIAL_SIZES = ["超小型", "小型", "中型", "大型", "超大型"];
// 种族速度
export const SPEEDS = ["4格", "5格", "6格", "7格"];
// 种族视觉（官方语料只有这三种：「标准视觉」在全库 0 命中，与「普通视觉」同义，已删除）
export const VISIONS = ["普通视觉", "昏暗视觉", "黑暗视觉"];
// 装备稀有度（对齐原版）
export const RARITIES = ["普通", "非普通", "稀有", "神之碎片"];
// 仪式类别
export const RITUAL_CATEGORIES = ["探险", "创造", "防护", "复原", "旅行", "欺骗", "束缚", "探知", "预言"];
// 层级（物品套装用，含「团体」）
export const TIERS = ["英雄", "典范", "传奇", "团体"];
// 专长类型（开集，仅建议）
export const FEAT_TYPES = ["职业专长", "典范专长", "史诗专长", "英雄专长"];
// 装备「分类组」常见建议：按类别分组，编辑端随 itemCategory 过滤候选（可自由输入，点选一键填入）
export const GROUPS_BY_CATEGORY: Record<string, string[]> = {
  武器: ["重刃", "轻刃", "长武器", "矛", "连枷", "锤", "镐", "斧", "弓", "弩", "投掷"],
  法器: ["权杖", "法杖", "法珠", "圣徽", "魔杖", "魔典", "图腾", "气印"],
  护甲: ["布甲", "皮甲", "革甲", "链甲", "鳞甲", "板甲", "盾牌"],
};
export const GROUPS = Object.values(GROUPS_BY_CATEGORY).flat();

// —— 装备「适合」（itemSuitable）：官方 99% 魔法装备携带的字段（details 首行 {{!!item-category}}：{{!!item-suitable}}）。
//    武器/法器/护甲 的适合 token 与分类组(group)同空间（重刃/法杖/鳞甲…）→ 用 group 承载，不另设行；
//    其余类别的适合词完全不同（臂部=盾位、奇物=纹身、消耗品=药剂…），按下表给候选与统计行（2026-09-10 官方数据勘误新增）。 ——
export const SUIT_CANDIDATES_BY_CATEGORY: Record<string, string[]> = {
  臂部: ["任意盾牌", "轻盾", "重盾", "护腕"],
  奇物: ["基地物品", "纹身", "异能小雕像", "军旗", "荒神碎片", "魔术袋"],
  消耗品: ["药剂及灵药", "药剂", "试剂", "磨刀石", "毒药"],
  炼金物品: ["爆弹", "油膏", "药物", "毒药", "其他"],
  另类奖励: ["妖精魔法赠礼", "元素赠礼", "失落符文", "神圣恩赐", "大师特训"],
  龙晶强化: ["（武器）"],
};
/** 该类别是否需要「适合」统计行：group 之外的分类型适合轴（武器/法器/护甲 用分类组承载，不重复设行）。 */
export function suitRowFor(cat: string | undefined, hasValue = false): { key: "itemSuitable"; label: string } | null {
  if (!cat || GROUPS_BY_CATEGORY[cat]) return null;
  return SUIT_CANDIDATES_BY_CATEGORY[cat] || hasValue ? { key: "itemSuitable", label: "适合" } : null;
}

// —— 装备·增强算法（2026-09-10）：官方 details 的「增强：」行**永远是对象文本**（加值数字从不出现，由物品等级推导）。
//    两个正交量分字段承载，消灭旧版「对象文本塞进 enh 加值位」的语义双载（导入官方护甲后 enh="AC" 触发加值误告警）：
//    · 增强加值 enh（数值）：等级推导 + 用户覆盖（清空 = 跟随等级）
//    · 增强对象 enhTarget（文本）：类别默认 + 用户覆盖（chips / 自定义输入）
//    实证（2603 条 增强 行值分布）：法器 509/武器 351/弹药 23 = 攻击骰和伤害骰；护甲 295 = AC；
//    颈部 147 = 强韧、反射和意志（含 50 条行尾多句号、1 条 +N 前缀的脏数据）；机关附件 混合（攻3/AC3/豁免2）。 ——
/** 各类别增强对象候选（首项 = 该类别默认）；键集合同时定义「该类别是否有增强」——奇物/头部/戒指等无增强条目的类别不在表内，
 *  不做加值推导（与官方覆盖一致），用户仍可手动填。 */
export const ENH_TARGETS_BY_CATEGORY: Record<string, string[]> = {
  武器: ["攻击骰和伤害骰"],
  法器: ["攻击骰和伤害骰"],
  弹药: ["攻击骰和伤害骰"],
  机关附件: ["攻击骰和伤害骰", "AC", "强韧、反射和意志"],
  护甲: ["AC"],
  盾牌: ["AC"],
  颈部: ["强韧、反射和意志"],
};
/** 无类别映射时的通用候选（用户手动为奇物等填增强时的对象选项） */
export const ENH_TARGETS_COMMON = ["攻击骰和伤害骰", "AC", "强韧、反射和意志"];
/** 该类别是否默认有增强（推导加值/显示对象 chips 的依据）。 */
export function enhAppliesTo(cat: string | undefined): boolean {
  return !!ENH_TARGETS_BY_CATEGORY[cat ?? ""];
}
/** 增强对象算法：显式覆盖优先 → 类别默认 → 空。 */
export function enhTargetOf(cat: string | undefined, explicit?: string): string {
  const t = (explicit ?? "").trim();
  if (t) return t;
  return (ENH_TARGETS_BY_CATEGORY[cat ?? ""] ?? [])[0] ?? "";
}
/** 官方「增强：」行值 → 规范对象文本（剥前导 +N 加值与行尾句号；如「+5强韧、反射和意志。」→「强韧、反射和意志」）。 */
export function normalizeEnhTarget(raw: string): string {
  return raw.replace(/^\s*\+\s*\d+\s*/, "").replace(/[\s。．.]+$/, "").trim();
}
/** 增强加值算法：显式覆盖优先 → 按物品等级推导（多级取并集，如「2 7 12」→「+1/+2/+3」）；无等级无覆盖 → 空。 */
export function enhBonusOf(itemLevel: string, explicit?: string): string {
  const t = (explicit ?? "").trim();
  if (t) return t;
  const lvls = itemLevels(itemLevel ?? "");
  if (!lvls.length) return "";
  const bonuses = [...new Set(lvls.map(enhancementBonusForLevel))];
  return bonuses.map((b) => "+" + b).join("/");
}
// —— 威能再生频率 / 威能类型（两个正交维度，与官方一致）——
// 再生频率（usage）：官方只有 随意(at-will)/遭遇(encounter)/每日(daily) 三值，决定卡面色与使用次数。
// 威能类型（powerType/powerKind）：攻击/辅助/特殊，决定卡头文字（如「战士攻击 1」）与人物页归类。
export const POWER_FREQUENCIES: { label: string; usage: string }[] = [
  { label: "随意", usage: "at-will" },
  { label: "遭遇", usage: "encounter" },
  { label: "每日", usage: "daily" },
];
/** 由再生频率中文名派生 usage 代码；未知返回 undefined。 */
export function powerFreqOf(zh: string): (typeof POWER_FREQUENCIES)[number] | undefined {
  return POWER_FREQUENCIES.find((f) => f.label === zh);
}

export const POWER_TYPES: { label: string; powerKind: string }[] = [
  { label: "攻击", powerKind: "attack" },
  { label: "辅助", powerKind: "utility" },
  { label: "特殊", powerKind: "special" },
];
/** 由威能类型中文名派生 powerKind；未知返回 undefined。 */
export function powerKindOf(type: string): (typeof POWER_TYPES)[number] | undefined {
  return POWER_TYPES.find((t) => t.label === type);
}

// 威能详情「标签块」标签全集（顺序即下拉候选顺序）。这些标签与官方威能卡正文的
// <th>标签：</th> 行一一对应；「攻击」内容通常形如「力量 vs. AC」。
export const POWER_BLOCK_LABELS: { label: string; hint?: string }[] = [
  { label: "目标", hint: "如：一个生物" },
  { label: "攻击", hint: "如：力量 vs. AC（粗体展示）" },
  { label: "命中", hint: "命中后的伤害与效果（按等级伸级，如「1d6+力量，5级：2d6…」）" },
  { label: "强化1", hint: "强化1档位：命中的进阶效果（如伤害提升/额外增益）" },
  { label: "强化2", hint: "强化2档位：命中的进一步进阶效果" },
  { label: "失手", hint: "失手时的效果，如：一半伤害" },
  { label: "效果", hint: "必定发生（无论命中与否）；按等级伸级时可写「xx级：…」" },
  { label: "触发", hint: "使用条件" },
  { label: "要求", hint: "使用前提要求" },
  { label: "前提", hint: "若未满足不可使用" },
  { label: "代价", hint: "如：消耗一次遭遇威能使用次数" },
  { label: "主目标", hint: "多目标攻击的主目标（下接子行 次目标/攻击/命中）" },
  { label: "主攻击", hint: "主目标攻击骰" },
  { label: "次目标", hint: "子行：次要目标" },
  { label: "次攻击", hint: "子行：次要攻击骰" },
  { label: "后效", hint: "回合结束后的持续效果" },
  { label: "次要维持", hint: "以次要动作维持" },
  { label: "移动维持", hint: "以移动动作维持" },
  { label: "标准维持", hint: "以标准动作维持" },
  { label: "特殊", hint: "特殊说明/可多次选择" },
];

// 「次攻击组」：主攻击命中后对次目标再发起一轮攻击的官方固定结构（全部缩进子行，点击「＋次攻击组」一键插入）
export const POWER_TEMPLATE_SECONDARY: PowerBlock[] = [
  { label: "次目标", text: "", indent: 1 },
  { label: "次攻击", text: "", indent: 1 },
  { label: "命中", text: "", indent: 1 },
  { label: "效果", text: "", indent: 1 },
];

// —— 威能详情「预设模板」——
// 从官方威能 details 解析出的高频行结构（目标/攻击/命中/失手/效果、触发/效果、
// 主·次攻击、缩进子行次攻击组等），在「威能详情」编辑器顶部以预设条一键套用。
// 依据 powerKind 统计：攻击类最常见结构为 目标>攻击>命中（885）、目标>攻击>命中>失手>效果（550）、
// 目标>攻击>命中>效果（507）；辅助类最常见为 效果（929）、目标>效果（498）、触发>效果（479）。
export interface PowerPreset {
  name: string;
  group: string;
  desc: string;
  blocks: PowerBlock[];
}

export const PRESET_GROUPS = ["攻击类", "辅助类", "特殊类"];

export const POWER_PRESETS: PowerPreset[] = [
  // ============ 攻击类 ============
  {
    name: "标准攻击",
    group: "攻击类",
    desc: "最常用的完整攻击块：目标 / 攻击 / 命中 / 失手 / 效果",
    blocks: [
      { label: "目标", text: "一个生物" },
      { label: "攻击", text: "力量 vs. 防御" },
      { label: "命中", text: "1[W] + 力量调整值的伤害" },
      { label: "失手", text: "一半伤害" },
      { label: "效果", text: "" },
    ],
  },
  {
    name: "简易攻击",
    group: "攻击类",
    desc: "精简攻击：目标 / 攻击 / 命中",
    blocks: [
      { label: "目标", text: "一个生物" },
      { label: "攻击", text: "力量 vs. 防御" },
      { label: "命中", text: "1[W] + 力量调整值的伤害" },
    ],
  },
  {
    name: "命中效果",
    group: "攻击类",
    desc: "命中带控制效果：目标 / 攻击 / 命中 / 效果（官方第 3 高频结构）",
    blocks: [
      { label: "目标", text: "一个生物" },
      { label: "攻击", text: "力量 vs. 防御" },
      { label: "命中", text: "1[W] + 力量调整值的伤害，且目标定身直到你下一回合结束" },
      { label: "效果", text: "你滑动目标1格" },
    ],
  },
  {
    name: "攻击失手",
    group: "攻击类",
    desc: "含失手行：目标 / 攻击 / 命中 / 失手（官方第 4 高频结构）",
    blocks: [
      { label: "目标", text: "一个生物" },
      { label: "攻击", text: "力量 vs. 防御" },
      { label: "命中", text: "1[W] + 力量调整值的伤害" },
      { label: "失手", text: "一半伤害" },
    ],
  },
  {
    name: "要求攻击",
    group: "攻击类",
    desc: "带使用要求的攻击：要求 / 目标 / 攻击 / 命中 / 效果",
    blocks: [
      { label: "要求", text: "你必须持用一把矛" },
      { label: "目标", text: "一个生物" },
      { label: "攻击", text: "力量 vs. 防御" },
      { label: "命中", text: "1[W] + 力量调整值的伤害，且目标迟缓直到你下一回合结束" },
      { label: "效果", text: "" },
    ],
  },
  {
    name: "反应攻击",
    group: "攻击类",
    desc: "触发时对目标发起攻击：触发 / 目标 / 攻击 / 命中",
    blocks: [
      { label: "触发", text: "一个敌人对你进行一次近战攻击" },
      { label: "目标", text: "触发的敌人" },
      { label: "攻击", text: "力量 vs. 防御" },
      { label: "命中", text: "1[W] + 力量调整值的伤害" },
    ],
  },
  {
    name: "区域攻击",
    group: "攻击类",
    desc: "爆发/区域范围攻击：目标（区域）/ 攻击 / 命中 / 失手",
    blocks: [
      { label: "目标", text: "爆发1范围内的所有敌人" },
      { label: "攻击", text: "力量 vs. 防御" },
      { label: "命中", text: "1[W] + 力量调整值的伤害" },
      { label: "失手", text: "一半伤害" },
    ],
  },
  {
    name: "特殊攻击",
    group: "攻击类",
    desc: "命中带特殊使用说明：目标 / 攻击 / 命中 / 特殊",
    blocks: [
      { label: "目标", text: "一个生物" },
      { label: "攻击", text: "智力 vs. 反射" },
      { label: "命中", text: "1d8 + 智力调整值的伤害，且目标迟缓直到你下一回合结束" },
      { label: "特殊", text: "当冲锋时，你可使用此威能替代近战基本攻击" },
    ],
  },
  {
    name: "强化攻击",
    group: "攻击类",
    desc: "带强化档位的进阶攻击：目标 / 攻击 / 命中 / 强化1 / 强化2",
    blocks: [
      { label: "目标", text: "一个生物" },
      { label: "攻击", text: "魅力 vs. AC" },
      { label: "命中", text: "1[W] + 魅力调整值的伤害，且目标定身（豁免终止）" },
      { label: "强化1", text: "1[W] + 魅力调整值的伤害，且目标定身（豁免终止），你获得1个回复力" },
      { label: "强化2", text: "2[W] + 魅力调整值的伤害，且目标定身（豁免终止），你获得2个回复力" },
    ],
  },
  {
    name: "多段攻击",
    group: "攻击类",
    desc: "主攻击命中后对次目标再发起一轮攻击（主目标 / 主攻击 / 命中 / 效果 + 次攻击组）",
    blocks: [
      { label: "主目标", text: "一个生物" },
      { label: "主攻击", text: "感知 vs. AC" },
      { label: "命中", text: "2[W] + 感知调整值的伤害" },
      { label: "效果", text: "进行次攻击" },
      { label: "次目标", text: "离主目标5格内的一个或二个生物", indent: 1 },
      { label: "次攻击", text: "感知 vs. AC", indent: 1 },
      { label: "命中", text: "1[W]伤害，且你滑动次目标5格到邻近主目标的一格", indent: 1 },
    ],
  },
  {
    name: "次攻击组",
    group: "攻击类",
    desc: "缩进子行组成的次攻击组（次目标 / 次攻击 / 命中 / 效果），与「＋ 追加次攻击组」同构",
    blocks: POWER_TEMPLATE_SECONDARY,
  },
  {
    name: "每日后效",
    group: "攻击类",
    desc: "每日控制型：命中带后效、失手不消耗（目标 / 攻击 / 命中 / 后效 / 失手）",
    blocks: [
      { label: "目标", text: "一个敌人" },
      { label: "攻击", text: "魅力 + 2 vs. 意志" },
      { label: "命中", text: "目标被支配（豁免终止）" },
      { label: "后效", text: "目标受到10点持续心灵伤害且晕眩（豁免终止）" },
      { label: "失手", text: "此威能不被消耗" },
    ],
  },
  // ============ 辅助类 ============
  {
    name: "目标与效果",
    group: "辅助类",
    desc: "辅助威能最常用：目标 / 效果",
    blocks: [
      { label: "目标", text: "你或一个盟友" },
      { label: "效果", text: "" },
    ],
  },
  {
    name: "触发反应",
    group: "辅助类",
    desc: "触发条件 + 效果：触发 / 目标 / 效果",
    blocks: [
      { label: "触发", text: "一次攻击命中离你5格内的一个盟友" },
      { label: "目标", text: "被命中的盟友" },
      { label: "效果", text: "你将目标传送离你5格内的一个空间，目标在对抗触发攻击的所有防御上获得+4加值" },
    ],
  },
  {
    name: "触发效果",
    group: "辅助类",
    desc: "简化触发：触发 / 效果（辅助第 3 高频结构）",
    blocks: [
      { label: "触发", text: "你或一个邻近盟友受到伤害" },
      { label: "效果", text: "触发者获得5点临时生命值" },
    ],
  },
  {
    name: "纯效果",
    group: "辅助类",
    desc: "仅一行效果（辅助最高频结构）",
    blocks: [
      { label: "效果", text: "你获得飞行，直到你下一回合结束。持续期间你可在半空中滑翔" },
    ],
  },
  {
    name: "要求效果",
    group: "辅助类",
    desc: "带使用要求的辅助：要求 / 效果",
    blocks: [
      { label: "要求", text: "你必须有至少一个回复力" },
      { label: "效果", text: "你失去一个回复力，且获得等于你回复力值的临时生命值。直到遭遇结束，你获得下列增益" },
    ],
  },
  {
    name: "前提触发",
    group: "辅助类",
    desc: "先决前提 + 触发：前提 / 触发 / 效果",
    blocks: [
      { label: "前提", text: "你必须在隐秘上受训" },
      { label: "触发", text: "你在隐藏状态且失去了对一个敌人的掩护或隐匿" },
      { label: "效果", text: "你做一次隐秘检定。如果你的检定结果超过了触发敌人的被动侦查，则你保持对它的隐藏" },
    ],
  },
  {
    name: "效果特殊",
    group: "辅助类",
    desc: "效果带特殊说明：效果 / 特殊",
    blocks: [
      { label: "效果", text: "直到你下一回合结束，你和邻近的盟友在防御上获得+1加值" },
      { label: "特殊", text: "此威能可被用作借机动作" },
    ],
  },
  {
    name: "持续维持",
    group: "辅助类",
    desc: "区域/效果需动作维持：目标 / 效果 / 次要维持",
    blocks: [
      { label: "目标", text: "两个未被占据的格子" },
      { label: "效果", text: "你在射程内两个未被占据格子之间创造一个次元裂缝。此裂缝持续直到你下一回合结束" },
      { label: "次要维持", text: "此裂缝持续直到你下一回合结束" },
    ],
  },
  {
    name: "移动维持",
    group: "辅助类",
    desc: "以移动动作维持：效果 / 移动维持",
    blocks: [
      { label: "效果", text: "你获得隐形直到你下一回合结束，并传送20格" },
      { label: "移动维持", text: "隐形持续直到你下一回合结束或直到你攻击，且你传送最多5格" },
    ],
  },
  // ============ 特殊类 ============
  {
    name: "召唤傀儡",
    group: "特殊类",
    desc: "召唤物持续攻击：效果 / 次攻击组 / 次要维持",
    blocks: [
      { label: "效果", text: "你以咒法在射程内一个未被占据的格子召出一个生物/物件。它持续到你下回合结束。当它出现时，它立即进行下列攻击" },
      { label: "目标", text: "邻近召唤物的一个生物", indent: 1 },
      { label: "攻击", text: "智力 vs. 反射", indent: 1 },
      { label: "命中", text: "2d8 + 智力调整值的伤害", indent: 1 },
      { label: "次要维持", text: "召唤物持续直到你下回合结束" },
    ],
  },
  {
    name: "区域维持",
    group: "特殊类",
    desc: "每日区域攻击 + 维持：目标 / 攻击 / 命中 / 失手 / 效果 / 次要维持",
    blocks: [
      { label: "目标", text: "爆发范围内的每个生物" },
      { label: "攻击", text: "智力 vs. 反射" },
      { label: "命中", text: "2d10 + 智力调整值的伤害，并且目标定身（豁免终止）" },
      { label: "失手", text: "一半伤害" },
      { label: "效果", text: "此爆发创造一片困难地形区域，此区域持续到你下回合结束" },
      { label: "次要维持", text: "此区域持续到你下回合结束，且区域内的所有生物受到10点伤害" },
    ],
  },
];

// 「标签块」→ 官方威能卡正文的 <table class=details> HTML（含缩进子行的全角缩进）。
export function serializePowerBlocks(blocks: PowerBlock[]): string {
  if (!blocks?.length) return "";
  const rows = blocks
    .map((b) => {
      const label = b.label.trim();
      if (!label && !(b.text ?? "").trim()) return "";
      const pad = (b.indent ?? 0) > 0 ? "\u00A0\u00A0" : "";
      // 未选标签（仅正文文本）当作普通段落输出，避免丢失输入
      if (!label) return `<tr><td colspan="2">${escapeHtml(b.text ?? "")}</td></tr>`;
      return `<tr><th>${pad}${escapeHtml(label)}：</th><td>${escapeHtml(b.text ?? "")}</td></tr>`;
    })
    .filter(Boolean);
  if (!rows.length) return "";
  return `<table class="details"><tbody>${rows.join("")}</tbody></table>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 从表单 JSON 字符串解析「标签块」数组；非法/空返回 null。
export function parsePowerBlocks(json?: string, opts?: { keepEmpty?: boolean }): PowerBlock[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return null;
    const rows: PowerBlock[] = v.map((b) => ({
      label: typeof b?.label === "string" ? b.label : "",
      text: typeof b?.text === "string" ? b.text : "",
      indent: typeof b?.indent === "number" ? b.indent : 0,
    }));
    // keepEmpty：编辑态保留空块（否则清空「标签」后该块瞬间消失）
    if (opts?.keepEmpty) return rows;
    const blocks = rows.filter((b) => b.label.trim() || b.text.trim());
    return blocks.length ? blocks : null;
  } catch {
    return null;
  }
}

// —— 官方 details HTML → 可编辑「标签块」——
// 官方威能正文（details）形如 <table class=details><tr><th>目标：</th><td>…</td></tr>…</table>，
// 多个表之间可夹 <div class=keyword>（如「次威能」小节）；子行用 &nbsp; 缩进、<br> 换行。
// 这里把结构逆解析回 PowerBlock[]，使「从官方/模板新建威能」时能直接得到可填空修改的标签块面板。

/** 解码常见 HTML 实体 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 剥除标签但保留 <br> 换行，压缩空白 */
function htmlToPlain(s: string): string {
  return decodeHtmlEntities(
    s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** 解析官方 details HTML 为 PowerBlock[]；无法解析时返回 null。 */
export function parsePowerDetails(html: string): PowerBlock[] | null {
  if (!html) return null;
  const blocks: PowerBlock[] = [];
  // 依次抓取 <div class=keyword>小节 或 <table class=details> 表
  const tokenRe =
    /<div\b[^>]*\bclass=["']?keyword["']?[^>]*>([\s\S]*?)<\/div>|<table\b[^>]*class=["']?details["']?[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html))) {
    if (m[1] !== undefined) {
      // 小节标题（如「次威能」+ 其用法行）→ 无标签纯文本段落块
      const t = htmlToPlain(m[1]);
      if (t) blocks.push({ label: "", text: t });
      continue;
    }
    const rows = m[2].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) ?? [];
    for (const r of rows) {
      const th = r.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
      const tds = r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) ?? [];
      const cellText = (td: string) => htmlToPlain(td.replace(/^<td[^>]*>/, "").replace(/<\/td>\s*$/, ""));
      if (th) {
        // 标签块：标签 + 内容；&nbsp; 前缀 → 缩进子行（如 次目标/次攻击）
        const labelHtml = th[1];
        const indent = /^\s*(?:&nbsp;|\u00A0)+/.test(labelHtml) ? 1 : 0;
        const label = htmlToPlain(labelHtml).replace(/[：:]\s*$/, "");
        const text = tds.map(cellText).filter(Boolean).join("\n");
        if (label || text) blocks.push({ label, text, ...(indent ? { indent } : {}) });
      } else if (tds.length) {
        const text = tds.map(cellText).filter(Boolean).join("\n");
        if (text) blocks.push({ label: "", text });
      }
    }
  }
  return blocks.length ? blocks : null;
}

// ====================================================================
// —— 各类型结构化编辑模型 + 双向序列化（对齐官方 wiki 格式）——
// ====================================================================

// —— 通用「威能引用节」模型 ——
// 主题/领域/血统/契约/魔法学派/典范之道/传奇天命 的正文都由「N级:标题 + 威能引用」小节构成，
// 编辑端把它结构化为一组 { level, title, refs }，保存时拼装回 wiki 层级标题 + {{威能}} 语法。
export interface LevelTitleRefs {
  /** 等级前缀（如「11」），可为空 */
  level: string;
  /** 小节标题（不含等级前缀），如「血统特性」 */
  title: string;
  /** 威能引用名列表 */
  refs: string[];
}

/** 从「标题行」解析 等级 + 标题（如「!! 11级：XX特性」→ 11 / XX特性；「!! 2级辅助威能」→ 2 / 辅助威能） */
export function parseLevelTitle(line: string): { level: string; title: string } {
  const s = line.trim().replace(/^!{2,}\s+/, "");
  const m = s.match(/^(\d+)级\s*[:：]\s*(.*)$/);
  if (m) return { level: m[1], title: m[2].trim() };
  const m2 = s.match(/^(\d+)级\s*(.+)$/);
  if (m2) return { level: m2[1], title: m2[2].trim() };
  return { level: "", title: s };
}

/** 拼装标题行：有等级时输出「N级：标题」 */
export function levelTitleLine(level: string, title: string): string {
  const l = level.trim();
  const t = title.trim();
  if (!l) return t;
  return `${l}级：${t}`;
}

/** 收集正文中的 `{{名称}}` 引用名（去重，保持出现顺序） */
export function extractRefs(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const ref = m[1].trim();
    if (ref && !seen.has(ref)) { seen.add(ref); out.push(ref); }
  }
  return out;
}

/** 收集正文链接 `[[name]]` / `[[name|alias]]` 的目标名 */
export function extractLinks(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\[\[([^[|\]]+?)(?:\|[^\]]+)?\]\]/g)) {
    const ref = m[1].trim();
    if (ref && !seen.has(ref)) { seen.add(ref); out.push(ref); }
  }
  return out;
}

/**
 * 把正文按「!! / !!! 层级标题」切为「威能引用节」数组：
 * 每个标题下收集 {{威能}} 引用；无标题引言段不参与。
 */
export function parseLevelRefSections(src: string): LevelTitleRefs[] {
  const out: LevelTitleRefs[] = [];
  if (!src) return out;
  // 先按 !!（及更高）切主节，再在节内收集 {{引用}}
  const parts = src.split(/^!{2,}\s+/m).filter((s) => s.trim());
  for (const part of parts) {
    const lines = part.trim().split("\n");
    const titleLine = lines[0].trim();
    const body = lines.slice(1).join("\n");
    const { level, title } = parseLevelTitle(titleLine);
    const refs = extractRefs(body);
    out.push({ level, title, refs });
  }
  return out;
}

/** 把「威能引用节」数组拼装回 wiki 正文（`!! N级：标题` + `{{威能}}` 列表） */
export function serializeLevelRefSections(sections: LevelTitleRefs[]): string {
  return sections
    .map((s) => {
      const head = "!! " + levelTitleLine(s.level, s.title);
      const refs = s.refs.filter((r) => r.trim()).map((r) => "{{" + r + "}}");
      return [head, ...refs].join("\n");
    })
    .join("\n\n");
}

// —— 装备·物品威能段 ——
// 官方装备威能正文（details 内）形如：<div class="bold bg-item">威能（关键词）✦每日（自由动作）</div>
// + <div class=text>触发/效果…</div>。这里把它结构化为 段头（关键词/频率/动作）+ 标签块正文。
export const ITEM_FREQUENCIES = ["每日", "遭遇", "随意", "消耗", "回复力"] as const;
export type ItemFreq = (typeof ITEM_FREQUENCIES)[number];

/** 官方段头基名族谱（2603 条实测）：威能 2014 / 辅助威能 51 / 攻击威能 20；其余为自定义标题段（固有增益 11 / 神圣展现 11 / 怪癖 11） */
export const POWER_HEAD_BASES = ["威能", "辅助威能", "攻击威能"] as const;
export type ItemPowerBase = (typeof POWER_HEAD_BASES)[number] | "自定义";

export interface ItemPowerSection {
  /** 段头基名（威能/辅助威能/攻击威能；「自定义」= 非威能标题段，用 head 作段头） */
  base?: ItemPowerBase;
  /** 自定义标题段的标题（固有增益/神圣展现/怪癖…）；base 非「自定义」时忽略 */
  head?: string;
  /** 段头「威能（关键词）」中的关键词（可缺省） */
  keywords?: string;
  /** 段头「✦频率」 */
  freq: ItemFreq | "";
  /** 段头「（动作）」 */
  action: string;
  /** 正文：复用 20 标签集 + 自由文本的标签块 */
  blocks: PowerBlock[];
}
/** 物品威能段头关键词候选（2026-09-10 勘误：按官方 2603 条段头实测频次排序，替换 10 个零出现词） */
export const ITEM_POWER_KEYWORDS = [
  "医疗", "传送", "毒素", "可强化", "幻术", "火焰", "咒法", "魅惑",
  "区域", "光耀", "恐惧", "心灵", "闪电", "雷鸣", "暗蚀", "寒冰",
  "力场", "强酸", "变形", "奥术",
];

/** 装备格式四大类（2026-09-08 官方数据画像）：A 进攻战斗件(武器/法器) / B 护甲 / C 通用配件 / D 消耗品 */
export type EquipFamily = "A" | "B" | "C" | "D";
/** 由装备类别判定格式族；未知/空类别按 C 处理。机关附件（增强53%+重击20%+适合=武器组）归 A（2026-09-10 勘误，原归 C 致重击行丢失）。 */
export function equipFamilyOf(cat?: string): EquipFamily {
  if (cat === "护甲" || cat === "盾牌") return "B";
  if (cat === "武器" || cat === "法器" || cat === "机关附件") return "A";
  if (cat === "消耗品" || cat === "炼金物品" || cat === "刺客毒药") return "D";
  return "C";
}

// —— 装备候选词解释（参考威能「关键词」的悬停含义说明）——
/** 类别(itemCategory 单选 chips) 说明 */
export const ITEM_CATEGORY_TIPS: Record<string, string> = {
  武器: "增强攻击骰和伤害骰，通常需要武器熟练",
  护甲: "增强 AC，通常需要护甲熟练",
  法器: "施法/异能用具，通常需要对应法器熟练",
  消耗品: "一次性使用的消耗品，用后销毁",
  "冒险装备": "标准的冒险道具（绳、火把、油等）",
  坐骑: "可骑乘的动物或载具",
  奇物: "功效各异的魔法奇物",
  戒指: "戴在手上的魔法戒指（通常限两枚）",
  颈部: "颈部位（护符/披肩）",
  头部: "头部位（头盔/头饰）",
  足部: "足部位（靴子/胫甲）",
  手部: "手部位（护手）",
  腰部: "腰带位",
  臂部: "臂部位（护臂/盾）",
  "龙晶强化": "以龙晶碎片强化的器物",
  炼金物品: "炼金产物（酸瓶、火瓶、炽焰瓶等）",
  "另类奖励": "非标准奖励（异能纹身、圣物等）",
  伙伴: "战斗伙伴（魔宠、召唤物等）",
  魔宠: "小型魔法仆从",
};
/** 稀有度(单选 chips) 说明 */
export const RARITY_TIPS: Record<string, string> = {
  普通: "最常见，无稀有特性",
  非普通: "较常见，价格略高",
  稀有: "罕见、昂贵",
  "神之碎片": "神器级，独一无二",
};
/** 分类组(group 候选)解释：按类型关键词命中；未命中的候选不显示 tooltip */
export const ITEM_TYPE_TIPS: Record<string, string> = {
  板甲: "重型护甲；AC 含甲+增强，无属性调整",
  链甲: "重型锁子甲",
  鳞甲: "重型鳞甲",
  重甲: "重型护甲",
  革甲: "皮革护甲",
  皮甲: "软皮护甲",
  布甲: "布料护甲，最轻",
  重刃: "重型刀刃武器",
  轻刃: "轻型刀刃武器",
  锤: "钝击重型武器",
  斧: "劈砍武器",
  矛: "长杆刺击武器",
  硬头锤: "单手钝击武器",
  连枷: "链式钝击武器",
  弓: "远程射击武器",
  弩: "远程机弩",
  投石索: "远程投掷武器",
  权杖: "法器：Scepter（单体/临近法术）",
  法杖: "法器：Staff（通用法术）",
  魔杖: "法器：Wand（单体法术）",
  圣徽: "法器：Holy Symbol（圣疗/圣术）",
  法珠: "法器：Orb（控制法术）",
  魔典: "法器：Tome（书本仪式）",
  图腾: "法器：Totem（野性/疾风）",
  气印: "法器：Ki 印章（武僧异能）",
  药剂: "消耗品：药剂",
  "药剂及灵药": "消耗品：药剂与灵药",
  试剂: "消耗品：炼金试剂",
  毒药: "消耗品：淬毒",
  磨刀石: "消耗品：临时附魔（如晶石磨刀石）",
};

/** 装备「特性」段：官方 `<div class=text>` 纯文本行集合；多段特性逐段添加。 */
export interface ItemPropertySection { lines: string[]; }
/** 解析 form.properties 的 JSON → ItemPropertySection[] */
export function parseItemProperties(json?: string, opts?: { keepEmpty?: boolean }): ItemPropertySection[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    // ⚠ 保留空段（lines=[]）：编辑器中「＋ 添加一个特性段」先建空段再填内容，此处过滤会令新段瞬间消失（按钮看似失效）。
    // 保存侧 serializeItemProperties 会跳过无内容的段，不影响成品输出。
    return v
      .map((s): ItemPropertySection => {
        const raw = Array.isArray(s?.lines) ? s.lines.map((l: unknown) => (typeof l === "string" ? l : "")) : [];
        // keepEmpty：编辑态同时保留段内空行（textarea 的换行/空行不被吞掉）
        return { lines: opts?.keepEmpty ? raw : raw.filter((l: string) => l.trim()) };
      });
  } catch {
    return [];
  }
}
/** 序列化 ItemPropertySection[] 为官方「特性」bg-item 段 HTML（一个标题 + 单 text，多行用 <br> 分隔，参考米莎凯之杖） */
export function serializeItemProperties(secs: ItemPropertySection[]): string {
  const lines = secs
    // 跳过编辑中的空段（parseItemProperties 保留空段，保存时不输出）
    .flatMap((s) => s.lines.filter((l) => l.trim()).map((l) => l.trim()));
  if (!lines.length) return "";
  // 官方格式：一个「特性」标题 + 单一 text 段落，多条特性用 <br> 分隔；
  // 仅多条时每条前加「✦」列表符，单条不加（参考「米莎凯之杖」「驱魔师腰带」）
  const rows = lines.length > 1 ? lines.map((l) => (l.startsWith("✦") ? l : "✦" + l)) : [lines[0]];
  return '<div class="bold bg-item">特性</div><div class=text>' +
    rows.map((l) => escapeHtml(l)).join("<br>") +
    "</div>";
}
/** 从官方 details HTML 逆解析「特性」bg-item 段 → ItemPropertySection[]（剥除内联 <b>/链接 标签，解码实体，<br> 拆行） */
export function parseItemPropertiesHtml(html: string): ItemPropertySection[] {
  const out: ItemPropertySection[] = [];
  const re = /class="bold bg-item">特性<\/div>([\s\S]*?)(?=class="bold bg-item"|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const seg = m[1] || "";
    const lines = [...seg.matchAll(/<div class=text>([\s\S]*?)<\/div>/g)]
      .flatMap((x) => x[1].replace(/<br\s*\/?>/gi, "\n").split("\n"))
      .map((l) => decodeHtmlEntities(l.replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").trim())
      .filter(Boolean);
    if (lines.length) out.push({ lines });
  }
  return out;
}

// —— 装备·统一数据结构（威能标准：统计标量为单一权威，details 纯派生，消灭「标量↔details」双重同步）——
export type ItemStatKey = "group" | "enh" | "critical" | "cost" | "weight";
/** 装备统计：权威标量（卡片统计表行即此；details 不再重复写 增强/重击）
 *  注：官方护甲无独立「甲类/AC」行（295 条全部为 增强：AC，即增强作用于 AC），故不设 armorClass 字段（2026-09-10 勘误）。 */
export interface ItemStat {
  group: string;      // 分类组
  enh: string;        // 增强加值（A/B；D 无）
  critical: string;   // 重击（仅 A）
  cost: string;       // 价格
  weight: string;     // 重量
}
/** 装备统一数据（封装配方向的读写对象；字段仍落在 CATEGORY_FIELDS.equipment 各标量键，不引入单 JSON blob） */
export interface EquipmentData {
  flavorText: string;
  stat: ItemStat;
  properties: ItemPropertySection[];
  powers: ItemPowerSection[];
  bodyText: string;
}

/** 各族统计表行（单一来源，EntryEditor 面板显隐 与 ItemCard 卡片表行共用）；C 族可带增强（颈部/臂部）。
 *  魔法物品不含重量（官方数据 2600+ 条魔法装备的全部字段均无 weight）——重量仅属于基础装备（MUNDANE_STAT_ROWS）。 */
export const FAMILY_STAT_ROWS: Record<EquipFamily, { key: ItemStatKey; label: string }[]> = {
  A: [
    { key: "group", label: "分类组" },
    { key: "enh", label: "增强" },
    { key: "cost", label: "价格" },
    { key: "critical", label: "重击" },
  ],
  B: [
    { key: "group", label: "分类组" },
    { key: "enh", label: "增强" },
    { key: "cost", label: "价格" },
  ],
  C: [
    // 「分类组」仅对 武器/法器(A)/护甲(B) 有意义（GROUPS_BY_CATEGORY 也只定义这三类）；魔宠/伙伴/坐骑等通用配件无分类组
    { key: "cost", label: "价格" },
  ],
  D: [
    { key: "cost", label: "价格" },
  ],
};
/** 取某族的统计表行；C 族在已填增强时追加「增强」行。 */
export function equipmentStatRows(fam: EquipFamily, enhPresent: boolean): { key: ItemStatKey; label: string }[] {
  const rows = [...FAMILY_STAT_ROWS[fam]];
  if (fam === "C" && enhPresent) {
    rows.splice(1, 0, { key: "enh", label: "增强" });
  }
  return rows;
}

// —— 基础装备（非魔法）形态统计行：按 itemCategory 显示基础专属字段（擅长/伤害/护甲加值/检定…）。
//    与魔法形态 FAMILY_STAT_ROWS 平行；特性(properties)不进统计表，统一走「物品特性」段渲染。 ——
export type MundaneStatKey = "proficiency" | "damage" | "range" | "armorBonus" | "minEnhancement"
  | "checkPenalty" | "speed" | "special" | "baseType" | "proficiencyFeat" | "shieldBonus" | ItemStatKey;
export const MUNDANE_STAT_ROWS: Record<string, { key: MundaneStatKey; label: string }[]> = {
  武器: [
    { key: "proficiency", label: "擅长加值" },
    { key: "damage", label: "伤害" },
    { key: "range", label: "射程" },
    { key: "group", label: "分类组" },
    { key: "cost", label: "价格" },
    { key: "weight", label: "重量" },
  ],
  护甲: [
    { key: "armorBonus", label: "护甲加值" },
    { key: "minEnhancement", label: "最小增强加值" },
    { key: "checkPenalty", label: "检定" },
    { key: "speed", label: "速度" },
    { key: "special", label: "特殊" },
    { key: "baseType", label: "基本类型" },
    { key: "cost", label: "价格" },
    { key: "weight", label: "重量" },
  ],
  法器: [
    { key: "cost", label: "价格" },
    { key: "weight", label: "重量" },
  ],
  盾牌: [
    { key: "shieldBonus", label: "盾牌加值" },
    { key: "checkPenalty", label: "检定" },
    { key: "speed", label: "速度" },
    { key: "baseType", label: "基本类型" },
    { key: "proficiencyFeat", label: "擅长专长" },
    { key: "cost", label: "价格" },
    { key: "weight", label: "重量" },
  ],
  冒险装备: [
    { key: "cost", label: "价格" },
    { key: "weight", label: "重量" },
  ],
};
/** 基础形态可用类别（gear.json 覆盖）；魔法形态维持全类别。 */
export const MUNDANE_CATEGORIES = ["武器", "护甲", "法器", "盾牌", "冒险装备"];
/** 基础形态专属字段（切换形态时清空/校验用） */
export const MUNDANE_FIELDS = [
  "proficiency", "damage", "range", "armorBonus", "minEnhancement",
  "checkPenalty", "speed", "special", "baseType", "proficiencyFeat", "shieldBonus",
];

/** 是否为基础（非魔法）装备形态：显式 itemForm 标记优先，否则按基础字段自明兜底。 */
export function isMundaneEntry(e: { itemForm?: string } & Record<string, unknown>): boolean {
  return e.itemForm === "mundane" || !!(e.proficiency || e.armorBonus || e.minEnhancement
    || e.shieldBonus || e.checkPenalty || e.speed || e.proficiencyFeat || e.damage || e.range);
}

/** gear.json 基础名录条目 → 装备编辑表单值（itemForm=mundane；properties 转 特性段 JSON）。 */
export function gearToForm(g: Record<string, unknown>): Record<string, string> {
  const s = (k: string) => (typeof g[k] === "string" ? (g[k] as string).trim() : "");
  const props = s("properties");
  return {
    name: s("name"),
    nameEn: s("nameEn"),
    source: s("source"),
    sourceText: s("details"),
    bodyFormat: "md",
    itemForm: "mundane",
    itemCategory: s("itemCategory") || "冒险装备",
    // 武器：subGroup（单手/双手）并入子类别展示；护甲 subGroup（护甲及精制品护甲）为冗余分组，不并入
    subCategory: s("itemCategory") === "武器" ? [s("subCategory"), s("subGroup")].filter(Boolean).join(" · ") : s("subCategory"),
    cost: s("cost"),
    weight: s("weight"),
    proficiency: s("proficiency"),
    damage: s("damage"),
    range: s("range"),
    armorBonus: s("armorBonus"),
    minEnhancement: s("minEnhancement"),
    checkPenalty: s("checkPenalty"),
    speed: s("speed"),
    special: s("special"),
    baseType: s("baseType"),
    proficiencyFeat: s("proficiencyFeat"),
    shieldBonus: s("shieldBonus"),
    group: s("group"),
    properties: props ? JSON.stringify([{ lines: [props] }]) : "",
  };
}

/** 装备 details 纯派生：仅 特性段 + 正文（增强/重击/分类组 移到卡片统计表，此不写）。 */
export function serializeEquipmentDetails(opts: {
  props: ItemPropertySection[];
  bodyHtml: string;
}): string | undefined {
  // ⚠ 勿用 [...str] 展开（会把字符串拆成单字符数组）；直接拼接数组
  return [serializeItemProperties(opts.props), opts.bodyHtml].filter(Boolean).join("\n") || undefined;
}

/**
 * 官方装备 details 剥除已结构化部分（等级宏 / {{!!类别行}} / 增强·重击·甲类行 / 特性段 / 威能段 / 标题段）后的残余文本。
 * 用于 draftToForm：残余（配方花费/关键技能/时间/要求/前提/特殊 等未结构化头部行）→ 正文，官方条目导入再保存不丢内容。
 */
export function residualEquipmentText(html: string): string {
  if (!html) return "";
  let h = html
    .replace(/<<[^>]*>>/g, "") // 等级宏 <<item-level-N>>
    .replace(/<div\b[^>]*>(?:(?!<\/div>)[\s\S])*?\{\{!![\s\S]*?<\/div>/g, "") // 含 {{!!宏}} 的行（类别/部件）
    .replace(/<div\b[^>]*class=["']?text["']?[^>]*>\s*<b>\s*(?:增强|重击|甲类|AC)\s*[：:]\s*<\/b>[^<]*<\/div>/gi, ""); // 统计标量行
  // 剥除所有 bg-item 段（特性/威能/标题段均已结构化，含其正文 div）
  h = h.replace(/<div\b[^>]*class=["']?bold bg-item["']?[^>]*>[\s\S]*?(?=<div\b[^>]*class=["']?bold bg-item["']?|$)/gi, "");
  const txt = h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|span|p)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return txt;
}

export function parseItemPowerSections(json?: string, opts?: { keepEmpty?: boolean }): ItemPowerSection[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    const baseOf = (b: unknown): ItemPowerBase =>
      typeof b === "string" && (b === "自定义" || (POWER_HEAD_BASES as readonly string[]).includes(b)) ? (b as ItemPowerBase) : "威能";
    const secs = v.map((s): ItemPowerSection => {
      const blocks: PowerBlock[] = Array.isArray(s?.blocks)
        ? s.blocks.map((b: PowerBlock) => ({
            label: typeof b?.label === "string" ? b.label : "",
            text: typeof b?.text === "string" ? b.text : "",
            indent: typeof b?.indent === "number" ? b.indent : 0,
          }))
        : ([] as PowerBlock[]);
      return {
        base: baseOf(s?.base),
        head: typeof s?.head === "string" ? s.head : "",
        keywords: typeof s?.keywords === "string" ? s.keywords : "",
        freq: (ITEM_FREQUENCIES as readonly string[]).includes(s?.freq) ? (s.freq as ItemFreq) : "",
        action: typeof s?.action === "string" ? s.action : "",
        blocks: opts?.keepEmpty ? blocks : blocks.filter((b) => b.label.trim() || b.text.trim()),
      };
    });
    // keepEmpty：编辑态保留空段（否则清空「频率/动作/关键词」后该段瞬间消失）
    if (opts?.keepEmpty) return secs;
    return secs.filter((s) => (s.base === "自定义" ? (s.head ?? "").trim() : s.freq || s.action || s.keywords || s.blocks.length));
  } catch {
    return [];
  }
}

/** 物品威能/标题段正文 → 官方 div.text 行内格式：`<b>标签：</b>内容` 以 <br> 分行；无标签行输出纯文本。
 *  注意与威能卡的 <table class=details> 不同——官方装备威能正文是 div.text 行内文本（毒药式 <b> 标签 / 普通行内「标签：」）。 */
function serializeItemBlocksText(blocks: PowerBlock[]): string {
  const lines = blocks
    .map((b) => {
      const label = (b.label ?? "").trim();
      const textHtml = (b.text ?? "").split(/\r?\n/).map((l) => escapeHtml(l.trim())).filter(Boolean).join("<br>");
      if (!label && !textHtml) return "";
      const pad = (b.indent ?? 0) > 0 ? "&nbsp;&nbsp;" : "";
      if (!label) return textHtml;
      return `${pad}<b>${escapeHtml(label)}：</b>${textHtml}`;
    })
    .filter(Boolean);
  return lines.join("<br>");
}

/** 物品威能段 → 官方 `<div class="bold bg-item">` 段头 + `<div class=text>` 行内正文 */
export function serializeItemPowerSection(s: ItemPowerSection): string {
  const bodyText = serializeItemBlocksText(s.blocks);
  const textDiv = bodyText ? `<div class=text>${bodyText}</div>` : "";
  if (s.base === "自定义") {
    const t = (s.head ?? "").trim() || "威能";
    return `<div class="bold bg-item">${escapeHtml(t)}</div>` + textDiv;
  }
  const base = s.base || "威能";
  const kw = s.keywords?.trim();
  const freq = s.freq?.trim();
  const action = s.action?.trim();
  const head = base + (kw ? "（" + kw + "）" : "") + "✦" + freq + (action ? "（" + action + "）" : "");
  return `<div class="bold bg-item">${escapeHtml(head)}</div>` + textDiv;
}

export function serializeItemPowerSections(sections: ItemPowerSection[]): string {
  return sections
    .filter((s) => (s.base === "自定义" ? (s.head ?? "").trim() : s.freq || s.action || s.keywords || s.blocks.length))
    .map(serializeItemPowerSection)
    .join("");
}

/**
 * 反向解析官方装备威能 HTML（details 内的 bg-item 段头 + text 正文行）为 ItemPowerSection[]。
 * 段头族谱（2603 条实测）：威能 2014 / 辅助威能 51 / 攻击威能 20（→ base）；
 * 固有增益 11 / 神圣展现 11 / 怪癖 11（→ base="自定义" + head）；「特性」1443 由 parseItemPropertiesHtml 处理，此处跳过（防双重复解析）。
 * 段头格式：`（基名）（关键词）✦频率（动作）`；正文按 <br> 拆行，每行认 `<b>标签：</b>`（毒药式）、行内「标签：内容」（普通式）或纯文本；行首 &nbsp; 识别缩进子行。
 */
export function parseItemPowerSectionsHtml(html: string): ItemPowerSection[] {
  if (!html) return [];
  const out: ItemPowerSection[] = [];
  const tokenRe =
    /<div\b[^>]*\bclass=["']?bold bg-item["']?[^>]*>([\s\S]*?)<\/div>(?:\s*<div\b[^>]*\bclass=["']?text["']?[^>]*>([\s\S]*?)<\/div>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html))) {
    const raw = htmlToPlain(m[1] ?? "").trim();
    if (!raw || raw === "特性") continue; // 特性段由 parseItemPropertiesHtml 结构化
    let base: ItemPowerBase = "威能";
    let head = "";
    let keywords = "";
    let rest = raw;
    const bm = raw.match(/^(辅助威能|攻击威能|威能)\s*(?:（([^）]*)）)?\s*✦?\s*(.*)$/);
    if (bm) {
      base = bm[1] as ItemPowerBase;
      keywords = (bm[2] ?? "").trim();
      rest = bm[3].trim();
    } else {
      base = "自定义";
      head = raw;
    }
    let freq: ItemFreq | "" = "";
    let action = "";
    if (base !== "自定义") {
      const fam = rest.match(/^(每日|遭遇|随意|消耗|回复力)\s*（([^）]+)）?\s*$/);
      if (fam) { freq = fam[1] as ItemFreq; action = fam[2] ?? ""; }
    }
    // 正文行：按 <br> 拆行；每行 <b>标签：</b> / 行内「标签：内容」 / 纯文本；行首 &nbsp; = 缩进子行
    const body = m[2] !== undefined ? m[2] : "";
    const blocks: PowerBlock[] = [];
    for (const ln of body.split(/<br\s*\/?>/i)) {
      const indent = /^(?:&nbsp;|\u00A0)/.test(ln) ? 1 : 0;
      const line = ln.replace(/^(?:&nbsp;|\u00A0)+/, "");
      const bm2 = line.match(/^\s*<b>([^<]*?)：?\s*<\/b>\s*([\s\S]*)$/i);
      if (bm2) {
        const label = htmlToPlain(bm2[1]).replace(/[：:]\s*$/, "").trim();
        const text = htmlToPlain(bm2[2] ?? "").trim();
        if (label || text) blocks.push({ label, text, indent });
        continue;
      }
      const pm = line.match(/^\s*([^：:<（(]{1,10})[：:]\s*([\s\S]+)$/);
      if (pm) {
        const label = htmlToPlain(pm[1]).trim();
        const text = htmlToPlain(pm[2]).trim();
        if (label && text) blocks.push({ label, text, indent });
        continue;
      }
      const t = htmlToPlain(line).trim();
      if (t) blocks.push({ label: "", text: t, indent });
    }
    if (head || freq || action || keywords || blocks.length) {
      out.push(base === "自定义"
        ? { base, head, keywords: "", freq: "", action: "", blocks }
        : { base, head: "", keywords, freq, action, blocks });
    }
  }
  return out;
}

// —— 仪式头部 ——
// 官方仪式卡 <div class=ritualinfo> 固定 header 六行：等级/类别/时间/材料花费/市场价格/关键技能。
export interface RitualHeader {
  ritualLevel: string;
  ritualCategory: string;
  time: string;
  cost: string;
  marketPrice: string;
  keySkill: string;
}
const RITUAL_LABEL_MAP: [string, keyof RitualHeader][] = [
  ["等级", "ritualLevel"], ["类别", "ritualCategory"], ["时间", "time"],
  ["材料花费", "cost"], ["市场价格", "marketPrice"], ["关键技能", "keySkill"],
];

/** 官方 ritualinfo HTML → 头部字段（缺失的保留原值） */
export function parseRitualInfo(html: string, fallback: RitualHeader): RitualHeader {
  const out: RitualHeader = { ...fallback };
  if (!html) return out;
  const re = /<span class=bold>(等级|类别|时间|材料花费|市场价格|关键技能)：<\/span>\s*([^<]*(?:<br\s*\/?>[^<]*)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const label = m[1];
    const pair = RITUAL_LABEL_MAP.find(([l]) => l === label);
    if (!pair) continue;
    const text = m[2].replace(/<br\s*\/?>/gi, " ").trim();
    out[pair[1]] = text;
  }
  // 兜底：跨 <span> 的简单捕获
  for (const [lbl, key] of RITUAL_LABEL_MAP) {
    if (out[key]) continue;
    const mm = html.match(new RegExp(lbl + "：([^<\\n]*?)<"));
    if (mm) out[key] = mm[1].trim();
  }
  return out;
}

/** 头部字段 → 官方 ritualinfo HTML */
export function serializeRitualInfo(h: RitualHeader): string {
  const row = (label: string, val: string) =>
    !val.trim() ? "" : `<div><span class=bold>${label}：</span>${escapeHtml(val.trim())}</div>`;
  return `<div class="ritualinfo">${RITUAL_LABEL_MAP.map(([lbl, k]) => row(lbl, h[k])).filter(Boolean).join("")}</div>`;
}

// —— 译名字典 terms 词条对 ——
/** terms 字符串 ↔ 键值对数组（按 `英: 中` 切分，: / ： 均可，空行过滤） */
export function parseTerms(text?: string, opts?: { keepEmpty?: boolean }): [string, string][] {
  if (text === undefined) return [];
  // keepEmpty：编辑态保留空行与原始空白（「＋ 添加词条对」的空行、输入中的行尾空格不被吞掉）。
  // 注意空串在此视为「一行空词条」——否则添加首个词条对写回 "" 后会被当作无内容而消失。
  if (opts?.keepEmpty) {
    // 仅在冒号后吃掉一个分隔空格，其余原样保留 → 「英文 + 中文」两栏拆分可无损往返（含空栏）
    return text.split(/\r?\n/).map((l): [string, string] => {
      const m = l.match(/^([^:：]*)[:：] ?([\s\S]*)$/);
      return m ? [m[1], m[2]] : [l, ""];
    });
  }
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.search(/[:：]/);
      if (i < 0) return [l, ""];
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    });
}
export function serializeTerms(pairs: [string, string][], opts?: { keepEmpty?: boolean }): string {
  // keepEmpty：编辑态不做裁剪与剔除，保证空行数量在「序列化 → 解析」间一一对应；
  // 任一侧为空时省略分隔空格，避免空栏读出多余的前导空格
  if (opts?.keepEmpty) return pairs.map(([en, zh]) => (en || zh ? `${en}:${zh ? " " + zh : ""}` : "")).join("\n");
  return pairs
    .filter(([en, zh]) => en.trim() || zh.trim())
    .map(([en, zh]) => (en.trim() ? `${en}: ${zh.trim()}` : zh.trim()))
    .join("\n");
}

// —— 专长关联威能等级表 ——
// 流派专长 benefit 末尾常内嵌 <table>（等级 × 关联威能）。结构化为行数组 [level, power]。
export interface FeatRow {
  level: string;
  power: string;
}
export function parseFeatTable(benefit?: string): FeatRow[] | null {
  if (!benefit) return null;
  const tm = benefit.match(/<table[^>]*>[\s\S]*?<\/table>/i);
  if (!tm) return null;
  const rows = tm[0].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) ?? [];
  const out: FeatRow[] = [];
  for (const r of rows) {
    const cells = r.match(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi) ?? [];
    const vals = cells.map(htmlToPlain);
    if (vals.length >= 2 && /^\d+/.test(vals[0])) out.push({ level: vals[0], power: vals[1] });
  }
  return out.length ? out : null;
}
export function serializeFeatTable(rows: FeatRow[]): string {
  const valid = rows.filter((r) => r.power.trim());
  if (!valid.length) return "";
  const trs = valid
    .map((r) => `<tr><th>${r.level.trim()}</th><td>${escapeHtml(r.power.trim())}</td></tr>`)
    .join("");
  return `<table class="details"><tbody><tr><th>等级</th><th>关联威能</th></tr>${trs}</tbody></table>`;
}

// —— 物品套装（item-set）—— 知识(折叠) / 套装组成 / 套装增益
export interface SetBonusBlock {
  pieces: string;  // 件数，如「2件套」
  text: string;
}
export function parseSetBonuses(src: string): { knowledge: string; setBonus: SetBonusBlock[] } {
  const knowledge = sectionBetweenWiki(src, "知识", "套装组成");
  const bonusSec = sectionBetweenWiki(src, "套装增益");
  const blocks: SetBonusBlock[] = [];
  if (bonusSec) {
    const parts = bonusSec.split(/^!!!\s+/m).filter((s) => s.trim());
    for (const part of parts) {
      const lines = part.trim().split("\n");
      const pieces = lines[0].trim();
      blocks.push({ pieces, text: lines.slice(1).join("\n").trim() });
    }
  }
  return { knowledge, setBonus: blocks };
}
/** 拼装套装正文：知识(!!) + 套装组成(!! [[物品]] 列表) + 套装增益(!! + !!! 件数) */
export function serializeItemSet(knowledge: string, components: string[], bonuses: SetBonusBlock[]): string {
  const sec: string[] = [];
  if (knowledge.trim()) sec.push("!! 知识\n" + knowledge.trim());
  const compHtml = components.filter((c) => c.trim()).map((c) => "[[" + c + "]]").join("\n");
  if (compHtml) sec.push("!! 套装组成\n" + compHtml);
  const bonusHtml = bonuses
    .filter((b) => b.text.trim())
    .map((b) => "!!! " + JSON.stringify(b.pieces.trim()).replace(/"/g, "") + "\n" + b.text.trim());
  if (bonusHtml.length) sec.push("!! 套装增益\n" + bonusHtml.join("\n\n"));
  return sec.join("\n\n");
}

/** 截取 `!! 标题` 到下个 `!! ` 之间的正文（无标题结尾可选） */
export function sectionBetweenWiki(src: string, startTitle: string, endTitle?: string): string {
  const re = new RegExp("\\n!! " + startTitle + "\\n(.*?)(?:\\n!! |$)", "s");
  const m = src.match(re);
  if (!m) return "";
  let body = m[1];
  if (endTitle) {
    const idx = body.search(new RegExp("\\n!! " + endTitle + "\\n"));
    if (idx >= 0) body = body.slice(0, idx);
  }
  return body.trim();
}

// —— 通用「等级特性小节」（power-ref 类型共用）——
// 服务于 magic-school / pact / bloodline / domain / theme / epic-destiny / paragon-path / class / race。
// 每小节 = 等级前缀 + 标题 + 类型（特性/威能）+ 正文 + 威能引用；正文 wikitext 以「!! N级：标题」分节。
// 引用语法：{{威能名}}（威能）或 [[链接名]]（链接），解析时提取为 refs，序列化时回写。
export interface LevelFeatureSection {
  /** 等级前缀（含「级」，可空）。如 "1级"、"11级"。 */
  level: string;
  /** 小节标题（不含「N级」前缀）。如 "幻术学徒"。 */
  title: string;
  /** 类型标注：特性 vs 威能。 */
  kind: "feature" | "power";
  /** 本小节描述正文（不含威能引用行）。 */
  body: string;
  /** 威能引用名（正文中 {{名}}/[[名]] 提取，序列化时回写为 {{名}} 行）。 */
  refs: string[];
}
/** 从正文提取 {{名}} / [[名]] 引用名（去重，保序） */
export function extractPowerRefs(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const ref = m[1].trim();
    if (ref && !seen.has(ref)) { seen.add(ref); out.push(ref); }
  }
  for (const m of body.matchAll(/\[\[([^[|\]]+?)\]\]/g)) {
    const ref = m[1].trim();
    if (ref && !seen.has(ref)) { seen.add(ref); out.push(ref); }
  }
  return out;
}
/** 判定小节标题是否属于「威能」类型（特性 vs 威能），用于初始 kind 标注 */
function kindOfTitle(title: string): "feature" | "power" {
  const t = title || "";
  return /威能|遭遇|每日|随意|辅助|攻击|行动/.test(t) ? "power" : "feature";
}
/**
 * 把正文 wikitext 解析为「等级特性小节」数组。
 * 分节依据：行首「!! N级：标题」或「!! N级 标题」（含数字级）。未以等级开头的小节
 * （如 不朽/实践天命/引言段）并入前一个 feature 小节或以 level 空 + 标题入列，避免丢失。
 */
export function parseLevelSections(src?: string, opts?: { /** 允许无等级前缀的小节入列（如 不朽/实践天命），默认 false */ allowPlain?: boolean }): LevelFeatureSection[] {
  if (!src) return [];
  const out: LevelFeatureSection[] = [];
  let cur: LevelFeatureSection | null = null;
  const lines = src.split(/\r?\n/);
  const pushRefs = () => {
    if (!cur) return;
    cur.refs = extractPowerRefs(cur.body);
    // 剥掉正文中已提取的引用标记，避免正文重复显示 {{名}}
    cur.body = cur.body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, "").replace(/\[\[([^[|\]]+?)\]\]/g, "$1").replace(/^\s*\n/gm, "").trimEnd();
  };
  for (const raw of lines) {
    const line = raw.trim();
    const m = /^!!\s+([0-9]+)\s*级\s*[:：]?\s*(.*)$/.exec(line);
    if (m) {
      if (cur) pushRefs();
      const title = m[2].trim();
      cur = {
        level: m[1] + "级",
        title,
        kind: kindOfTitle(title),
        body: "",
        refs: [],
      };
      out.push(cur);
      continue;
    }
    // 无等级前缀的「!! 标题」小节目录（如 不朽 Immortality / 实践天命）
    if (/^!!\s+(.*)$/.test(line)) {
      const plainTitle = /^!!\s+(.*)$/.exec(line)![1].trim();
      if (cur) pushRefs();
      if (opts?.allowPlain) {
        cur = { level: "", title: plainTitle, kind: kindOfTitle(plainTitle), body: "", refs: [] };
        out.push(cur);
      } else {
        cur = { level: "", title: plainTitle, kind: kindOfTitle(plainTitle), body: line, refs: [] };
        out.push(cur);
      }
      continue;
    }
    if (cur) cur.body += raw + "\n";
    else {
      // 分节前引言段：并入一个「引言」feature 小节，保持内容不丢
      if (raw.trim()) {
        cur = { level: "", title: "", kind: "feature", body: raw + "\n", refs: [] };
        out.push(cur);
      }
    }
  }
  if (cur) pushRefs();
  return out.filter((s) => s.level || s.title || s.body.trim() || s.refs.length);
}
// —— 编辑态 form 的 JSON 字符串 → 结构化数组（JSON 感知；非 JSON 回落 wikitext 解析）——
function tryParseJsonArray<T>(json?: string): T[] | null {
  if (!json || !json.trim()) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}
/** 编辑态 form.featRows（JSON）→ FeatRow[]；空/非法返回 [] */
export function parseFeatRowsJson(json?: string, opts?: { keepEmpty?: boolean }): FeatRow[] {
  const v = tryParseJsonArray<FeatRow>(json) ?? [];
  const rows = v.map((r) => ({ level: String(r?.level ?? ""), power: String(r?.power ?? "") }));
  // keepEmpty：编辑态保留空行（否则清空「等级」后该行瞬间消失）
  if (opts?.keepEmpty) return rows;
  return rows.filter((r) => r.level.trim() || r.power.trim());
}
/** 编辑态 form.setBonuses（JSON）→ SetBonusBlock[]；空/非法返回 [] */
export function parseSetBonusesJson(json?: string, opts?: { keepEmpty?: boolean }): SetBonusBlock[] {
  const v = tryParseJsonArray<SetBonusBlock>(json) ?? [];
  const rows = v.map((b) => ({ pieces: String(b?.pieces ?? ""), text: String(b?.text ?? "") }));
  // keepEmpty：编辑态保留空块（否则清空「件数」后该块瞬间消失）
  if (opts?.keepEmpty) return rows;
  return rows.filter((b) => b.pieces.trim() || b.text.trim());
}
/** 编辑态 form.levelSections（JSON）→ LevelFeatureSection[]；
 *  兼容旧值（存 wikitext）时回落 parseLevelSections。 */
export function parseLevelSectionsJson(json?: string, opts?: { allowPlain?: boolean; keepEmpty?: boolean }): LevelFeatureSection[] {
  const v = tryParseJsonArray<LevelFeatureSection>(json);
  if (v) {
    const rows = v.map((s) => ({
      level: String(s?.level ?? ""),
      title: String(s?.title ?? ""),
      kind: (s?.kind === "power" ? "power" : "feature") as LevelFeatureSection["kind"],
      body: String(s?.body ?? ""),
      refs: Array.isArray(s?.refs) ? s.refs.map((r) => String(r ?? "")) : [],
    }));
    // keepEmpty：编辑态保留空小节（否则「＋ 添加小节」的全空新行会被立即剔除，按钮看似失效）
    if (opts?.keepEmpty) return rows;
    return rows.filter((s) => s.level || s.title || s.body.trim() || s.refs.length);
  }
  return parseLevelSections(json, opts);
}

/** 小节数组 → 正文 wikitext：!! N级：标题 + 正文 + {{引用}} 行 */
export function serializeLevelSections(sections: LevelFeatureSection[]): string {
  return sections
    .filter((s) => s.level || s.title || s.body.trim() || s.refs.length)
    .map((s) => {
      const head = s.level ? `!! ${s.level}${s.title ? `：${s.title}` : ""}` : s.title ? `!! ${s.title}` : `!! ${s.title}`;
      const body = s.body.trim();
      const refs = s.refs.filter(Boolean).map((r) => `{{${r.trim()}}}`);
      const parts = [head];
      if (body) parts.push(body);
      parts.push(...refs);
      return parts.join("\n");
    })
    .join("\n\n");
}

// —— 生物数据块（creature）——
// 官方生物条目在正文内嵌 `<div class=creature>`：头部（名称+角色 / 体型 源界 类别标签）、
// 双栏数据行（生命值/回复力/防御/速度/…）、以及「行动/特质/灵气」段（bg-power 段头 + description 描述）。
// 此处结构化为独立字段，序列化保持官方 HTML 格式（gen-creature-card 渲染不变）。
export interface CreatureBlock {
  /** 名称（头部主标题） */
  name: string;
  /** 角色（如 召唤生物 / 标准 / 精英 / 独一 / 下属） */
  role: string;
  /** 排除名称/角色的第二行加工标签（如 中型 妖精界 类人生物（不死）） */
  subtitleLabel: string;
  /** 双栏数据行：每行 = 左标签 + 左值 + 右标签 + 右值（左右可空） */
  rows: { leftLabel: string; leftValue: string; rightLabel: string; rightValue: string }[];
  /** 行动/特质/灵气段 */
  actions: { name: string; freq: string; action: string; qualifier: string; description: string }[];
}
// 生物「角色」常见取值（官方 205 条统计常见）
export const CREATURE_ROLES = ["标准", "精英", "独一", "下属", "召唤生物"];
// 生物「体型」「源界」常见取值（用于第二行加工标签的便捷 chip）
export const CREATURE_SIZES = ["微型", "小型", "中型", "大型", "超大型", "巨型"];
export const CREATURE_ORIGINS = ["妖精界", "元素界", "天然界", "阴影界", "暗影界", "虚空界", "未知", "原体"];
// 生物动作段头的动作类别（官方图标 {{$:/dnd/images/xxx}} 按动作映射；灵气/特制无动作图标类）
export const CREATURE_ACTIONS = ["标准动作", "移动动作", "次要动作", "自由动作", "借机动作", "即时中断", "即时反应", "灵气", "特制"];
// 生物常见频率（“灵气N”形如 ◈灵气2；充能的触发条件写入动作「限定词」）
export const CREATURE_FREQUENCIES = ["随意", "遭遇", "每日", "充能", "灵气2", "灵气5"];
// 常用双栏数据行标签预设（点选即加行）
export const CREATURE_ROW_PRESETS = ["生命值", "回复力", "防御", "速度", "技能", "豁免", "行动点", "免疫", "状态免疫", "感官", "感知", "语言", "装备", "擅用"];

// 官方图标 → 动作类别
function creatureActionFromIcon(iconKey: string): string {
  const map: Record<string, string> = {
    melee: "标准动作", aura: "灵气", glance: "借机动作", stance: "特制", summon: "特制",
    ranged: "标准动作", move: "移动动作", minor: "次要动作", free: "自由动作", weapon: "标准动作",
  };
  return map[iconKey] ?? "";
}
/** 把官方「行动/特质/灵气」段的段头 HTML 解析为 { name, freq, action, qualifier }。
 *  段头变体：{{icon}}闪光姿态✦灵气2 / {{icon}}标准动作（光耀）✦随意 / 次要动作✦随意（每轮一次） */
function parseCreatureActionHead(head: string): { name: string; freq: string; action: string; qualifier: string } {
  const star = head.indexOf("✦");
  // 频率：✦ 之后取 灵气N / 随意 / 遭遇 / 每日 / 每轮一次
  const tail = star >= 0 ? head.slice(star + 1).trim() : "";
  const freqM = tail.match(/(灵气\s*\d+|每日|遭遇|随意|充能|每轮一次|每遭遇\d+次)/);
  const freq = (freqM && freqM[1]) ? freqM[1] : "";
  // 限定词：频率之后的括号内容（如 次要动作✦随意（每轮一次）的「每轮一次」），回填时原样写回
  const qualM = tail.match(/[（(]\s*([^）)]*)\s*[）)]\s*$/);
  const qualifier = qualM ? qualM[1].trim() : "";
  // 名称/动作段：✦ 之前去掉图标与括号关键词
  let namePart = (star >= 0 ? head.slice(0, star) : head).trim();
  namePart = namePart.replace(/\{\{\$:\/dnd\/images\/(\w+)\}\}/g, "");
  const iconM = head.match(/\{\{\$:\/dnd\/images\/(\w+)\}\}/);
  let action = iconM?.[1] ? creatureActionFromIcon(iconM[1]) : "";
  namePart = namePart.trim();
  // 无图标时动作直接以「标准动作（光耀）」领头
  const naked = CREATURE_ACTIONS.find((a) => namePart.startsWith(a));
  if (naked) {
    action = naked;
    namePart = namePart.slice(naked.length);
  }
  // 残留的（关键词）归入 name（如 光耀/传送），以便回填
  namePart = namePart
    .replace(/^[（(]\s*([^）)]*)\s*[）)]/, "$1")
    .replace(/[\s：:]+$/, "")
    .trim();
  return { name: namePart, freq, action, qualifier };
}
/** 提取 <div class=creature>…</div> 的内层 HTML：按 <div>/</div> 配对计数定位闭合标签，
 *  避免遇到首个内部 </div>（如头部 bg-title 行）就截断。找不到返回 null。 */
function extractCreatureInner(html: string): string | null {
  const open = html.search(/<div class="?creature"?>/i);
  if (open < 0) return null;
  let depth = 0;
  const re = /<\/?div\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  re.lastIndex = open;
  while ((m = re.exec(html))) {
    if (m[0][1] === "/") depth--;
    else depth++;
    if (depth === 0) return html.slice(open, m.index);
  }
  return null;
}
/** 把官方生物数据块 HTML 逆解析为 CreatureBlock（找不到数据块返回 null） */
export function parseCreatureBlock(html?: string): CreatureBlock | null {
  if (!html) return null;
  const inner = extractCreatureInner(html);
  if (inner === null) return null;
  const block: CreatureBlock = { name: "", role: "", subtitleLabel: "", rows: [], actions: [] };
  // 头部行：名称 + 角色
  const head = inner.match(/<div class="?bold font-size-h4 bg-title"?>([\s\S]*?)<\/div>/i);
  if (head && head[1]) {
    const spans = head[1].match(/<span>([\s\S]*?)<\/span>/g) ?? [];
    if (spans[0]) block.name = htmlToPlain(spans[0].replace(/<\/?span>/g, ""));
    if (spans[1]) block.role = htmlToPlain(spans[1].replace(/<\/?span>/g, ""));
  }
  // 第二行辅助标签（体型 源界 类别）
  const sub = inner.match(/<div class="?bg-title"?>([\s\S]*?)<\/div>/i);
  if (sub && sub[1]) {
    const spans = sub[1].match(/<span>([\s\S]*?)<\/span>/g) ?? [];
    if (spans[0]) block.subtitleLabel = htmlToPlain(spans[0].replace(/<\/?span>/g, ""));
  }
  // 双栏数据行：''标签'' 值 两列（无 class 的裸 <div>）
  const rowRe = /<div>([\s\S]*?)<\/div>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(inner))) {
    const rowHtml = (rm && rm[1]) ? rm[1] : "";
    if (!rowHtml || /class\s*=/.test(rowHtml)) continue;
    const spans = rowHtml.match(/<span>([\s\S]*?)<\/span>/g) ?? [];
    if (spans.length === 0) continue;
    const col = (s: string) => {
      const t = htmlToPlain(s.replace(/<\/?span>/g, "")).replace(/'+/g, "").trim();
      const mm = t.match(/^(.+?)\s+(.*)$/s);
      return mm && mm[1] !== undefined
        ? { label: mm[1].trim().replace(/^''|''$/g, ""), value: (mm[2] ?? "").trim() }
        : { label: "", value: t };
    };
    const l = col(spans[0] ?? "");
    const r = spans[1] ? col(spans[1]) : { label: "", value: "" };
    block.rows.push({ leftLabel: l.label, leftValue: l.value, rightLabel: r.label, rightValue: r.value });
  }
  // 行动/特质段（bg-power 段头 + description 描述）
  const segRe = /<div class="?bold bg-power"?>([\s\S]*?)<\/div>\s*<div class="?description"?>([\s\S]*?)<\/div>/gi;
  let seg: RegExpExecArray | null;
  while ((seg = segRe.exec(inner))) {
    if (!seg[1]) continue;
    const head2 = htmlToPlain(seg[1]).trim();
    const desc = htmlToPlain(seg[2] ?? "").replace(/<br\s*\/?>/gi, "\n").trim();
    block.actions.push({ ...parseCreatureActionHead(head2), description: desc });
  }
  const valid = block.name || block.role || block.rows.length || block.actions.length;
  return valid ? block : null;
}
/** 把编辑表单里的 JSON 字符串还原为 CreatureBlock（容错：空/非法返回 null） */
export function parseCreatureBlockJson(json?: string): CreatureBlock | null {
  if (!json || !json.trim()) return null;
  try {
    const b = JSON.parse(json);
    if (!b || typeof b !== "object") return null;
    return {
      name: String(b.name ?? ""),
      role: String(b.role ?? ""),
      subtitleLabel: String(b.subtitleLabel ?? ""),
      rows: Array.isArray(b.rows)
        ? b.rows.map((r: Record<string, unknown>) => ({
            leftLabel: String(r?.leftLabel ?? ""), leftValue: String(r?.leftValue ?? ""),
            rightLabel: String(r?.rightLabel ?? ""), rightValue: String(r?.rightValue ?? ""),
          }))
        : [],
      actions: Array.isArray(b.actions)
        ? b.actions.map((a: Record<string, unknown>) => ({
            name: String(a?.name ?? ""), freq: String(a?.freq ?? ""),
            action: String(a?.action ?? ""), qualifier: String(a?.qualifier ?? ""),
            description: String(a?.description ?? ""),
          }))
        : [],
    };
  } catch {
    return null;
  }
}
/** 序列化 CreatureBlock → 官方 div.creature HTML 数据块 */
export function serializeCreatureBlock(b: CreatureBlock): string {
  const esc = (s: string) => escapeHtml(s ?? "");
  const nameRow = b.role
    ? `<div class="bold font-size-h4 bg-title"><span>${esc(b.name)}</span><span>${esc(b.role)}</span></div>`
    : `<div class="bold font-size-h4 bg-title"><span>${esc(b.name)}</span></div>`;
  const subRow = b.subtitleLabel
    ? `<div class=bg-title><span>${esc(b.subtitleLabel)}</span><span></span></div>` : "";
  const rows = b.rows
    .filter((r) => r.leftLabel || r.leftValue || r.rightLabel || r.rightValue)
    .map((r) => {
      const l = r.leftLabel ? `''${esc(r.leftLabel)}'' ${esc(r.leftValue)}` : esc(r.leftValue);
      const rcol = r.rightLabel ? `''${esc(r.rightLabel)}'' ${esc(r.rightValue)}` : esc(r.rightValue);
      return `<div><span>${l.trim()}</span><span>${rcol.trim()}</span></div>`;
    });
  const actions = b.actions
    .filter((a) => a.name || a.action || a.freq || a.qualifier || a.description)
    .map((a) => {
      // 灵气/特制：{{icon}}名称✦频率；其余：{{icon}}动作（名称）✦频率；限定词写回为频率后括号（每轮一次）
      const isAuraLike = a.action === "灵气" || a.action === "特制";
      const icon = a.action ? `{{$:/dnd/images/${iconForAction(a.action)}}}` : "";
      const q = a.qualifier ? `（${esc(a.qualifier)}）` : "";
      const inner = isAuraLike
        ? [a.name, a.freq ? `✦${a.freq}${q}` : ""].filter(Boolean).join("")
        : [(a.action || a.name ? `${a.action || ""}${a.name ? `（${a.name}）` : ""}` : ""), a.freq ? `✦${a.freq}${q}` : ""].filter(Boolean).join("");
      const desc = a.description.replace(/\n+/g, "<br>");
      return `<div class="bold bg-power">${icon}${esc(inner)}</div><div class=description>${desc}</div>`;
    });
  const inner = [nameRow, subRow, ...rows, ...actions].filter(Boolean).join("\n");
  return inner ? `<div class=creature>\n${inner}\n</div>` : "";
}
function iconForAction(action: string): string {
  const map: Record<string, string> = {
    "标准动作": "melee", "移动动作": "move", "次要动作": "minor", "自由动作": "free",
    "借机动作": "glance", "即时中断": "glance", "即时反应": "glance", "灵气": "aura", "特制": "stance", "召唤": "summon",
  };
  return map[action] ?? "melee";
}

// —— 专长预设与前提候选（统计驱动）——
export const FEAT_PRESETS: PowerPreset[] = [
  {
    name: "检定加值型",
    group: "增益型",
    desc: "你在「技能」检定上获得+N（技能/数值填空）",
    blocks: [{ label: "增益", text: "你在「运动」检定上获得+2。", indent: 0 }],
  },
  {
    name: "引导神力型",
    group: "增益型",
    desc: "获得引导神力威能",
    blocks: [{ label: "增益", text: "你获得引导神力威能「{{威能}}」。" }],
  },
  {
    name: "回气增强型",
    group: "增益型",
    desc: "当你使用你的回气时…",
    blocks: [{ label: "增益", text: "当你使用你的回气时，在你下一次回合开始前，你在所有防御上获得+2加值。" }],
  },
  {
    name: "遭遇限制型",
    group: "增益型",
    desc: "每遭遇一次的限定效果",
    blocks: [{ label: "增益", text: "每遭遇一次，当一个敌人攻击你时，你可以用一次自由动作对它做一次随模仿的攻击。" }],
  },
  {
    name: "重伤触发型",
    group: "增益型",
    desc: "当你重伤时触发的增益",
    blocks: [{ label: "增益", text: "当你重伤时，你获得5点临时生命值。" }],
  },
  {
    name: "威能授予型",
    group: "增益型",
    desc: "获得一个具体威能（作为遭遇威能使用）",
    blocks: [{ label: "增益", text: "你获得[[冰刺击]]威能，它可以作为遭遇威能使用。" }],
  },
];
/** 前提句式候选（官方 3202 条前提语料归纳，按句式分类分组）
 *  仅提供句式前缀做预输入，点击后填入前缀、由用户补全具体内容（如「职业：」+ 战士）。 */
export const FEAT_PREREQ_GROUPS: { label: string; items: string[] }[] = [
  { label: "职业式", items: ["职业："] },
  { label: "等级式", items: ["角色等级："] },
  { label: "受训式", items: ["技能受训："] },
  { label: "属性式", items: ["力量", "敏捷", "体质", "智力", "感知", "魅力"] },
  { label: "种族式", items: ["种族："] },
];

const COMMON: SheetField[] = [
  { key: "name", label: "名称", type: "text", placeholder: "必填", required: true },
  { key: "nameEn", label: "英文名", type: "text", placeholder: "可选" },
  { key: "category", label: "分类", type: "select", required: true },
  { key: "tags", label: "标签", type: "tags", placeholder: "用逗号分隔" },
  { key: "source", label: "出处", type: "text", placeholder: "默认：私设" },
  { key: "sourceText", label: "正文", type: "longtext", placeholder: "支持 Markdown 语法使用。" },
];

export const CATEGORY_FIELDS: Record<string, SheetField[]> = {
  power: [
    { key: "grantedBy", label: "授予者 / 来源", type: "text", placeholder: "如：战士 / 邪术师 / 龙裔（可选，会显示在卡头）" },
    { key: "powerType", label: "威能类型", type: "select", options: POWER_TYPES.map((t) => t.label), placeholder: "如：攻击" },
    { key: "usageZh", label: "再生频率", type: "select", options: POWER_FREQUENCIES.map((f) => f.label), placeholder: "如：随意" },
    { key: "actionType", label: "动作", type: "select", options: ACTION_TYPES, placeholder: "如：标准动作" },
    { key: "level", label: "等级", type: "text" },
    { key: "keywords", label: "关键词", type: "multichips", groups: POWER_KEYWORD_GROUPS, delimiter: "，", placeholder: "如：奥术，法器（多选，以顿号分隔）" },
    { key: "range", label: "射程/范围", type: "text" },
    { key: "flavorText", label: "风味文本", type: "text", placeholder: "可选的斜体风味描述" },
    { key: "powerBlocks", label: "威能详情", type: "longtext" },
  ],
  equipment: [
    { key: "itemForm", label: "形态", type: "select", options: ["magic", "mundane"] },
    { key: "itemCategory", label: "类别", type: "select", options: ["武器", "护甲", "法器", "臂部", "头部", "颈部", "手部", "戒指", "腰部", "足部", "奇物", "另类奖励", "龙晶强化", "消耗品", "炼金物品", "冒险装备", "伙伴", "坐骑", "魔宠", "盾牌"], required: true },
    { key: "itemLevel", label: "物品等级", type: "text" },
    { key: "rarity", label: "稀有度", type: "select", options: RARITIES },
    { key: "flavorText", label: "风味文本", type: "text", placeholder: "可选的斜体风味描述（显示在卡片名字下）" },
    { key: "group", label: "分类组", type: "multichips", options: GROUPS, placeholder: "如：重型刀剑" },
    { key: "itemSuitable", label: "适合", type: "text", placeholder: "该装备适用的槽位/形态，如 臂部：任意盾牌、奇物：纹身（武器/法器/护甲 填「分类组」即可）" },
    { key: "enh", label: "增强加值", type: "text" },
    { key: "enhTarget", label: "增强对象", type: "text", placeholder: "增强作用于什么（如 攻击骰和伤害骰 / AC），默认按类别自动推导" },
    { key: "cost", label: "价格", type: "text" },
    { key: "weight", label: "重量", type: "text" },
    { key: "critical", label: "重击", type: "text" },
    { key: "subCategory", label: "子类别", type: "text", placeholder: "基础装备分组，如：军用近战武器 / 布甲（轻甲）/ 圣徽（从基础名录选择自动填入）" },
    { key: "proficiency", label: "擅长加值", type: "text", placeholder: "如：+3" },
    { key: "damage", label: "伤害", type: "text", placeholder: "如：1d8" },
    { key: "range", label: "射程", type: "text", placeholder: "如：10/20；近战填 —" },
    { key: "armorBonus", label: "护甲加值", type: "text", placeholder: "如：+6" },
    { key: "minEnhancement", label: "最小增强加值", type: "text", placeholder: "如：+1" },
    { key: "checkPenalty", label: "检定", type: "text", placeholder: "如：-1" },
    { key: "speed", label: "速度", type: "text", placeholder: "如：-1" },
    { key: "special", label: "特殊", type: "text" },
    { key: "baseType", label: "基本类型", type: "text", placeholder: "如：链甲" },
    { key: "proficiencyFeat", label: "擅长专长", type: "text", placeholder: "如：轻盾擅长" },
    { key: "shieldBonus", label: "盾牌加值", type: "text", placeholder: "如：+1" },
    { key: "powerSections", label: "物品威能段", type: "longtext" },
    { key: "properties", label: "物品特性", type: "longtext" },
  ],
  feat: [
    { key: "tierZh", label: "层级", type: "select", options: ["英雄", "典范", "天命", "史诗"] },
    { key: "featType", label: "专长类型", type: "multichips", options: FEAT_TYPES, placeholder: "如：职业专长" },
    { key: "prerequisite", label: "前提", type: "longtext", placeholder: "如：职业：战士" },
    { key: "benefit", label: "增益", type: "longtext", placeholder: "该专长带来的效果" },
    { key: "special", label: "特殊", type: "longtext", placeholder: "可选，如特殊说明/可多次选择" },
    { key: "featRows", label: "关联威能等级表", type: "longtext", placeholder: "流派专长的等级×关联威能列表" },
  ],
  // 种族数据 8 槽按官方 classTrait 头部顺序排列（平均身高→平均体重→属性调整→体型→速度→视觉→语言→技能奖励）
  race: [
    { key: "avgHeight", label: "平均身高", type: "text", placeholder: `官方「''平均身高：''」行文本，如：129cm-145cm/4'3"-4'9"` },
    { key: "avgWeight", label: "平均体重", type: "text", placeholder: `官方「''平均体重：''」行文本，如：73kg-100kg/160-220 lb` },
    { key: "abilityOne", label: "出生奖励属性1", type: "select", options: SIX_ABILITIES, placeholder: "如：力量（必然 +2 的那一项）" },
    { key: "abilityTwo", label: "出生奖励属性2", type: "select", options: SIX_ABILITIES, placeholder: "如：力量或感知" },
    { key: "size", label: "体型", type: "select", options: RACIAL_SIZES, placeholder: "如：中型" },
    // 速度：原版 54 个种族的速度一律是单一数值（4/5/6/7格），无一例外；额外移动方式（飞行/游泳/攀爬等）
    // 在原版里是写在「''速度：''」同一行的后缀文本（仅皮克精/蟾蜍怪 2 例），故这里只收数值，
    // 额外移动方式请写成种族特性行（车卡会把特性行原样展示，语义更清楚）。
    { key: "speed", label: "速度", type: "text", placeholder: "只填数值，单位「格」，如 6（保存时自动补成「6格」）；飞行/游泳等额外移动方式请写成种族特性行" },
    { key: "vision", label: "视觉", type: "multichips", options: VISIONS },
    { key: "languages", label: "语言", type: "text", placeholder: "官方「''语言：''」行文本，如：通用语，矮人语；写「任选两种」「A或B」时车卡会留空槽位供玩家自选" },
    { key: "skillBonus", label: "技能奖励", type: "text", placeholder: "官方「''技能奖励：''」行文本，须写成「+N技能名」并用「，」分隔，如：+2地城，+2坚韧" },
    { key: "raceTraits", label: "种族特性", type: "longtext", placeholder: "结构化特性行（名称 + 正文 + 可选替代），保存时拼装进 classTrait 块" },
    { key: "startingPower", label: "起始威能", type: "text", placeholder: "威能全名（如 矮人恢复力 Dwarven Resilience）。保存时在 classTrait 内追加「''短名：''你具有[[威能名]]威能。」行——车卡据此授予该威能——并输出 {{威能名}} 转clusion 行与官方文本对齐" },
    { key: "loreSections", label: "正文块", type: "longtext", placeholder: "可增删的正文块（标题 + 正文），保存时按序拼装在 classTrait 块之后" },
    { key: "raceAuxPowers", label: "辅助威能", type: "longtext", placeholder: "小节标题 + 引言 + 威能条目列表，保存时拼装为 `!! 标题` + `!!! 威能名` + 描述 + `{{威能名}}`" },
  ],
  class: [
    { key: "role", label: "职责", type: "select", options: ROLES },
    { key: "powerSource", label: "威能来源", type: "multichips", options: POWER_SOURCES },
    { key: "keySkill", label: "关键技能", type: "multichips", options: SKILLS },
    { key: "levelSections", label: "等级特性/威能", type: "longtext" },
  ],
  "paragon-path": [
    { key: "level", label: "等级", type: "text" },
    { key: "prerequisite", label: "前提", type: "longtext" },
    { key: "levelSections", label: "等级特性小节", type: "longtext" },
  ],
  "epic-destiny": [
    { key: "tierZh", label: "层级", type: "select", options: ["英雄", "典范", "天命", "史诗"] },
    { key: "prerequisite", label: "前提", type: "longtext" },
    { key: "levelSections", label: "等级特性小节", type: "longtext" },
  ],
  "magic-school": [{ key: "levelSections", label: "等级特性小节", type: "longtext" }],
  pact: [{ key: "levelSections", label: "等级特性小节", type: "longtext" }],
  bloodline: [{ key: "levelSections", label: "等级特性小节", type: "longtext" }],
  theme: [{ key: "levelSections", label: "等级特性小节", type: "longtext" }],
  domain: [{ key: "levelSections", label: "等级特性小节", type: "longtext" }],
  "item-set": [
    { key: "tier", label: "层级", type: "select", options: TIERS },
    { key: "setKnowledge", label: "知识（背景 lore）", type: "longtext", placeholder: "套装背景故事/传说段落（可折叠显示）" },
    { key: "setComponents", label: "套装组成", type: "multichips", delimiter: "，", placeholder: "组成本文物的物品名（多选，以顿号分隔；保存时生成 [[物品]] 链接列表）" },
    { key: "setBonuses", label: "套装增益", type: "longtext" },
  ],
  ritual: [
    { key: "ritualLevel", label: "仪式等级", type: "text" },
    { key: "ritualCategory", label: "仪式类别", type: "select", options: RITUAL_CATEGORIES },
    { key: "keySkill", label: "关键技能", type: "multichips", options: SKILLS },
    { key: "time", label: "时间", type: "text", placeholder: "如：10分钟" },
    { key: "cost", label: "材料花费", type: "text", placeholder: "如：25gp，和价值20gp的器材" },
    { key: "marketPrice", label: "市场价格", type: "text", placeholder: "如：125gp" },
    // 官方仪式卡的斜体风味引子（`//你的听众随着那安稳平静的曲调…//`）与效果正文是两回事：
    // 前者是卡片名字下的引子，后者是 ritualinfo 之后的效果描述，必须分开存放。
    { key: "flavorText", label: "风味文本", type: "text", placeholder: "可选的斜体风味描述（显示在卡片名字下）" },
  ],
  dictionary: [
    { key: "termsPairs", label: "词条对", type: "longtext", placeholder: "英文: 中文（每行一对）" },
  ],
  creature: [
    { key: "creatureBlock", label: "生物数据块", type: "longtext" },
  ],
};

// 全类型共用的外观自定义字段：每张卡头部可自定义配色与图标（默认保留各类型语义色）
export const APPEARANCE_FIELDS: SheetField[] = [
  {
    key: "cardColor",
    label: "卡片配色",
    type: "select",
    options: [
      "#9c27b0", "#3f51b5", "#009688", "#fb8c00", "#c62828", "#00897b", "#455a64",
      "#d81b60", "#7b1fa2", "#303f9f", "#0288d1", "#039be5", "#00796b", "#689f38",
      "#7cb342", "#f57c00", "#ef6c00", "#e64a19", "#5d4037", "#546e7a", "#616161",
      "#b71c1c", "#ad1457", "#4527a0", "#283593", "#01579b", "#b2ff59", "#ffca28",
    ],
  },
  {
    key: "cardIcon",
    label: "头部图标",
    type: "select",
    options: [
      "shield", "swords", "auto_awesome", "bolt", "star", "lock", "local_fire_department",
      "psychology", "spa", "colors", "palette", "skull", "raven",
      "local_florist", "globe_asia", "water_drop", "air", "terrain", "visibility",
      "health_and_safety", "favorite", "menu_book", "account_balance", "castle",
      "auto_awesome_mosaic", "public", "pets", "eco", "moon_stars", "forest",
      "device_hub", "hub", "rocket_launch", "contactless", "compost", "nightlight",
      "target", "lightbulb", "content_cut",
    ],
  },
];

// 分类下拉：官方主要分类（顺序与词条页一致）
export const CATEGORY_LIST: string[] = [
  "power", "equipment", "feat", "race", "class", "paragon-path", "epic-destiny",
  "item-set", "ritual", "theme", "domain", "magic-school", "pact", "vice",
  "virtue", "bloodline", "creature", "reference", "dictionary",
];

// 左侧表单按「右侧卡片组成部分」分区的顺序定义（value 为 SheetField.key 的子集）。
// 覆盖全部 19 类：每类按对应卡片消费的字段分区；未在 CATEGORY_FIELDS 登记专属标量的
// 纯通用类型（theme/domain 等）仅保留「归属 + 外观」，正文(sourceText)独立成区。
// 注意：tags（标签）是搜索/归类元数据，预览卡不渲染，统一放在末尾的「标签」面板（TAGS_SECTION）。
export interface HomebrewSection {
  title: string;
  keys: string[];
  /** 面板级提示文字（如标签面板说明其作用） */
  hint?: string;
  /** 核心面板：常驻展开；未标 core 的面板统一收进底部「附加设置」折叠区（主次分明） */
  core?: boolean;
  /** 专属渲染器标记：equip-stats = 装备「统计数据」用横排表组件（与右侧 ic-stats 逐行同构） */
  kind?: "equip-stats";
  /** 可选区块：非空 = 该面板可由用户开关（收起成「＋ 添加」细条；有内容自动展开；关闭时二次确认清空）。
   *  值为收起态细条上的说明文案（如「官方 72% 装备含威能段；消耗品/基础装备常不需要」）。 */
  optional?: string;
}
/** 标签（tags）为元数据：仅用于搜索与归类，不会显示在卡片上。 */
export const TAGS_SECTION: HomebrewSection = {
  title: "标签",
  keys: ["tags"],
  hint: "用于搜索与归类（逗号分隔），不会显示在卡片上，可留空。",
};

export const CATEGORY_SECTIONS: Record<string, HomebrewSection[]> = {
  equipment: [
    // 面板顺序与装备卡视觉、官方 details 顺序（等级表→分类→增强→重击→特性→威能）一致：
    // 抬头(meta) → 风味文本 → 统计表 → 特性 → 威能 → 正文。
    // 「统计数据」用横排表渲染器（kind:"equip-stats"），行集由形态/类别(装备族)自动决定；
    // 基础专属字段（subCategory + MUNDANE_FIELDS）由该组件按 MUNDANE_STAT_ROWS 呈现。
    { title: "基本信息 · 装备", keys: ["name", "nameEn", "source", "itemForm", "itemLevel", "rarity"], core: true },
    { title: "风味文本", keys: ["flavorText"], core: true },
    { title: "统计数据", keys: ["group", "itemSuitable", "enh", "critical", "cost", "weight", "subCategory", ...MUNDANE_FIELDS], core: true, kind: "equip-stats", hint: "统计行按装备族/形态自动决定，与右侧卡片统计表一一对应。" },
    { title: "物品特性", keys: ["properties"], core: true, optional: "纯文本特性描述（如潜行加值、伤害免疫等）；消耗品、基础装备常不需要" },
    { title: "物品威能", keys: ["powerSections"], core: true, optional: "官方 72% 装备含威能段；消耗品、基础装备常不需要", },
    { title: "正文", keys: ["sourceText"], core: true, optional: "自由 Markdown 补充（背景故事/变体规则/DM 备注）；官方装备无此部分" },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ],
  power: [
    // 面板顺序与威能卡视觉从上到下、从左到右一致：抬头 → 风味文本 → 关键词行（频率✦关键词 / 动作✦射程）→ 数据（标签块）
    { title: "基本信息 · 威能", keys: ["name", "nameEn", "source", "grantedBy", "powerType", "level"], core: true },
    { title: "风味文本", keys: ["flavorText"], core: true },
    { title: "使用频率", keys: ["usageZh"], core: true },
    { title: "关键词", keys: ["keywords"], core: true },
    { title: "动作与射程", keys: ["actionType", "range"], core: true },
    { title: "威能详情（标签块）", keys: ["powerBlocks"], core: true },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ],
  feat: [
    { title: "基本信息 · 专长", keys: ["name", "nameEn", "source", "tierZh", "featType"], core: true },
    { title: "增益", keys: ["benefit"], core: true },
    { title: "前提", keys: ["prerequisite"] },
    { title: "特殊", keys: ["special"] },
    { title: "关联威能等级表", keys: ["featRows"] },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ],
  race: [
    { title: "基本信息 · 种族", keys: ["name", "nameEn", "source"], core: true },
    {
      title: "种族数据",
      keys: ["avgHeight", "avgWeight", "abilityOne", "abilityTwo", "size", "speed", "vision", "languages", "skillBonus"],
      core: true,
      hint: "顺序即官方 classTrait 头部顺序；保存时逐行写入 classTrait 块，车卡据此自动回填属性调整/体型/速度/视觉/语言/技能奖励。",
    },
    { title: "种族特性", keys: ["raceTraits"], core: true, hint: "正文内写 [[威能名]]，保存后车卡会自动授予该威能；正文含「替代「XX」」时车卡识别为替换关系。" },
    { title: "起始威能", keys: ["startingPower"], core: true, hint: "该种族自带的种族威能（如矮人的「矮人恢复力」）。填全名后保存时会在 classTrait 内写一行「''短名：''你具有[[威能全名]]威能。」，车卡据此把该威能授予角色（种族/辅助槽）；同时在块后输出 {{威能全名}} 转clusion 行与官方文本对齐。" },
    { title: "正文", keys: ["loreSections"], core: true, hint: "按块拼装在 classTrait 块之后；首块无标题时作为「种族背景」引言，其余无标题块并入前一块。辅助威能请填在下面的专用分区。" },
    { title: "辅助威能", keys: ["raceAuxPowers"], core: true, hint: "结构固定为「小节标题 + 引言 + 威能条目」；每条威能保存时写成 `!!! 威能名` + 描述 + `{{威能名}}` 三行，车卡据此渲染可悬浮、带「选择此威能」的威能条目。威能名建议与数据库中的威能全名一致（中文 English）。" },
    TAGS_SECTION,
  ],
  class: [
    { title: "基本信息 · 职业", keys: ["name", "nameEn", "source"], core: true },
    { title: "职业数据", keys: ["role", "powerSource", "keySkill"], core: true },
    { title: "等级特性/威能表", keys: ["levelSections"], core: true },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ],
  "paragon-path": [
    { title: "基本信息 · 典范之道", keys: ["name", "nameEn", "source"], core: true },
    { title: "典范条件", keys: ["level", "prerequisite"], core: true },
    { title: "等级特性小节", keys: ["levelSections"], core: true },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ],
  "epic-destiny": [
    { title: "基本信息 · 传奇天命", keys: ["name", "nameEn", "source"], core: true },
    { title: "天命条件", keys: ["tierZh", "prerequisite"], core: true },
    { title: "等级特性小节", keys: ["levelSections"], core: true },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ],
  "item-set": [
    { title: "基本信息 · 物品套装", keys: ["name", "nameEn", "source"], core: true },
    { title: "套装信息", keys: ["tier"], core: true },
    { title: "知识（lore）", keys: ["setKnowledge"], core: true },
    { title: "套装组成", keys: ["setComponents"], core: true },
    { title: "套装增益", keys: ["setBonuses"], core: true },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ],
  ritual: [
    { title: "基本信息 · 仪式", keys: ["name", "nameEn", "source"], core: true },
    // 顺序对齐官方仪式卡：抬头 → 风味引子 → ritualinfo 数据行 → 效果正文
    { title: "风味文本", keys: ["flavorText"], core: true },
    { title: "仪式信息", keys: ["ritualLevel", "ritualCategory", "keySkill", "time", "cost", "marketPrice"], core: true },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ],
  dictionary: [
    { title: "基本信息 · 译名字典", keys: ["name", "nameEn", "source"], core: true },
    { title: "词条对", keys: ["termsPairs"], core: true },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ],
  // —— 纯通用型：正文为「等级特性小节」结构化的类型，加 levelSections core 区 ——
  theme: powerRefSections("主题"),
  domain: powerRefSections("领域"),
  "magic-school": powerRefSections("魔法学派"),
  pact: powerRefSections("契约"),
  bloodline: powerRefSections("血统"),
  // 以下类型保持纯正文 + lore
  vice: genericSections("败德"),
  virtue: genericSections("美德"),
  creature: [
    { title: "基本信息 · 生物", keys: ["name", "nameEn", "source"], core: true },
    { title: "生物数据块", keys: ["creatureBlock"], core: true, hint: "数据块 = 头部（名称/角色/体型·源界·类别）+ 双栏数据行 + 行动/特质/灵气段。序列化保持官方 div.creature 格式。" },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ],
  reference: genericSections("术语"),
};

// 威能引用类：基本信息 core + 等级特性小节（威能引用编辑器）core + 外观/标签 附加设置。
function powerRefSections(label: string): HomebrewSection[] {
  return [
    { title: `基本信息 · ${label}`, keys: ["name", "nameEn", "source"], core: true },
    { title: "等级特性小节", keys: ["levelSections"], core: true, hint: "每个小节 = 等级 + 标题 + 类型（特性/威能）+ 正文 + 威能引用。保存时拼装为「!! N级：标题」分节正文。" },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ];
}

// 纯通用类型的分区：仅「基本信息 + 外观 + 标签」，正文独立成区（无专属标量字段）。
export function genericSections(label: string): HomebrewSection[] {
  return [
    { title: `基本信息 · ${label}`, keys: ["name", "nameEn", "source"], core: true },
    { title: "外观", keys: ["cardColor", "cardIcon"] },
    TAGS_SECTION,
  ];
}

/** 在编辑表单中「不显示正文(sourceText)区」的分类：只在卡片真正渲染 details/sourceText 的类型出现正文区。
 *  feat：卡片不渲染 details；power：详情完全由「标签块」派生，不再提供自由 Markdown 正文。 */
// 这两类正文完全由结构化编辑器派生（power：标签块；dictionary：词条对），不再提供自由 Markdown 正文区。
export const POWER_REF_CATEGORIES: ReadonlySet<string> = new Set([
  "magic-school", "pact", "bloodline", "theme", "domain",
  "epic-destiny", "paragon-path", "class",
]);
export const WITHOUT_BODY: ReadonlySet<string> = new Set(["feat", "power", "dictionary"]);

export function fieldsFor(cat: string): SheetField[] {
  return [...COMMON, ...(CATEGORY_FIELDS[cat] ?? []), ...APPEARANCE_FIELDS];
}

export function splitTags(s: string): string[] {
  return s
    .split(/[，,、]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

