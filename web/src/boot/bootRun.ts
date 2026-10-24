// 启动编排：把「读清单 → 校验缓存 → 准备存储」串成一条可观测的状态机。
//
// 设计约束（改动前请先读）：
//   · **关键任务只有两项**，且都是小请求。图标字体、搜索索引、怪物库一律不许进关键集——
//     否则一次慢网络就会把「图标晚点出来」升级成「整站打不开」，那是倒退而不是修复。
//   · 任何一步失败都**不抛错**、不阻塞超过 BLOCK_MAX_MS。启动编排是体验层，
//     它坏了顶多没有进度条，绝不能让人进不去主界面。
//   · 状态用模块级单例 + useSyncExternalStore 订阅（见 BootOverlay），
//     避免 StrictMode 下双执行 effect 把启动跑两遍。

import { platform } from "@platform";
import { cacheSupported, requestPersist, verifyCachedShards } from "./cacheStore";
import { activeDataVersion, dataUrl, loadDataManifest } from "./manifest";
import type { BootSnapshot, BootTask } from "./types";

/** 从开始到「必须进主界面」的硬上限。到点无论成没成都放行，启动在后台继续。 */
export const BLOCK_MAX_MS = 6_000;

const TASK_DEFS: { id: string; label: string; critical: boolean }[] = [
  { id: "manifest", label: "读取数据清单", critical: true },
  { id: "cache", label: "校验本地缓存", critical: true },
  { id: "storage", label: "准备本地存储", critical: false },
];

function initialTasks(): BootTask[] {
  return TASK_DEFS.map((t) => ({ ...t, state: "pending" }));
}

let snapshot: BootSnapshot = {
  started: false,
  ready: false,
  tasks: initialTasks(),
  done: 0,
  total: TASK_DEFS.filter((t) => t.critical).length,
  failed: false,
  cachedShards: 0,
  dataVersion: null,
};

let bootStarted = false;
let bypassed = false;
/**
 * 「离线优先」：用户点了「仅用缓存继续」之后置位。
 * 数据层据此不再尝试联网（避免在明明知道链路不行的前提下反复打请求）。
 */
let offlineOnly = false;

const listeners = new Set<() => void>();

function commit(next: BootSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeBoot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBootSnapshot(): BootSnapshot {
  return snapshot;
}

export function isOfflineOnly(): boolean {
  return offlineOnly;
}

function setTask(id: string, patch: Partial<BootTask>): void {
  const tasks = snapshot.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  const critical = tasks.filter((t) => t.critical);
  const done = critical.filter((t) => t.state === "ok" || t.state === "fail" || t.state === "skip").length;
  const ready = done >= critical.length;
  commit({
    ...snapshot,
    tasks,
    done,
    ready,
    failed: critical.some((t) => t.state === "fail"),
  });
}

/**
 * 放行：把还没落地的关键任务标成 skip，然后标记 ready。
 * 用户点「跳过」、到点兜底、以及非网页端都走这里。
 */
export function bypassBoot(reason: string, offline = false): void {
  if (snapshot.ready) return;
  bypassed = true;
  if (offline) offlineOnly = true;
  const tasks = snapshot.tasks.map((t) =>
    t.critical && (t.state === "pending" || t.state === "running")
      ? { ...t, state: "skip" as const, detail: reason }
      : t,
  );
  const critical = tasks.filter((t) => t.critical);
  commit({
    ...snapshot,
    tasks,
    done: critical.filter((t) => t.state === "ok" || t.state === "fail" || t.state === "skip").length,
    ready: true,
    failed: critical.some((t) => t.state === "fail"),
  });
}

/** 幂等启动。重复调用（StrictMode、热更新）直接返回。 */
export function startBoot(): void {
  if (bootStarted) return;
  bootStarted = true;

  // 桌面端与安卓端走 app:// / 本地资源，没有跨境问题，也不需要这份编排：
  // 直接标记就绪，界面照旧，一行行为都不变。
  if (platform.kind !== "web" || !cacheSupported()) {
    commit({ ...snapshot, started: true, ready: true });
    return;
  }

  commit({ ...snapshot, started: true });
  void run();
}

async function run(): Promise<void> {
  // 兜底：无论下面卡在哪一步，到点一律放行
  const watchdog = setTimeout(() => bypassBoot("启动超时，已跳过", true), BLOCK_MAX_MS);

  try {
    // ① 读清单（唯一必须联网的一步，约 2KB）
    setTask("manifest", { state: "running" });
    const manifest = await loadDataManifest();
    if (bypassed) return;

    if (!manifest) {
      setTask("manifest", { state: "fail", detail: "无法读取数据清单，将直接联网取数" });
      // 清单拿不到也要继续走缓存校验那一行，否则进度条会停在一半
    } else {
      const version = activeDataVersion();
      setTask("manifest", { state: "ok", detail: version ? "版本 " + shortVersion(version) : "已读取" });
    }

    // ② 校验缓存（本地操作，不发请求）
    setTask("cache", { state: "running" });
    const entries = manifest
      ? Object.values(manifest.categories).map((c) => ({ url: dataUrl(c.file), sha256: c.sha256 }))
      : [];
    const hits = await verifyCachedShards(entries);
    if (bypassed) return;
    setTask("cache", {
      state: manifest ? "ok" : "skip",
      detail: entries.length === 0 ? "无可校验分片" : "命中 " + hits.length + "/" + entries.length + " 个分片",
    });
    commit({ ...snapshot, cachedShards: hits.length, dataVersion: activeDataVersion() });

    // ③ 本地存储（非关键，失败不影响进入）
    setTask("storage", { state: "running" });
    await requestPersist();
    setTask("storage", { state: "ok", detail: "已申请持久化" });
  } catch (err) {
    // 编排自身出错：所有未落地的关键任务算失败，但立刻放行
    const message = err instanceof Error ? err.message : String(err);
    const tasks = snapshot.tasks.map((t) =>
      t.critical && t.state !== "ok" ? { ...t, state: "fail" as const, detail: message } : t,
    );
    commit({ ...snapshot, tasks, ready: true, failed: true });
  } finally {
    clearTimeout(watchdog);
    // 走到这里说明关键任务都已落地（或已被兜底放行）
    if (!snapshot.ready) commit({ ...snapshot, ready: true });
  }
}

/** 版本号太长会撑破一行，截前 10 位即可辨识 */
function shortVersion(v: string): string {
  return v.length > 12 ? v.slice(0, 12) : v;
}
