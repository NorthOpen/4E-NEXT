// WebDAV 传输层：Basic 认证 + ETag（If-Match）乐观锁。
//
// 浏览器直连 WebDAV 的两个现实约束（都写进错误提示里了，别让用户自己猜）：
//   1. PUT / PROPFIND / MKCOL 都是非简单方法，必然触发 CORS 预检；
//      服务端必须在 Access-Control-Allow-Methods / -Headers 里放行
//      （Authorization、Content-Type、If-Match、If-None-Match、Depth）。
//   2. fetch 在「CORS 被拦」与「网络不可达」时都抛同一个 TypeError，无法区分，
//      所以提示文案要同时覆盖这两种可能。

import { SYNC_FILE, SyncError, type SyncConfig } from "./types";

const TIMEOUT_MS = 30000;

function joinUrl(base: string, segments: string[]): string {
  const b = base.replace(/\/+$/, "");
  const parts = segments
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s));
  return parts.length ? b + "/" + parts.join("/") : b;
}

function dirSegments(cfg: SyncConfig): string[] {
  return cfg.dir.split("/");
}

/** 远端目录 URL。 */
export function dirUrl(cfg: SyncConfig): string {
  return joinUrl(cfg.url, dirSegments(cfg));
}

/** 远端同步文件 URL。 */
export function syncFileUrl(cfg: SyncConfig): string {
  return joinUrl(cfg.url, [...dirSegments(cfg), SYNC_FILE]);
}

/** 配置是否足以发起请求；不足则抛出可读的 config 错误。 */
export function assertConfig(cfg: SyncConfig): void {
  if (!cfg.url.trim()) throw new SyncError("config", "还没有填写 WebDAV 服务器地址。");
  if (!/^https?:\/\//i.test(cfg.url.trim())) {
    throw new SyncError("config", "服务器地址需要以 http:// 或 https:// 开头。");
  }
  if (!cfg.username.trim()) throw new SyncError("config", "还没有填写用户名。");
  if (!cfg.password) throw new SyncError("config", "还没有填写应用密码。");

  // 混合内容：HTTPS 页面请求 http:// 会被浏览器直接拦掉，而 fetch 只会抛一个笼统的
  // TypeError——如果不在这里点破，用户看到的就是「无法连接服务器」，永远猜不到是协议问题。
  const url = cfg.url.trim();
  const pageIsHttps = typeof location !== "undefined" && location.protocol === "https:";
  if (pageIsHttps && /^http:\/\//i.test(url)) {
    const host = url.replace(/^http:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (!isLocal) {
      throw new SyncError(
        "config",
        "本页是 HTTPS，浏览器会拦截对 http:// 地址的请求（混合内容）。请把 WebDAV 地址改成 https:// 开头。",
      );
    }
  }
}

/** Basic 认证头（UTF-8 安全：先按 UTF-8 编码再转 base64，避免中文用户名乱码）。 */
export function basicAuth(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(user + ":" + pass);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "Basic " + btoa(bin);
}

interface DavInit {
  headers?: Record<string, string>;
  body?: string;
  /** 读取响应头（PROPFIND 之类我们只关心状态码） */
  method?: string;
}

async function dav(cfg: SyncConfig, url: string, method: string, init: DavInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      headers: {
        Authorization: basicAuth(cfg.username, cfg.password),
        ...(init.headers ?? {}),
      },
      body: init.body,
      // 用 Basic 认证，不带 cookie：避免与服务器上的网页登录态互相干扰
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new SyncError("network", "请求超时（" + TIMEOUT_MS / 1000 + " 秒）。服务器没有响应，请检查网络或地址。");
    }
    throw new SyncError(
      "cors",
      "无法连接服务器。可能是：（1）服务器未放行浏览器跨域请求（CORS 缺少 PUT/PROPFIND/MKCOL 与 Authorization 头）；" +
        "（2）地址写错；（3）网络不可达。地址：" + url,
    );
  } finally {
    clearTimeout(timer);
  }
}

function authError(status: number): SyncError {
  if (status === 401) {
    return new SyncError(
      "auth",
      "认证失败（401）。请确认用户名正确，且密码填的是「应用专用密码」而不是账号登录密码。",
      401,
    );
  }
  return new SyncError("auth", "没有权限访问该目录（" + status + "）。请检查应用密码的授权范围。", status);
}

/**
 * 逐级创建远端目录。逐级而非一次建到底，是因为 MKCOL 在父目录不存在时会返回 409。
 * 已存在（405）视为成功。
 */
export async function ensureDir(cfg: SyncConfig, onNote?: (s: string) => void): Promise<void> {
  const segs = dirSegments(cfg).map((s) => s.trim()).filter((s) => s.length > 0);
  if (segs.length === 0) return;
  const acc: string[] = [];
  for (const seg of segs) {
    acc.push(seg);
    const url = joinUrl(cfg.url, acc);
    const res = await dav(cfg, url, "MKCOL");
    if (res.status === 201) {
      onNote?.("已创建远端目录 " + acc.join("/"));
      continue;
    }
    if (res.status === 405 || res.status === 301) continue; // 已存在
    if (res.status === 401 || res.status === 403) throw authError(res.status);
    if (res.status === 409) {
      throw new SyncError("notfound", "父目录不存在，无法创建 " + acc.join("/") + "（409）。请检查远端路径。", 409);
    }
    if (res.status >= 400) {
      throw new SyncError("server", "创建远端目录失败：服务器返回 " + res.status + "。", res.status);
    }
  }
}

/** 连接测试：只做只读探测，不写入任何东西。 */
export async function testConnection(cfg: SyncConfig): Promise<string> {
  assertConfig(cfg);
  const url = dirUrl(cfg);
  const res = await dav(cfg, url, "PROPFIND", { headers: { Depth: "0" } });

  if (res.status === 207 || res.status === 200) return "连接正常，远端目录可访问。";
  if (res.status === 404) return "连接正常，但远端目录还不存在（首次同步时会自动创建）。";
  if (res.status === 401 || res.status === 403) throw authError(res.status);
  if (res.status === 405) {
    // 少数服务器不支持对目录 PROPFIND，退化为探测同步文件本身
    const f = await dav(cfg, syncFileUrl(cfg), "GET");
    if (f.status === 404 || f.ok) return "连接正常（该服务器不支持目录 PROPFIND，已改用文件探测）。";
    if (f.status === 401 || f.status === 403) throw authError(f.status);
    throw new SyncError("server", "连接测试失败：服务器返回 " + f.status + "。", f.status);
  }
  throw new SyncError("server", "连接测试失败：服务器返回 " + res.status + "。", res.status);
}

export interface RemoteDoc {
  doc: unknown | null;
  etag: string | null;
}

/** 读取远端同步文件；不存在返回 doc: null。 */
export async function pullDocument(cfg: SyncConfig): Promise<RemoteDoc> {
  assertConfig(cfg);
  const res = await dav(cfg, syncFileUrl(cfg), "GET", { headers: { Accept: "application/json" } });
  if (res.status === 404) return { doc: null, etag: null };
  if (res.status === 401 || res.status === 403) throw authError(res.status);
  if (!res.ok) throw new SyncError("server", "读取远端文件失败：服务器返回 " + res.status + "。", res.status);

  const text = await res.text();
  if (!text.trim()) return { doc: null, etag: res.headers.get("ETag") };
  try {
    return { doc: JSON.parse(text), etag: res.headers.get("ETag") };
  } catch {
    throw new SyncError("parse", "远端文件不是合法的 JSON。" + syncFileUrl(cfg) + " 可能被别的东西占用了。");
  }
}

/**
 * 写入远端同步文件。带 ETag 时用 If-Match 做乐观锁：
 * 期间别人改过就返回 412，由调用方重新拉取合并，绝不覆盖。
 */
export async function pushDocument(cfg: SyncConfig, doc: unknown, etag: string | null): Promise<{ etag: string | null }> {
  assertConfig(cfg);
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  if (etag) headers["If-Match"] = etag;
  else headers["If-None-Match"] = "*";

  const res = await dav(cfg, syncFileUrl(cfg), "PUT", { headers, body: JSON.stringify(doc) });
  if (res.status === 412) {
    throw new SyncError("conflict", "远端文件在这次同步期间被其他设备修改过（412）。", 412);
  }
  if (res.status === 401 || res.status === 403) throw authError(res.status);
  if (!res.ok && res.status !== 204 && res.status !== 201) {
    throw new SyncError("server", "写入远端文件失败：服务器返回 " + res.status + "。", res.status);
  }
  return { etag: res.headers.get("ETag") };
}
