// WebDAV 连接配置与设备标识的本地持久化。
//
// 注意：密码就存在浏览器 localStorage 里——这是纯前端方案的固有代价。
// 因此界面上必须明说「只用应用专用密码、可随时吊销」，绝不能引导用户填账号登录密码。

import { safeSetItem, uid } from "../storage";
import { DEFAULT_SYNC_CONFIG, type SyncConfig } from "./types";

const CONFIG_KEY = "4enext.webdav.v1";
const DEVICE_KEY = "4enext.deviceId.v1";

/** 读取同步配置（缺省字段回落默认值）。 */
export function loadSyncConfig(): SyncConfig {
  const out: SyncConfig = { ...DEFAULT_SYNC_CONFIG };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return out;
    const s = JSON.parse(raw) as Partial<SyncConfig>;
    if (typeof s.url === "string") out.url = s.url;
    if (typeof s.username === "string") out.username = s.username;
    if (typeof s.password === "string") out.password = s.password;
    if (typeof s.dir === "string") out.dir = s.dir;
    if (typeof s.enabled === "boolean") out.enabled = s.enabled;
  } catch {
    /* 损坏就回落默认，不让同步配置把设置页整个拖崩 */
  }
  return out;
}

export function saveSyncConfig(c: SyncConfig): boolean {
  return safeSetItem(CONFIG_KEY, JSON.stringify(c));
}

/** 是否填够了能发起同步的信息（不看 enabled）。 */
export function isConfigured(c: SyncConfig): boolean {
  return c.url.trim().length > 0 && c.username.trim().length > 0 && c.password.length > 0;
}

/**
 * 设备标识：仅用于让远端文档知道「最后一次是谁写的」，不参与冲突判定
 * （冲突一律用记录自身的 updatedAt 与内容哈希判断，避免被设备时钟污染）。
 */
export function deviceId(): string {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw) return raw;
  } catch {
    /* 读不到就现生成一个 */
  }
  const id = uid() + "-" + Math.random().toString(36).slice(2, 6);
  safeSetItem(DEVICE_KEY, id);
  return id;
}
