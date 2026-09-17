// 全量备份：把本机所有 4E NEXT 数据打包成一个 JSON 文件，供「清除本机数据」之前留底。
//
// 为什么需要它：设置页的清除是「一键全清」，人物卡也在里面，一次误点可能抹掉很久的车卡成果。
// 所以清除入口旁边必须有一个同等显眼、而且**真的能还原**的备份动作 ——
// 只能导出、不能导入的「备份」是一句空话，用户按了反而更放心地误删。
//
// 刻意不打包的内容：
//   · WebDAV 配置（4enext.webdav*）——里面有应用密码，不该落进一个随手放在下载目录的文件里
//   · 同步基线 / 同步状态 / 设备 ID —— 这些是「本机与远端对到哪一步」的记账，
//     换台机器恢复时应当重新建立；带着旧的记账恢复，反而会把远端的改动误判成本机删过的
// 背景图的字节存在 IndexedDB 里（localStorage 只有一个路径标记），所以单独随包带一份，
// 否则恢复后背景会指向一个已经被删掉的缓存键，看起来就是「背景不见了」。

import { platform } from "@platform";
import { BG_CACHE_KEY, BG_CACHE_MARK_KEY } from "./settings";
import { cacheGetImage, cachePutImage } from "./imageCache";
import { appKeys, isAppKey } from "./storage";

export const BACKUP_KIND = "backup";
export const BACKUP_FORMAT = 1;

/** 不进备份文件的键前缀（凭据与同步记账，理由见文件头注释） */
const EXCLUDED_PREFIXES = [
  "4enext.webdav",
  "4enext.syncBase",
  "4enext.syncState",
  "4enext.syncTombstones",
  "4enext.deviceId",
];

export interface BackupFile {
  app: "4enext";
  kind: typeof BACKUP_KIND;
  format: number;
  exportedAt: string;
  version: string;
  /** 全部 4enext* 键值，与 localStorage 逐字节一致 */
  data: Record<string, string>;
  /** 背景图字节（data URL）；没设过背景就是 null */
  bgImage: string | null;
}

export interface RestoreResult {
  /** 写回去的键数 */
  keys: number;
  /** 背景图是否也恢复了 */
  bg: boolean;
}

function isExcluded(key: string): boolean {
  return EXCLUDED_PREFIXES.some((p) => key.startsWith(p));
}

/** 打包当前本机数据。 */
export async function buildBackup(): Promise<BackupFile> {
  const data: Record<string, string> = {};
  for (const k of appKeys()) {
    if (isExcluded(k)) continue;
    try {
      const v = platform.storage.getItem(k);
      if (typeof v === "string") data[k] = v;
    } catch {
      /* 单个键读不出来就跳过，不因为一项失败丢掉整份备份 */
    }
  }

  let bgImage: string | null = null;
  try {
    const cached = await cacheGetImage(BG_CACHE_KEY);
    if (cached && cached.startsWith("data:")) bgImage = cached;
  } catch {
    /* IndexedDB 不可用：备份里就没有背景，其余照常 */
  }

  return {
    app: "4enext",
    kind: BACKUP_KIND,
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    version: __APP_VERSION__,
    data,
    bgImage,
  };
}

/** 备份文件名：4enext-backup-20250612-1830.json（带日期，避免连着导出几次互相覆盖） */
export function backupFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    "4enext-backup-" +
    now.getFullYear() +
    p(now.getMonth() + 1) +
    p(now.getDate()) +
    "-" +
    p(now.getHours()) +
    p(now.getMinutes()) +
    ".json"
  );
}

/**
 * 从备份文本恢复。
 * 语义是「覆盖同名键，保留备份里没有的键」：主要用途是清空之后的还原，
 * 但它不该顺手删掉用户在清空之后新写的东西。
 */
export async function restoreBackup(text: string): Promise<RestoreResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("文件内容不是有效的 JSON。");
  }
  const b = parsed as Partial<BackupFile> | null;
  if (!b || b.app !== "4enext" || b.kind !== BACKUP_KIND || typeof b.data !== "object" || b.data === null) {
    throw new Error("这不是 4E NEXT 导出的备份文件。（人物卡的单个导出文件请到「存档」里导入。）");
  }

  let keys = 0;
  for (const [k, v] of Object.entries(b.data as Record<string, unknown>)) {
    if (!isAppKey(k) || typeof v !== "string") continue;
    try {
      platform.storage.setItem(k, v);
      keys++;
    } catch {
      /* 配额满时后面的键多半也写不进去，继续试完并如实返回条数 */
    }
  }

  let bg = false;
  if (typeof b.bgImage === "string" && b.bgImage.startsWith("data:")) {
    try {
      await cachePutImage(BG_CACHE_KEY, b.bgImage);
      bg = true;
    } catch {
      /* 背景写不进缓存不影响其余数据 */
    }
  }
  // 备份里带了背景路径标记却没有图片字节（旧备份 / 缓存写入失败）：
  // 把标记撤掉，免得应用每次启动都去找一张不存在的图。
  if (!bg) {
    try {
      if (platform.storage.getItem(BG_CACHE_MARK_KEY) === BG_CACHE_KEY) platform.storage.removeItem(BG_CACHE_MARK_KEY);
    } catch {
      /* 忽略 */
    }
  }

  return { keys, bg };
}
