// AI 车卡：会话层（纯文本 / 结构化 JSON）。
//
// 结构化输出不依赖各家的 response_format —— 国内外供应商与中转站的支持参差不齐，
// 填一个不被支持的字段反而会 400。这里统一走「提示词要求 JSON + 本地解析 + 失败回灌一次」：
// 第一次解析失败时，把原始输出与解析错误一起发回去让模型自己修，比换参数可靠。

import { AiError, type AiConfig, type ChatMessage } from "./types";
import { excerpt, requestChat, type ChatOptions } from "./transport";

/** 追加给模型的输出格式硬要求。 */
const JSON_RULE =
  "输出要求：只输出一个 JSON 对象，不要输出任何解释、前言、后记，也不要用 Markdown 代码块包裹。";

export async function chatText(cfg: AiConfig, messages: ChatMessage[], opts?: ChatOptions): Promise<string> {
  const r = await requestChat(cfg, messages, opts);
  return r.text;
}

/** 括号配平地截取一段 JSON（容忍模型在 JSON 后面又写了一堆解释）。 */
function sliceBalanced(text: string): string | null {
  const open = text[0];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
  return null;
}

/** 从模型输出里挖出 JSON 文本（支持代码块、前后夹带解释文字）。 */
export function extractJsonText(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fence ? fence[1] : text).trim();
  if (!body) return null;
  if (body[0] === "{" || body[0] === "[") {
    const balanced = sliceBalanced(body);
    if (balanced) return balanced;
  }
  const start = body.search(/[{[]/);
  if (start < 0) return null;
  return sliceBalanced(body.slice(start));
}

type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

function tryParse<T>(raw: string): ParseOutcome<T> {
  const jsonText = extractJsonText(raw);
  if (!jsonText) return { ok: false, error: "输出里没有找到 JSON" };
  try {
    return { ok: true, value: JSON.parse(jsonText) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "JSON 解析失败" };
  }
}

/**
 * 要求模型返回一个 JSON 对象并解析它。
 * 解析失败时回灌一次（把原始输出与错误原因一并发回），再失败才抛错。
 */
export async function chatJson<T>(cfg: AiConfig, messages: ChatMessage[], opts?: ChatOptions): Promise<{ data: T; raw: string }> {
  const first = await requestChat(cfg, [...messages, { role: "system", content: JSON_RULE }], opts);
  const parsed = tryParse<T>(first.text);
  if (parsed.ok) return { data: parsed.value, raw: first.text };

  const repair: ChatMessage[] = [
    ...messages,
    { role: "system", content: JSON_RULE },
    { role: "assistant", content: first.text },
    { role: "user", content: "上面的输出不是合法 JSON（" + parsed.error + "）。请只输出修正后的 JSON 对象，不要任何其他文字。" },
  ];
  const second = await requestChat(cfg, repair, opts);
  const again = tryParse<T>(second.text);
  if (again.ok) return { data: again.value, raw: second.text };
  throw new AiError("format", "模型返回的内容不是合法 JSON（已重试一次）。原始输出：" + excerpt(second.text));
}
