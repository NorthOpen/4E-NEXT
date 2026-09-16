import { platform } from "@platform";
import type { Entry } from "../data/types";
import { safeSetItem, uid } from "./storage";

// 个人资源池存储层：以「包」为存储单元（.d4e 资源包）。
// 每个包：{ id, name, author, description, version, icon, enabled, createdAt, updatedAt, entries }。
// - enabled 的包参与 loaders 合并（可渲染/可搜索），禁用的包保留但离线。
// - 官方 canonical 层只读；用户层独立存储（此处暂用 localStorage，条目量大后可迁 IndexedDB）。

export interface HomebrewPool {
  id: string;
  name: string;
  author?: string;
  /** 包简介：私设页列表与导入确认页展示 */
  description?: string;
  /** 版本号（自由文本，如 1.0.0） */
  version?: string;
  /** Material Symbols 图标名，用于列表外部显示 */
  icon?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  entries: Entry[];
}

/** 包的「外部显示与介绍」可编辑字段。 */
export interface PoolMeta {
  name?: string;
  author?: string;
  description?: string;
  version?: string;
  icon?: string;
}

/** 包图标候选（Material Symbols Outlined，本地字体已内置）。 */
export const POOL_ICONS: string[] = [
  "extension", "menu_book", "swords", "shield", "bolt", "diamond",
  "casino", "science", "pets", "local_fire_department", "workspaces", "palette",
];
export const DEFAULT_POOL_ICON = "extension";

const POOLS_KEY = "4enext.homebrewPools.v1";
// 旧扁平存储（Phase C 早期版本），用于一次性迁移。
const LEGACY_KEY = "4enext.userEntries.v1";

function isEntryLike(e: unknown): e is Entry {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.category === "string" &&
    Array.isArray(o.tags)
  );
}

function isPool(p: unknown): p is HomebrewPool {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.enabled === "boolean" &&
    Array.isArray(o.entries)
  );
}

export function newPool(name: string, entries: Entry[] = [], meta: PoolMeta = {}): HomebrewPool {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name,
    author: meta.author,
    description: meta.description,
    version: meta.version,
    icon: meta.icon ?? DEFAULT_POOL_ICON,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    entries: entries.map((e) => ({ ...e, origin: "user" })),
  };
}

/**
 * 保存全部资源包。返回 false 表示没写进去（配额写满 / 存储被禁用），
 * 失败会由 safeSetItem 广播出去，界面据此提示「没有保存成功」。
 * 资源包是最容易撑爆 localStorage 的一类数据，这里尤其不能静默失败。
 */
function savePools(pools: HomebrewPool[]): boolean {
  return safeSetItem(POOLS_KEY, JSON.stringify(pools));
}

function loadLegacy(): HomebrewPool[] {
  const pools: HomebrewPool[] = [];
  try {
    const raw = platform.storage.getItem(LEGACY_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const ents = arr.filter(isEntryLike);
        if (ents.length) {
          pools.push(newPool("个人池", ents));
          savePools(pools);
          try {
            platform.storage.removeItem(LEGACY_KEY);
          } catch {
            /* 忽略 */
          }
        }
      }
    }
  } catch {
    /* 忽略 */
  }
  return pools;
}

/** 读取全部包（含禁用）。不存在则返回 []（并尝试迁移旧扁平数据）。 */
export function loadPools(): HomebrewPool[] {
  try {
    const raw = platform.storage.getItem(POOLS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter(isPool);
    }
  } catch {
    /* 走 legacy */
  }
  return loadLegacy();
}

/** 读取单个包（含禁用）。 */
export function loadPool(id: string): HomebrewPool | undefined {
  return loadPools().find((p) => p.id === id);
}

function touch(id: string, pools: HomebrewPool[], entries?: Entry[]): void {
  const p = pools.find((x) => x.id === id);
  if (!p) return;
  if (entries) p.entries = entries.map((e) => ({ ...e, origin: "user" }));
  p.updatedAt = new Date().toISOString();
}

/**
 * 扁平化条目（供 loaders/校验用）。
 * @param includeDisabled 为 true 时含禁用包（冲突检测用）；默认仅 enabled（渲染/搜索用）。
 */
export function loadUserEntries(includeDisabled = false): Entry[] {
  return loadPools()
    .filter((p) => includeDisabled || p.enabled)
    .flatMap((p) => p.entries);
}

export function entryPoolId(id: string): string | undefined {
  for (const p of loadPools()) if (p.entries.some((e) => e.id === id)) return p.id;
  return undefined;
}

export function createPool(name: string, meta: PoolMeta = {}): HomebrewPool {
  const pools = loadPools();
  const p = newPool(name, [], meta);
  pools.push(p);
  savePools(pools);
  return p;
}

/** 写/更新条目到指定包。poolId 为空时落到第一个包（无包则自动建「个人池」）。 */
export function upsertEntryInPool(id: string, entry: Entry, poolId?: string): Entry {
  const pools = loadPools();
  const sourcePoolId = pools.find((p) => p.entries.some((e) => e.id === id))?.id;
  let target = pools.find((p) => p.id === (poolId ?? sourcePoolId));
  if (!target) {
    if (pools.length) target = pools[0];
    else {
      target = newPool("个人池");
      pools.push(target);
    }
  }
  // 显式换包：先从原包摘除，避免同 id 条目在两个包内并存
  if (sourcePoolId && sourcePoolId !== target.id) {
    const src = pools.find((p) => p.id === sourcePoolId);
    if (src) touch(src.id, pools, src.entries.filter((e) => e.id !== id));
  }
  const norm = { ...entry, origin: "user" as const };
  const idx = target.entries.findIndex((e) => e.id === id);
  if (idx >= 0) target.entries[idx] = norm;
  else target.entries.push(norm);
  touch(target.id, pools, target.entries);
  savePools(pools);
  return norm;
}

/** 从所有包移除该条目。 */
export function removeEntryFromAnyPool(id: string): HomebrewPool[] {
  return removeEntriesFromAnyPool([id]);
}

/** 批量移除条目（跨包）。 */
export function removeEntriesFromAnyPool(ids: string[]): HomebrewPool[] {
  const drop = new Set(ids);
  const pools = loadPools();
  for (const p of pools) {
    const next = p.entries.filter((e) => !drop.has(e.id));
    if (next.length !== p.entries.length) touch(p.id, pools, next);
  }
  savePools(pools);
  return pools;
}

/** 批量移动条目到目标包（保持 id 不变）。 */
export function moveEntriesToPool(ids: string[], targetPoolId: string): HomebrewPool[] {
  const pools = loadPools();
  const target = pools.find((p) => p.id === targetPoolId);
  if (!target) return pools;
  const moving = new Set(ids);
  const picked: Entry[] = [];
  for (const p of pools) {
    if (p.id === targetPoolId) continue;
    const keep: Entry[] = [];
    for (const e of p.entries) (moving.has(e.id) ? picked : keep).push(e);
    if (keep.length !== p.entries.length) touch(p.id, pools, keep);
  }
  if (picked.length) {
    const existing = new Set(target.entries.map((e) => e.id));
    touch(target.id, pools, [...target.entries, ...picked.filter((e) => !existing.has(e.id))]);
  }
  savePools(pools);
  return pools;
}

/** 在包内复制一条条目（新 id + 「副本」后缀）。 */
export function duplicateEntry(id: string): Entry | undefined {
  const pools = loadPools();
  const pool = pools.find((p) => p.entries.some((e) => e.id === id));
  const src = pool?.entries.find((e) => e.id === id);
  if (!pool || !src) return undefined;
  const taken = new Set(pools.flatMap((p) => p.entries.map((e) => e.id)));
  const copy: Entry = { ...src, id: uniquify(src.id, taken), name: src.name + " 副本", origin: "user" };
  touch(pool.id, pools, [...pool.entries, copy]);
  savePools(pools);
  return copy;
}

function uniquify(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  const stem = base.replace(/#\d+$/, "");
  let n = 1;
  while (taken.has(stem + "#" + n)) n++;
  return stem + "#" + n;
}

/** 用户层内唯一的条目 id（ignoreId 为编辑自身时保留的 id）。 */
export function uniqueEntryId(base: string, ignoreId?: string): string {
  const taken = new Set<string>();
  for (const p of loadPools()) for (const e of p.entries) if (e.id !== ignoreId) taken.add(e.id);
  return uniquify(base.trim() || "未命名", taken);
}

export function togglePoolEnabled(id: string): HomebrewPool[] {
  const pools = loadPools();
  const p = pools.find((x) => x.id === id);
  if (p) {
    p.enabled = !p.enabled;
    p.updatedAt = new Date().toISOString();
    savePools(pools);
  }
  return pools;
}

export function deletePool(id: string): HomebrewPool[] {
  const pools = loadPools().filter((p) => p.id !== id);
  savePools(pools);
  return pools;
}

export function renamePool(id: string, name: string): HomebrewPool[] {
  const pools = loadPools();
  const p = pools.find((x) => x.id === id);
  if (p && name.trim()) {
    p.name = name.trim();
    p.updatedAt = new Date().toISOString();
    savePools(pools);
  }
  return pools;
}

/** 更新包的外部显示信息（名称/作者/简介/版本/图标）。 */
export function updatePoolMeta(id: string, meta: PoolMeta): HomebrewPool | undefined {
  const pools = loadPools();
  const p = pools.find((x) => x.id === id);
  if (!p) return undefined;
  if (meta.name !== undefined && meta.name.trim()) p.name = meta.name.trim();
  if (meta.author !== undefined) p.author = meta.author.trim() || undefined;
  if (meta.description !== undefined) p.description = meta.description.trim() || undefined;
  if (meta.version !== undefined) p.version = meta.version.trim() || undefined;
  if (meta.icon !== undefined) p.icon = meta.icon.trim() || DEFAULT_POOL_ICON;
  p.updatedAt = new Date().toISOString();
  savePools(pools);
  return p;
}

/** 复制一份包（新 id，可改新名），默认启用。 */
export function copyPool(sourceId: string, newName?: string): HomebrewPool | undefined {
  const pools = loadPools();
  const src = pools.find((p) => p.id === sourceId);
  if (!src) return undefined;
  const name = (newName && newName.trim()) || src.name + " 副本";
  const dup = newPool(name, src.entries, {
    author: src.author,
    description: src.description,
    version: src.version,
    icon: src.icon,
  });
  pools.push(dup);
  savePools(pools);
  return dup;
}

/** 导入一份新包（enabled 默认开，立即可见）。 */
export function importAsPool(name: string, meta: PoolMeta, entries: Entry[]): HomebrewPool {
  const pools = loadPools();
  const p = newPool(name, entries, meta);
  pools.push(p);
  savePools(pools);
  return p;
}

/** 供外部（迁移/测试）整体替换。 */
export function replaceAllPools(pools: HomebrewPool[]): void {
  savePools(pools.map((p) => ({ ...p, entries: p.entries.map((e) => ({ ...e, origin: "user" })) })));
}

// ===== 统计：用于私设页的「大小 / 涉及资源类型」快速展示 =====

/** 单个包在 localStorage 中的占用（UTF-16 码元，与 localStorageUsage 口径一致）。 */
export function poolSizeBytes(pool: HomebrewPool): number {
  try {
    return JSON.stringify(pool).length;
  } catch {
    return 0;
  }
}

/** 全部包合计占用。 */
export function poolsSizeBytes(pools: HomebrewPool[]): number {
  return pools.reduce((n, p) => n + poolSizeBytes(p), 0);
}

/** 包内涉及的资源类型及条目数（按条目量降序）。 */
export function poolCategoryCounts(pool: HomebrewPool): { category: string; count: number }[] {
  const map = new Map<string, number>();
  for (const e of pool.entries) map.set(e.category, (map.get(e.category) ?? 0) + 1);
  return [...map.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
