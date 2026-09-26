// AI 顶栏：连接配置 + 一句意图的文字输入。
//
// 玩家「AI 车卡」页与主持「AI」页共用这一条 —— 两边的差异全部收在 props 里
// （标题 / 输入框提示 / 右侧附加控件 / 末行说明），版式与交互只能有一份：
// 连接配置的字段顺序、错误分类、http 明文警告、Key 存法这些一旦分叉，
// 两边就会对「同一个接口地址为什么连不上」给出不同解释。
//
// 配置的持有者由页面决定：页面传 cfg 时是本组件的受控用法（页面要用它发请求，
// 如玩家页的决策清单）；不传则本组件自己持有并落库（如主持页）。
// 无论哪种，改动都会写回 lib/ai/config，两边看到的是同一份连接设置。

import { useEffect, useState } from "react";
import {
  FilledButton,
  FilledSelect,
  FilledTextField,
  OutlinedButton,
  SelectOption,
  Slider,
  TextButton,
} from "./md";
import SheetDialog from "./SheetDialog";
import { chatText } from "../lib/ai/chat";
import {
  activeProvider,
  apiKeyFor,
  effectiveBaseUrl,
  effectiveModel,
  isAiConfigured,
  isPlainHttpEndpoint,
  loadAiConfig,
  maskKey,
  saveAiConfig,
} from "../lib/ai/config";
import { AI_PROVIDERS, providerById } from "../lib/ai/providers";
import { AiError, type AiConfig } from "../lib/ai/types";

interface Msg {
  kind: "ok" | "warn" | "err";
  text: string;
}

function describeError(e: unknown): string {
  if (e instanceof AiError) return e.message;
  if (e instanceof Error) return "调用失败：" + e.message;
  return "调用失败：未知错误。";
}

export default function AiSetupBar({
  title,
  cfg,
  onCfgChange,
  children,
  placeholder,
  extra,
  onInstructionChange,
  hint,
}: {
  /** 板块标题 */
  title: string;
  /** 受控配置：页面自己要用它发请求时传入（不传则由本组件持有） */
  cfg?: AiConfig;
  onCfgChange?: (next: AiConfig) => void;
  /** 输入框下方的额外内容（玩家页放种族 / 职业快捷指定） */
  children?: React.ReactNode;
  /** 输入框提示语 */
  placeholder?: string;
  /** 标题行右侧、连接配置按钮之前的内容（玩家页放「从零建卡 / 优化现有卡」分段按钮） */
  extra?: React.ReactNode;
  /** 输入框变化时通知页面（输入内容要参与 AI 请求） */
  onInstructionChange?: (text: string) => void;
  /** 末行说明（缺省显示「连接：供应商 · 模型」） */
  hint?: string;
}) {
  const controlled = cfg !== undefined;
  const [ownCfg, setOwnCfg] = useState<AiConfig>(() => loadAiConfig());
  const cur = cfg ?? ownCfg;
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<null | "test">(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [instruction, setInstruction] = useState("");
  const [connOpen, setConnOpen] = useState(false);

  // 首次进入把预设地址固化到存储：桌面端据此放行，也让你一眼看到实际会连到哪里。
  // 受控时顺带把页面那份 cfg 一起补齐（onCfgChange）—— 否则「先开主机页、再开玩家页」
  // 与「直接开玩家页」会得到两种 baseUrl，桌面端的请求白名单就对不上。
  useEffect(() => {
    const preset = providerById(cur.providerId).baseUrl;
    if (!cur.baseUrl && preset) patch({ baseUrl: preset });
    // 只在挂载时补一次；此后由用户输入与供应商切换维护
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provider = activeProvider(cur);
  const ready = isAiConfigured(cur);

  function patch(p: Partial<AiConfig>) {
    const next = { ...cur, ...p };
    if (controlled) onCfgChange?.(next);
    else setOwnCfg(next);
    // 受控与非受控都落库：连接配置是应用级设置，两边必须看到同一份
    saveAiConfig(next);
  }

  function onInstruction(text: string) {
    setInstruction(text);
    onInstructionChange?.(text);
  }

  async function onTest() {
    setBusy("test");
    setMsg(null);
    try {
      const t0 = Date.now();
      const reply = await chatText(cur, [{ role: "user", content: "只回复两个字：可用" }], { maxTokens: 32, temperature: 0 });
      setMsg({ kind: "ok", text: "连接正常（" + (Date.now() - t0) + " 毫秒）。模型回复：" + reply.trim().slice(0, 60) });
    } catch (e) {
      setMsg({ kind: "err", text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="block ai-hero">
        <div className="block-head">
          <h3 className="block-title">{title}</h3>
          <div className="block-head-actions">
            {extra}
            <OutlinedButton onClick={() => setConnOpen(true)} title={ready ? "已配置：" + provider.label : "尚未配置 AI 连接"}>
              <span slot="icon" className="material-symbols-outlined">settings</span>
              <span className="ai-conn-label">
                连接配置
                <span className={"ai-conn-dot" + (ready ? " ok" : "")} aria-hidden="true" />
              </span>
            </OutlinedButton>
          </div>
        </div>

        <textarea
          className="hb-textarea"
          rows={2}
          value={instruction}
          placeholder={placeholder ?? "想做什么？"}
          onChange={(e) => onInstruction(e.target.value)}
        />

        {children}

        {hint !== undefined ? (
          <p className="hint">{hint}</p>
        ) : (
          <p className="hint">连接：{ready ? provider.label + " · " + effectiveModel(cur) : "未配置"}</p>
        )}
      </section>

      {/* 连接配置：收进弹窗填写，不再占版面 */}
      <SheetDialog
        open={connOpen}
        headline="连接配置"
        sub={ready ? provider.label + " · " + effectiveModel(cur) : "未配置"}
        onClose={() => setConnOpen(false)}
        actions={
          <FilledButton onClick={onTest} disabled={busy !== null || !ready}>
            {busy === "test" ? "测试中…" : "测试连接"}
          </FilledButton>
        }
      >
        <div className="ai-conn-body">

          <div className="ai-field">
            <FilledSelect
              label="供应商"
              value={cur.providerId}
              onChange={(e) => {
                const id = (e.target as any).value ?? "deepseek";
                // 地址固化为新预设：桌面端的请求授权白名单只认「用户填过的地址」，
                // 留空会让每次连接都撞上「允许访问这个地址吗」的弹窗（见 AI车卡设计.md 安全一节）。
                // Key 跟着供应商切：每个供应商各存一把，切回来还在。
                patch({ providerId: id, baseUrl: providerById(id).baseUrl, model: "", apiKey: apiKeyFor(cur, id) });
              }}
            >
              {AI_PROVIDERS.map((p) => (
                <SelectOption key={p.id} value={p.id}>{p.label}</SelectOption>
              ))}
            </FilledSelect>
          </div>

          <p className="hint">
            <span className="material-symbols-outlined ai-inline-ic">info</span>
            {provider.corsNote}
          </p>

          <div className="ai-field">
            <FilledTextField
              label="模型"
              placeholder={provider.model || "例如 deepseek-chat"}
              value={cur.model}
              onInput={(e) => patch({ model: (e.target as HTMLInputElement).value ?? "" })}
            />
          </div>
          {provider.models.length > 0 && (
            <div className="ai-chips">
              {provider.models.map((m) => (
                <button key={m} type="button" className={"chip" + (effectiveModel(cur) === m ? " active" : "")} onClick={() => patch({ model: m })}>
                  {m}
                </button>
              ))}
            </div>
          )}

          <div className="ai-field">
            <FilledTextField
              type={showKey ? "text" : "password"}
              label="API Key"
              placeholder={provider.requiresKey ? "sk-…" : "本地模型可留空"}
              value={cur.apiKey}
              onInput={(e) => patch({ apiKey: (e.target as HTMLInputElement).value ?? "" })}
            />
          </div>
          <div className="settings-row">
            <TextButton onClick={() => setShowKey((v) => !v)}>{showKey ? "隐藏" : "显示"}</TextButton>
            <span className="label">当前：{maskKey(cur.apiKey)}</span>
            {cur.apiKey && <TextButton onClick={() => patch({ apiKey: "" })}>清除 Key</TextButton>}
          </div>
          <div className="settings-row">
            <span className="field-label">Key 存法</span>
            <div className="md3-seg" role="radiogroup" aria-label="Key 存法">
              <button
                type="button"
                role="radio"
                aria-checked={cur.keyStorage === "device"}
                className={"md3-seg-btn" + (cur.keyStorage === "device" ? " on" : "")}
                onClick={() => patch({ keyStorage: "device" })}
              >
                {cur.keyStorage === "device" && <span className="material-symbols-outlined md3-seg-check">check</span>}
                保存在本机
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={cur.keyStorage === "session"}
                className={"md3-seg-btn" + (cur.keyStorage === "session" ? " on" : "")}
                onClick={() => patch({ keyStorage: "session" })}
              >
                {cur.keyStorage === "session" && <span className="material-symbols-outlined md3-seg-check">check</span>}
                仅本次会话
              </button>
            </div>
          </div>
          <div className="ai-field">
            <FilledTextField
              label="接口地址（Base URL）"
              placeholder={provider.baseUrl || "https://…/v1"}
              value={cur.baseUrl}
              onInput={(e) => patch({ baseUrl: (e.target as HTMLInputElement).value ?? "" })}
            />
          </div>
          {isPlainHttpEndpoint(effectiveBaseUrl(cur)) && (
            <p className="ai-msg warn">
              接口地址是 http:// 开头：API Key 会以近明文的方式在网络上传输，同一网络内可能被截获。请改用 https://；
              确实只能走 http 时，请只在完全可信的内网里使用。
            </p>
          )}

          <div className="settings-row">
            <span className="field-label">随机度</span>
            <Slider min={0} max={1} step={0.1} value={cur.temperature} onInput={(e) => patch({ temperature: (e.target as any).value })} />
            <span className="label">{cur.temperature.toFixed(1)}</span>
          </div>

          {msg && <p className={"ai-msg " + msg.kind}>{msg.text}</p>}
        </div>
      </SheetDialog>
    </>
  );
}
