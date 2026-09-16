// 本机状态 ⇄ 同步文档的转换层。
//
// 这里是「哪些数据参与同步」的唯一裁决处：
//   ✅ 人物卡（4enext.cards.v1）与私设资源包（4enext.homebrewPools.v1）
//   ❌ 外观设置 / 板块布局 / 手机分组 / 投骰模式 —— 设备偏好，同步过去只会制造困惑
//   ❌ WebDAV 配置本身 —— 绝不能把自己的密码推到远端
//
// 信封里的 updatedAt 由 payload 派生（卡片取 card.updatedAt，包取 pool.updatedAt），
// 保证同一份数据在任何设备上算出相同的 updatedAt 与 hash。

import { loadCards, saveCards, uid, type SavedCard } from "../storage";
import { loadPools, replaceAllPools, type HomebrewPool } from "../userdata";
import { documentToBase, emptyDocument, makeRecord, mergeDocuments, type MergeHooks } from "./merge";
import type { BaseMap, MergeResult, SyncDocument, SyncRecord, Tombstones } from "./types";

export type CardRecord = SyncRecord<SavedCard>;
export type PoolRecord = SyncRecord<HomebrewPool>;
export type LocalDoc = SyncDocument<SavedCard, HomebrewPool>;

/** 构造一份带正确载荷类型的空文档（远端从未同步过时用它当远端）。 */
export function emptyLocalDocument(deviceId: string): LocalDoc {
  return emptyDocument<SavedCard, HomebrewPool>(deviceId);
}

/** 私设包的 updatedAt 是 ISO 字符串（历史遗留），统一换算成 ms。 */
function poolTime(p: HomebrewPool): number {
  const t = Date.parse(p.updatedAt ?? "");
  if (Number.isFinite(t) && t > 0) return t;
  const c = Date.parse(p.createdAt ?? "");
  return Number.isFinite(c) ? c : 0;
}

/** 冲突副本的名字后缀。 */
function conflictSuffix(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return "（冲突副本 " + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + "）";
}

/** 冲突时把远端那份留成本地副本；只改存档名，不动角色自身的名字。 */
const cardHooks: MergeHooks<SavedCard> = {
  nameOf: (d) => d.name,
  copy: (rec, now) => {
    const id = uid();
    const data: SavedCard = { ...rec.data, id, name: rec.data.name + conflictSuffix(now), updatedAt: now };
    return makeRecord(id, now, data);
  },
};

const poolHooks: MergeHooks<HomebrewPool> = {
  nameOf: (d) => d.name,
  copy: (rec, now) => {
    const id = uid();
    const iso = new Date(now).toISOString();
    const data: HomebrewPool = { ...rec.data, id, name: rec.data.name + conflictSuffix(now), updatedAt: iso };
    return makeRecord(id, now, data);
  },
};

function splitKey(key: string): { kind: string; id: string } {
  const i = key.indexOf(":");
  return i < 0 ? { kind: key, id: "" } : { kind: key.slice(0, i), id: key.slice(i + 1) };
}

/**
 * 生成「本机现状」文档。
 *
 * 墓碑的来源有两处：
 *   ① 之前同步学到的墓碑（持久化在本地，避免远端文件被重置后删除被复活）
 *   ② 上次同步时 base 里有、现在本机没有的记录 → 说明是这次同步之后删的，
 *      删除时间取「上次同步时间」而不是「现在」——用 now 会让一次新删除
 *      盖掉对端更晚的编辑，取 lastSyncAt 更保守，也更接近真实删除时刻。
 */
export function buildLocalDocument(
  deviceId: string,
  base: BaseMap,
  storedTombstones: Tombstones,
  lastSyncAt: number,
): LocalDoc {
  const doc = emptyLocalDocument(deviceId);
  for (const c of loadCards()) doc.cards[c.id] = makeRecord(c.id, c.updatedAt || 0, c);
  for (const p of loadPools()) doc.pools[p.id] = makeRecord(p.id, poolTime(p), p);

  const tombstones: Tombstones = { ...storedTombstones };
  if (lastSyncAt > 0) {
    for (const key of Object.keys(base)) {
      const { kind, id } = splitKey(key);
      if (!id) continue;
      const exists = kind === "card" ? id in doc.cards : kind === "pool" ? id in doc.pools : true;
      if (!exists && !tombstones[key]) tombstones[key] = lastSyncAt;
    }
  }
  doc.tombstones = tombstones;
  return doc;
}

/** 三方合并（本机 × 远端 × 基线）。纯逻辑都在 merge.ts，这里只提供两边的差异化钩子。 */
export function mergeLocalRemote(
  local: LocalDoc,
  remote: LocalDoc,
  base: BaseMap,
  now: number,
): MergeResult<SavedCard, HomebrewPool> {
  return mergeDocuments<SavedCard, HomebrewPool>(local, remote, base, now, { card: cardHooks, pool: poolHooks });
}

/** 把合并结果落回 localStorage（人物卡与私设包），返回各自条数。 */
export function applyDocument(doc: LocalDoc): { cards: number; pools: number } {
  const cards = Object.values(doc.cards ?? {}).map((r) => r.data);
  saveCards(cards);
  const pools = Object.values(doc.pools ?? {}).map((r) => r.data);
  replaceAllPools(pools);
  return { cards: cards.length, pools: pools.length };
}

/** 合并后的文档里应当带走的记录条数（用于摘要文案）。 */
export function countRecords(doc: LocalDoc): { cards: number; pools: number } {
  return { cards: Object.keys(doc.cards ?? {}).length, pools: Object.keys(doc.pools ?? {}).length };
}

export { documentToBase };
