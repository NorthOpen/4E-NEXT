// 教学模式：分步定义 + 「这台机器是不是新用户」判定 + 播放记录。
//
// 为什么新用户判定必须在模块求值时（而不是组件挂载后）做一次快照：
// App 的 useState 初始值里就会写入 4enext.cards.v1 —— 本机没有存档时它会自动建一张
// 「角色 1」并存下去（见 App.tsx）。那是首次渲染期间发生的事，等到任何 useEffect
// 跑起来时，localStorage 里必然已经有 4E NEXT 的数据了，
// 「这台机器此前到底有没有用过」这个问题就再也答不出来。
// 所以这里在 import 阶段读一次并冻结成常量，后续只认这个快照。

import { platform } from "@platform";
import { safeSetItem } from "./storage";
import type { View } from "../App";

/** 教学是否播放过的标记（值存版本号，便于改动步骤后让老用户再看一次新的引导） */
export const TUTORIAL_SEEN_KEY = "4enext.tutorialSeen.v1";

/** 教学内容版本。步骤有实质变化时提高它，看过旧版的人会重新看到一次。 */
export const TUTORIAL_VERSION = "1";

/**
 * 本机此前是否完全没有 4E NEXT 的数据。
 * 读不到存储（无痕模式、站点数据被禁用）时按「不是新用户」处理：
 * 这种情况下播放记录同样存不下来，播放教学只会变成每次打开都弹一遍。
 */
const FIRST_VISIT: boolean = (() => {
  try {
    return !platform.storage.keys().some((k) => k.startsWith("4enext"));
  } catch {
    return false;
  }
})();

export function isFirstVisit(): boolean {
  return FIRST_VISIT;
}

export function hasSeenTutorial(): boolean {
  try {
    return platform.storage.getItem(TUTORIAL_SEEN_KEY) === TUTORIAL_VERSION;
  } catch {
    return false;
  }
}

/** 记下「已经播放过」。跳过、中途退出、看完都算 —— 反复弹出比少讲一次更烦人。 */
export function markTutorialSeen(): void {
  safeSetItem(TUTORIAL_SEEN_KEY, TUTORIAL_VERSION);
}

/** 该不该在本次打开时自动播放：本机第一次用，且还没看过。 */
export function shouldAutoStartTutorial(): boolean {
  return FIRST_VISIT && !hasSeenTutorial();
}

export interface TutorialStep {
  id: string;
  /** 气泡标题 */
  title: string;
  /** 一句话说明：说清「这一页是干什么用的」，不写操作手册 */
  body: string;
  /**
   * 候选选择器，按顺序取第一个真正画在页面上的。
   * 桌面端是左侧导航轨的按钮，手机端是底部 NavigationBar 的对应项，
   * 两边共用同一步骤，谁在就用谁。取不到时退化为居中卡片，教学不中断。
   */
  anchor?: string[];
  /** 进入这一步时把应用切到哪个页面，让用户看到真实内容而不是空壳 */
  view?: View;
  /**
   * 手机端的补充说明。
   * 底栏按 MD3 只放得下 4 项，存档 / 私设 / 词条 / 设置 / 编辑渲染这几个入口
   * 手机端都收在「更多」面板里，高亮块只能落在「更多」按钮上 —— 那时补一句话，
   * 否则用户会对着「更多」读「这里可以新建人物卡」，对不上。
   */
  mobileNote?: string;
  /**
   * 只在某一种端型上讲这一步。
   * 车卡页的单栏/双栏切换只存在于桌面端，手机端顶部的板块分组胶囊反过来 ——
   * 两边共用一份步骤定义，靠这个字段筛掉对方用不上的步骤，
   * 进度条与总步数都按筛完的算，否则手机会显示「第 3 / 15 步」却永远走不到第 15 步。
   */
  only?: "mobile" | "desktop";
  /** 气泡优先摆在高亮块的哪一侧（放不下会自动换边） */
  prefer?: "top" | "bottom" | "left" | "right";
}

/**
 * 步骤顺序 = 用户的心智顺序：先认清「车卡在人物页」，再认识跑团时要用的速览，
 * 然后是内容页、数据出入口（存档 / 私设）、查规则、最后是设置。
 * 手机端底栏只放得下 4 项，存档 / 私设 / 词条 / 设置都收在「更多」里，
 * 所以这些步骤在手机端退化为高亮「更多」按钮。
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "欢迎使用4E NEXT！",
    body: "基于4Ewiki数据与MD3风格的新一代 D&D 4E 车卡器。首次使用请跟随教学快速浏览一遍功能入口。",
  },
  {
    id: "sheet",
    title: "人物",
    body: "人物页面是你最主要的工作空间，由一个又一个的板块组成。",
    anchor: ["[data-tour='nav-sheet']", "[data-tour='mob-sheet']"],
    view: "sheet",
    prefer: "right",
  },
  {
    id: "overview",
    title: "速览",
    body: "为遭遇或正式游戏内容准备的，与人物页面同步的快速资源管理页面。",
    anchor: ["[data-tour='nav-overview']", "[data-tour='mob-overview']"],
    view: "overview",
    prefer: "right",
  },
  {
    id: "background",
    title: "背景",
    body: "提供了四个可由你自由填写的填写区，支持md语法的使用。",
    anchor: ["[data-tour='nav-background']", "[data-tour='mob-background']"],
    view: "background",
    prefer: "right",
  },
  {
    id: "reserve",
    title: "储备",
    body: "无论是管理游戏内发放的全新物品，或是职业给予你的储备资源，皆可在此页面实现。同步提供快捷的与人物页面资源交换功能。",
    anchor: ["[data-tour='nav-reserve']", "[data-tour='mob-reserve']"],
    view: "reserve",
    prefer: "right",
  },
  {
    id: "save",
    title: "存档",
    body: "这里可以新建、切换、重命名人物卡，支持将人物卡导出成 PNG / JPG / PDF，或者导出成 JSON 文件方便多端管理。",
    anchor: ["[data-tour='nav-save']", "[data-tour='mob-more']"],
    mobileNote: "手机端这个入口收在底栏的「更多」里，点开就能看到「存档」。",
    view: "sheet",
    prefer: "right",
  },
  {
    id: "homebrew",
    title: "私设",
    body: "为官方数据之外的玩家自制资源提供的包管理与包编辑功能。",
    anchor: ["[data-tour='nav-homebrew']", "[data-tour='mob-more']"],
    mobileNote: "手机端这个入口收在底栏的「更多」里，点开就能看到「私设」。",
    view: "homebrew",
    prefer: "right",
  },
  {
    id: "search",
    title: "规则",
    body: "提供部分常用规则的快速浏览与万律的词条查询。",
    // 标题与正文讲的是「规则」页（万律速查 + 派生数值 / 技能检定公式表 + 行动点），
    // 高亮与跳转因此都落在导航轨的「规则」上，而不是旁边的「词条」。
    anchor: ["[data-tour='nav-learn']", "[data-tour='mob-more']"],
    mobileNote: "手机端「词条」与「规则」都收在底栏的「更多」里。",
    view: "learn",
    prefer: "right",
  },
  {
    id: "mode",
    title: "编辑 / 渲染：换个样子看卡",
    body: "编辑模式用来填内容；渲染模式会隐藏输入框，以干净的渲染模式呈现人物卡。",
    anchor: ["[data-tour='rail-mode']", "[data-tour='mob-more']"],
    mobileNote: "手机端这个切换收在底栏的「更多」里，是面板最上面的那一段。",
    prefer: "right",
  },
  // ---- 车卡页的板块操作：认识完各页面之后回到人物页，讲这一页怎么用 ----
  {
    id: "sheet-panels",
    title: "板块",
    body: "你可以对照规则书，开始对板块进行填写，一般而言，我们建议每一次都从选择你的种族、职业，填写你的起始等级开始。",
    anchor: ["[data-tour='panel-info']"],
    view: "sheet",
    prefer: "bottom",
  },
  {
    id: "sheet-picker",
    title: "自由的编辑模式",
    body: "所有显示的选择器与填写框都可以被编辑。大部分数据都提供了便捷或自动化的填写方式。",
    anchor: ["[data-tour='pick-field']"],
    view: "sheet",
    prefer: "bottom",
  },
  {
    id: "sheet-layout",
    title: "栏目布局",
    body: "你可以根据自己的喜好，切换单栏或双栏显示。",
    anchor: ["[data-tour='layout-toggle']"],
    view: "sheet",
    only: "desktop",
    prefer: "right",
  },
  {
    id: "sheet-tabs",
    title: "手机端：顶部的板块分组",
    body: "为了适配手机端的显示，顶部的切换组件允许你快速在人物卡的五个大类内跳转。",
    anchor: ["[data-tour='sheet-tabs']"],
    view: "sheet",
    only: "mobile",
    prefer: "bottom",
  },
  {
    id: "settings",
    title: "设置",
    body: "在设置页面，可以按照你的喜好配置全局取色色种与背景壁纸、调整字体、设置WebDAV 多设备同步、本机数据的备份与清除。",
    anchor: ["[data-tour='nav-settings']", "[data-tour='mob-more']"],
    mobileNote: "手机端这个入口收在底栏的「更多」里，点开就能看到「设置」。",
    view: "settings",
    prefer: "right",
  },
  {
    id: "panel-layout",
    title: "自定义板块设置",
    body: "按住任意板块拖动，就能自定义它们在人物页里的呈现顺序。",
    anchor: ["[data-tour='panel-layout']"],
    view: "settings",
    prefer: "bottom",
  },
];
