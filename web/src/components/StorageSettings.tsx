import { platform } from "@platform";
import { useRef, useState } from "react";
import { FilledButton, FilledTonalButton, TextButton } from "./md";
import SheetDialog from "./SheetDialog";
import { clearAllAppData, fmtBytes, loadCards, localStorageBreakdown, STORAGE_GROUP_TONE, STORAGE_HINT } from "../lib/storage";
import { loadPools } from "../lib/userdata";
import { clearImageCache } from "../lib/imageCache";
import { backupFilename, buildBackup, restoreBackup } from "../lib/backup";
import { hasSeenTutorial } from "../lib/tutorial";

// 设置页「教学模式 + 本地数据」板块。
//
// 两个刻意的取舍：
//   · 清除是「一键全清」，人物卡也在里面。所以确认对话框必须把「会消失什么」
//     用具体条数摆出来（几张卡、几个资源包、多少字节），而不是写一句「所有数据」——
//     用户对「所有数据」没有体感，对「你这 7 张卡会没」有。
//   · 清除旁边必须有一个真的能还原的备份动作。只能导出、不能导入的备份是句空话：
//     用户按了反而更放心地误删。所以这里「导出全部数据 / 从备份恢复」成对出现。
//
// 清除与恢复之后都重新加载页面：数据散落在 App 的内存状态、主题上下文、
// 背景图缓存好几处，逐个通知它们刷新比重启一次页面更容易出错。

type Busy = null | "backup" | "restore" | "clear";

interface Msg {
  kind: "ok" | "warn" | "err";
  text: string;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : "未知错误。";
}

export default function StorageSettings({ onStartTutorial }: { onStartTutorial: () => void }) {
  // 挂载时取一次快照：进入设置页会重新挂载，所以切页回来看到的就是最新值
  const [usage] = useState(() => localStorageBreakdown());
  const [cardCount] = useState(() => loadCards().length);
  const [poolCount] = useState(() => loadPools().length);
  const [seen] = useState(() => hasSeenTutorial());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [backupDone, setBackupDone] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const segments = usage.groups.filter((g) => g.bytes > 0);

  function openConfirm() {
    setBackupDone(false);
    setMsg(null);
    setConfirmOpen(true);
  }

  async function onExportBackup() {
    setBusy("backup");
    setMsg(null);
    try {
      const backup = await buildBackup();
      const res = await platform.files.saveText(backupFilename(), JSON.stringify(backup, null, 2));
      if (res.ok) {
        setBackupDone(true);
        setMsg({ kind: "ok", text: "备份已导出。请确认文件确实下载完成，再回来清除。" });
      } else if (res.canceled) {
        setMsg({ kind: "warn", text: "已取消保存，本机数据没有任何变动。" });
      } else {
        setMsg({ kind: "err", text: "备份导出失败：" + res.reason });
      }
    } catch (e) {
      setMsg({ kind: "err", text: "备份导出失败：" + describe(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onRestoreFile(file: File) {
    setBusy("restore");
    setMsg(null);
    try {
      const result = await restoreBackup(await file.text());
      setMsg({ kind: "ok", text: "已恢复 " + result.keys + " 项数据，正在重新加载…" });
      // 留出看清提示的时间再重载，否则页面一闪，用户不知道刚才发生了什么
      window.setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setMsg({ kind: "err", text: describe(e) });
      setBusy(null);
    }
  }

  async function onClear() {
    setBusy("clear");
    setMsg(null);
    const removed = clearAllAppData();
    await clearImageCache();
    setConfirmOpen(false);
    if (removed === 0) {
      // 存储被禁用（无痕模式 / 站点数据被拦）时删不动，如实说，不要假装清干净了
      setMsg({ kind: "warn", text: "本机的存储当前不可写，没有可以清除的数据（可能处于无痕模式）。" });
      setBusy(null);
      return;
    }
    setMsg({ kind: "ok", text: "已清除 " + removed + " 项本机数据，正在重新加载…" });
    window.setTimeout(() => window.location.reload(), 900);
  }

  return (
    <>
      <section className="block">
        <h3 className="block-title">教学模式</h3>
        <div className="settings-row">
          <span className="field-label">分步引导</span>
          <FilledButton onClick={onStartTutorial}>开始教学模式</FilledButton>
          <span className="label">{seen ? "已经观看过" : "还没观看过"}</span>
        </div>
      </section>

      <section className="block">
        <h3 className="block-title">缓存占用</h3>
        <p className="hint">{STORAGE_HINT}</p>

        <div className="cacheset-meter">
          <div className="cacheset-meter-head">
            <span className="cacheset-meter-label">
              <span className="material-symbols-outlined">database</span>
              已占用
            </span>
            <span className="cacheset-meter-val">
              <b>{fmtBytes(usage.used)}</b>
              <span className="cacheset-meter-total"> / {fmtBytes(usage.total)}</span>
              <span className="cacheset-meter-pct">{usage.percent.toFixed(1)}%</span>
            </span>
          </div>
          <div className="cacheset-bar" role="img" aria-label={"已使用 " + usage.percent.toFixed(1) + "%"}>
            {segments.map((g) => (
              <span
                key={g.key}
                className="cacheset-seg"
                title={g.label + "：" + fmtBytes(g.bytes)}
                style={{ width: Math.max(0.8, (g.bytes / usage.total) * 100) + "%", background: STORAGE_GROUP_TONE[g.key] }}
              />
            ))}
          </div>
          <ul className="cacheset-legend">
            {usage.groups.map((g) => (
              <li key={g.key} className={g.bytes > 0 ? "" : "muted"}>
                <span className="cacheset-dot" style={{ background: STORAGE_GROUP_TONE[g.key] }} />
                <span className="cacheset-legend-label">{g.label}</span>
                <span className="cacheset-legend-val">{fmtBytes(g.bytes)}</span>
              </li>
            ))}
          </ul>
          <p className="cacheset-note">
            共 {usage.keys} 个存储项，其中 {cardCount} 张人物卡、{poolCount} 个私设资源包。
          </p>
        </div>

        {msg && <p className={"d4e-sync-msg " + msg.kind}>{msg.text}</p>}

        {/* MD3 卡片动作区：不给每个动作单独起行、配说明，靠按钮自身的层级
            （文字 → 填充 → 错误色填充）说明轻重，整体靠右下角 */}
        <div className="cacheset-actions">
          <TextButton onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            {busy === "restore" ? "恢复中…" : "从备份恢复"}
          </TextButton>
          <FilledButton onClick={() => void onExportBackup()} disabled={busy !== null}>
            {busy === "backup" ? "导出中…" : "导出全部数据"}
          </FilledButton>
          <FilledTonalButton className="cacheset-danger" onClick={openConfirm} disabled={busy !== null}>
            清除全部数据
          </FilledTonalButton>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onRestoreFile(f);
            }}
          />
        </div>
      </section>

      {confirmOpen && (
        <SheetDialog
          open
          headline="清除全部本机数据"
          sub="此操作无法撤销"
          headColor="var(--md-sys-color-error-container)"
          headFg="var(--md-sys-color-on-error-container)"
          extraClass="sheet-dialog-store"
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <TextButton onClick={() => void onExportBackup()} disabled={busy !== null}>
                先导出备份
              </TextButton>
              <FilledTonalButton className="cacheset-danger" onClick={() => void onClear()} disabled={busy !== null}>
                {busy === "clear" ? "清除中…" : "确认清除"}
              </FilledTonalButton>
            </>
          }
        >
          <div className="cacheset-confirm">
            <p className="cacheset-lead">以下内容会立即从本机消失，清空后无法找回：</p>
            <ul className="cacheset-list">
              <li>
                <b>{cardCount}</b> 张人物卡（含还没有导出的修改）
              </li>
              <li>
                <b>{poolCount}</b> 个私设资源包
              </li>
              <li>外观设置、背景图与动态取色</li>
              <li>WebDAV 地址、账号与应用密码</li>
            </ul>
            <p className="cacheset-note">
              合计占用 {fmtBytes(usage.used)}。清除完成后页面会重新加载，教学模式会再播放一次。
            </p>
            {backupDone ? (
              <p className="cacheset-ok">
                <span className="material-symbols-outlined">check_circle</span>
                <span>备份文件已导出。确认它已经下载完成，就可以清除本机数据了。</span>
              </p>
            ) : (
              <p className="cacheset-warn">
                <span className="material-symbols-outlined">warning</span>
                <span>这些人物卡如果还要用，请先点「先导出备份」存成文件；之后可以随时从备份恢复。</span>
              </p>
            )}
          </div>
        </SheetDialog>
      )}
    </>
  );
}
