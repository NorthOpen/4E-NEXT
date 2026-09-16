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

export interface ConnectionReport {
  /** ok = 一切正常；warn = 能用但有限制，值得提醒 */
  level: "ok" | "warn";
  text: string;
}

/**
 * 可达性探针：no-cors 模式不发跨域预检，能拿到响应（哪怕是被认证拦下的 401）
 * 就说明 DNS、TCP、TLS 与服务器本身都正常，问题只可能出在跨域上。
 *
 * 这是浏览器里唯一能把「网络不通」和「跨域被拦」分开的手段——
 * 普通 fetch 在两种情况下都只抛一个没有细节的 TypeError。
 */
async function probeReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    await fetch(url, { method: "GET", mode: "no-cors", credentials: "omit", cache: "no-store", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 带认证的 GET 探测：读到状态码就说明跨域与认证这两关都过了；返回 null 表示没读到。 */
async function probeAuthedGet(cfg: SyncConfig, url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: basicAuth(cfg.username, cfg.password) },
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 跨域/网络失败后的分诊：说清到底是哪一环，而不是把三种可能一起抛给用户。 */
async function diagnoseBlocked(cfg: SyncConfig, dir: string): Promise<never> {
  if (!(await probeReachable(dir))) {
    throw new SyncError(
      "network",
      "网络层就不通（不是跨域问题）：地址可能拼错了，或服务器无法从公网访问。地址：" + dir,
    );
  }
  // 服务器有响应 → 必然是跨域被拦。再看是不是「只有 PROPFIND 被拦」。
  const fileStatus = await probeAuthedGet(cfg, syncFileUrl(cfg));
  if (fileStatus !== null) {
    throw new SyncError(
      "cors",
      "服务器可以访问，也放行了 GET 的跨域读取，但拒绝了 PROPFIND 的跨域预检。" +
        "同步本身只用 MKCOL / GET / PUT，不一定受影响——可以直接点「立即同步」试试。" +
        "若同步也失败，说明 MKCOL 或 PUT 同样没被放行。地址：" + dir,
    );
  }
  throw new SyncError(
    "cors",
    "服务器可以访问，但没有返回任何跨域许可（CORS）响应头，浏览器不允许网页读取它的响应。" +
      "这需要服务端为 " + dir + " 放行 GET / PUT / MKCOL（或 PROPFIND），" +
      "以及 Authorization、Content-Type、If-Match 请求头。" +
      "多数公共网盘不提供这项设置；自建 Nextcloud / 群晖 / Cloudreve / MinIO 一般可以配置。",
  );
}

/**
 * 连接测试：只做只读探测，不写入任何东西。
 *
 * 刻意「不」把 PROPFIND 当作唯一门槛——真正同步时只用 MKCOL / GET / PUT，
 * 而不少服务器的跨域白名单里没有 PROPFIND。拿它当门槛会出现
 * 「测试连接失败、同步其实能用」的误报。
 */
export async function testConnection(cfg: SyncConfig): Promise<ConnectionReport> {
  assertConfig(cfg);
  const dir = dirUrl(cfg);

  // ① 先试 PROPFIND：能拿到响应就能一次说清「目录在不在」
  let propfindStatus: number | null = null;
  try {
    const res = await dav(cfg, dir, "PROPFIND", { headers: { Depth: "0" } });
    propfindStatus = res.status;
    if (res.status === 207 || res.status === 200) return { level: "ok", text: "连接正常，远端目录可访问。" };
    if (res.status === 404) return { level: "ok", text: "连接正常，但远端目录还不存在（首次同步时会自动创建）。" };
    if (res.status === 401 || res.status === 403) throw authError(res.status);
  } catch (e) {
    if (!(e instanceof SyncError) || e.kind !== "cors") throw e;
    return diagnoseBlocked(cfg, dir);
  }

  // ② PROPFIND 拿到了响应但状态码不理想（405 / 5xx）：同步不依赖它，改用文件探测
  const fileStatus = await probeAuthedGet(cfg, syncFileUrl(cfg));
  if (fileStatus === null) return diagnoseBlocked(cfg, dir);
  if (fileStatus === 404 || (fileStatus >= 200 && fileStatus < 300)) {
    return {
      level: "warn",
      text:
        "连接基本正常。该服务器不支持目录 PROPFIND（返回 " + propfindStatus + "），已改用同步文件探测；" +
        "同步本身只用 MKCOL / GET / PUT，不受影响。",
    };
  }
  if (fileStatus === 401 || fileStatus === 403) throw authError(fileStatus);
  throw new SyncError("server", "连接测试失败：服务器返回 " + fileStatus + "。", fileStatus);
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
