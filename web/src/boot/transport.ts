// 带超时与重试的取数原语。
//
// 存在的理由：原来的 loaders.ts 直接 `await fetch(...)`，在丢包链路上 fetch 会一直挂着不 settle，
// 于是界面上永远停在「加载中…」——既没有错误，也没有出口。
// 这里给每次请求一个硬超时 + 有限次退避重试，让失败变成**可观测、可重试**的事件。
//
// 超时分两种，不能混用：
//   · 连接/首字节超时（fetchResponse）—— 几秒内没拿到响应头就算失败；
//   · 传输停滞超时（readBody）—— 读完响应头之后，只要数据还在流就不打断。
// power.json 有 19MB，用统一的 15 秒总超时会把正常但慢的大文件直接判死。

/** 失败分类：界面据此决定给什么按钮、说什么话。 */
export type FetchFailureKind = "timeout" | "network" | "http" | "verify" | "unsupported";

export class FetchFailure extends Error {
  constructor(
    message: string,
    readonly kind: FetchFailureKind,
    /** HTTP 状态码（kind === "http" 时有值） */
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchFailure";
  }
}

export interface RequestPolicy {
  /** 单次请求「等到响应头」的超时毫秒数 */
  timeoutMs?: number;
  /** 首次之外的重试次数 */
  retries?: number;
  /** 读完响应头之后，允许的「无新数据」时长 */
  stallMs?: number;
}

const DEFAULT_TIMEOUT = 12_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_STALL = 20_000;

/** 把「超时 + 外部取消」合流成一个 AbortSignal，并在结束后清掉计时器。 */
function withTimeout(timeoutMs: number): { signal: AbortSignal; done: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
    timedOut: () => timedOut,
  };
}

/** 判断这次失败值不值得重试：超时、网络错误、5xx、429 值得，4xx 不值得。 */
function retryable(err: unknown): boolean {
  if (err instanceof FetchFailure) {
    if (err.kind === "http") return (err.status ?? 0) >= 500 || err.status === 429;
    return err.kind === "timeout" || err.kind === "network";
  }
  return true;
}

function backoff(attempt: number): number {
  // 400ms / 800ms / 1600ms，加一点抖动避免多任务同时重试撞在一起
  return 400 * 2 ** attempt + Math.floor(Math.random() * 200);
}

/**
 * 取一次响应，失败时按退避重试。
 *
 * 返回原始 Response（调用方自己决定读 json / arrayBuffer）。
 * 非 2xx 一律抛 FetchFailure —— 上层不必再判 res.ok。
 */
export async function fetchResponse(url: string, init: RequestInit = {}, policy: RequestPolicy = {}): Promise<Response> {
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT;
  const retries = policy.retries ?? DEFAULT_RETRIES;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, backoff(attempt - 1)));

    const guard = withTimeout(timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: guard.signal });
      if (!res.ok) {
        throw new FetchFailure("HTTP " + res.status + "：" + url, "http", res.status);
      }
      return res;
    } catch (err) {
      // AbortError 是我们自己超时掐掉的，翻译成可读的 kind
      if (guard.timedOut()) {
        lastError = new FetchFailure("请求超时（" + Math.round(timeoutMs / 1000) + " 秒无响应）", "timeout");
      } else if (err instanceof FetchFailure) {
        lastError = err;
      } else if (err instanceof DOMException && err.name === "AbortError") {
        lastError = new FetchFailure("请求已中断", "network");
      } else {
        lastError = new FetchFailure(err instanceof Error ? err.message : "网络错误", "network");
      }
      if (!retryable(lastError)) break;
    } finally {
      guard.done();
    }
  }

  throw lastError instanceof Error ? lastError : new FetchFailure("网络错误", "network");
}

/**
 * 分批读完整响应体，带「停滞检测」。
 *
 * 只要还有新数据进来就一直等（大文件可以从容下载），
 * 一旦连续 stallMs 没收到任何字节才判定为卡死 —— 这才是跨境链路上真正的故障形态：
 * 不是慢，是传到一半不动了。
 */
/** 读一块数据，若 stallMs 内没有新字节则判定停滞。 */
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, stallMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new FetchFailure("传输停滞（" + Math.round(stallMs / 1000) + " 秒无数据），已中断", "timeout")),
      stallMs,
    );
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBody(res: Response, stallMs: number): Promise<Uint8Array<ArrayBuffer>> {
  const body = res.body;
  if (!body) {
    // 极老的环境没有流式 body，退回一次性读取（没有停滞保护，但至少能用）
    return new Uint8Array(await res.arrayBuffer());
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const chunk = await readChunk(reader, stallMs);
      if (chunk.done) break;
      if (chunk.value) {
        chunks.push(chunk.value);
        total += chunk.value.length;
      }
    }
  } catch (err) {
    // 半途失败：把流关掉，别留着连接占带宽
    void reader.cancel().catch(() => undefined);
    throw err;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}

/**
 * SHA-256（十六进制）。非安全上下文（http 且非 localhost）下 crypto.subtle 不存在，返回 null 表示「无法校验」。
 *
 * 参数写成 Uint8Array<ArrayBuffer> 而不是 Uint8Array：TS 5.7 起 BufferSource 要求 buffer 必须是
 * ArrayBuffer（不含 SharedArrayBuffer），用裸 Uint8Array 会过不了类型检查。
 * 两个调用点都是 new Uint8Array(...) 构造出来的，天然满足。
 */
export async function sha256Hex(buf: Uint8Array<ArrayBuffer>): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * 取 JSON，可选做完整性校验。
 *
 * 为什么要校验：跨境链路上 200 + 一个被注入或被截断的响应是真实存在的形态，
 * 只判 res.ok 会把坏数据一路吃进 UI。清单里带了 sha256 就比对，没带就跳过。
 */
export async function fetchJsonBytes<T>(
  url: string,
  opts: { sha256?: string; policy?: RequestPolicy } = {},
): Promise<{ data: T; bytes: number }> {
  const policy = opts.policy ?? {};
  const res = await fetchResponse(url, { cache: "no-cache" }, policy);
  const buf = await readBody(res, policy.stallMs ?? DEFAULT_STALL);

  if (opts.sha256) {
    const actual = await sha256Hex(buf);
    // actual === null 说明环境不支持摘要（非安全上下文），此时不做否决，只放行
    if (actual && actual !== opts.sha256) {
      throw new FetchFailure("文件校验失败（内容与清单不一致）", "verify");
    }
  }

  let parsed: T;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buf)) as T;
  } catch {
    throw new FetchFailure("响应不是合法 JSON", "verify");
  }
  return { data: parsed, bytes: buf.byteLength };
}
