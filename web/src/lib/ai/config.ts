// AI 车卡：配置与凭据。
//
// 凭据处理沿用 WebDAV 那一套既有约定（四处都要照顾到，别漏）：
//   · 存 platform.storage（网页 = localStorage，桌面 = 应用数据目录）
//   · 桌面端落盘时由主进程用 safeStorage 加密（desktop/main/main.js 的 SECRET_FIELDS）
//   · 不进备份（lib/backup.ts 的 EXCLUDED_PREFIXES）—— 不该落进随手放在下载目录的文件里
//   · 不参与同步（lib/sync/document.ts 是唯一裁决处，这里一个字都不碰）
//
// 两种存法由用户选：
//   device  —— 落盘保存（桌面端加密）；换机器/换系统账户要重填
//   session —— 只活在内存里，刷新即失效；适合公用电脑或只想临时用一下
// 界面必须明说：无论哪种，Key 都可能被同机的人或浏览器扩展读到，请用可随时吊销的专用 Key。

import { platform } from "@platform";
import { safeSetItem } from "../storage";
import { providerById } from "./providers";
import { AiError, type AiConfig, type AiProtocol, type AiProvider } from "./types";

export const AI_KEY = "4enext.ai.v1";

/** 单次请求超时：模型生成一张卡的候选说明可能是几千 token，30 秒不够 */
export const AI_TIMEOUT_MS = 120000;

export const DEFAULT_AI_CONFIG: AiConfig = {
  providerId: "deepseek",
  baseUrl: "",
  model: "",
  apiKey: "",
  apiKeys: {},
  keyStorage: "device",
  temperature: 0.3,
  maxTokens: 0,
};

/**
 * 「仅本次会话」的 Key：只活在内存里，不写任何存储（刷新页面即失效）。
 * 按供应商分开存 —— 切供应商时那份 Key 要跟着切。
 */
let sessionKeys: Record<string, string> = {};

/** 读取配置（缺省字段回落默认值；损坏不让页面整体崩掉）。 */
export function loadAiConfig(): AiConfig {
  const out: AiConfig = { ...DEFAULT_AI_CONFIG };
  try {
    const raw = platform.storage.getItem(AI_KEY);
    if (!raw) return out;
    const s = JSON.parse(raw) as Partial<AiConfig>;
    if (typeof s.providerId === "string" && s.providerId) out.providerId = s.providerId;
    if (typeof s.baseUrl === "string") out.baseUrl = s.baseUrl;
    if (typeof s.model === "string") out.model = s.model;
    if (s.keyStorage === "device" || s.keyStorage === "session") out.keyStorage = s.keyStorage;
    // 按供应商分装的 Key 表；旧配置只有一把 apiKey，就地迁移成「当前供应商那一把」
    const stored: Record<string, string> =
      s.apiKeys && typeof s.apiKeys === "object" && !Array.isArray(s.apiKeys) ? { ...s.apiKeys } : {};
    if (!stored[out.providerId] && typeof s.apiKey === "string" && s.apiKey) stored[out.providerId] = s.apiKey;
    // 会话存法下存储里没有 Key（可能整表都没落盘），用内存里那一份
    out.apiKeys = out.keyStorage === "session" ? { ...stored, ...sessionKeys } : stored;
    out.apiKey = out.apiKeys[out.providerId] ?? "";
    if (typeof s.temperature === "number" && Number.isFinite(s.temperature)) out.temperature = s.temperature;
    if (typeof s.maxTokens === "number" && Number.isFinite(s.maxTokens)) out.maxTokens = s.maxTokens;
  } catch {
    /* 忽略：坏数据回落默认，别把设置页拖崩 */
  }
  return out;
}

/**
 * 保存配置。
 *
 * 每次保存都先把「当前供应商 + 当前输入框里的 Key」记进分供应商的 Key 表，
 * 这样切换供应商时界面就能拿到那一把（切回来还在）。
 * session 存法下整张 Key 表都只进内存：落盘的 apiKey 为空串、apiKeys 为空表。
 * 失败返回 false（由 safeSetItem 广播出去，界面据此提示）。
 */
export function saveAiConfig(c: AiConfig): boolean {
  const keys: Record<string, string> = { ...c.apiKeys };
  const current = c.apiKey.trim();
  if (current) keys[c.providerId] = current;
  else delete keys[c.providerId];
  const normalized: AiConfig = { ...c, apiKeys: keys, apiKey: keys[c.providerId] ?? "" };

  if (c.keyStorage === "session") {
    sessionKeys = keys;
    return safeSetItem(AI_KEY, JSON.stringify({ ...normalized, apiKey: "", apiKeys: {} }));
  }
  sessionKeys = {};
  return safeSetItem(AI_KEY, JSON.stringify(normalized));
}

/** 切换供应商时要落进输入框的那把 Key（没有就是空）。 */
export function apiKeyFor(c: AiConfig, providerId: string): string {
  return c.apiKeys[providerId] ?? "";
}

export function activeProvider(c: AiConfig): AiProvider {
  return providerById(c.providerId);
}

/** 生效的接口地址（用户填的优先，其次预设）。 */
export function effectiveBaseUrl(c: AiConfig): string {
  return (c.baseUrl.trim() || activeProvider(c).baseUrl).replace(/\/+$/, "");
}

/** 生效的模型名（用户填的优先，其次预设）。 */
export function effectiveModel(c: AiConfig): string {
  return c.model.trim() || activeProvider(c).model;
}

/** 明文 http 且不是本机：Key 会以近明文的方式过网（Basic/自定义头都不加密），值得当场提醒。 */
export function isPlainHttpEndpoint(url: string): boolean {
  if (!/^http:\/\//i.test(url.trim())) return false;
  const host = url.trim().replace(/^http:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && host !== "[::1]";
}

/** 混合内容：HTTPS 页面请求非本机的 http:// 会被浏览器直接拦掉，先点破，别让用户猜。 */
function assertNoMixedContent(url: string): void {
  if (!/^http:\/\//i.test(url)) return;
  const pageIsHttps = typeof location !== "undefined" && location.protocol === "https:";
  if (!pageIsHttps) return;
  const host = url.replace(/^http:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!isLocal) {
    throw new AiError("config", "本页是 HTTPS，浏览器会拦截对 http:// 地址的请求（混合内容）。请把接口地址改成 https:// 开头。");
  }
}

/** 地址 + 协议：把用户填的 Base URL 补成完整端点（同一份判断，测试连接与正式调用共用）。 */
export function resolveEndpoint(c: AiConfig): { url: string; protocol: AiProtocol } {
  const p = activeProvider(c);
  const base = effectiveBaseUrl(c);
  if (!base) throw new AiError("config", "还没有填写接口地址（Base URL）。");
  if (!/^https?:\/\//i.test(base)) throw new AiError("config", "接口地址需要以 http:// 或 https:// 开头。");
  assertNoMixedContent(base);

  if (p.protocol === "anthropic") {
    if (/\/messages$/.test(base)) return { url: base, protocol: "anthropic" };
    if (/\/v1$/.test(base)) return { url: base + "/messages", protocol: "anthropic" };
    return { url: base + "/v1/messages", protocol: "anthropic" };
  }
  if (/\/chat\/completions$/.test(base)) return { url: base, protocol: "openai" };
  return { url: base + "/chat/completions", protocol: "openai" };
}

/** 配置是否够发起一次调用。 */
export function isAiConfigured(c: AiConfig): boolean {
  const p = activeProvider(c);
  if (!effectiveBaseUrl(c) || !effectiveModel(c)) return false;
  return p.requiresKey ? c.apiKey.trim().length > 0 : true;
}

/**
 * 界面上展示的 Key：只露末 4 位。
 * 不露前缀——前缀本身就带信息（sk-ant- 之类），截图/录屏时多露一个字都是白送。
 */
export function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return "（未填写）";
  if (k.length <= 8) return "••••";
  return "••••" + k.slice(-4);
}
