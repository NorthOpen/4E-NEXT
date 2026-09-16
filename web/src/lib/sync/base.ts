// 同步基线与状态：上次同步时各记录的样子 + 上次同步时间 + 墓碑。
//
// base 是「本机上次见到远端是什么样」的快照。有了它才能区分
// 「这一侧改过了」和「只是还没同步」——否则每次同步都会把两边都判成改动。

import { safeSetItem } from "../storage";
import type { BaseMap, Tombstones } from "./types";

const BASE_KEY = "4enext.syncBase.v1";
const TOMB_KEY = "4enext.syncTombstones.v1";
const STATE_KEY = "4enext.syncState.v1";

export interface SyncState {
  /** 上次成功同步的时间（ms）；0 表示从未同步过 */
  lastSyncAt: number;
  /** 上次同步的结果摘要，供设置页展示 */
  lastSummary: string;
}

const EMPTY_STATE: SyncState = { lastSyncAt: 0, lastSummary: "" };

export function loadBase(): BaseMap {
  try {
    const raw = localStorage.getItem(BASE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as BaseMap) : {};
  } catch {
    return {};
  }
}

export function saveBase(b: BaseMap): void {
  safeSetItem(BASE_KEY, JSON.stringify(b));
}

export function loadTombstones(): Tombstones {
  try {
    const raw = localStorage.getItem(TOMB_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Tombstones) : {};
  } catch {
    return {};
  }
}

export function saveTombstones(t: Tombstones): void {
  safeSetItem(TOMB_KEY, JSON.stringify(t));
}

export function loadSyncState(): SyncState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    const s = JSON.parse(raw) as Partial<SyncState>;
    return {
      lastSyncAt: typeof s.lastSyncAt === "number" ? s.lastSyncAt : 0,
      lastSummary: typeof s.lastSummary === "string" ? s.lastSummary : "",
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function saveSyncState(s: SyncState): void {
  safeSetItem(STATE_KEY, JSON.stringify(s));
}

/** 忘记本机的同步基线（用于「下次同步当作首次」这类排障操作）。 */
export function clearSyncBase(): void {
  try {
    localStorage.removeItem(BASE_KEY);
    localStorage.removeItem(TOMB_KEY);
  } catch {
    /* 忽略 */
  }
}
