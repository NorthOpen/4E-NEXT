// 设置页「数据与同步」板块：WebDAV 配置 + 连接测试 + 手动同步。
//
// 几个刻意的取舍：
//   · 只做手动同步。自动同步一旦失败，用户根本不知道数据没上去；
//     车卡器丢一张精心车出来的卡，比多点一次按钮严重得多。
//   · 密码存浏览器本地的风险直接写在界面上，并引导用「应用专用密码」。
//   · 同步失败时不隐藏原因：把可能的三条（CORS / 地址 / 网络）都摆出来。

import { useState } from "react";
import { FilledButton, FilledTextField, Switch, TextButton } from "./md";
import {
  clearSyncBase,
  isConfigured,
  loadSyncConfig,
  loadSyncState,
  saveSyncConfig,
  syncNow,
  testConnection,
  SyncError,
  type SyncConfig,
} from "../lib/sync";

type Busy = null | "test" | "sync";
interface Msg {
  kind: "ok" | "warn" | "err";
  text: string;
}

function describeError(e: unknown): string {
  if (e instanceof SyncError) return e.message;
  if (e instanceof Error) return "同步出错：" + e.message;
  return "同步出错：未知错误。";
}

function fmtTime(ms: number): string {
  if (!ms) return "尚未同步过";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

export default function SyncSettings() {
  const [cfg, setCfg] = useState<SyncConfig>(() => loadSyncConfig());
  const [state, setState] = useState(() => loadSyncState());
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  function patch(p: Partial<SyncConfig>) {
    const next = { ...cfg, ...p };
    setCfg(next);
    saveSyncConfig(next);
  }

  async function onTest() {
    setBusy("test");
    setMsg(null);
    try {
      const report = await testConnection(cfg);
      setMsg({ kind: report.level === "ok" ? "ok" : "warn", text: report.text });
    } catch (e) {
      setMsg({ kind: "err", text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onSync() {
    setBusy("sync");
    setMsg(null);
    try {
      const outcome = await syncNow();
      setState(loadSyncState());
      if (outcome.conflicts.length) {
        const names = outcome.conflicts.map((c) => c.copyName).join("、");
        setMsg({
          kind: "err",
          text:
            "同步完成，但有 " + outcome.conflicts.length + " 条内容在两台设备上都被改过，已各自另存为副本，没有覆盖丢失：" + names + "。请手动确认要保留哪一份。",
        });
      } else {
        const bits: string[] = [];
        if (outcome.pulled) bits.push("拉取 " + outcome.pulled + " 条");
        if (outcome.pushed) bits.push("推送 " + outcome.pushed + " 条");
        if (outcome.deleted) bits.push("删除 " + outcome.deleted + " 条");
        setMsg({ kind: "ok", text: bits.length ? "同步完成：" + bits.join("，") + "。" : "同步完成：两侧已一致，无需改动。" });
      }
    } catch (e) {
      setMsg({ kind: "err", text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  const ready = isConfigured(cfg);

  return (
    <section className="block">
      <h3 className="block-title">数据与同步</h3>
      <p className="hint">
        用你自己的 WebDAV 网盘在多台设备之间同步<b>人物卡</b>与<b>私设资源包</b>。
        外观设置与板块布局属于本机偏好，不会同步。
      </p>
      <p className="hint">
        <b>开始之前请先确认一件事：</b>网页直连 WebDAV 需要服务端主动放行跨域（CORS），
        而<b>多数公共网盘并不提供这个开关</b>——能自己改服务端配置的（自建 Nextcloud、群晖、Cloudreve、MinIO 等）才比较稳。
        点「测试连接」会明确告诉你卡在哪一环，别跳过这一步。
      </p>

      <div className="settings-row">
        <span className="field-label">启用同步</span>
        <Switch selected={cfg.enabled} onChange={(e) => patch({ enabled: (e.target as any).selected })} />
        <span className="label">{cfg.enabled ? "已启用" : "已关闭"}</span>
      </div>

      <div className="d4e-sync-field">
        <FilledTextField
          label="WebDAV 地址"
          placeholder="https://你的域名/dav/"
          value={cfg.url}
          onInput={(e) => patch({ url: (e.target as HTMLInputElement).value ?? "" })}
        />
      </div>

      <div className="d4e-sync-field">
        <FilledTextField
          label="用户名"
          value={cfg.username}
          onInput={(e) => patch({ username: (e.target as HTMLInputElement).value ?? "" })}
        />
      </div>

      <div className="d4e-sync-field">
        <FilledTextField
          type="password"
          label="应用密码"
          value={cfg.password}
          onInput={(e) => patch({ password: (e.target as HTMLInputElement).value ?? "" })}
        />
      </div>

      <div className="d4e-sync-field">
        <FilledTextField
          label="远端文件夹"
          placeholder="4enext"
          value={cfg.dir}
          onInput={(e) => patch({ dir: (e.target as HTMLInputElement).value ?? "" })}
        />
      </div>

      <div className="d4e-sync-actions">
        <FilledButton onClick={onTest} disabled={busy !== null || !ready}>
          {busy === "test" ? "测试中…" : "测试连接"}
        </FilledButton>
        <FilledButton onClick={onSync} disabled={busy !== null || !ready || !cfg.enabled}>
          {busy === "sync" ? "同步中…" : "立即同步"}
        </FilledButton>
        <TextButton
          onClick={() => {
            clearSyncBase();
            setState(loadSyncState());
            setMsg({ kind: "ok", text: "已清除本机的同步基线，下次同步会当作首次同步处理（不会删除任何数据）。" });
          }}
          disabled={busy !== null}
        >
          重置同步基线
        </TextButton>
      </div>

      <p className="hint">
        上次同步：{fmtTime(state.lastSyncAt)}
        {state.lastSummary ? "（" + state.lastSummary + "）" : ""}
      </p>

      {msg && <p className={"d4e-sync-msg " + msg.kind}>{msg.text}</p>}

      <p className="hint">
        <b>关于密码：</b>它只保存在本机浏览器里，不会上传到别处；但请务必使用网盘提供的
        <b>应用专用密码</b>（坚果云：账户信息 → 安全选项 → 添加应用密码），不要填账号登录密码，这样可以随时单独吊销。
      </p>
      <p className="hint">
        <b>连接失败多半是跨域：</b>浏览器对 WebDAV 用的 PUT / PROPFIND 会先发跨域预检，
        服务端需要放行这些方法与 <code>Authorization</code>、<code>Content-Type</code>、<code>If-Match</code> 等请求头。
        服务端需要放行 GET / PUT / MKCOL（PROPFIND 仅用于本测试，同步不依赖它），
        以及 <code>Authorization</code>、<code>Content-Type</code>、<code>If-Match</code> 等请求头。
        另外本站是 HTTPS，WebDAV 地址也必须是 <code>https://</code>，否则会被浏览器按「混合内容」拦掉。
      </p>
    </section>
  );
}
