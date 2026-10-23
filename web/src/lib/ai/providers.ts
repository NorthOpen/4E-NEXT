// AI 车卡：供应商预设表。
//
// 取舍：
//   · 默认协议只做 OpenAI 兼容一种（`/chat/completions`）——国内可用的供应商、自建反代、
//     中转站（one-api / new-api）绝大多数都实现它，一份适配覆盖 90% 场景；Anthropic 单独一份。
//   · cors 字段是「网页版直连」的已知情况，仅用于界面提示。桌面端走主进程，不受 CORS 约束。
//     这里写的是经验值，不是保证 —— 服务商的策略随时会变，所以界面必须允许用户自填地址。
//   · 模型名是有保质期的：`model` / `models` 只写「现在能直接调通的 API 模型 ID」，
//     别把版本号当模型名（`DeepSeek-V3.2` 那种是展示名，填进去必然 404）。各家换模型时
//     通常留一段兼容期，停用后就只能改这张表 —— 旧名→新名写进 `legacyModels`，
//     载入配置时自动改写，免得老存档一直撞 400。

import type { AiProvider } from "./types";

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "deepseek",
    label: "DeepSeek（官方）",
    protocol: "openai",
    // 官方文档给的 base_url 不带 /v1（带 /v1 目前也仍然能通，老配置不用动）
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    // 2026-04-24 公告、2026-07-24 停用：旧名分别指向 V4-Flash 的非思考/思考模式，现由 deepseek-flash 接管
    legacyModels: { "deepseek-chat": "deepseek-flash", "deepseek-reasoner": "deepseek-flash" },
    requiresKey: true,
    keyHint: "在 platform.deepseek.com 的「API Keys」里创建，形如 sk-…",
    cors: "unknown",
    corsNote: "部分用户反馈网页端可直连，部分被跨域拦下。连不上时请用桌面版或自建反代。",
  },
  {
    id: "openrouter",
    label: "OpenRouter（聚合，网页友好）",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    // OpenRouter 的模型 ID 带厂商前缀；旧的 deepseek/deepseek-chat 在那边仍指向 V3（很老）
    model: "deepseek/deepseek-v4.1-flash",
    models: ["deepseek/deepseek-v4.1-flash", "google/gemini-3.8-flash", "anthropic/claude-sonnet-5.5"],
    requiresKey: true,
    keyHint: "在 openrouter.ai/keys 创建，形如 sk-or-…",
    cors: "ok",
    corsNote: "该服务面向浏览器调用设计，网页版通常可以直接使用。",
  },
  {
    id: "moonshot",
    label: "月之暗面 Kimi",
    protocol: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    models: ["kimi-k3", "kimi-k2.6", "kimi-k2.7-code"],
    // 2026-05-25 下线 kimi-k2 系列、2026-08-31 下线 moonshot-v1 系列：旧名留着只会 404
    legacyModels: { "kimi-k2-0905-preview": "kimi-k3", "moonshot-v1-32k": "kimi-k2.6" },
    requiresKey: true,
    keyHint: "在 platform.kimi.com（原 platform.moonshot.cn）创建 API Key",
    cors: "unknown",
    corsNote: "网页端是否可直连取决于服务端策略，连不上时请用桌面版。",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    protocol: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3-flash",
    models: ["glm-4.7-flash", "glm-5.3-flash", "glm-5.3"],
    requiresKey: true,
    keyHint: "在 open.bigmodel.cn 的「API Keys」里创建",
    cors: "unknown",
    corsNote: "网页端是否可直连取决于服务端策略，连不上时请用桌面版。",
  },
  {
    id: "dashscope",
    label: "通义千问（兼容模式）",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-plus",
    models: ["qwen3.8-flash", "qwen3.7-plus", "qwen3.8-max"],
    requiresKey: true,
    keyHint: "在阿里云百炼控制台创建 API Key",
    cors: "unknown",
    corsNote: "网页端是否可直连取决于服务端策略，连不上时请用桌面版。",
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    protocol: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V4.1-Flash",
    models: ["deepseek-ai/DeepSeek-V4.1-Flash", "Qwen/Qwen3.8-27B", "zai-org/GLM-5.3"],
    requiresKey: true,
    keyHint: "在 cloud.siliconflow.cn 创建 API Key",
    cors: "unknown",
    corsNote: "网页端是否可直连取决于服务端策略，连不上时请用桌面版。",
  },
  {
    id: "openai",
    label: "OpenAI（官方）",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-6-luna",
    models: ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"],
    requiresKey: true,
    keyHint: "在 platform.openai.com 创建，形如 sk-…",
    cors: "blocked",
    corsNote: "官方 API 一般不给浏览器跨域放行：网页版多半连不上，请用桌面版或自建反代。",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5-5",
    models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    // claude-3-5-haiku 已于 2026-02 退役，旧名直接改写；claude-sonnet-4-5 虽已公告 2026-11-30 退役，
    // 但现在还能用 —— 仍能调的旧名不替他改，只把推荐列表换新
    legacyModels: { "claude-3-5-haiku-latest": "claude-haiku-5-5" },
    requiresKey: true,
    keyHint: "在 console.anthropic.com 创建，形如 sk-ant-…",
    cors: "flag",
    corsNote: "浏览器直连需要专用请求头，本功能会自动带上（anthropic-dangerous-direct-browser-access）。",
  },
  {
    id: "ollama",
    label: "Ollama（本机）",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3.5:9b",
    models: ["qwen3.5:9b", "qwen3.5:4b", "qwen3.5:27b"],
    requiresKey: false,
    keyHint: "本地模型不需要 Key",
    cors: "local",
    corsNote: "需给 Ollama 设 OLLAMA_ORIGINS 放行本页来源；https 页面连 http://127.0.0.1 可能被浏览器的私有网络访问策略拦下 —— 桌面版没有这个问题。",
  },
  {
    id: "lmstudio",
    label: "LM Studio（本机）",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    models: ["local-model"],
    requiresKey: false,
    keyHint: "本地模型不需要 Key",
    cors: "local",
    corsNote: "需在 LM Studio 里开启 CORS；桌面版没有这个问题。",
  },
  {
    id: "custom",
    label: "自定义（OpenAI 兼容）",
    protocol: "openai",
    baseUrl: "",
    model: "",
    models: [],
    requiresKey: false,
    keyHint: "自建反代 / 中转站（one-api、new-api 等）填自己的地址与模型名",
    cors: "unknown",
    corsNote: "地址与模型名由你填写；网页端能否直连取决于该服务是否放行跨域。",
  },
];

export function providerById(id: string): AiProvider {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}
