import { useSyncExternalStore } from "react";

/**
 * 故事白板状态（主持模式）。
 *
 * DM 在团里经常要一边听玩家说话一边记「谁欠谁一个人情」「下下个场景要放那个钟楼」，
 * 这些想法天然是**空间性**的：一块一块写下来、用线连起来，比线性笔记好认。
 * 所以这里是一张可平移、可缩放的白板：方块（想法 / 事件 / 人物 / 线索）+ 带箭头的连线。
 *
 * 与遭遇面板同一套模块级订阅写法（应用没有状态库），并且同样给破坏性操作留一次撤销 ——
 * 一整场的故事笔记被手滑清掉，比丢一场遭遇更难受。
 */

export type StoryKind = "idea" | "event" | "npc" | "clue";

/**
 * 方块配色：一律走 MD3 语义色，跟着全局动态取色与深浅模式走。
 * （私设那边用的是各卡片家族的规则色，白板没有「规则色」可用，语义色才是对的那一层。）
 */
export type StoryColor = "primary" | "secondary" | "tertiary" | "error" | "neutral";

/** 五个预设色：全部是 MD3 语义色令牌，所以跟着全局取色种子与深浅模式一起变 */
export const STORY_COLORS: { key: StoryColor; label: string }[] = [
  { key: "primary", label: "主色" },
  { key: "secondary", label: "次色" },
  { key: "tertiary", label: "三色" },
  { key: "error", label: "警示" },
  { key: "neutral", label: "中性" },
];

const TOKEN_COLORS = new Set<string>(STORY_COLORS.map((c) => c.key));

/** 色值是语义色令牌还是自选 HEX —— 前者走 c-* 类（能跟着主题变），后者走行内变量 */
export function isTokenColor(v: string | undefined): v is StoryColor {
  return !!v && TOKEN_COLORS.has(v);
}

/** 自选色的前景色：按相对亮度在白 / 近黑之间挑一个（和 MD3 的 on-color 同一个思路） */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.45 ? "rgba(0, 0, 0, .87)" : "#ffffff";
}

/** 四种预设类型：各自带默认图标与配色，新建时直接用，之后可以在编辑弹窗里覆盖 */
export const STORY_KINDS: { key: StoryKind; label: string; icon: string; color: StoryColor }[] = [
  { key: "idea", label: "想法", icon: "lightbulb", color: "tertiary" },
  { key: "event", label: "事件", icon: "flag", color: "primary" },
  { key: "npc", label: "人物", icon: "person", color: "secondary" },
  { key: "clue", label: "线索", icon: "search", color: "neutral" },
];

/** 可选图标（Material Symbols 名）：够覆盖跑团笔记的常见语义 */
export const STORY_ICONS = [
  "lightbulb", "flag", "person", "search", "star", "warning",
  "place", "schedule", "key", "favorite", "bolt", "shield",
  "book", "map", "gavel", "visibility", "psychology", "groups",
  "history", "campaign", "sell", "diamond", "target", "anchor",
];

export interface StoryNode {
  id: string;
  /** 世界坐标（左上角）；屏幕位置 = 世界坐标 × k + view 偏移 */
  x: number;
  y: number;
  /** 尺寸也是世界坐标（不随缩放变），右下角拖拽可改 */
  w: number;
  h: number;
  kind: StoryKind;
  title: string;
  text: string;
  /** 自定义图标 / 配色：不填就跟着 kind 的预设走（编辑弹窗里可覆盖） */
  icon?: string;
  /** 语义色令牌（primary / secondary / tertiary / error / neutral）或自选 HEX */
  color?: string;
  /** 锁定后不能拖动、不能改大小 —— 摆好版的板子最怕手滑碰歪 */
  locked?: boolean;
  at: number;
}

/** 连线的箭头形制 */
export type ArrowStyle = "single" | "reverse" | "double" | "dot" | "none";

/** 形制表：工具栏按钮里画的是这些档位实际的样子（见 StoryView 的 ArrowPreview），所以不需要图标字段 */
export const ARROW_STYLES: { key: ArrowStyle; label: string }[] = [
  { key: "single", label: "单向：箭头指向目标" },
  { key: "reverse", label: "反向：箭头指向起点" },
  { key: "double", label: "双向：两端都有箭头" },
  { key: "dot", label: "圆点相连（表示相关而非指向）" },
  { key: "none", label: "虚线（无箭头）" },
];

/** 连线：从 from 指向 to；style 缺省按单向箭头（老存档没有这个字段） */
export interface StoryEdge { id: string; from: string; to: string; style?: ArrowStyle }

/**
 * 自由笔迹：世界坐标下的一串点，压平成 [x1,y1,x2,y2,…] 存 —— 一笔几百个点，
 * 用对象数组存进 localStorage 会明显更胖。w 是线宽（世界坐标，随画布缩放）。
 * color 存墨色：要么是下面三个基础色的键，要么是自选 HEX。
 */
export interface StoryStroke { id: string; pts: number[]; w: number; color?: string; at: number }

/**
 * 画笔的三个基础墨色：刻意**不用**主题色 —— 笔就该是笔的颜色（红/黑/蓝），
 * 但深浅模式要照顾，所以每档都用 light-dark 各取一个：深色画布上「黑」会翻成近白，
 * 否则纯黑落在深底上等于没画。
 */
export type PenInk = "ink-black" | "ink-red" | "ink-blue";

export const PEN_INKS: { key: PenInk; label: string }[] = [
  { key: "ink-black", label: "黑" },
  { key: "ink-red", label: "红" },
  { key: "ink-blue", label: "蓝" },
];

const PEN_INK_SET = new Set<string>(PEN_INKS.map((i) => i.key));

/** 墨色是基础色（走 CSS 类，深浅模式各有一档）还是自选 HEX */
export function isPenInk(v: string | undefined): v is PenInk {
  return !!v && PEN_INK_SET.has(v);
}

/** 视图变换：先平移再缩放（transform: translate(x,y) scale(k)） */
export interface StoryViewBox { x: number; y: number; k: number }

export interface StorySnapshot {
  nodes: StoryNode[];
  edges: StoryEdge[];
  strokes: StoryStroke[];
  view: StoryViewBox;
  undo: { text: string; stamp: number } | null;
}

/** 方块默认尺寸与下限（连线按方块自己的 w/h 算与矩形边界的交点） */
export const DEFAULT_W = 220;
export const DEFAULT_H = 152;
export const MIN_W = 140;
export const MIN_H = 100;
export const MIN_K = 0.3;
export const MAX_K = 2.5;

const KEY = "4enext-story";

function read(): StorySnapshot {
  const empty: StorySnapshot = { nodes: [], edges: [], strokes: [], view: { x: 0, y: 0, k: 1 }, undo: null };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<StorySnapshot>;
    // 老存档没有 w/h/locked，读进来补齐默认值（否则连线会按 undefined 算交点）
    const nodes = (Array.isArray(p.nodes) ? p.nodes.filter((n) => n && typeof n.id === "string") : [])
      .map((n) => ({
        ...n,
        w: typeof n.w === "number" && n.w > 0 ? Math.max(MIN_W, n.w) : DEFAULT_W,
        h: typeof n.h === "number" && n.h > 0 ? Math.max(MIN_H, n.h) : DEFAULT_H,
      }));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = Array.isArray(p.edges)
      ? p.edges.filter((e) => e && ids.has(e.from) && ids.has(e.to))
      : [];
    const strokes = Array.isArray(p.strokes)
      ? p.strokes.filter((s) => s && typeof s.id === "string" && Array.isArray(s.pts) && s.pts.length >= 4)
      : [];
    const v = p.view;
    const view = v && typeof v.x === "number" && typeof v.y === "number" && typeof v.k === "number"
      ? { x: v.x, y: v.y, k: clamp(v.k, MIN_K, MAX_K) }
      : { x: 0, y: 0, k: 1 };
    return { nodes, edges, strokes, view, undo: null };
  } catch {
    return empty;   // 坏数据当空板，不要让一页笔记把整页打死
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

let state: StorySnapshot = read();
let lastSnapshot: { nodes: StoryNode[]; edges: StoryEdge[]; strokes: StoryStroke[] } | null = null;
const subs = new Set<() => void>();
let persistTimer: number | null = null;

function persistSoon(): void {
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  // 拖动方块时每帧都在改坐标，落盘按 300ms 合并一次，免得把 localStorage 写爆
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        nodes: state.nodes, edges: state.edges, strokes: state.strokes, view: state.view,
      }));
    } catch {
      // 写满或被禁用时不影响本次会话，只是刷新后不保留
    }
  }, 300);
}

function commit(next: StorySnapshot): void {
  state = next;
  persistSoon();
  for (const fn of subs) fn();
}

function uid(): string {
  return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function subscribeStory(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

export function storySnapshot(): StorySnapshot {
  return state;
}

export function useStory(): StorySnapshot {
  return useSyncExternalStore(subscribeStory, storySnapshot, storySnapshot);
}

/** 破坏性操作：压一份快照进撤销槽，换一条 Snackbar */
function undoable(text: string, nodes: StoryNode[], edges: StoryEdge[], strokes: StoryStroke[]): void {
  lastSnapshot = { nodes: state.nodes, edges: state.edges, strokes: state.strokes };
  commit({ nodes, edges, strokes, view: state.view, undo: { text, stamp: Date.now() } });
}

export function undoStory(): void {
  if (!lastSnapshot) return;
  const prev = lastSnapshot;
  lastSnapshot = null;
  commit({ nodes: prev.nodes, edges: prev.edges, strokes: prev.strokes, view: state.view, undo: null });
}

export function dismissStoryUndo(): void {
  if (!state.undo) return;
  lastSnapshot = null;
  commit({ ...state, undo: null });
}

export function addNode(kind: StoryKind, x: number, y: number): string {
  const node: StoryNode = { id: uid(), x, y, w: DEFAULT_W, h: DEFAULT_H, kind, title: "", text: "", at: Date.now() };
  commit({ ...state, nodes: [...state.nodes, node], undo: null });
  return node.id;
}

export function updateNode(id: string, patch: Partial<StoryNode>): void {
  commit({ ...state, nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)), undo: null });
}

/** 拖动中的高频写入：不压撤销、不动其它字段 */
export function moveNode(id: string, x: number, y: number): void {
  commit({ ...state, nodes: state.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) });
}

/** 拖动右下角改大小（拖动中高频调用，和 moveNode 一样不压撤销） */
export function resizeNode(id: string, w: number, h: number): void {
  commit({
    ...state,
    nodes: state.nodes.map((n) => (n.id === id ? { ...n, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) } : n)),
  });
}

/** 锁定 / 解锁：锁住的方块不能被拖动或拉伸 */
export function toggleLock(id: string): void {
  commit({ ...state, nodes: state.nodes.map((n) => (n.id === id ? { ...n, locked: !n.locked } : n)), undo: null });
}

export function removeNode(id: string): void {
  const n = state.nodes.find((x) => x.id === id);
  if (!n) return;
  undoable(
    "已删除「" + (n.title || STORY_KINDS.find((k) => k.key === n.kind)?.label || "方块") + "」",
    state.nodes.filter((x) => x.id !== id),
    state.edges.filter((e) => e.from !== id && e.to !== id),   // 连带它的连线一起走
    state.strokes,
  );
}

export function addEdge(from: string, to: string, style: ArrowStyle = "single"): void {
  if (from === to) return;
  if (state.edges.some((e) => e.from === from && e.to === to)) return;   // 同向重复连线没有意义
  commit({ ...state, edges: [...state.edges, { id: uid(), from, to, style }], undo: null });
}

/** 改箭头形制：连线模式下点一条既有的线，就把它改成当前选中的那一档（不是按顺序轮换） */
export function setEdgeStyle(id: string, style: ArrowStyle): void {
  const cur = state.edges.find((e) => e.id === id);
  if (!cur || (cur.style ?? "single") === style) return;
  commit({ ...state, edges: state.edges.map((e) => (e.id === id ? { ...e, style } : e)), undo: null });
}

export function removeEdge(id: string): void {
  if (!state.edges.some((e) => e.id === id)) return;
  undoable("已删除连线", state.nodes, state.edges.filter((e) => e.id !== id), state.strokes);
}

/** 落一笔（自由笔迹）：拖动过程中不落库，抬笔才写一次 */
export function addStroke(pts: number[], w: number, color?: string): void {
  if (pts.length < 4) return;
  commit({ ...state, strokes: [...state.strokes, { id: uid(), pts, w, color, at: Date.now() }], undo: null });
}

export function removeStroke(id: string): void {
  if (!state.strokes.some((s) => s.id === id)) return;
  undoable("已擦掉一笔", state.nodes, state.edges, state.strokes.filter((s) => s.id !== id));
}

export function clearStory(): void {
  if (state.nodes.length === 0 && state.strokes.length === 0) return;
  const parts = [state.nodes.length + " 块", state.strokes.length + " 笔"].filter((t) => !t.startsWith("0 "));
  undoable("已清空白板（" + parts.join(" · ") + "）", [], [], []);
}

export function setView(view: StoryViewBox): void {
  commit({ ...state, view: { x: view.x, y: view.y, k: clamp(view.k, MIN_K, MAX_K) } });
}
