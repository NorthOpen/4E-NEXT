// 车卡页板块摆放（设置 → 自定义页面板块）
//
// 车卡页由若干「板块」拼成，本模块给出板块清单、默认摆放，以及读写本地缓存的入口。
// 用户拖动调整后的顺序存在 localStorage（4enext.sheetLayout.v1），刷新、重开浏览器后仍然生效。
// 顺序变化通过 useSyncExternalStore 广播：设置页改完，车卡页（若已挂载）立刻跟着变。

import { useSyncExternalStore } from "react";
import { safeSetItem } from "./storage";

/** 车卡页板块 id。已发布的 id 不要再改名——用户本地缓存按 id 记录摆放位置。 */
export type SheetPanelId =
  | "info"
  | "stats"
  | "hit"
  | "damage"
  | "powers"
  | "feats"
  | "skills"
  | "race"
  | "class"
  | "paragon"
  | "epic"
  | "equipment"
  | "money"
  | "rituals"
  | "theme";

/** 顶部区锚板块（角色信息、角色数值）：只能放在顶部区，且永远排在顶部区最前，不能搬到左/右栏。 */
export const TOP_PANEL_IDS: SheetPanelId[] = ["info", "stats"];
const TOP_PANEL_SET = new Set<SheetPanelId>(TOP_PANEL_IDS);

/** 允许放进双栏顶部区的板块：锚板块之外，命中/伤害也可放在顶部区（排在锚板块之后）。 */
const TOP_ALLOWED_SET = new Set<SheetPanelId>([...TOP_PANEL_IDS, "hit", "damage"]);

/** 该板块是否属于顶部区锚板块（true 则只能放在顶部区）。 */
export function topOnlyPanel(id: SheetPanelId): boolean {
  return TOP_PANEL_SET.has(id);
}

/** 该板块是否允许放进顶部区（锚板块 + 命中 + 伤害）。 */
export function topAllowedPanel(id: SheetPanelId): boolean {
  return TOP_ALLOWED_SET.has(id);
}

export interface SheetPanelMeta {
  id: SheetPanelId;
  /** 板块名，与车卡页上的标题一致，便于用户对上号 */
  label: string;
  /** 设置页拖动条上的图标 */
  icon: string;
  /** 一句话说明里面有什么 */
  hint: string;
  /** 在双栏顶部区占满整行（战斗数值这类宽表放半栏会挤） */
  wide?: boolean;
}

export const SHEET_PANELS: SheetPanelMeta[] = [
  { id: "info", label: "角色信息", icon: "person", hint: "立绘、姓名、种族、职阶、阵营与语言" },
  { id: "stats", label: "角色数值", icon: "monitoring", hint: "先攻、六项属性、感知、抵御、移动力、生命" },
  { id: "hit", label: "命中", icon: "swords", hint: "攻击表" },
  { id: "damage", label: "伤害", icon: "bolt", hint: "伤害表" },
  { id: "powers", label: "威能", icon: "bolt", hint: "随意 / 遭遇 / 每日 / 辅助 / 种族威能槽位" },
  { id: "feats", label: "专长", icon: "star", hint: "专长槽位与奖励专长" },
  { id: "skills", label: "技能", icon: "checklist", hint: "技能加值与受训标记" },
  { id: "race", label: "种族", icon: "groups", hint: "种族特性与亚种" },
  { id: "class", label: "职业", icon: "school", hint: "职业能力与职业威能" },
  { id: "paragon", label: "典范之道", icon: "military_tech", hint: "典范特性（11 级解锁）" },
  { id: "epic", label: "传奇天命", icon: "auto_awesome", hint: "天命特性（21 级解锁）" },
  { id: "equipment", label: "装备", icon: "shield", hint: "武器、护甲、法器、奇物与冒险装备" },
  { id: "money", label: "金钱", icon: "payments", hint: "收入、花销与余额" },
  { id: "rituals", label: "仪式", icon: "auto_stories", hint: "仪式魔法与武术奥义" },
  { id: "theme", label: "主题", icon: "category", hint: "主题特性与专属威能" },
];

export const SHEET_PANEL_IDS: SheetPanelId[] = SHEET_PANELS.map((p) => p.id);

// ===== 手机端板块分组（车卡页顶部胶囊切换） =====
//
// 桌面端双栏能同时铺开好几个板块，手机上一屏只放得下一个；15 个板块整页铺下来要滚很久。
// 所以手机端按「建卡时的心智阶段」把板块归成 5 组，顶部胶囊切换、一屏只看一组：
//   · 分组本身固定（不参与设置页拖动），避免手机上再学一套排版概念；
//   · 组内顺序仍跟随 single —— 用户在设置页拖出来的先后，手机端组内照样生效；
//   · 5 组并集必须覆盖 SHEET_PANEL_IDS 全部条目，漏掉的板块在手机上会彻底看不见。

export interface SheetPanelGroup {
  id: string;
  /** 胶囊上的短标签；手机宽度下要排得下 5 个，控制在 2 个字 */
  label: string;
  icon: string;
  /** 该组包含的板块 */
  panels: SheetPanelId[];
}

export const SHEET_PANEL_GROUPS: SheetPanelGroup[] = [
  { id: "base", label: "人物", icon: "person", panels: ["info", "stats"] },
  { id: "combat", label: "战斗", icon: "swords", panels: ["hit", "damage"] },
  { id: "ability", label: "能力", icon: "bolt", panels: ["powers", "feats", "skills"] },
  { id: "origin", label: "出身", icon: "school", panels: ["race", "class", "paragon", "epic", "theme"] },
  { id: "items", label: "物品", icon: "shield", panels: ["equipment", "money", "rituals"] },
];

/** 取一组内的板块，并保持设置页里排出来的 single 顺序（组内自定义顺序不丢失）。 */
export function panelsInGroup(group: SheetPanelGroup, single: SheetPanelId[]): SheetPanelId[] {
  const inGroup = new Set(group.panels);
  return single.filter((id) => inGroup.has(id));
}

/**
 * 默认展开哪一组：跟随 single 的首个板块——用户把「装备」拖到最前，手机端就默认打开「物品」组。
 * single 为空（缓存异常）时回落到第一组。
 */
export function defaultPanelGroup(single: SheetPanelId[]): SheetPanelGroup {
  const first = single[0];
  return SHEET_PANEL_GROUPS.find((g) => first && g.panels.includes(first)) ?? SHEET_PANEL_GROUPS[0];
}

const PANEL_BY_ID: Record<string, SheetPanelMeta> = Object.fromEntries(SHEET_PANELS.map((p) => [p.id, p]));

/** 取板块元信息（id 已在类型上受限，运行时兜底返回第一项，不会崩） */
export function panelMeta(id: SheetPanelId): SheetPanelMeta {
  return PANEL_BY_ID[id] ?? SHEET_PANELS[0];
}

/** 双栏布局的三个区域：顶部区（自身两列并排）、左栏、右栏 */
export type SheetLayoutZone = "top" | "left" | "right";
/** 可放置板块的容器：单栏是一个列表，双栏分三个区域 */
export type SheetLayoutSlot = "single" | SheetLayoutZone;

export const DOUBLE_ZONES: SheetLayoutZone[] = ["top", "left", "right"];

export interface SheetLayoutConfig {
  /** 单栏布局：从上到下的板块顺序（手机端强制使用单栏） */
  single: SheetPanelId[];
  /** 双栏布局：顶部区、左栏、右栏各自的板块顺序 */
  double: Record<SheetLayoutZone, SheetPanelId[]>;
}

/** 默认摆放：顶部「角色信息 | 角色数值 | 命中 | 伤害」（命中/伤害在锚板块之下），左栏威能/专长/技能/种族/职业/典范/天命，右栏装备/金钱/仪式/主题 */
export const DEFAULT_SHEET_LAYOUT: SheetLayoutConfig = {
  single: ["info", "stats", "hit", "damage", "race", "class", "paragon", "epic", "skills", "powers", "feats", "equipment", "money", "rituals", "theme"],
  double: {
    top: ["info", "stats", "hit", "damage"],
    left: ["powers", "feats", "skills", "race", "class", "paragon", "epic"],
    right: ["equipment", "money", "rituals", "theme"],
  },
};

const SHEET_LAYOUT_KEY = "4enext.sheetLayout.v1";

function defaultLayout(): SheetLayoutConfig {
  return { single: [...DEFAULT_SHEET_LAYOUT.single], double: { top: [...DEFAULT_SHEET_LAYOUT.double.top], left: [...DEFAULT_SHEET_LAYOUT.double.left], right: [...DEFAULT_SHEET_LAYOUT.double.right] } };
}

/** 过滤非法 id 与重复项，顺带把「已出现过的 id」记进 seen */
function takeIds(raw: unknown, seen: Set<SheetPanelId>): SheetPanelId[] {
  if (!Array.isArray(raw)) return [];
  const out: SheetPanelId[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const id = v as SheetPanelId;
    if (!PANEL_BY_ID[id] || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 归一化：任何来源（本地缓存、拖动结果）都过一遍这里。
 * 单栏是一份完整清单，双栏是另一份——两边的去重集合必须分开算，
 * 否则「单栏先吃掉了全部 id」会把双栏清空（拖动一次就丢光整栏）。
 * 每份清单都保证每个板块恰好出现一次：拖丢板块比顺序不对更让用户困惑。
 * 新版本新增的板块会追加到单栏末尾与左栏末尾，老存档也能看到它。
 */
export function normalizeSheetLayout(raw: unknown): SheetLayoutConfig {
  const src = raw && typeof raw === "object" ? (raw as Partial<SheetLayoutConfig>) : {};
  const dbl = src.double && typeof src.double === "object" ? src.double : ({} as Partial<Record<SheetLayoutZone, unknown>>);

  const seenSingle = new Set<SheetPanelId>();
  const single = takeIds(src.single, seenSingle);
  single.push(...SHEET_PANEL_IDS.filter((id) => !seenSingle.has(id)));

  // 双栏与单栏是两套独立摆放，去重集合必须分开算，否则「单栏先吃掉全部 id」会把双栏清空。
  // 双栏额外遵守顶部区约束：
  //   · 锚板块（角色信息、角色数值）只能待在顶部区，且永远排在顶部区最前；
  //   · 命中/伤害可待在顶部区（排在锚板块之后），也可搬到左/右栏；
  //   · 其余板块不能进入顶部区。
  // 缓存里摆错位置的板块会被纠正：左/右栏里混入的锚板块收回顶部，顶部区里混入的普通板块挪去左栏。
  const seenDouble = new Set<SheetPanelId>();
  const top: SheetPanelId[] = [];
  const left: SheetPanelId[] = [];
  const right: SheetPanelId[] = [];
  // 顶部区先处理：锚板块固定在最前（顺序 info→stats），随后只接纳允许进顶部的板块（命中/伤害）；
  // 顶部区里混入的普通板块（如损坏缓存中的 powers）挪到左栏末尾。
  const rawTop = takeIds(dbl.top, seenDouble);
  const topExtras: SheetPanelId[] = [];
  const topToSide: SheetPanelId[] = [];
  for (const v of rawTop) {
    if (TOP_PANEL_SET.has(v)) continue;
    (topAllowedPanel(v) ? topExtras : topToSide).push(v);
  }
  for (const id of TOP_PANEL_IDS) if (rawTop.includes(id)) top.push(id);
  top.push(...topExtras);
  left.push(...topToSide);
  // 左/右栏：锚板块即使出现在这里也收回顶部；其余板块按原顺序入对应栏。
  const place = (raw: unknown, side: SheetPanelId[]) => {
    for (const v of takeIds(raw, seenDouble)) (TOP_PANEL_SET.has(v) ? top : side).push(v);
  };
  place(dbl.left, left);
  place(dbl.right, right);
  // 保证每个板块恰好出现一次：顶部区锚板块缺项补回顶部最前，其余缺项补到左栏末尾。
  for (const id of TOP_PANEL_IDS) if (!seenDouble.has(id)) { top.unshift(id); seenDouble.add(id); }
  for (const id of SHEET_PANEL_IDS) if (!seenDouble.has(id)) left.push(id);

  return { single, double: { top, left, right } };
}

/** 从本地缓存读摆放（没有存档或存档损坏时回落到默认摆放）。 */
export function loadSheetLayout(): SheetLayoutConfig {
  try {
    const raw = localStorage.getItem(SHEET_LAYOUT_KEY);
    if (!raw) return defaultLayout();
    return normalizeSheetLayout(JSON.parse(raw));
  } catch {
    return defaultLayout();
  }
}

/** 写入本地缓存；失败返回 false（由 lib/storage 统一广播，界面会提示没保存成功）。 */
export function saveSheetLayout(cfg: SheetLayoutConfig): boolean {
  return safeSetItem(SHEET_LAYOUT_KEY, JSON.stringify(cfg));
}

// ===== 运行时状态：设置页与车卡页共用一份，改完立即广播 =====

let current: SheetLayoutConfig | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // 单个订阅者出错不影响其他订阅者
    }
  }
}

/** 当前摆放（首次调用时从本地缓存读入） */
export function getSheetLayout(): SheetLayoutConfig {
  if (!current) current = loadSheetLayout();
  return current;
}

/** 应用一份新摆放：归一化 → 写本地缓存 → 通知订阅者。返回归一化后的结果。 */
export function setSheetLayout(next: SheetLayoutConfig): SheetLayoutConfig {
  current = normalizeSheetLayout(next);
  saveSheetLayout(current);
  emit();
  return current;
}

/** 恢复默认摆放（同时清掉本地缓存里的自定义记录）。 */
export function resetSheetLayout(): SheetLayoutConfig {
  current = defaultLayout();
  try {
    localStorage.removeItem(SHEET_LAYOUT_KEY);
  } catch {
    /* 删除失败不影响本次使用 */
  }
  emit();
  return current;
}

export function subscribeSheetLayout(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// 多标签页同步：另一个标签页改了摆放，本页跟着刷新
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== SHEET_LAYOUT_KEY && e.key !== null) return;
    current = loadSheetLayout();
    emit();
  });
}

/** 组件里读摆放（设置页与车卡页共用） */
export function useSheetLayout(): SheetLayoutConfig {
  return useSyncExternalStore(subscribeSheetLayout, getSheetLayout, getSheetLayout);
}

// ===== 摆放调整（纯函数，供设置页拖动 / 箭头按钮调用） =====

function listOf(cfg: SheetLayoutConfig, slot: SheetLayoutSlot): SheetPanelId[] {
  return slot === "single" ? cfg.single : cfg.double[slot];
}

/**
 * 从目标所在的「栏位体系」里摘掉该板块——单栏与双栏是两套独立摆放。
 * 单栏体系只动 single；双栏体系则从 top/left/right 全部摘掉（归一化保证一个板块只出现在其中一处，
 * 摘掉全部等效于摘掉它当前的所在栏），不会顺手把单栏（手机端）的顺序搅乱。
 */
function without(cfg: SheetLayoutConfig, id: SheetPanelId, to: SheetLayoutSlot): SheetLayoutConfig {
  if (to === "single") {
    return {
      single: cfg.single.filter((x) => x !== id),
      double: { top: [...cfg.double.top], left: [...cfg.double.left], right: [...cfg.double.right] },
    };
  }
  return {
    single: [...cfg.single],
    double: {
      top: cfg.double.top.filter((x) => x !== id),
      left: cfg.double.left.filter((x) => x !== id),
      right: cfg.double.right.filter((x) => x !== id),
    },
  };
}

/** 板块当前在哪：单栏 / 双栏的哪个区域 */
export function sheetPanelSlot(cfg: SheetLayoutConfig, id: SheetPanelId): SheetLayoutSlot | null {
  if (cfg.single.includes(id)) return "single";
  for (const z of DOUBLE_ZONES) if (cfg.double[z].includes(id)) return z;
  return null;
}

/**
 * 把板块移到目标容器：targetId 为空表示放到该容器末尾；
 * 否则插到 targetId 之前（after=true 则插到它之后）。
 * 源容器与目标容器相同时按「先摘出再插入」处理，因此上下拖动不会错位。
 */
export function moveSheetPanel(
  cfg: SheetLayoutConfig,
  id: SheetPanelId,
  to: SheetLayoutSlot,
  targetId: SheetPanelId | null = null,
  after = false
): SheetLayoutConfig {
  const next = without(cfg, id, to);
  const list = listOf(next, to);
  if (!targetId || targetId === id) {
    list.push(id);
  } else {
    const at = list.indexOf(targetId);
    if (at < 0) list.push(id);
    else list.splice(at + (after ? 1 : 0), 0, id);
  }
  return normalizeSheetLayout(next);
}

/** 同容器内上下移动（dir = -1 上移 / 1 下移）；已经在头尾时原样返回。 */
export function nudgeSheetPanel(cfg: SheetLayoutConfig, id: SheetPanelId, slot: SheetLayoutSlot, dir: -1 | 1): SheetLayoutConfig {
  const list = listOf(cfg, slot);
  const i = list.indexOf(id);
  if (i < 0) return cfg;
  const j = i + dir;
  if (j < 0 || j >= list.length) return cfg;
  return moveSheetPanel(cfg, id, slot, list[j], dir > 0);
}
