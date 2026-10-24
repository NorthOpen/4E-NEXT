// 卡表数据的持久缓存（Cache Storage）。
//
// 为什么是 Cache Storage 而不是 IndexedDB：
//   · 条目以 URL 为键，和 fetch 的语义一一对应，读回来的就是原样的 Response，不用自己设计表结构；
//   · **写入不需要 Service Worker**。SW 首次访问本来就不控制页面，指望它首访落盘得等下一轮刷新；
//     这里在页面里直接 `cache.put`，首访即可生效，SW 只在第二阶段负责「下次自动命中」。
//   · 用户清站点数据时两者一起没，不额外增加需要解释的存储位置。
//
// 只在网页端有意义：桌面端/安卓端的卡表随包分发、走 app:// 与本地资源，
// 不存在跨境问题，也不需要这份缓存（入口处按 platform.kind 关掉）。

import { sha256Hex } from "./transport";

const CACHE_NAME = "4enext-data-v1";
const META_PATH = "/__4enext-data-meta__";

export interface CacheEntryMeta {
  /** 该分片的 SHA-256（来自数据清单，可能缺失） */
  sha256?: string;
  bytes?: number;
  /** 写入时所处的数据版本，用于判断是否过期 */
  dataVersion?: string;
  /** 写入时间戳，LRU 淘汰时用 */
  at: number;
}

export interface CacheMeta {
  version: 1;
  /** 缓存当前对应的数据版本 */
  dataVersion?: string;
  entries: Record<string, CacheEntryMeta>;
}

/** Cache Storage 是否可用：非安全上下文、file://、桌面壳里都可能不可用。 */
export function cacheSupported(): boolean {
  if (typeof caches === "undefined") return false;
  if (typeof location === "undefined") return false;
  return location.protocol === "https:" || location.protocol === "http:" || location.hostname === "localhost";
}

function absolute(url: string): string {
  return new URL(url, location.href).href;
}

async function openCache(): Promise<Cache> {
  return caches.open(CACHE_NAME);
}

async function readMeta(): Promise<CacheMeta> {
  const empty: CacheMeta = { version: 1, entries: {} };
  if (!cacheSupported()) return empty;
  try {
    const cache = await openCache();
    const res = await cache.match(absolute(META_PATH));
    if (!res) return empty;
    const parsed = (await res.json()) as CacheMeta;
    if (!parsed || parsed.version !== 1 || typeof parsed.entries !== "object") return empty;
    return parsed;
  } catch {
    return empty;
  }
}

async function writeMeta(meta: CacheMeta): Promise<void> {
  if (!cacheSupported()) return;
  const cache = await openCache();
  const body = JSON.stringify(meta);
  await cache.put(
    absolute(META_PATH),
    new Response(body, { headers: { "content-type": "application/json" } }),
  );
}

/** 命中缓存的条目（含写入时的元信息）。未命中或结构损坏返回 null。 */
export async function readCachedJson<T>(url: string): Promise<{ data: T; meta: CacheEntryMeta } | null> {
  if (!cacheSupported()) return null;
  try {
    const cache = await openCache();
    const res = await cache.match(absolute(url));
    if (!res) return null;
    const data = (await res.json()) as T;
    const meta = (await readMeta()).entries[absolute(url)] ?? { at: 0 };
    return { data, meta };
  } catch {
    // 缓存条目损坏（写入中断、JSON 被截断）当成未命中，让它走网络
    return null;
  }
}

/**
 * 写入缓存。
 *
 * 写入失败**绝不能让主流程失败**：配额满、隐私模式、Safari 的清理策略都会让这里抛错，
 * 而缓存只是加速手段，取不到数据才是真故障。
 * 配额满时顺手把整份缓存清掉自愈 —— 留着半份旧数据不如让下次重新建。
 */
export async function writeCachedJson(url: string, data: unknown, meta: Omit<CacheEntryMeta, "at">): Promise<void> {
  if (!cacheSupported()) return;
  try {
    const cache = await openCache();
    const body = JSON.stringify(data);
    await cache.put(
      absolute(url),
      new Response(body, { headers: { "content-type": "application/json" } }),
    );
    const current = await readMeta();
    current.entries[absolute(url)] = { ...meta, bytes: meta.bytes ?? body.length, at: Date.now() };
    if (meta.dataVersion) current.dataVersion = meta.dataVersion;
    await writeMeta(current);
  } catch (err) {
    if (isQuotaError(err)) await clearAll();
  }
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

/** 清空整份数据缓存（换数据版本、配额超限、用户主动重置时用）。 */
export async function clearAll(): Promise<void> {
  if (!cacheSupported()) return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    /* 清不掉就算了，下次写入会覆盖 */
  }
}

/**
 * 按清单校验缓存里的分片，返回命中且校验通过的 URL 集合。
 *
 * 只在清单里带了 sha256 时才真正比对内容；没带哈希的产物退化成「存在即命中」——
 * 那是 dev 模式与老产物的正常形态，不该因此判定为失败。
 */
export async function verifyCachedShards(manifestEntries: { url: string; sha256?: string }[]): Promise<string[]> {
  if (!cacheSupported() || manifestEntries.length === 0) return [];
  try {
    const cache = await openCache();
    const hits: string[] = [];
    for (const item of manifestEntries) {
      const key = absolute(item.url);
      const res = await cache.match(key);
      if (!res) continue;
      if (!item.sha256) {
        hits.push(item.url);
        continue;
      }
      const buf = new Uint8Array(await res.clone().arrayBuffer());
      const actual = await sha256Hex(buf);
      if (actual === null || actual === item.sha256) hits.push(item.url);
    }
    return hits;
  } catch {
    return [];
  }
}

/** 容量估算（用于界面提示与将来的 LRU 淘汰策略）。不可用时返回 null。 */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

/** 申请持久化存储，降低被浏览器在空间紧张时清掉的概率。失败无声，不影响功能。 */
export async function requestPersist(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* 权限被拒是常态，忽略 */
  }
}
