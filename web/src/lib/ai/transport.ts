// AI 车卡：请求传输层。
//
// 一律走 @platform 的 http 接缝（网页 = fetch + CORS；桌面 = 主进程直连，不受 CORS 约束），
// 所以「同一份代码在两端行为不同」这一点只体现在错误文案上，业务层不需要分支。
//
// 网页端连不上供应商是**预期内的失败路径**（服务商不给跨域头），不是 bug：
// fetch 在 CORS 被拦与网络不可达时抛的是同一个 TypeError，无法区分，
// 因此提示文案必须同时覆盖两种可能（与 lib/sync/webdav.ts 同一处理）。

import { platform } from "@platform";
import { AI_TIMEOUT_MS, activeProvider, effectiveModel, resolveEndpoint } from "./config";
import { AiError, type AiConfig, type ChatMessage, type ChatResult, type ChatUsage } from "./types";

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * 把可能混进文本里的凭据抹掉。
 *
 * 报错信息会带出服务端返回的正文与模型的原始输出（这是排错必需的），而这两处都可能出现 Key：
 * 服务端偶尔回显请求头，模型在被注入时也可能把它吐出来。所以所有对外文本先过这里 ——
 * 宁可少一段排错信息，也不能把凭据打进界面或日志。
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{6,}/g,
  /\bsk-[A-Za-z0-9_-]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /\bx-api-key["'\s:]+[A-Za-z0-9._-]{8,}/gi,
  /\b[0-9a-f]{32}\.[A-Za-z0-9]{8,}\b/g, // 智谱 GLM 这类「32 位 hex + 点 + 串」的格式
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "（已隐去）");
  return out;
}

/** 响应正文的片段（报错时附上，模型名/地址写错时这几百字符最有用）。 */
export function excerpt(text: string, max = 300): string {
  const t = scrubSecrets(text).replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max) + "…";
}

/** 超时 + 外部取消合流成一个 AbortSignal。 */
function makeSignal(timeoutMs: number, external?: AbortSignal) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onAbort);
    },
  };
}

function networkError(e: unknown, timeoutMs: number, timedOut: boolean): AiError {
  if (e instanceof AiError) return e;
  const name = e instanceof Error ? e.name : "";
  if (name === "AbortError" || timedOut) {
    return new AiError("abort", "请求已取消或超时（超过 " + Math.round(timeoutMs / 1000) + " 秒没有响应）。");
  }
  // 桌面端主进程的授权闸门（desktop/main/main.js 的 originAllowed）：文案由那边给出，
  // 这里只做识别并转成可照做的提示，而不是笼统的「网络不可达」。
  const msg = e instanceof Error ? e.message : "";
  if (msg.includes("已拒绝") || msg.includes("未获授权") || msg.includes("请求来源不是") || msg.includes("只允许 http / https")) {
    return new AiError("config", "桌面端拦截了这次请求：" + msg);
  }
  if (platform.kind === "web") {
    return new AiError(
      "cors",
      "无法访问该接口地址。浏览器里通常是两种情况：① 该服务商不允许网页直接调用（跨域被拦）——请改用桌面版，或换用允许浏览器直连的供应商/自建反代；② 地址写错或网络不可达。",
    );
  }
  return new AiError("network", "无法连接该接口地址（网络不可达，或地址写错）。");
}

function statusError(status: number, body: string): AiError {
  const tail = body ? "服务端返回：" + excerpt(body) : "";
  if (status === 401) return new AiError("auth", "API Key 无效或已失效（401）。请检查 Key 是否填错、是否已被吊销。" + tail, status);
  if (status === 403) {
    return new AiError("auth", "服务端拒绝访问（403）。可能是 Key 权限不足，或该账号被禁止从浏览器调用。" + tail, status);
  }
  if (status === 404) return new AiError("config", "接口地址或模型名不存在（404）。请检查 Base URL 与模型名。" + tail, status);
  if (status === 429) return new AiError("rate", "请求过于频繁，或额度已用尽（429）。稍后重试或换一个 Key。" + tail, status);
  if (status === 400 || status === 422) {
    return new AiError("config", "请求被服务端拒绝（" + status + "）。多半是模型名不对或参数不被支持。" + tail, status);
  }
  if (status >= 500) return new AiError("server", "服务端错误（" + status + "）。稍后重试。" + tail, status);
  return new AiError("server", "请求失败（" + status + "）。" + tail, status);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** 从两种协议的响应里取正文与用量。 */
function parseReply(protocol: "openai" | "anthropic", json: unknown): ChatResult {
  const root = asRecord(json);
  if (!root) throw new AiError("format", "服务端返回的不是 JSON 对象。");

  if (protocol === "anthropic") {
    const blocks = Array.isArray(root.content) ? root.content : [];
    const text = blocks
      .map((b) => {
        const r = asRecord(b);
        return r && r.type === "text" && typeof r.text === "string" ? r.text : "";
      })
      .join("");
    const u = asRecord(root.usage);
    const usage: ChatUsage | undefined = u
      ? { promptTokens: numOrUndef(u.input_tokens), completionTokens: numOrUndef(u.output_tokens) }
      : undefined;
    if (!text.trim()) throw new AiError("format", "模型没有返回正文内容。原始返回：" + excerpt(JSON.stringify(json)));
    return { text, usage };
  }

  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first?.message);
  const raw = message?.content;
  let text = "";
  if (typeof raw === "string") text = raw;
  else if (Array.isArray(raw)) {
    // 少数供应商把 content 拆成分片数组
    text = raw
      .map((part) => {
        const r = asRecord(part);
        return r && typeof r.text === "string" ? r.text : "";
      })
      .join("");
  }
  const u = asRecord(root.usage);
  const usage: ChatUsage | undefined = u
    ? {
        promptTokens: numOrUndef(u.prompt_tokens),
        completionTokens: numOrUndef(u.completion_tokens),
        totalTokens: numOrUndef(u.total_tokens),
      }
    : undefined;
  if (!text.trim()) throw new AiError("format", "模型没有返回正文内容。原始返回：" + excerpt(JSON.stringify(json)));
  return { text, usage };
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 按配置发一次对话请求。调用方负责给消息内容，这里只负责协议、超时与错误分类。 */
export async function requestChat(cfg: AiConfig, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const provider = activeProvider(cfg);
  const { url, protocol } = resolveEndpoint(cfg);
  const model = effectiveModel(cfg);
  if (!model) throw new AiError("config", "还没有填写模型名。");
  if (provider.requiresKey && !cfg.apiKey.trim()) throw new AiError("config", "还没有填写 API Key。");

  const temperature = opts.temperature ?? cfg.temperature;
  const maxTokens = opts.maxTokens ?? cfg.maxTokens;

  let headers: Record<string, string>;
  let body: Record<string, unknown>;

  if (protocol === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    headers = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": cfg.apiKey.trim(),
    };
    // Anthropic 的浏览器直连必须显式声明；桌面端走主进程，带了也无害
    if (platform.kind === "web") headers["anthropic-dangerous-direct-browser-access"] = "true";
    body = { model, max_tokens: maxTokens > 0 ? maxTokens : 2048, temperature, messages: rest };
    if (system) body.system = system;
  } else {
    headers = { "content-type": "application/json" };
    if (cfg.apiKey.trim()) headers.authorization = "Bearer " + cfg.apiKey.trim();
    body = { model, messages, temperature, stream: false };
    if (maxTokens > 0) body.max_tokens = maxTokens;
  }

  const timeoutMs = opts.timeoutMs ?? AI_TIMEOUT_MS;
  const sig = makeSignal(timeoutMs, opts.signal);

  let res;
  try {
    res = await platform.http(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: sig.signal,
      timeoutMs,
    });
  } catch (e) {
    sig.done();
    throw networkError(e, timeoutMs, sig.timedOut());
  }
  sig.done();

  const text = await res.text().catch(() => "");
  if (!res.ok) throw statusError(res.status, text);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiError("format", "服务端返回的内容不是合法 JSON（原始返回：" + excerpt(text) + "）。");
  }
  return parseReply(protocol, json);
}
