import { useSyncExternalStore } from "react";
import type { MonsterBlock } from "./monsters";

/**
 * 战场状态（主持模式）。
 *
 * 主持页是跑团时手边的控制台，不是检索页——检索交给词条页。
 * 这里维护的是一份**正在场上打的怪物实例**：加入 / 移除 / 改实时数据，
 * 外加一个「当前选中」的指针（详情面板看谁）。
 *
 * 两个刻意为之的设计：
 *   · creatureText 随实例一起存 —— 面板要能独立渲染，不该为了显示一只已经进场的怪
 *     再去拉 6.8MB 的怪物库；库只在「添加怪物」的检索里按需加载。
 *   · 破坏性操作（移除 / 清空 / 重置）都留一次撤销 —— DM 手快清空一整场是灾难，
 *     一条 Snackbar 换回整份名单是本页最划算的功能。
 *
 * 状态管理用模块级订阅 + useSyncExternalStore：应用没有引入状态库，
 * 这个规模（一份列表 + 一个选中项）用不上一整套 reducer。
 */

export interface EncounterMonster {
  uid: string;
  monsterId: string;
  /** 显示名，可改（同名怪加多只时用来区分，如「哥布林战士 A」） */
  name: string;
  /** 一行完整标签，如 "LV3 杂兵 蛮战 · 图鉴 1"（老数据的兜底展示） */
  tag: string;
  /** 结构化的身份字段：名册上只挑需要的那几枚做徽标，不必再解析 tag */
  level?: number;
  rank?: string;
  role?: string;
  book?: string;
  hp: number;
  maxHp: number;
  /** 临时生命值：伤害先扣它（4E 规则） */
  tempHp: number;
  /** 重伤阈值（半血）；0 表示没有重伤值（如杂兵） */
  bloodied: number;
  conditions: string[];
  notes: string;
  /** 展示态数据块（管线渲染好的 <div class=creature>） */
  text: string;
  addedAt: number;
}

/**
 * 4E 的状态表（按用途分三组，20 条）——用户在跑团时是「按处境找状态」，
 * 不是背字母表，所以给出分组比给一长条 chip 好找得多。
 *
 * desc 是给牌桌用的速查（PHB 定义的压缩版，不是逐字译文）：鼠标停在已挂上的状态上会浮出来，
 * 免得 DM 为了一句「震慑到底能不能动」去翻书。
 */
export interface ConditionDef { name: string; desc: string }

export const CONDITION_GROUPS: { label: string; items: ConditionDef[] }[] = [
  {
    label: "行动受限",
    items: [
      { name: "定身", desc: "无法离开当前格；传送与被推、拉、滑移不受影响。" },
      { name: "迟缓", desc: "速度减半（向下取整到 2 的倍数），且不能奔跑。" },
      { name: "受擒", desc: "被定身；擒抱者对你获得战斗优势，你也无法受益于隐形。" },
      { name: "固定", desc: "被定身且不能传送；攻击骰 −2。" },
      { name: "匍匐", desc: "近战攻击者对你获得战斗优势；你攻击骰 −2，对远程攻击的防御 +2。" },
      { name: "无助", desc: "给予所有敌人战斗优势，且可被致命一击（coup de grace）。" },
      { name: "晕眩", desc: "每回合只能做一个动作（标准 / 移动 / 次要择一）；不能夹击；给予战斗优势。" },
      { name: "震慑", desc: "无法行动；不能夹击；给予战斗优势。" },
      { name: "昏迷", desc: "无法行动、不能感知周围；所有防御 −5；给予战斗优势。" },
      { name: "支配", desc: "由支配者替你决定行动；不能使用每日威能等资源。" },
    ],
  },
  {
    label: "感知与命中",
    items: [
      { name: "目盲", desc: "攻击骰 −5；给予所有敌人战斗优势；不能夹击。" },
      { name: "耳聋", desc: "无法听见；察觉检定 −10。" },
      { name: "隐形", desc: "敌人看不见你：你对其获得战斗优势，其攻击你 −5。" },
      { name: "隐蔽", desc: "敌人对你的攻击骰 −2。" },
      { name: "战斗优势", desc: "对其攻击骰 +2；可触发偷袭、致命一击等。" },
      { name: "标记", desc: "攻击非标记者时 −2；若仍如此做，标记者可对你发动惩罚。" },
    ],
  },
  {
    label: "伤害与生死",
    items: [
      { name: "持续伤害", desc: "每回合开始时受到该伤害；回合结束可豁免结束。" },
      { name: "濒死", desc: "生命值 0 或以下：昏迷，且每回合开始要做死亡豁免（10+ 稳定）。" },
      { name: "石化", desc: "昏迷且无法行动、不觉察周围；对所有伤害获得 20 抗性。" },
      { name: "虚弱", desc: "你造成的所有伤害减半（持续伤害不减半）。" },
    ],
  },
];
export const CONDITIONS = CONDITION_GROUPS.flatMap((g) => g.items.map((i) => i.name));

/** 状态名 → 速查文本（tooltip 与候选弹窗共用） */
export const CONDITION_DESC: Record<string, string> = Object.fromEntries(
  CONDITION_GROUPS.flatMap((g) => g.items.map((i) => [i.name, i.desc])),
);

/** 旧版本里用过 5E 味的译名，读档时顺手改过来 */
const LEGACY_CONDITION: Record<string, string> = { 倒地: "匍匐", 被擒抱: "受擒", 受缚: "固定" };

interface UndoRecord { text: string; prev: EncounterMonster[]; prevSelected: string; stamp: number }
export interface EncounterState { list: EncounterMonster[]; selected: string; undo: UndoRecord | null }

const KEY = "4enext-encounter";

function parseMonster(raw: unknown): EncounterMonster | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<EncounterMonster>;
  if (typeof m.uid !== "string" || typeof m.name !== "string") return null;
  const maxHp = typeof m.maxHp === "number" ? m.maxHp : 1;
  return {
    ...m,
    uid: m.uid,
    monsterId: typeof m.monsterId === "string" ? m.monsterId : "",
    name: m.name,
    tag: typeof m.tag === "string" ? m.tag : "",
    hp: typeof m.hp === "number" ? m.hp : maxHp,
    maxHp,
    tempHp: typeof m.tempHp === "number" ? m.tempHp : 0,
    bloodied: typeof m.bloodied === "number" ? m.bloodied : 0,
    conditions: Array.isArray(m.conditions)
      ? m.conditions.map((c) => LEGACY_CONDITION[c] ?? c)
      : [],
    notes: typeof m.notes === "string" ? m.notes : "",
    text: typeof m.text === "string" ? m.text : "",
    addedAt: typeof m.addedAt === "number" ? m.addedAt : 0,
  } as EncounterMonster;
}

function read(): EncounterState {
  let list: EncounterMonster[] = [];
  let selected = "";
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      // 旧格式是裸数组；新格式是 { list, selected }
      const box = Array.isArray(parsed) ? null : (parsed as { list?: unknown; selected?: unknown });
      const arr = Array.isArray(parsed) ? parsed : box?.list;
      if (Array.isArray(arr)) list = arr.map(parseMonster).filter((m): m is EncounterMonster => m !== null);
      if (box && typeof box.selected === "string") selected = box.selected;
    }
  } catch {
    // 解析失败就当空场，不要让一份坏数据把整页打死
  }
  return { list, selected: pickSelected(list, selected), undo: null };
}

/** 选中项失效（被移除/清空）时退到第一只，仍然保证「详情面板永远有内容」 */
function pickSelected(list: EncounterMonster[], want: string): string {
  if (list.some((m) => m.uid === want)) return want;
  return list.length > 0 ? list[0].uid : "";
}

let state: EncounterState = read();
/** 撤销用的上一份名单；只留一级——够救回手滑，不会变成版本历史 */
let undoStack: { record: UndoRecord } | null = null;
const subs = new Set<() => void>();

function persist(s: EncounterState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ list: s.list, selected: s.selected }));
  } catch {
    // 写满或被禁用时不影响本次会话，只是刷新后不保留
  }
}

function commit(next: EncounterState): void {
  state = next;
  persist(next);
  for (const fn of subs) fn();
}

/** 普通改动：清掉待撤销的 Snackbar（已经干别的了） */
function setList(list: EncounterMonster[], selected?: string): void {
  commit({ list, selected: pickSelected(list, selected ?? state.selected), undo: null });
}

/** 破坏性改动：把当前名单压进撤销槽，并挂一条 Snackbar */
function setListUndoable(text: string, list: EncounterMonster[], selected?: string): void {
  undoStack = { record: { text, prev: state.list, prevSelected: state.selected, stamp: Date.now() } };
  const next = { list, selected: pickSelected(list, selected ?? state.selected), undo: null };
  commit({ ...next, undo: undoStack.record });
}

function uid(): string {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function subscribeEncounter(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function encounterSnapshot(): EncounterState {
  return state;
}

/** 订阅战场状态（组件里用这个） */
export function useEncounter(): EncounterState {
  return useSyncExternalStore(subscribeEncounter, encounterSnapshot, encounterSnapshot);
}

/** 谁在详情面板里 */
export function selectMonster(uidStr: string): void {
  if (state.selected === uidStr) return;
  commit({ ...state, selected: pickSelected(state.list, uidStr) });
}

/**
 * 同名怪的编号：第一只不带后缀，从第二只进场开始统一带 A / B / C。
 * 只在「第二只进场」这一刻把第一只补成 A——否则会出现「一个没编号、一个带 B」的错位。
 * 纯函数（接收名单而不是读模块状态），好让「一次加 N 只」在本地一次算完再落库。
 */
function place(list: EncounterMonster[], base: string): { list: EncounterMonster[]; name: string } {
  const same = list.filter((m) => m.name === base || m.name.startsWith(base + " "));
  if (same.length === 0) return { list, name: base };
  let out = list;
  if (same.length === 1 && same[0].name === base) {
    out = list.map((m) => (m.uid === same[0].uid ? { ...m, name: base + " A" } : m));
  }
  return { list: out, name: base + " " + String.fromCharCode(65 + (same.length % 26)) };
}

/**
 * 放怪物上场。count > 1 时一次放 N 只同名怪（自动 A/B/C）——
 * 4E 里一场遭遇动辄四五个杂兵，一只一只点是最浪费手速的地方。
 */
export function addMonster(m: MonsterBlock, count = 1): string {
  const maxHp = m.hp ?? 1;
  let list = state.list;
  let last = "";
  for (let i = 0; i < count; i++) {
    const named = place(list, m.name);
    list = named.list;
    const item: EncounterMonster = {
      uid: uid(),
      monsterId: m.id,
      name: named.name,
      tag: [
        m.level !== undefined ? "LV" + m.level : "",
        m.rank ?? "",
        m.role ?? "",
        m.book === "MM1" ? "图鉴 1" : m.book === "MM2" ? "图鉴 2" : m.book === "MM3" ? "图鉴 3" : "",
      ].filter(Boolean).join(" "),
      level: m.level,
      rank: m.rank,
      role: m.role,
      book: m.book,
      hp: maxHp,
      maxHp,
      tempHp: 0,
      bloodied: m.bloodied ?? 0,
      conditions: [],
      notes: "",
      text: m.creatureText,
      addedAt: Date.now(),
    };
    list = [...list, item];
    last = item.uid;
  }
  setList(list, last);   // 加完就选中最后一只，详情面板立刻显示它
  return last;
}

/** 移除（可撤销） */
export function removeMonster(uidStr: string): void {
  const m = state.list.find((x) => x.uid === uidStr);
  if (!m) return;
  setListUndoable("已移出「" + m.name + "」", state.list.filter((x) => x.uid !== uidStr));
}

/** 清空全场（可撤销） */
export function clearEncounter(): void {
  if (state.list.length === 0) return;
  setListUndoable("已清空 " + state.list.length + " 只怪物", []);
}

/** 重置：全员回满血、清临时生命值与状态，名单留着（可撤销） */
export function resetEncounter(): void {
  if (state.list.length === 0) return;
  const next = state.list.map((m) => ({ ...m, hp: m.maxHp, tempHp: 0, conditions: [] as string[] }));
  setListUndoable("已复位 " + next.length + " 只怪物", next);
}

export function undoEncounter(): void {
  const rec = undoStack?.record;
  if (!rec) return;
  undoStack = null;
  commit({ list: rec.prev, selected: pickSelected(rec.prev, rec.prevSelected), undo: null });
}

export function dismissUndo(): void {
  if (!state.undo) return;
  undoStack = null;
  commit({ ...state, undo: null });
}

/** 复制一份（同名的自动加序号），常用来一口气放三只哥布林 */
export function duplicateMonster(uidStr: string): void {
  const src = state.list.find((m) => m.uid === uidStr);
  if (!src) return;
  const named = place(state.list, src.name.replace(/ [A-Z]$/, ""));
  // 复制出来的是「同一只怪的另一只」：满血、无临时生命值、无状态，位置接在队尾
  const item: EncounterMonster = { ...src, uid: uid(), name: named.name, hp: src.maxHp, tempHp: 0, conditions: [], addedAt: Date.now() };
  setList([...named.list, item], item.uid);
}

export function updateMonster(uidStr: string, patch: Partial<EncounterMonster>): void {
  setList(state.list.map((m) => (m.uid === uidStr ? { ...m, ...patch } : m)));
}

/** 直接改 HP（DM 记错数时手改），夹在 0..maxHp 之间 */
export function setHp(uidStr: string, hp: number): void {
  const m = state.list.find((x) => x.uid === uidStr);
  if (!m) return;
  updateMonster(uidStr, { hp: Math.max(0, Math.min(m.maxHp, Math.round(hp))) });
}

/** 伤害先吃临时生命值，剩余部分扣 HP；HP 不为负（4E 里 0 即倒地/死亡） */
export function damageMonster(uidStr: string, amount: number): void {
  const m = state.list.find((x) => x.uid === uidStr);
  if (!m || amount <= 0) return;
  const absorbed = Math.min(m.tempHp, amount);
  updateMonster(uidStr, { tempHp: m.tempHp - absorbed, hp: Math.max(0, m.hp - (amount - absorbed)) });
}

export function healMonster(uidStr: string, amount: number): void {
  const m = state.list.find((x) => x.uid === uidStr);
  if (!m || amount <= 0) return;
  updateMonster(uidStr, { hp: Math.min(m.maxHp, m.hp + amount) });
}

export function toggleCondition(uidStr: string, cond: string): void {
  const m = state.list.find((x) => x.uid === uidStr);
  if (!m) return;
  const has = m.conditions.includes(cond);
  updateMonster(uidStr, { conditions: has ? m.conditions.filter((c) => c !== cond) : [...m.conditions, cond] });
}
