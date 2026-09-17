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

/** 明文 http 且不是本机：Basic 认证会以近似明文的方式过网，值得当场提醒 */
function isPlainHttp(url: string): boolean {
  if (!/^http:\/\//i.test(url.trim())) return false;
  const host = url.trim().replace(/^http:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && host !== "[::1]";
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
      <p className="hint">使用WebDAV在多台设备之间同步人物卡与私设资源包。</p>

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

      {isPlainHttp(cfg.url) && (
        <p className="d4e-sync-msg warn">
          地址是 http:// 开头：用户名与应用密码会以 Base64（等同明文）在网络上传输，同一局域网内可被截获。
          自建服务器请改用 https://；确实只能走 http 时，请只在完全可信的内网里使用。
        </p>
      )}

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
    </section>
  );
}
