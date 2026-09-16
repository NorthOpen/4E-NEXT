// WebDAV 多端同步：类型与常量。
//
// 这一层刻意不依赖任何应用模块（人物卡 / 私设包的类型不在这里出现），
// 好处是 merge.ts 可以脱离浏览器与 DOM 单独编译、单独单测——
// 合并逻辑是最容易悄悄丢用户数据的地方，必须能验证。

export const SYNC_APP = "4enext";
export const SYNC_KIND = "sync";
export const SYNC_SCHEMA_VERSION = 1;

/** 远端同步文件名（位于配置的远端目录内）。 */
export const SYNC_FILE = "sync.json";

/**
 * 一条记录在同步文档中的信封。
 *
 * updatedAt 由 payload 自身派生（人物卡取 card.updatedAt，私设包取 pool.updatedAt），
 * 而不是「写文档的时刻」——这样同一份数据在任何设备上算出的 updatedAt 与 hash 都一致，
 * 否则每同步一次都会把两边都判成「改过了」。
 */
export interface SyncRecord<T> {
  id: string;
  updatedAt: number;
  hash: string;
  data: T;
}

/** 墓碑：key 形如 "card:<id>" / "pool:<id>"，value 为删除时间（ms）。 */
export type Tombstones = Record<string, number>;

export interface SyncDocument<C = unknown, P = unknown> {
  app: string;
  kind: string;
  schemaVersion: number;
  deviceId: string;
  updatedAt: number;
  cards: Record<string, SyncRecord<C>>;
  pools: Record<string, SyncRecord<P>>;
  tombstones: Tombstones;
}

/** 上次同步时各记录的样子，用于判断「这一侧到底改没改」（三方合并的 base）。 */
export interface BaseEntry {
  updatedAt: number;
  hash: string;
}

export type BaseMap = Record<string, BaseEntry>;

export interface ConflictInfo {
  kind: "card" | "pool";
  /** 原记录 id（本地那份保留原 id） */
  id: string;
  /** 原记录名（用于界面提示） */
  name: string;
  /** 冲突副本的 id */
  copyId: string;
  /** 冲突副本的名 */
  copyName: string;
}

export interface MergeStats {
  cardsPulled: number;
  cardsPushed: number;
  poolsPulled: number;
  poolsPushed: number;
  deleted: number;
}

export interface MergeResult<C, P> {
  merged: SyncDocument<C, P>;
  conflicts: ConflictInfo[];
  stats: MergeStats;
}

export interface SyncConfig {
  /** WebDAV 根地址，如 https://dav.jianguoyun.com/dav/ */
  url: string;
  username: string;
  /** 应用专用密码（不是账号登录密码） */
  password: string;
  /** 远端子目录（相对根地址），如 4enext */
  dir: string;
  enabled: boolean;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  url: "",
  username: "",
  password: "",
  dir: "4enext",
  enabled: false,
};

export type SyncErrorKind =
  | "config"
  | "network"
  | "cors"
  | "auth"
  | "notfound"
  | "conflict"
  | "server"
  | "parse"
  | "unsupported";

/** 带分类的同步错误：界面按 kind 给出可操作的提示，而不是甩一个英文异常。 */
export class SyncError extends Error {
  kind: SyncErrorKind;
  status: number | undefined;

  constructor(kind: SyncErrorKind, message: string, status?: number) {
    super(message);
    this.name = "SyncError";
    this.kind = kind;
    this.status = status;
  }
}

export interface SyncOutcome {
  at: number;
  pulled: number;
  pushed: number;
  deleted: number;
  conflicts: ConflictInfo[];
}
