// AI 车卡：类型与错误定义。
//
// 分层：config（凭据与设置）→ providers（供应商预设）→ transport（请求）→ chat（会话）
//       → picker（单步决策）→ driver（跨步编排）。本文件只放类型，不放逻辑。
//
// 为什么错误必须分类（AiErrorKind）：用户看到的得是「能照着做」的一句话。
// 网页端被 CORS 拦、Key 填错、模型名写错、余额不足，这四件事的处置完全不同
// —— 参照 lib/sync/webdav.ts 对「CORS 与网络不可达抛同一个 TypeError」的处理。

/** 请求协议：openai = /chat/completions（绝大多数国内外供应商与中转站）；anthropic = /v1/messages。 */
export type AiProtocol = "openai" | "anthropic";

/** 网页版直连该供应商的已知情况（仅用于界面提示；桌面端不受 CORS 约束）。 */
export type CorsHint = "ok" | "unknown" | "blocked" | "flag" | "local";

export interface AiProvider {
  id: string;
  label: string;
  protocol: AiProtocol;
  /** 默认接入地址；OpenAI 兼容填到 /v1 一级即可，transport 会补 /chat/completions */
  baseUrl: string;
  /** 默认模型 */
  model: string;
  /** 常见模型候选（界面给下拉建议，仍可自由输入） */
  models: string[];
  /** 是否必须填 API Key（本地模型通常不需要） */
  requiresKey: boolean;
  /** 「Key 从哪来」的一句话说明 */
  keyHint: string;
  cors: CorsHint;
  /** 网页版直连的注意事项（桌面版无此问题） */
  corsNote: string;
}

/** API Key 的存法：device = 落盘保存（桌面端由主进程加密）；session = 只活在内存里，刷新即失效。 */
export type KeyStorage = "device" | "session";

export interface AiConfig {
  providerId: string;
  /** 覆盖预设地址（留空 = 用预设）。自建反代 / 中转站填这里 */
  baseUrl: string;
  /** 覆盖预设模型（留空 = 用预设） */
  model: string;
  /** 当前供应商的 Key（= apiKeys[providerId]，transport 直接用它） */
  apiKey: string;
  /** 每个供应商各存一把 Key：切换供应商时跟随切换、切回来还在 */
  apiKeys: Record<string, string>;
  /** Key 存法；session 时 apiKey 与 apiKeys 都不写入存储 */
  keyStorage: KeyStorage;
  temperature: number;
  /** 单次最大输出 token；0 = 不传（由服务端默认） */
  maxTokens: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  text: string;
  usage?: ChatUsage;
}

export type AiErrorKind =
  | "config"      // 配置不全 / 地址不合法 / 模型名不存在
  | "network"     // 网络不可达
  | "cors"        // 网页端被跨域策略拦下
  | "auth"        // Key 无效 / 无权限
  | "rate"        // 限流或额度用尽
  | "server"      // 服务端错误
  | "abort"       // 用户取消或超时
  | "format";     // 返回内容不是预期结构

/** 带分类的 AI 调用错误：界面直接展示 message，不需要再猜。 */
export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;

  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.status = status;
  }
}
