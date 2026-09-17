import { platform } from "@platform";
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
    const raw = platform.storage.getItem(CARDS_KEY);
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
    return platform.storage.getItem(ACTIVE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** 保存「当前打开的卡」；失败返回 false（同样会广播）。 */
export function saveActiveId(id: string): boolean {
  return safeSetItem(ACTIVE_KEY, id);
}

// 容量口径由平台实现给出：网页端 = 浏览器约 5MB 配额；桌面端 = 本地数据文件的磁盘容量估值。
// 两端的统计口径一致（UTF-16 码元，含 key + value），所以这里的百分比仍然可比。

export interface StorageUsage {
  used: number;   // 已用字节（UTF-16 码元数）
  total: number;  // 上限
  percent: number; // 0–100
  keys: number;
}

export function localStorageUsage(): StorageUsage {
  const { used, total, keys } = platform.storage.usage();
  return { used, total, percent: total > 0 ? Math.min(100, (used / total) * 100) : 0, keys };
}

/** 存储位置的用户可读名称（网页端「浏览器缓存」/ 桌面端「本地数据文件」）。 */
export const STORAGE_LABEL: string = platform.storage.label;
/** 存储位置的一句话说明，用于设置页与私设页。 */
export const STORAGE_HINT: string = platform.storage.hint;

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

/**
 * 分组的指示色。私设页的占用面板与设置页的占用条共用同一套，
 * 两处指的是同一批数据，配色必须一致，否则用户会以为看到的是两回事。
 * 全部走 MD3 语义色，随动态取色与深浅模式自动适配。
 */
export const STORAGE_GROUP_TONE: Record<StorageGroupKey, string> = {
  homebrew: "var(--md-sys-color-primary)",
  cards: "var(--md-sys-color-tertiary)",
  appearance: "var(--md-sys-color-secondary)",
  other: "var(--md-sys-color-outline)",
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
    for (const k of platform.storage.keys()) {
      const v = platform.storage.getItem(k) ?? "";
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
  const total = platform.storage.usage().total;
  return { used, total, percent: total > 0 ? Math.min(100, (used / total) * 100) : 0, keys, groups };
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
  /** 平台补充的说明（桌面端磁盘写失败时由主进程给出） */
  detail?: string;
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
    platform.storage.setItem(key, value);
    usageCache = null; // 写入成功，占用已变化
    return true;
  } catch (err) {
    recordFailure(key, scope ?? groupOf(key), isQuotaExceeded(err) ? "quota" : "unavailable", key.length + value.length);
    return false;
  }
}

/** 记录并广播一次写入失败。同步失败（网页端配额写满）与异步失败（桌面端写盘出错）共用这条路径。 */
function recordFailure(
  key: string,
  scope: StorageGroupKey,
  reason: StorageFailureReason,
  bytes: number,
  detail?: string,
): void {
  const failure: StorageFailure = {
    key,
    scope,
    label: GROUP_LABELS[scope],
    reason,
    bytes,
    usage: cachedUsage(),
    at: Date.now(),
    detail,
  };
  lastFailure = failure;
  for (const fn of failureListeners) {
    try {
      fn(failure);
    } catch {
      // 单个订阅者出错不影响其他订阅者
    }
  }
}

// 桌面端的数据落盘由主进程异步完成，磁盘写失败晚于 setItem 返回。
// 这类失败同样不许静默——接到后走上面同一条广播路径（见 components/StorageAlert）。
platform.storage.onWriteError?.((message) => {
  recordFailure("(数据文件)", "other", "unavailable", 0, message);
});

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

// ===== 整体清除：设置页「清除本机数据」用 =====
//
// 前缀两套写法都有历史原因：绝大多数键是 4enext.xxx.v1，
// 外观类另有 4enext-layout 这种短横线写法（见 App.tsx 的 toggleLayout）。
// 统一按 "4enext" 前缀匹配，避免清除时漏掉任何一个。

const APP_KEY_PREFIX = "4enext";

/** 这个键是不是本应用写下的。 */
export function isAppKey(key: string): boolean {
  return key.startsWith(APP_KEY_PREFIX);
}

/** 本应用在存储里的全部键。返回的是快照数组，边遍历边删是安全的。 */
export function appKeys(): string[] {
  try {
    return platform.storage.keys().filter(isAppKey);
  } catch {
    return [];
  }
}

/**
 * 清空本应用的全部本地数据，返回真正删掉的键数。
 * 存储被禁用时删不动，返回 0 —— 调用方据此提示失败，不要假装清干净了。
 */
export function clearAllAppData(): number {
  let removed = 0;
  for (const k of appKeys()) {
    try {
      platform.storage.removeItem(k);
      removed++;
    } catch {
      /* 单个键删不掉不中断其余的删除 */
    }
  }
  usageCache = null;
  return removed;
}