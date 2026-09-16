// 同步编排：把「本机现状 → 拉远端 → 三方合并 → 落回本地 → 推远端」串起来。
//
// 并发安全靠 ETag 乐观锁：PUT 带 If-Match，期间被别的设备改过就拿到 412，
// 此时重新拉取并再合并一轮，绝不覆盖别人的写入。

import { deviceId, isConfigured, loadSyncConfig } from "./config";
import { loadBase, loadSyncState, loadTombstones, saveBase, saveSyncState, saveTombstones } from "./base";
import { applyDocument, buildLocalDocument, emptyLocalDocument, mergeLocalRemote, type LocalDoc } from "./document";
import { checkDocument, documentToBase } from "./merge";
import { SyncError, type SyncConfig, type SyncOutcome } from "./types";
import { assertConfig, ensureDir, pullDocument, pushDocument } from "./webdav";

/** 合并结果已写回本机数据后广播，让界面重新读取人物卡 / 私设包。 */
export const SYNC_APPLIED_EVENT = "4enext:sync-applied";

function notifyDataChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

function summaryOf(outcome: SyncOutcome): string {
  const bits: string[] = [];
  if (outcome.pulled) bits.push("拉取 " + outcome.pulled + " 条");
  if (outcome.pushed) bits.push("推送 " + outcome.pushed + " 条");
  if (outcome.deleted) bits.push("删除 " + outcome.deleted + " 条");
  if (outcome.conflicts.length) bits.push("冲突 " + outcome.conflicts.length + " 条（已存为副本）");
  return bits.length ? bits.join("，") : "两侧已一致，无需改动";
}

/**
 * 执行一次同步。
 *
 * 同步失败时本机数据可能已经写入（合并是先落本地再推远端），这是有意为之：
 * 拉下来的内容对用户是有价值的，不能因为网络失败就丢掉。
 * 但基线只在推送成功后才更新，所以下次同步仍会把这批改动推上去，不会漏。
 */
export async function runSync(cfgOverride?: SyncConfig): Promise<SyncOutcome> {
  const cfg = cfgOverride ?? loadSyncConfig();
  assertConfig(cfg);

  const device = deviceId();
  const base = loadBase();
  const state = loadSyncState();
  const now = Date.now();

  let current: LocalDoc = buildLocalDocument(device, base, loadTombstones(), state.lastSyncAt);
  await ensureDir(cfg);

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const { doc: remoteRaw, etag } = await pullDocument(cfg);

    let remote: LocalDoc;
    if (remoteRaw === null) {
      remote = emptyLocalDocument(device);
    } else {
      const check = checkDocument(remoteRaw);
      if (!check.ok) {
        if (check.reason === "too-new") {
          const v = (remoteRaw as { schemaVersion?: number }).schemaVersion;
          throw new SyncError(
            "unsupported",
            "远端文件由更新版本的 4E NEXT 写入（schemaVersion " + String(v) + "）。请先升级本页，避免旧版把新字段写丢。",
          );
        }
        if (check.reason === "not-sync") {
          throw new SyncError("parse", "远端文件不是 4E NEXT 的同步文件——这个文件名可能被别的东西占用了，请换一个远端路径。");
        }
        throw new SyncError("parse", "远端同步文件结构损坏，无法合并。");
      }
      const doc = remoteRaw as LocalDoc;
      doc.cards = doc.cards ?? {};
      doc.pools = doc.pools ?? {};
      doc.tombstones = doc.tombstones ?? {};
      remote = doc;
    }

    const { merged, conflicts, stats } = mergeLocalRemote(current, remote, base, now);
    applyDocument(merged);

    try {
      await pushDocument(cfg, merged, etag);
    } catch (e) {
      // 期间别的设备写过 → 重拉重合并，最多再来一轮
      if (e instanceof SyncError && e.kind === "conflict" && attempt < 2) {
        current = merged;
        continue;
      }
      notifyDataChanged();
      throw e;
    }

    const outcome: SyncOutcome = {
      at: Date.now(),
      pulled: stats.cardsPulled + stats.poolsPulled,
      pushed: stats.cardsPushed + stats.poolsPushed,
      deleted: stats.deleted,
      conflicts,
    };
    saveBase(documentToBase(merged));
    saveTombstones(merged.tombstones);
    saveSyncState({ lastSyncAt: outcome.at, lastSummary: summaryOf(outcome) });
    notifyDataChanged();
    return outcome;
  }
}

/** 设置页的「立即同步」：未配置时给出可读错误而不是抛原始异常。 */
export async function syncNow(): Promise<SyncOutcome> {
  const cfg = loadSyncConfig();
  if (!isConfigured(cfg)) {
    throw new SyncError("config", "还没有配置 WebDAV。请先填写服务器地址、用户名与应用密码。");
  }
  return runSync(cfg);
}

export { loadSyncConfig, saveSyncConfig, isConfigured, deviceId } from "./config";
export { loadSyncState, clearSyncBase } from "./base";
export { testConnection } from "./webdav";
export type { ConnectionReport } from "./webdav";
export { dirUrl, syncFileUrl } from "./webdav";
export type { SyncConfig, SyncOutcome, ConflictInfo, SyncErrorKind } from "./types";
export { SyncError } from "./types";
