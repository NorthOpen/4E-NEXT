// 同步合并算法（纯函数，不依赖 DOM / 应用模块，可单独编译单测）。
//
// 合并规则：
//   · 记录级 LWW（Last-Write-Wins），时间取记录自身的 updatedAt，不用设备时钟做绝对判断
//   · 删除写墓碑；删除比编辑新才生效（编辑更新则复活，并撤销墓碑）
//   · 两侧都改过同一条 → 保留本地那份，另一边落成「冲突副本」，绝不静默丢弃
//
// 关键前提：信封里的 updatedAt 与 hash 都由 payload 派生，两边算出同一份数据的值必然相同。
// 因此「某一侧改没改」= 与上次同步的 base 比对 hash，而不是比时间戳。

import {
  SYNC_APP,
  SYNC_KIND,
  SYNC_SCHEMA_VERSION,
  type BaseMap,
  type ConflictInfo,
  type MergeResult,
  type MergeStats,
  type SyncDocument,
  type SyncRecord,
  type Tombstones,
} from "./types";

/** 默认 32 位 FNV-1a 偏移基；第二路换一个基，拼起来得到 64 位，降低碰撞概率。 */
const FNV_BASIS = [0x811c9dc5, 0xcbf29ce4];
const FNV_PRIME = 0x01000193;

/** 稳定序列化：递归按键名排序，保证同一份数据在不同设备上得到同一个字符串。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

/** 64 位（两路 32 位 FNV-1a 拼接）内容哈希，用作「这条记录变没变」的判据。 */
export function hashString(input: string): string {
  const parts: string[] = [];
  for (const basis of FNV_BASIS) {
    let h = basis;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, FNV_PRIME);
    }
    parts.push((h >>> 0).toString(16).padStart(8, "0"));
  }
  return parts.join("");
}

/** 记录内容哈希（payload 的规范序列化再哈希）。 */
export function recordHash(data: unknown): string {
  return hashString(stableStringify(data));
}

export function makeRecord<T>(id: string, updatedAt: number, data: T): SyncRecord<T> {
  return { id, updatedAt, hash: recordHash(data), data };
}

export function emptyDocument<C = unknown, P = unknown>(deviceId: string): SyncDocument<C, P> {
  return {
    app: SYNC_APP,
    kind: SYNC_KIND,
    schemaVersion: SYNC_SCHEMA_VERSION,
    deviceId,
    updatedAt: 0,
    cards: {},
    pools: {},
    tombstones: {},
  };
}

export type DocCheck = { ok: true } | { ok: false; reason: "not-sync" | "too-new" | "malformed" };

/** 校验远端读回来的对象是不是我们的同步文档（并挡住更高版本，避免静默降级丢字段）。 */
export function checkDocument(value: unknown): DocCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "not-sync" };
  const v = value as Record<string, unknown>;
  if (v.app !== SYNC_APP || v.kind !== SYNC_KIND) return { ok: false, reason: "not-sync" };
  if (typeof v.schemaVersion !== "number") return { ok: false, reason: "malformed" };
  if (v.schemaVersion > SYNC_SCHEMA_VERSION) return { ok: false, reason: "too-new" };
  if (v.cards !== undefined && (typeof v.cards !== "object" || v.cards === null)) return { ok: false, reason: "malformed" };
  if (v.pools !== undefined && (typeof v.pools !== "object" || v.pools === null)) return { ok: false, reason: "malformed" };
  return { ok: true };
}

/** 把合并结果转成下次同步用的 base。 */
export function documentToBase(doc: SyncDocument): BaseMap {
  const base: BaseMap = {};
  for (const [id, r] of Object.entries(doc.cards ?? {})) base["card:" + id] = { updatedAt: r.updatedAt, hash: r.hash };
  for (const [id, r] of Object.entries(doc.pools ?? {})) base["pool:" + id] = { updatedAt: r.updatedAt, hash: r.hash };
  return base;
}

/** 墓碑保留期：超过这个时间的删除记录没必要再背着走。 */
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export function pruneTombstones(tombstones: Tombstones, now: number): Tombstones {
  const out: Tombstones = {};
  for (const [k, v] of Object.entries(tombstones)) {
    if (typeof v === "number" && now - v < TOMBSTONE_TTL_MS) out[k] = v;
  }
  return out;
}

export interface MergeHooks<T> {
  /** 冲突时把另一侧那份落成副本（新 id + 名字加后缀）；返回 null 表示放弃副本。 */
  copy: (rec: SyncRecord<T>, now: number) => SyncRecord<T> | null;
  nameOf: (data: T) => string;
}

export interface MergeHooksMap<C, P> {
  card: MergeHooks<C>;
  pool: MergeHooks<P>;
}

interface CollectionResult<T> {
  records: Record<string, SyncRecord<T>>;
  conflicts: ConflictInfo[];
  pulled: number;
  pushed: number;
  deleted: number;
}

function mergeCollection<T>(
  prefix: string,
  kind: "card" | "pool",
  local: Record<string, SyncRecord<T>>,
  remote: Record<string, SyncRecord<T>>,
  tombstones: Tombstones,
  base: BaseMap,
  hooks: MergeHooks<T>,
  now: number,
): CollectionResult<T> {
  const records: Record<string, SyncRecord<T>> = {};
  const conflicts: ConflictInfo[] = [];
  let pulled = 0;
  let pushed = 0;
  let deleted = 0;

  // 本地顺序优先：卡片列表的顺序是用户可见的，不能被同步打乱
  const ids = Object.keys(local);
  for (const id of Object.keys(remote)) if (!(id in local)) ids.push(id);

  for (const id of ids) {
    const key = prefix + id;
    const l = local[id];
    const r = remote[id];
    const b = base[key];
    const tomb = tombstones[key] ?? 0;
    const lTime = l ? l.updatedAt : 0;
    const rTime = r ? r.updatedAt : 0;

    // 墓碑比两侧都新 → 保持删除状态
    if (tomb > 0 && tomb >= lTime && tomb >= rTime) {
      if (l || r) deleted += 1;
      continue;
    }
    // 出现了比墓碑更新的编辑 → 复活，并撤销墓碑
    if (tomb > 0) delete tombstones[key];

    if (l && r) {
      if (l.hash === r.hash) {
        records[id] = l;
        continue;
      }
      const lChanged = !b || l.hash !== b.hash || l.updatedAt !== b.updatedAt;
      const rChanged = !b || r.hash !== b.hash || r.updatedAt !== b.updatedAt;
      if (lChanged && rChanged) {
        // 真冲突：本地那份占住原 id，远端那份另起一条副本
        records[id] = l;
        const copy = hooks.copy(r, now);
        if (copy) {
          records[copy.id] = copy;
          conflicts.push({ kind, id, name: hooks.nameOf(l.data), copyId: copy.id, copyName: hooks.nameOf(copy.data) });
        }
        pushed += 1;
      } else if (lChanged) {
        records[id] = l;
        pushed += 1;
      } else if (rChanged) {
        records[id] = r;
        pulled += 1;
      } else {
        // base 与实际内容不一致（理论上到不了）：退化为取较新的一份
        if (l.updatedAt >= r.updatedAt) {
          records[id] = l;
          pushed += 1;
        } else {
          records[id] = r;
          pulled += 1;
        }
      }
      continue;
    }

    if (l) {
      // 远端没有这条，且没有墓碑 → 保守起见推上去，绝不因为对端缺数据就删本地
      records[id] = l;
      pushed += 1;
      continue;
    }
    if (r) {
      records[id] = r;
      pulled += 1;
    }
  }

  return { records, conflicts, pulled, pushed, deleted };
}

/**
 * 三方合并：local（本机现状）× remote（远端）× base（上次同步的样子）。
 *
 * 注意 tombstones 参数会被就地修改（撤销已被更新编辑覆盖的墓碑），
 * 传入的必须是本函数内部新建的对象——mergeDocuments 已保证这一点。
 */
export function mergeDocuments<C, P>(
  local: SyncDocument<C, P>,
  remote: SyncDocument<C, P>,
  base: BaseMap,
  now: number,
  hooks: MergeHooksMap<C, P>,
): MergeResult<C, P> {
  const tombstones: Tombstones = {};
  for (const [k, v] of Object.entries(local.tombstones ?? {})) tombstones[k] = Math.max(tombstones[k] ?? 0, v);
  for (const [k, v] of Object.entries(remote.tombstones ?? {})) tombstones[k] = Math.max(tombstones[k] ?? 0, v);

  const cards = mergeCollection("card:", "card", local.cards ?? {}, remote.cards ?? {}, tombstones, base, hooks.card, now);
  const pools = mergeCollection("pool:", "pool", local.pools ?? {}, remote.pools ?? {}, tombstones, base, hooks.pool, now);

  const stats: MergeStats = {
    cardsPulled: cards.pulled,
    cardsPushed: cards.pushed,
    poolsPulled: pools.pulled,
    poolsPushed: pools.pushed,
    deleted: cards.deleted + pools.deleted,
  };

  return {
    merged: {
      app: SYNC_APP,
      kind: SYNC_KIND,
      schemaVersion: SYNC_SCHEMA_VERSION,
      deviceId: local.deviceId || remote.deviceId,
      updatedAt: now,
      cards: cards.records,
      pools: pools.records,
      tombstones: pruneTombstones(tombstones, now),
    },
    conflicts: [...cards.conflicts, ...pools.conflicts],
    stats,
  };
}
