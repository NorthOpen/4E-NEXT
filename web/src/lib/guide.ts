// 导引模式（新手教程）：步骤定义 + 进度持久化。
//
// 与「教学模式」（lib/tutorial.ts，聚光灯分步介绍各个页面入口）的分工：
//   · 教学模式讲的是「车卡器有哪些页面」，一次性、被动跟随，讲完就结束；
//   · 导引模式讲的是「人物卡怎么车出来」，由用户在导航栏主动点击才开始，
//     并且**强制新建一张空白人物卡**，把车卡页的板块一块块拆下来边讲边做。
//
// 「分布式」的含义：导引不另做一套简化界面 —— 每一步的舞台就是车卡器真实的板块
// （CharacterSheet 的 onlyPanels 只渲染被拆出来的那几块）或真实的其它页面
// （背景 / 储备 / 速览：导引把用户送过去，页面上跟着悬浮导引条，随时可以回来）。
// 因此导引里填的每一个字都直接写进人物卡，与正常车卡完全同源，
// 不存在「教程里的卡」和「真正的卡」两份数据。
//
// 进度只记 (cardId, stepId)：卡片内容由 App 的自动存档负责，
// 用户中途点去别的页面、关掉浏览器再回来，内容与进度都还在。

import { platform } from "@platform";
import { safeSetItem } from "./storage";
import type { Character } from "../sheet/character";
import type { SheetPanelId } from "./sheetLayout";

/** 导引进度存档键 */
export const GUIDE_RUN_KEY = "4enext.guideRun.v1";

/** 导引强制新建的那张卡的默认卡名（用户可随时在存档面板里改名） */
export const GUIDE_CARD_NAME = "导引角色";

/** 章节：进度条按章节分段留白，用户一眼能看出「现在在讲哪一大块」 */
export type GuideChapter = "start" | "identity" | "numbers" | "ability" | "gear" | "wrap";

export const GUIDE_CHAPTER_LABEL: Record<GuideChapter, string> = {
  start: "起步",
  identity: "身份",
  numbers: "数值",
  ability: "能力",
  gear: "装备",
  wrap: "收尾",
};

/**
 * 每一步的舞台。
 *   panel   —— 车卡页的板块（onlyPanels 拆出来单独渲染；可以给多块，按数组顺序上下排列）
 *   page    —— 背景 / 储备 / 速览这类独立页面：就地渲染在导引里（进度条不会消失），
 *              讲解里会顺带说明「它平时挂在导航栏的哪一项上」，用户之后自己也知道怎么去
 *   custom  —— 导引自带的说明卡（欢迎、存档导出、完成）
 */
export type GuideStage =
  | { kind: "panel"; panels: SheetPanelId[] }
  | { kind: "page"; page: "background" | "reserve" | "overview" }
  | { kind: "custom"; card: "welcome" | "save" | "finish" };

/** 导引里额外提供的抽卡挑选：独立弹窗，按槽位发牌（见 sheet/DrawDialog.tsx） */
export type GuideDrawKind = "power" | "feat";

/** 「角色信息」板块里可以被导引临时锁住的栏位（种族 / 英雄职阶） */
export type GuideLockablePicker = "race" | "class";

export interface GuideStep {
  id: string;
  chapter: GuideChapter;
  /** 步骤标题（讲解卡与进度条悬浮提示用） */
  title: string;
  /** 进度条上的短标签，2–4 字 */
  short: string;
  stage: GuideStage;
  /** 讲解正文：一段一条，逐段渲染 */
  body: string[];
  /** 要点清单 */
  tips?: string[];
  /** 本步要做的事（显示为「本步目标」） */
  task?: string;
  /** 完成判据：满足时「本步目标」自动打勾（只提示，不阻拦翻页） */
  done?: (c: Character) => boolean;
  /** 舞台内的高亮锚点：命中 [data-guide="..."] 的元素会被圈出来 */
  focus?: string;
  /** 舞台标题右侧的补充说明 */
  stageNote?: string;
  /**
   * 本步在舞台上方提供一个「抽卡挑选」按钮：点开是独立的抽卡弹窗（发牌 → 选一张 → 写进你选的槽位）。
   * 抽卡是导引特别提供的挑选辅助，普通车卡的槽位选择器里不出现它。
   */
  draw?: GuideDrawKind;
  /**
   * 本步允许点击的「角色信息」选择栏：没列出来的会被灰掉（不可点）。
   * 新手容易在还没听到讲解之前就把种族/职阶点掉，于是按步骤逐个解锁：
   * 讲种族那步解锁 race，讲职阶那步解锁 class，其余步骤全锁。
   */
  unlock?: GuideLockablePicker[];
  /** 只在满足条件时出现在步骤表里（如典范之道要 11 级） */
  when?: (c: Character) => boolean;
}

/** 1 级时该填满的威能槽位（沿用升级表）：随意 2 / 遭遇 1 / 每日 1 */
const L1_POWERS = { atWill: 2, encounter: 1, daily: 1 };

/**
 * 步骤顺序 = 实车卡的顺序，而不是板块在页面上的排列顺序：
 * 先角色信息（姓名），再出身（种族→职业），然后是数值（属性→技能），
 * 接着才是能力（威能→专长）、装备与命中伤害的核对，最后收尾。
 * 每一步的 stage 决定了用哪一块真实板块 / 哪一个真实页面当舞台。
 */
export const GUIDE_STEPS: GuideStep[] = [
  {
    id: "welcome",
    chapter: "start",
    title: "欢迎来到导引模式！",
    short: "起步",
    stage: { kind: "custom", card: "welcome" },
    body: [
      "此模式是为新手准备的分布式车卡模式。在接下来步骤中，系统将为您拆解并说明如何在 4E-NEXT 里进行车卡。",
      "导引模式所附带的指南将会尽可能的简洁明了，力求以最快捷的方式带完人物卡的完整制作。即便如此，对于规则问题等，仍然建议您首先通读《玩家手册》。",
      "4E-NEXT 通过存档功能来管理人物卡。导引模式已经自动为您新建了一张空白人物卡，在存档里叫「" + GUIDE_CARD_NAME + "」。您可以随时对这张人物卡的存档名进行重命名。",
      "对于初学者，建议您从 1 级开始建卡。",
    ],
    tips: ["顶部进度条点击任意一段可以进行跳转。"],
    task: "看完说明后，让我们开始吧？",
  },
  {
    id: "info",
    chapter: "identity",
    title: "从「角色信息」开始",
    short: "角色信息",
    stage: { kind: "panel", panels: ["info"] },
    focus: "name",
    stageNote: "车卡页 · 角色信息板块（本步的种族与职阶先锁住）",
    unlock: [],
    body: [
      "正如一本小说的开头，导读总会先简述主角的基本信息一般，「角色信息」板块内就像标签一样帮助您快速构建角色。",
      "先给角色起个名字吧。其余栏位（性别、年龄、体型、身高、体重、信仰、阵营、组织等）都可以留空，当然，如果您有想法，也可以随手填上。",
      "不过，先不要着急选择种族和职业，在之后的步骤里，我们会结合其他板块，一并介绍它们的填写方法。",
    ],
    tips: [
      "导入图片进入立绘框时，将会帮助您裁切并压缩图片的体积。立绘会跟随人物卡存档。",
      "在经验栏填够足额经验时，会自动折算等级，反之亦然。",
      "语言一栏将会自动按照种族数据填写，但也支持您的手动增减与加入自定义内容。",
    ],
    task: "给角色起一个名字",
    done: (c) => c.name.trim().length > 0 && c.name.trim() !== "未命名角色",
  },
  {
    id: "race-pick",
    chapter: "identity",
    title: "选择种族",
    short: "选种族",
    stage: { kind: "panel", panels: ["info"] },
    focus: "race-pick",
    stageNote: "车卡页 · 角色信息板块的「种族」栏",
    unlock: ["race"],
    body: [
      "点击「种族」将会打开种族选择器。可以按名称搜索，也可以通过点选属性按钮，筛选出提供对应属性加值的种族。",
      "大部分的 4E 种族将给与你两项属性 +2 的加值，包含一项固定加值和可选加值，可选加值的选择，我们将在之后的步骤里进行。",
    ],
    tips: ["种族还将决定角色的基础速度、视觉、体型、语言、技能加值，以及可能存在的种族威能。"],
    task: "选定一个种族",
    done: (c) => !!c.raceId,
  },
  {
    id: "race-panel",
    chapter: "identity",
    title: "使用「种族特性」板块",
    short: "种族特性",
    stage: { kind: "panel", panels: ["race"] },
    focus: "race-traits",
    stageNote: "车卡页 · 种族特性板块",
    body: [
      "这块板块将直接展示你所选种族的全部内容：属性加值、体型与速度、视觉、语言、技能加值，以及种族威能。",
      "为了方便观看，部分内容以标题为单位被收起，您可以通过点击的形式展开并阅览。",
    ],
    tips: [
      "右上的「简洁 / 详细」按钮，将会改变文字详略的显示模式，它不会影响任何数据。",
      "如果您选择的种族存在可替换的亚种，「亚种」按钮将会出现，您可以自由切换，选中的亚种增益会替换掉对应的基础特性。",
      "种族辅助威能将会提供一个快捷的选择按钮。",
    ],
    task: "通读一遍种族特性",
  },
  {
    id: "class-pick",
    chapter: "identity",
    title: "选择英雄职阶",
    short: "选职业",
    stage: { kind: "panel", panels: ["info"] },
    focus: "class-pick",
    stageNote: "车卡页 · 角色信息板块的「英雄职阶」栏",
    unlock: ["race", "class"],
    body: [
      "点击「英雄职阶」将会打开职业选择器。职业决定你的战斗定位、生命值与回复力、防御加值、受训技能数量，以及您能选择哪些威能。",
      "在 1 级时，一个职业会给你：2 个随意攻击威能、1 个遭遇攻击威能、1 个每日攻击威能、1 个专长，以及若干受训技能。",
    ],
    tips: [
      "职业选择器内拥有独立的混职切换开关，但如果您是第一次车卡，我们强烈建议您不要使用混职模式。",
      "更换职业将会清除掉上一个职业授予的威能。",
    ],
    task: "选定一个职业",
    done: (c) => !!c.classId,
  },
  {
    id: "class-panel",
    chapter: "identity",
    title: "使用「职业能力」板块",
    short: "职业能力",
    stage: { kind: "panel", panels: ["class"] },
    focus: "class-features",
    stageNote: "车卡页 · 职业能力板块",
    body: [
      "职业能力板块将会列出职业的全部特性：职业特性、需要在若干选项里挑一个的选择型特性（如法师的学派、牧师的神域等），以及职业赠予的威能、专长与仪式。",
      "带选项的特性会在内部提供可选的按钮，点完即写入人物卡；赠予的威能会出现在威能板块的「特殊」分组里，不占常规槽位。",
    ],
    tips: [
      "还没达到对应等级的特性会以折叠形式出现。",
      "「混职」职业会有两块职业能力，并多出一个「详情」按钮查看原始数据。",
      "有选项却还没选时，之后步骤里涉及的威能板块可能会缺失内容。",
    ],
    task: "挑选职业选项",
  },
  {
    id: "stats",
    chapter: "numbers",
    title: "「角色数值」板块：分配属性",
    short: "属性",
    stage: { kind: "panel", panels: ["stats"] },
    focus: "abilities",
    stageNote: "车卡页 · 角色数值板块",
    body: [
      "属性决定攻击、伤害、防御、技能与生命。新卡的默认数组是 8/10/10/10/10/10，打开「购点」开关后，可以基于 22 购点法将六项属性分配到 8–18 之间。",
      "在您为属性板块进行分配后，周遭板块会自动算出基于属性的基础先攻、抵御（AC/强韧/反射/意志）、移动力与生命等数值。",
    ],
    tips: [
      "打开「购点」开关后，新出现的「购点 N/22」按钮可以被再次点击，里面塞入了四套常用的属性数组，您可以通过自由调整属性分配来一键套用对应数组。",
      "使用「查看详情」按钮将为您呈现具体的数据构成（如基础值、种族、提升、自定义等）。",
      "当您达到对应等级，得到属性提升时，属性的提升也要在这里分配。",
    ],
    task: "使用 22 购点法或自由分配你的基础属性",
    // 判据：属性不再是新卡的默认数组（8/10/10/10/10/10）——只要有一项不是 8 或 10，就说明动过手了
    done: (c) => Object.values(c.abilities).some((v) => v !== 8 && v !== 10),
  },
  {
    id: "skills",
    chapter: "numbers",
    title: "填写受训",
    short: "技能",
    stage: { kind: "panel", panels: ["skills"] },
    focus: "skills",
    stageNote: "车卡页 · 技能板块",
    body: [
      "在「技能」板块，您可以决定哪些技能受训。",
      "详细模式下，直接点击相应技能就能切换受训状态；下方「职业技能受训」列出了本职业允许您选的那些技能，并允许您快速勾选。",
    ],
    tips: [
      "您选择职业自动受训的技能会标出来，不占选择名额。",
      "护甲减值会自动作用在运动、坚韧、杂技、隐秘、盗术上。",
      "每一项技能的构成可以使用「查看详情」逐个核对。",
    ],
    task: "把职业允许的受训技能选满",
    done: (c) => c.trainedSkills.filter(Boolean).length > 0,
  },
  {
    id: "powers",
    chapter: "ability",
    title: "挑选威能",
    short: "威能",
    stage: { kind: "panel", panels: ["powers"] },
    focus: "power-slots",
    stageNote: "车卡页 · 威能板块",
    draw: "power",
    body: [
      "威能按「随意 / 遭遇 / 每日 / 辅助 / 特殊」分组，每个空格上都标着它应该填几级的威能（由升级表推导）。在 1 级时，您应该拥有 2 个随意威能、1 个遭遇威能、1 个每日威能。",
      "点任意空格打开威能选择器：默认只列出本职与种族的威能，可以按类别、等级、来源筛选，也可以全文搜索。",
    ],
    tips: [
      "不想自己挑选？您可以使用只在导引模式特别提供的抽卡模式来快速挑选，抽卡模式会随机为您提供 3 个威能进行选择，并允许您即时重抽 2 次。",
      "威能等级只要不高于槽位等级即可，升级时，可以用新威能替换旧槽位。",
      "种族威能与职业赠予的威能会出现在「特殊」分组，不占用常规槽位。",
    ],
    task: "至少填进 1 个威能",
    done: (c) => Object.values(c.powerSlots).some((slots) => slots.some(Boolean)) && c.powerSlots.atWill.filter(Boolean).length >= L1_POWERS.atWill,
  },
  {
    id: "feats",
    chapter: "ability",
    title: "挑选专长",
    short: "专长",
    stage: { kind: "panel", panels: ["feats"] },
    focus: "feat-slots",
    stageNote: "车卡页 · 专长板块",
    draw: "feat",
    body: [
      "一般而言，您 1 级将获得 1 个英雄级专长。",
      "选择器按层级 / 类型把专长归类（种族、职业、技能、流派、通用），也支持进行搜索。",
    ],
    tips: [
      "前置条件不会自动过滤：灰色或看起来无关的条目，先看它的前提（属性、种族、职业、等级）。",
      "部分专长会让你再选择一次（某类武器、某个法器、混职天赋）。",
      "如果专长携带了威能，将会自动被纳入威能板块；替换型专长则会寻问您替换掉哪个格子。",
    ],
    task: "选好 1 级专长",
    done: (c) => c.featSlots.filter(Boolean).length > 0,
  },
  {
    id: "paragon",
    chapter: "ability",
    title: "典范之道（11 级起）",
    short: "典范",
    stage: { kind: "panel", panels: ["paragon"] },
    focus: "paragon",
    stageNote: "车卡页 · 典范特性板块",
    when: (c) => c.level >= 11,
    body: [
      "11 级开始，角色要选一条典范之道：它是职业的进阶方向，带来 11/12/16/20 级的特性与专属威能。",
      "选择入口仍在「角色信息」板块的「典范之道」栏（11 级才会解锁），这一块板块展示的是选完之后拿到的内容。",
    ],
    tips: [
      "典范之道的遭遇威能与每日威能会占据威能板块里相应等级的槽位。",
      "前提条件（种族、职业、擅长）会写在条目的前置里，选择器不会替你过滤。",
    ],
    task: "选定一条典范之道",
    done: (c) => !!c.paragonPathId,
  },
  {
    id: "epic",
    chapter: "ability",
    title: "传奇天命（21 级起）",
    short: "天命",
    stage: { kind: "panel", panels: ["epic"] },
    focus: "epic",
    stageNote: "车卡页 · 天命特性板块",
    when: (c) => c.level >= 21,
    body: [
      "21 级进入传奇层级，角色要选一个传奇天命：它是角色的「结局」，决定 21 级之后的特性、威能与最终的传奇命运。",
      "入口在「角色信息」板块的「传奇天命」栏（21 级解锁）。",
    ],
    tips: [
      "天命特性里常有「全部属性 +1」「威能替换」这类影响面较大的条目，选完记得回头看属性与威能板块。",
      "24/26/29 级还有天命特性与辅助威能，升级时按板块提示补齐即可。",
    ],
    task: "选定一个传奇天命",
    done: (c) => !!c.epicDestinyId,
  },
  {
    id: "equipment",
    chapter: "gear",
    title: "挑选装备",
    short: "装备",
    // 金钱板块一并带上，且排在装备之上：1 级卡要先「记一笔收入」才谈得上买东西
    stage: { kind: "panel", panels: ["money", "equipment"] },
    focus: "equip-slots",
    stageNote: "车卡页 · 金钱板块（上）+ 装备板块（下）",
    body: [
      "装备板块分主手 / 副手 / 护甲 / 法器 / 其他 / 消耗品 / 冒险装备 / 奇物几组。基础武器、基础护甲这些装备与魔法物品是分开选的：先点槽位选择基础装备（决定伤害骰与防御），再用附魔槽位来选择魔法物品。",
      "金钱板块会同步统计自动花销与余额。对于 1 级卡而言，一般的购物资金为 100gp，不妨向金钱板块的新增收入填入 100gp 并确定，然后开始购物吧？",
      "当然，1 级卡是没有足够的资金购买魔法物品的。但这也能减少您挑选的烦恼。",
    ],
    tips: [
      "根据您的职业、种族、专长里列着给你的武器/法器/护甲擅长，装备选择器内将会自动为您标识擅长的装备，一般而言，我们都建议您不要选择没有擅长标识的装备。",
      "沉重的护甲会带来对技能的护甲减值。",
      "由于团内情况千变万化，4E-NEXT 没有按照标准购物表强制锁定您的等级初始购物资金，请咨询您的主持确定具体金额。",
    ],
    task: "至少装备一把武器或一件法器",
    done: (c) => c.equipmentSlots.some(Boolean) || Object.keys(c.baseItems).length > 0,
  },
  {
    id: "hit",
    chapter: "gear",
    title: "核对「命中」表",
    short: "命中",
    stage: { kind: "panel", panels: ["hit"] },
    focus: "hit",
    stageNote: "车卡页 · 命中板块",
    body: [
      "命中板块自动汇总了属性调整值、熟练加值、增强加值、专长与职业加值，以此来算出正常情况下，您角色某项攻击手段所具备的攻击加值。",
      "您可以自由的为您的攻击方式，如基本攻击、某个威能创建新的命中并进行追踪。",
    ],
    tips: [
      "行里的来源单元格可以点击，既能选自动来源，也能填其他来自定义加值。",
      "增减按钮将会成对增减攻击与伤害两个板块，确保一个命中对应一个伤害，反之亦然。",
      "使用「骰子指令」按钮可以快捷显示本栏命中所使用的骰子表达式，您可以复制并快捷使用。",
    ],
    task: "核对每一行的攻击加值是否合理",
  },
  {
    id: "damage",
    chapter: "gear",
    title: "核对「伤害」表",
    short: "伤害",
    stage: { kind: "panel", panels: ["damage"] },
    focus: "damage",
    stageNote: "车卡页 · 伤害板块",
    body: [
      "伤害板块自动汇总了属性调整值、熟练加值、增强加值、专长与职业加值，以此来算出正常情况下，您角色某项攻击手段所具备的伤害加值。",
      "您可以自由的为您的攻击方式，如基本攻击、某个威能创建新的伤害并进行追踪。",
    ],
    tips: [
      "「查看详情」里能看到伤害加值的完整构成，包括自定义条目。",
      "暴击时的额外伤害也在这张表的行内标注（来自魔法物品的暴击骰）。",
    ],
    task: "核对伤害骰与加值",
  },
  {
    id: "background",
    chapter: "wrap",
    title: "背景页面",
    short: "背景页",
    stage: { kind: "page", page: "background" },
    stageNote: "独立页面 · 左侧导航栏 →「背景」",
    body: [
      "背景需要在左侧的导航栏切换至独立页面，在这里为您提供了四个自由的填写区：性格外貌、人物设定、背景与主体奖励、冒险笔记。",
      "在导引模式下，您可以简单的记录一点零散的思路，可以在之后进行填充。",
    ],
    task: "填写一个您对角色期望的关键词",
    done: (c) => !!(c.creation?.personality || c.creation?.concept || c.creation?.background || c.creation?.notes),
  },
  {
    id: "reserve",
    chapter: "wrap",
    title: "储备页面",
    short: "储备页",
    stage: { kind: "page", page: "reserve" },
    stageNote: "独立页面 · 左侧导航栏 →「储备」",
    body: [
      "储备需要在左侧的导航栏切换至独立页面，储备页是人物卡的后备仓库，法师的法术书、游戏中获取的魔法装备、暂时不用的威能与装备，都可以被放至其中。",
      "在威能/装备板块点击开启「与储备交换」，便可交换储备和人物页面的对应槽位内容。",
    ],
    tips: ["储备页面槽位不受槽位等级限制，换进人物页面槽位时再按规则核对即可。"],
    task: "认识「储备」页面",
  },
  {
    id: "overview",
    chapter: "wrap",
    title: "速览页面",
    short: "速览页",
    stage: { kind: "page", page: "overview" },
    stageNote: "独立页面 · 左侧导航栏 →「速览」",
    body: [
      "速览需要在左侧的导航栏切换至独立页面，速览是给游戏现场使用的紧凑面板，方便您快速的跟踪与查询角色数据。",
      "它和人物页共享同一份数据，但一些游戏内临时数据仅在速览页面被记录。",
    ],
    tips: ["使用短休/长休按钮会按规则为您进行相应的资源与恢复。"],
    task: "认识「速览」页面",
  },
  {
    id: "save",
    chapter: "wrap",
    title: "存档与导出",
    short: "存档",
    stage: { kind: "custom", card: "save" },
    stageNote: "导航栏「存档」按钮打开的面板",
    body: [
      "存档需要在左侧的导航栏点击并打开独立弹窗。对人物卡的每一步更改都是自动保存的，在这里，你可以向其他 4E-NEXT 用户分享你的卡片，或管理多张人物卡。",
      "导出支持 PNG / JPG / PDF（渲染成干净的角色卡图片）与 JSON（备份整个角色数据，可再导入）。",
    ],
    tips: ["导引为你新建的人物卡就在存档列表里，可以改名成你喜欢的角色名。"],
    task: "打开一次存档面板看看",
  },
  {
    id: "finish",
    chapter: "wrap",
    title: "导引结束",
    short: "完成",
    stage: { kind: "custom", card: "finish" },
    body: [
      "恭喜！如果您跟随导引进行了每一步操作，您已经顺利的制作出了您的第一张人物卡！",
      "请核对您的填写内容，这张卡随时都可以被继续编辑。",
    ],
    tips: ["想再来一遍？使用「重新开始导引（新建人物卡）」。"],
    task: "核对清单项目",
  },
];

/** 可见步骤的缓存键：只看 when 的结果，属性每次微调不该重算步骤表 */
function stepSignature(c: Character): string {
  return GUIDE_STEPS.map((s) => (s.when ? (s.when(c) ? "1" : "0") : "1")).join("");
}

let cachedSignature = "";
let cachedSteps: GuideStep[] = GUIDE_STEPS;

/**
 * 当前人物卡下可见的步骤表。
 * 用签名做单条缓存，保证「属性每敲一个字」不会产生新的数组身份 ——
 * 否则依赖步骤对象的高亮 / 滚动副作用会被反复触发。
 */
export function guideSteps(char: Character): GuideStep[] {
  const sig = stepSignature(char);
  if (sig !== cachedSignature) {
    cachedSignature = sig;
    cachedSteps = GUIDE_STEPS.filter((s) => !s.when || s.when(char));
  }
  return cachedSteps;
}

/**
 * 本步在「角色信息」板块里应当被锁住的栏位：没在 unlock 里列出来的就锁上。
 * 只对 stage 是角色信息板块的步骤有意义，其余步骤那块板块根本不在舞台上。
 */
export function guideLockedPickers(step: GuideStep): GuideLockablePicker[] {
  const open = step.unlock ?? [];
  return (["race", "class"] as GuideLockablePicker[]).filter((k) => !open.includes(k));
}

/** 取某一步在步骤表里的下标；找不到（步骤被改过）时回到第一步 */
export function guideStepIndex(steps: GuideStep[], id: string | undefined): number {
  const i = steps.findIndex((s) => s.id === id);
  return i < 0 ? 0 : i;
}

export interface GuideRun {
  /** 导引专用的那张人物卡 */
  cardId: string;
  /** 当前停在哪一步（存 id 而不是下标：步骤表被编辑过也不会串位） */
  stepId: string;
  startedAt: number;
}

/** 读取进行中的导引；没有或数据损坏时返回 null */
export function loadGuideRun(): GuideRun | null {
  try {
    const raw = platform.storage.getItem(GUIDE_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuideRun>;
    if (!parsed || typeof parsed.cardId !== "string" || typeof parsed.stepId !== "string") return null;
    return { cardId: parsed.cardId, stepId: parsed.stepId, startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : Date.now() };
  } catch {
    return null;
  }
}

/** 写入进行中的导引；传 null 表示这次导引结束（清掉记录） */
export function saveGuideRun(run: GuideRun | null): void {
  if (!run) {
    try {
      platform.storage.removeItem(GUIDE_RUN_KEY);
    } catch {
      /* 删不掉不影响本次会话 */
    }
    return;
  }
  safeSetItem(GUIDE_RUN_KEY, JSON.stringify(run));
}

/** 本步目标的完成状态：无判据返回 undefined（显示成中性提示） */
export function guideTaskDone(step: GuideStep, char: Character): boolean | undefined {
  return step.done ? step.done(char) : undefined;
}
