import type { Character } from "../sheet/character";

export interface SavedCard {
  id: string;
  name: string;
  char: Character;
  updatedAt: number;
}

const CARDS_KEY = "4enext.cards.v1";
const ACTIVE_KEY = "4enext.activeCard.v1";

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function loadCards(): SavedCard[] {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c) => c && typeof c.id === "string" && c.char && typeof c.name === "string");
  } catch {
    return [];
  }
}

/**
 * 保存人物卡列表。
 * 返回 false 表示没能写进去（配额写满 / 浏览器禁用存储），同时会广播失败事件，
 * 由界面提示「没有保存成功」——旧实现是静默吞掉，用户以为存上了，刷新才发现丢了。
 */
export function saveCards(cards: SavedCard[]): boolean {
  return safeSetItem(CARDS_KEY, JSON.stringify(cards));
}

export function loadActiveId(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** 保存「当前打开的卡」；失败返回 false（同样会广播）。 */
export function saveActiveId(id: string): boolean {
  return safeSetItem(ACTIVE_KEY, id);
}

// localStorage 容量估算：按 UTF-16 码元统计（含 key + value），近似各浏览器配额口径。
const LS_MAX = 5 * 1024 * 1024; // 通用上限约 5MB

export interface StorageUsage {
  used: number;   // 已用字节（UTF-16 码元数）
  total: number;  // 上限
  percent: number; // 0–100
  keys: number;
}

export function localStorageUsage(): StorageUsage {
  let used = 0;
  let keys = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) ?? "";
      used += k.length + v.length;
      keys++;
    }
  } catch {
    /* ignore */
  }
  return { used, total: LS_MAX, percent: Math.min(100, (used / LS_MAX) * 100), keys };
}

export function fmtBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}

// ===== 缓存明细：把 localStorage 的键按用途分组，供私设页「浏览器缓存」板块直观展示 =====

export type StorageGroupKey = "homebrew" | "cards" | "appearance" | "other";

export interface StorageGroup {
  key: StorageGroupKey;
  label: string;
  bytes: number;
  keys: number;
}

export interface StorageBreakdown extends StorageUsage {
  groups: StorageGroup[];
}

const GROUP_LABELS: Record<StorageGroupKey, string> = {
  homebrew: "私设资源包",
  cards: "人物卡存档",
  appearance: "外观与设置",
  other: "其他数据",
};

function groupOf(key: string): StorageGroupKey {
  if (key.startsWith("4enext.homebrew") || key === "4enext.userEntries.v1") return "homebrew";
  if (key === "4enext.cards.v1" || key === "4enext.activeCard.v1") return "cards";
  if (key === "4enext.settings.v1" || key === "4enext.sheetLayout.v1" || key.startsWith("4enext.bg") || key.startsWith("4enext.portrait") || key === "4enext-layout" || key === "4enext-bg") {
    return "appearance";
  }
  // 同步配置（WebDAV 地址/账号/应用密码）与同步基线同属「设置」一类
  if (key.startsWith("4enext.webdav") || key.startsWith("4enext.sync") || key === "4enext.deviceId.v1") return "appearance";
  return "other";
}

/** 分组统计 localStorage 占用（含总量与百分比）。 */
export function localStorageBreakdown(): StorageBreakdown {
  const totals: Record<StorageGroupKey, { bytes: number; keys: number }> = {
    homebrew: { bytes: 0, keys: 0 },
    cards: { bytes: 0, keys: 0 },
    appearance: { bytes: 0, keys: 0 },
    other: { bytes: 0, keys: 0 },
  };
  let used = 0;
  let keys = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) ?? "";
      const size = k.length + v.length;
      used += size;
      keys++;
      const g = totals[groupOf(k)];
      g.bytes += size;
      g.keys++;
    }
  } catch {
    /* ignore */
  }
  const groups = (Object.keys(totals) as StorageGroupKey[]).map((key) => ({
    key,
    label: GROUP_LABELS[key],
    bytes: totals[key].bytes,
    keys: totals[key].keys,
  }));
  return { used, total: LS_MAX, percent: Math.min(100, (used / LS_MAX) * 100), keys, groups };
}

// ===== 写入护栏：localStorage 写满 / 被禁用时不再静默吞掉，改为向订阅者广播 =====
//
// 背景：自动保存有 400ms 防抖，配额写满后每次编辑都会失败。旧实现 catch 为空，
// 界面照常显示新内容，用户直到刷新才发现全丢了。这里把失败显性化：
// 所有写入统一走 safeSetItem，失败时记录并通知订阅者（见 components/StorageAlert）。

export type StorageFailureReason = "quota" | "unavailable";

export interface StorageFailure {
  /** 写入失败的键 */
  key: string;
  /** 归属分组：与「浏览器缓存占用」面板同一套口径 */
  scope: StorageGroupKey;
  /** 分组中文名，如「人物卡存档」 */
  label: string;
  /** quota = 空间写满；unavailable = 浏览器不让写（无痕模式 / 站点数据被禁用等） */
  reason: StorageFailureReason;
  /** 本次尝试写入的大小（UTF-16 码元，与占用统计同口径） */
  bytes: number;
  /** 失败当时的整体占用 */
  usage: StorageUsage;
  at: number;
}

type FailureListener = (f: StorageFailure) => void;

const failureListeners = new Set<FailureListener>();
let lastFailure: StorageFailure | null = null;

// 占用统计要遍历整个 localStorage；连续失败时短时缓存，避免反复全量扫描
let usageCache: { at: number; usage: StorageUsage } | null = null;
const USAGE_CACHE_MS = 2000;

function cachedUsage(): StorageUsage {
  const now = Date.now();
  if (usageCache && now - usageCache.at < USAGE_CACHE_MS) return usageCache.usage;
  const usage = localStorageUsage();
  usageCache = { at: now, usage };
  return usage;
}

/** 识别「配额写满」：各浏览器抛出的形态不一致，逐一比对。 */
export function isQuotaExceeded(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" || // Firefox
    e.code === 22 ||                            // 通用 DOMException 编码
    e.code === 1014                             // Firefox
  );
}

/**
 * 写 localStorage 的统一入口。成功返回 true；
 * 失败不再静默忽略，而是广播 StorageFailure，由界面提示用户。
 * scope 缺省时按键名推导（与缓存占用面板的分组保持一致）。
 */
export function safeSetItem(key: string, value: string, scope?: StorageGroupKey): boolean {
  try {
    localStorage.setItem(key, value);
    usageCache = null; // 写入成功，占用已变化
    return true;
  } catch (err) {
    const g = scope ?? groupOf(key);
    const failure: StorageFailure = {
      key,
      scope: g,
      label: GROUP_LABELS[g],
      reason: isQuotaExceeded(err) ? "quota" : "unavailable",
      bytes: key.length + value.length,
      usage: cachedUsage(),
      at: Date.now(),
    };
    lastFailure = failure;
    for (const fn of failureListeners) {
      try {
        fn(failure);
      } catch {
        // 单个订阅者出错不影响其他订阅者
      }
    }
    return false;
  }
}

/** 订阅写入失败；返回取消订阅函数。 */
export function subscribeStorageFailure(fn: FailureListener): () => void {
  failureListeners.add(fn);
  return () => {
    failureListeners.delete(fn);
  };
}

/**
 * 读取最近一次写入失败。
 * App 在 useState 初始值里就会写一次存档（早于任何组件挂载），
 * 提示组件挂载后靠这个补看一眼，避免首屏那次失败被漏报。
 */
export function takeLastStorageFailure(): StorageFailure | null {
  return lastFailure;
}

export function clearLastStorageFailure(): void {
  lastFailure = null;
}