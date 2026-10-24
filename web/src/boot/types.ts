// 启动编排的类型定义。
//
// 这一层只描述「启动时有哪些事要做、做到哪一步」，不关心界面怎么画，
// 也不关心数据从哪来 —— 界面见 BootOverlay.tsx，取数见 manifest.ts / cacheStore.ts。

/**
 * 数据清单里的单个分类条目。
 *
 * sha256 / bytes / dataVersion 都是**可选**的：
 * 它们由构建产物注入（见 vite.config.ts 的 dataManifestHashes 插件），
 * 而 dev 模式下、以及尚未跑过构建的数据副本里没有这几个字段。
 * 缺失时一律降级为「不校验、直接联网取」，不能让老产物变成打不开的站。
 */
export interface CategoryMeta {
  count: number;
  file: string;
  /** 文件内容的 SHA-256（十六进制小写）。有它才做完整性校验。 */
  sha256?: string;
  /** 文件字节数，进度条与容量估算用。 */
  bytes?: number;
}

/** data/manifest.json 的形状（在 data/types.ts 的 Manifest 基础上加了增量字段）。 */
export interface DataManifest {
  schemaVersion: number;
  generatedAt: string;
  total: number;
  /** 整包版本：每次重新生成数据都会变。清单里没有时回落到 generatedAt。 */
  dataVersion?: string;
  categories: Record<string, CategoryMeta>;
}

/** 单个启动任务的状态机。 */
export type BootTaskState = "pending" | "running" | "ok" | "fail" | "skip";

export interface BootTask {
  id: string;
  /** 界面上显示的一行文案 */
  label: string;
  /**
   * 关键任务 = 没完成就不进主界面。
   * 刻意只有「读清单」「校验缓存」两项：图标字体、搜索索引这些慢但不影响开工的东西
   * 一律非关键 —— 否则图省事的阻塞会把「图标晚点出来」升级成「整站打不开」。
   */
  critical: boolean;
  state: BootTaskState;
  /** 失败原因 / 补充说明（如「命中 12 个分片」） */
  detail?: string;
}

/** 对外暴露的启动快照（useSyncExternalStore 要求每次变化返回新对象）。 */
export interface BootSnapshot {
  /** 已经开始跑 */
  started: boolean;
  /** 关键任务全部落地（成功、失败或跳过都算「落地」） */
  ready: boolean;
  tasks: BootTask[];
  /** 已完成的关键任务数 / 关键任务总数 */
  done: number;
  total: number;
  /** 关键任务里有失败项 */
  failed: boolean;
  /** 缓存里已通过校验的分片数 */
  cachedShards: number;
  /** 当前生效的数据版本（读不到清单时为 null） */
  dataVersion: string | null;
}
