// 数据清单：启动时唯一一次「必须联网」的小请求。
//
// 它是整套增量更新的支点：约 2KB，用 no-store 保证每次都问一次「数据换版本了吗」，
// 版本没变就整站走缓存（零数据流量），变了下差集只取变过的分片。

import { fetchJsonBytes } from "./transport";
import type { DataManifest } from "./types";

/** 读清单的超时给得比数据请求短：它只是 2KB，卡住说明链路已经不行了，早失败早降级。 */
const MANIFEST_POLICY = { timeoutMs: 5_000, retries: 2 };

let cached: DataManifest | null = null;
let pending: Promise<DataManifest | null> | null = null;
let activeVersion: string | null = null;

export function manifestUrl(): string {
  return import.meta.env.BASE_URL + "data/manifest.json";
}

/** 清单里的分类文件相对路径 → 可请求的完整地址。 */
export function dataUrl(relPath: string): string {
  return import.meta.env.BASE_URL + "data/" + relPath;
}

/**
 * 取数据清单。失败返回 null（**不抛错**）。
 *
 * 启动不该因为一份清单挂掉：拿不到就当成「不知道有没有更新」，
 * 由数据层按「有缓存先用缓存、没有就联网」的保守策略继续，功能一个不少。
 */
export function loadDataManifest(): Promise<DataManifest | null> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = (async () => {
    try {
      const { data } = await fetchJsonBytes<DataManifest>(manifestUrl(), {
        policy: MANIFEST_POLICY,
        // 清单本身不校验：它是信任根，且每次都是网络直取
      });
      if (!data || typeof data.categories !== "object") return null;
      cached = data;
      activeVersion = data.dataVersion ?? data.generatedAt ?? null;
      return data;
    } catch {
      return null;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

/**
 * 当前生效的数据版本。
 *
 * null 表示「清单没拿到」，此时数据层一律**接受缓存**——
 * 宁可给用户一份旧卡表，也好过在断网时给一个空站。
 */
export function activeDataVersion(): string | null {
  return activeVersion;
}

/** 已经读到过清单（测试与设置页用）。 */
export function peekManifest(): DataManifest | null {
  return cached;
}
