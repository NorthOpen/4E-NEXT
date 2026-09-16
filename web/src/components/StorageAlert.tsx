import { platform } from "@platform";
import { useEffect, useRef, useState } from "react";
import {
  clearLastStorageFailure,
  fmtBytes,
  STORAGE_LABEL,
  subscribeStorageFailure,
  takeLastStorageFailure,
  type StorageFailure,
} from "../lib/storage";
import { FilledButton, IconButton, TextButton } from "./md";
import SheetDialog from "./SheetDialog";

// 存储写入失败提示。
//
// localStorage 写满或被浏览器禁掉时，保存会失败：界面照常更新，但刷新后修改全没了。
// 这里把失败摆到台面上，并给出能立刻止损的动作（先把内容导成文件）。
//
// 两种 MD3 形态，按打扰程度递进：
//   ① 本次会话第一次失败 —— MD3 对话框（复用全站的 SheetDialog / md-dialog）。
//      卡头用 error-container，和私设页缓存面板告急态是同一套错误语义色。
//      md-dialog 内部是原生 <dialog>.showModal()，处于浏览器 top layer，
//      因此能压在「存档」弹窗之上 —— 用户点「保存」失败时正好就在那个弹窗里。
//   ② 用户关掉一次之后 —— MD3 Snackbar（inverse-surface / inverse-on-surface /
//      inverse-primary 三件套），不抢焦点，避免打字时被反复打断。
//
// 配色一律走 MD3 语义色令牌，随全局动态取色与深色模式自动适配，不写死任何颜色。
//
// 自动保存有 400ms 防抖，写满后会连续失败，所以同一类数据的失败合并计数；
// 关闭后有冷却期，不会关掉又立刻弹回来。

/** 关闭提示后的静默时长：期间同类数据再失败也不打扰。 */
const MUTE_MS = 60_000;

interface Alerted {
  failure: StorageFailure;
  /** 同一类数据连续失败的次数 */
  times: number;
}

/** 「现在该做什么」：按失败原因和数据类型给不同的下一步。 */
function tipOf(f: StorageFailure): string {
  if (f.reason !== "quota") {
    return platform.kind === "desktop"
      ? "先把当前人物卡导出成文件留底，再检查磁盘剩余空间，以及数据文件是否被其他程序占用。"
      : "先把当前人物卡导出成文件留底，再退出无痕模式，或在浏览器设置里允许本站保存数据。";
  }
  return f.scope === "homebrew"
    ? "先导出这个资源包留底，再删掉暂时用不到的包腾出空间。"
    : "先把当前人物卡导出成文件留底，再到私设页删掉暂时用不到的资源包腾出空间。";
}

export default function StorageAlert(props: {
  /** 「导出当前人物卡」：把还没写进浏览器的内容抢救成文件 */
  onBackup?: () => void;
  /** 「查看占用」：跳到私设页的浏览器缓存板块 */
  onInspect?: () => void;
}) {
  const [alerted, setAlerted] = useState<Alerted | null>(null);
  // 是否以对话框呈现；用户关掉一次后永久降级为 Snackbar
  const [asDialog, setAsDialog] = useState(false);
  const escalated = useRef(false);
  const mutedUntil = useRef<Record<string, number | undefined>>({});

  useEffect(() => {
    const accept = (f: StorageFailure) => {
      if (Date.now() < (mutedUntil.current[f.scope] ?? 0)) return;
      setAlerted((prev) =>
        prev && prev.failure.scope === f.scope
          ? { failure: f, times: prev.times + 1 }
          : { failure: f, times: 1 },
      );
      if (!escalated.current) {
        escalated.current = true;
        setAsDialog(true);
      }
    };
    const off = subscribeStorageFailure(accept);
    // App 在 useState 初始值里就会写一次存档，早于本组件挂载，这里补看一次避免漏报
    const pending = takeLastStorageFailure();
    if (pending) {
      clearLastStorageFailure();
      accept(pending);
    }
    return off;
  }, []);

  if (!alerted) return null;

  const { failure, times } = alerted;
  const quota = failure.reason === "quota";

  const dismiss = () => {
    mutedUntil.current[failure.scope] = Date.now() + MUTE_MS;
    setAsDialog(false);
    setAlerted(null);
  };

  // ---- 形态 ①：MD3 对话框 ----
  if (asDialog) {
    return (
      <SheetDialog
        open
        headline="没有保存成功"
        sub={quota ? "存储空间已满" : platform.kind === "desktop" ? "本地数据文件写入失败" : "浏览器不允许保存数据"}
        headColor="var(--md-sys-color-error-container)"
        headFg="var(--md-sys-color-on-error-container)"
        extraClass="sheet-dialog-store"
        onClose={dismiss}
        actions={
          <>
            {props.onInspect && (
              <TextButton
                onClick={() => {
                  props.onInspect?.();
                  dismiss();
                }}
              >
                查看占用
              </TextButton>
            )}
            {props.onBackup && <FilledButton onClick={props.onBackup}>导出当前人物卡</FilledButton>}
          </>
        }
      >
        <div className="d4e-store-dlg">
          <p className="d4e-store-lead">
            {failure.label}这次没能写入{STORAGE_LABEL}。你现在看到的内容还在，但刷新或关闭页面后就会丢失。
          </p>

          {quota && (
            <div className="d4e-store-gauge">
              <div className="d4e-store-gauge-head">
                <span className="d4e-store-gauge-label">
                  <span className="material-symbols-outlined">database</span>
                  {STORAGE_LABEL}占用
                </span>
                <span className="d4e-store-gauge-val">
                  <b>{fmtBytes(failure.usage.used)}</b>
                  <span className="d4e-store-gauge-total"> / {fmtBytes(failure.usage.total)}</span>
                  <span className="d4e-store-gauge-pct">{failure.usage.percent.toFixed(1)}%</span>
                </span>
              </div>
              <div
                className="d4e-store-gauge-bar"
                role="img"
                aria-label={"已使用 " + failure.usage.percent.toFixed(1) + "%"}
              >
                <span className="d4e-store-gauge-fill" style={{ width: failure.usage.percent + "%" }} />
              </div>
              <p className="d4e-store-note">本次需要写入 {fmtBytes(failure.bytes)}，剩余空间放不下。</p>
            </div>
          )}

          <p className="d4e-store-tip">
            <span className="material-symbols-outlined">warning</span>
            <span>{tipOf(failure)}</span>
          </p>

          {failure.detail && <p className="d4e-store-note">{failure.detail}</p>}

          {times > 1 && <p className="d4e-store-note">已连续 {times} 次没有保存成功。</p>}
        </div>
      </SheetDialog>
    );
  }

  // ---- 形态 ②：MD3 Snackbar ----
  return (
    <div className="d4e-snackbar" role="alert" aria-live="assertive">
      <span className="d4e-snackbar-text">
        {failure.label}未保存成功，刷新后会丢失{times > 1 ? "（已连续 " + times + " 次）" : ""}
      </span>
      {props.onBackup && (
        <TextButton className="d4e-snackbar-action" onClick={props.onBackup}>
          导出备份
        </TextButton>
      )}
      <IconButton className="d4e-snackbar-close" aria-label="关闭提示" title="关闭提示" onClick={dismiss}>
        <span className="material-symbols-outlined">close</span>
      </IconButton>
    </div>
  );
}
