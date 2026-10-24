// 启动浮层（MD3）。
//
// 分工：
//   · index.html 里那段静态启动屏负责「HTML 到手 → React 挂载」这段（这时 JS 还没跑起来，React 画不了东西）；
//   · 这个组件负责「React 挂载 → 数据就绪」，并在慢网络下给出可操作的出口。
//
// 关键行为：
//   · **快网络下不出现**：延迟 400ms 才显示，绝大多数用户只会看到静态启动屏一闪而过；
//   · 到 6 秒无论如何淡出放行（BLOCK_MAX_MS），启动在后台继续，绝不把用户锁在进度条里；
//   · 图标字体**不在**等待集里 —— 它慢不影响进主界面。

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TextButton } from "../components/md";
import { LinearProgress } from "../components/md";
import { bypassBoot, getBootSnapshot, startBoot, subscribeBoot } from "./bootRun";
import "./boot.css";

/** 浮层延迟出现：低于这个时长用户感觉不到停顿，画出来反而是一次闪烁 */
const SHOW_DELAY_MS = 400;
/** 显示多久之后给出「仅用缓存继续」这个出口 */
const OFFLINE_AFTER_MS = 4_000;
/** 淡出时长，与 --md-sys-motion-duration-medium2 对齐 */
const FADE_MS = 240;

const STATIC_BOOT_ID = "4e-boot";

function removeStaticBoot(): void {
  document.getElementById(STATIC_BOOT_ID)?.remove();
}

type Phase = "idle" | "shown" | "leaving" | "gone";

export default function BootOverlay() {
  const snap = useSyncExternalStore(subscribeBoot, getBootSnapshot, getBootSnapshot);
  const [phase, setPhase] = useState<Phase>("idle");
  const [allowOffline, setAllowOffline] = useState(false);
  const timers = useRef<number[]>([]);
  /** 淡出后卸载的计时器单独放一个 ref：它不能被下面那个 effect 的 cleanup 清掉 */
  const unmountTimer = useRef<number | null>(null);

  // 启动只跑一次（bootRun 内部也是幂等的，这里双重保险）
  useEffect(() => {
    startBoot();
    timers.current.push(
      window.setTimeout(() => {
        if (getBootSnapshot().ready) {
          removeStaticBoot();
          setPhase("gone");
        } else {
          removeStaticBoot();
          setPhase("shown");
        }
      }, SHOW_DELAY_MS),
    );
    return () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
  }, []);

  // 组件卸载时才清理淡出计时器。
  // 不能挂在下面那个 effect 的 cleanup 上：phase 从 shown 变成 leaving 会让那个 effect 重跑，
  // cleanup 先执行 → 把刚设好的卸载计时器清掉 → 永远停在 leaving（浮层淡到透明却留在 DOM 里）。
  useEffect(
    () => () => {
      if (unmountTimer.current) window.clearTimeout(unmountTimer.current);
    },
    [],
  );

  // 就绪 → 淡出 → 卸载
  useEffect(() => {
    if (!snap.ready) return;
    if (phase === "idle") {
      // 在延迟窗口内就绪了：什么也没画过，直接收掉静态屏
      removeStaticBoot();
      setPhase("gone");
      return;
    }
    if (phase !== "shown") return;
    setPhase("leaving");
    unmountTimer.current = window.setTimeout(() => setPhase("gone"), FADE_MS);
  }, [snap.ready, phase]);

  // 出口按钮的延时出现
  useEffect(() => {
    if (phase !== "shown") return;
    const t = window.setTimeout(() => setAllowOffline(true), OFFLINE_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "idle" || phase === "gone") return null;

  const total = Math.max(1, snap.total);
  const done = Math.min(snap.done, total);
  const leaving = phase === "leaving";

  return (
    <div
      className={"boot-scrim" + (leaving ? " leaving" : "")}
      role="status"
      aria-live="polite"
      aria-busy={!snap.ready}
    >
      <div className="boot-panel">
        <div className="boot-brand">4E NEXT</div>

        <p className="boot-headline">正在加载</p>

        <LinearProgress className="boot-progress" value={done} max={total} />

        <div className="boot-count">
          {done}/{total}
          {snap.dataVersion ? <span className="boot-version"> · v{snap.dataVersion}</span> : null}
        </div>

        <ul className="boot-tasks">
          {snap.tasks.map((task) => (
            <li key={task.id} className={"boot-task " + task.state}>
              <span className="boot-task-dot" aria-hidden="true" />
              <span className="boot-task-label">{task.label}</span>
              {task.detail ? <span className="boot-task-detail">{task.detail}</span> : null}
            </li>
          ))}
        </ul>

        <div className="boot-actions">
          <TextButton onClick={() => bypassBoot("已跳过")}>跳过</TextButton>
          {allowOffline && (
            <TextButton onClick={() => bypassBoot("仅使用本地缓存", true)}>仅用缓存继续</TextButton>
          )}
        </div>
      </div>
    </div>
  );
}
