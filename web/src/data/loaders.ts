import type { Manifest, SearchEntry, Entry } from "./types";
import { loadUserEntries } from "../lib/userdata";
import { toSearchEntry } from "../lib/bundle";
import { activeDataVersion, dataUrl, peekManifest } from "../boot/manifest";
import { readCachedJson, writeCachedJson } from "../boot/cacheStore";
import { isOfflineOnly } from "../boot/bootRun";
import { fetchJsonBytes } from "../boot/transport";

const cache = new Map<string, unknown>();

/**
 * 取数策略（改动前请先读完）：
 *
 *   1. 内存命中 → 直接返回（同一次会话内不重复读盘/读网）；
 *   2. 持久缓存命中且**版本一致** → 直接返回，一个字节都不上网；
 *   3. 否则联网取：首字节超时 + 传输停滞检测 + 退避重试 + 可选 SHA-256 校验；
 *   4. 联网失败但手上有旧缓存 → 退回旧的（旧卡表好过空站）；
 *   5. 两种情况都没有 → 抛错，由调用方显示「加载失败」。
 *
 * 之所以把「版本一致」作为缓存命中的前提：数据管线重跑之后缓存里是旧卡表，
 * 直接拿来用会让用户看到已经改掉/删掉的条目，比慢一点更糟。
 */

/** power.json 有 19MB，所以首字节超时给得比清单宽，且只在「传输停滞」时才判死 */
const DATA_POLICY = { timeoutMs: 15_000, retries: 2, stallMs: 20_000 };

/** 清单里的分片元信息索引：relPath -> { sha256, bytes }。清单只读一次，索引随之建一次。 */
let manifestIndex: Map<string, { sha256?: string; bytes?: number }> | null = null;

function metaFor(path: string): { sha256?: string; bytes?: number } | undefined {
  const mf = peekManifest();
  if (!mf) return undefined;
  if (!manifestIndex) {
    manifestIndex = new Map();
    for (const c of Object.values(mf.categories)) manifestIndex.set(c.file, { sha256: c.sha256, bytes: c.bytes });
  }
  return manifestIndex.get(path);
}

/** 缓存条目是否还属于当前数据版本。清单没拿到（null）时一律认为可用 —— 那是离线场景。 */
function cacheFresh(entryVersion: string | undefined, active: string | null): boolean {
  if (active === null) return true;
  return entryVersion === active;
}

async function fetchJson<T>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit) return hit as T;

  const url = dataUrl(path);
  const meta = metaFor(path);
  const version = activeDataVersion();
  const cached = await readCachedJson<T>(url);

  // ② 缓存新鲜 → 零网络
  if (cached && cacheFresh(cached.meta.dataVersion, version)) {
    cache.set(path, cached.data);
    return cached.data;
  }

  // 用户选了「仅用缓存继续」：不再打请求，有旧数据就用旧数据
  if (cached && isOfflineOnly()) {
    cache.set(path, cached.data);
    return cached.data;
  }

  // ③ 联网
  try {
    const { data, bytes } = await fetchJsonBytes<T>(url, { sha256: meta?.sha256, policy: DATA_POLICY });
    cache.set(path, data);
    // 写缓存不 await：慢一拍的持久化不该拖住渲染
    void writeCachedJson(url, data, {
      sha256: meta?.sha256,
      bytes,
      dataVersion: version ?? undefined,
    });
    return data;
  } catch (err) {
    // ④ 联网失败但手上有旧缓存 → 退回旧的
    if (cached) {
      cache.set(path, cached.data);
      return cached.data;
    }
    throw err;
  }
}

/** 官方层：直接读取派生 JSON，统一补 origin="official"。 */
async function loadOfficial(cat: string): Promise<Entry[]> {
  const data = await fetchJson<Entry[]>("categories/" + cat + ".json");
  return data.map((e) => ({ ...e, origin: "official" as const }));
}

/** 用户层：从个人资源池读取该分类的自制条目（实时读取，编辑/导入后即时生效）。 */
function loadUser(cat: string): Entry[] {
  return loadUserEntries().filter((e) => e.category === cat && e.origin === "user");
}

// 合并：先官方后用户，同 id 时用户覆盖官方（用户自定义优先，无冲突时行为与官方一致）。
function merge(cat: string): Promise<Entry[]> {
  return loadOfficial(cat).then((official) => {
    const byId = new Map<string, Entry>();
    for (const e of official) byId.set(e.id, e);
    for (const e of loadUser(cat)) byId.set(e.id, e);
    return [...byId.values()];
  });
}

export function loadManifest(): Promise<Manifest> {
  return fetchJson<Manifest>("manifest.json");
}

/** 搜索索引：官方 + 用户合并，让自制条目也能被搜索到。 */
export async function loadSearchIndex(): Promise<SearchEntry[]> {
  const official = await fetchJson<SearchEntry[]>("search-index.json");
  const user = loadUserEntries().map(toSearchEntry);
  if (user.length === 0) return official;
  const byId = new Map<string, SearchEntry>();
  for (const s of official) byId.set(s.id, s);
  for (const s of user) byId.set(s.id, s);
  return [...byId.values()];
}

export function loadRelations(): Promise<{ powerByGrantedBy: Record<string, string[]> }> {
  return fetchJson("relations.json");
}

export function loadCategory(cat: string): Promise<Entry[]> {
  return merge(cat);
}

/** 按分类返回仅官方条目（如需访问原始官方数据，可绕过用户层覆盖）。 */
export function loadOfficialCategory(cat: string): Promise<Entry[]> {
  return loadOfficial(cat);
}
