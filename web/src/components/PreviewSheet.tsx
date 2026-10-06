import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, IconButton } from "./md";

// MD3 模态底部卡片（modal bottom sheet），承载触屏上原本靠 :hover 弹出的预览卡片。
//
// 为什么需要它：桌面端的预览浮层（.wiki-ref-pop / .cls-option-pop / .compact-pop 那一套）
// 是绝对定位在触发元素旁边的，触屏既没有悬停、浮层又会被祖先的 overflow 裁掉，
// 位置还会横向超出视口。MD3 对这种「手机上要展示一块较大的上下文内容」的规定做法
// 是底部卡片：整宽、贴底、内容区自己滚动、点遮罩或 Esc 关闭。
//
// @material/web 没有底部卡片组件，这里由原生 md-dialog 改造而来：
//   · 仍然是 <dialog>.showModal() —— 顶层 layer、32% 遮罩、焦点陷阱、Esc 关闭、
//     背后页面滚动锁定都由浏览器与组件给出，与其它弹窗行为一致；
//   · 只把定位从「居中」改成「贴底」、圆角改成上大下小（28dp），
//     并把进出场动画换成从视口下方滑入（md-dialog 默认那套是居中对话框的「从上方落下」）。
export default function PreviewSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(open);
  // 打开时刻：长按弹出后手指离开时，某些浏览器会补一次 click 落在遮罩上，
  // 卡片会在弹出的同一帧被关掉。开场的这段时间内忽略这次「取消」。
  const openedAt = useRef(Date.now());

  useEffect(() => {
    if (open) openedAt.current = Date.now();
    setVisible(open);
  }, [open]);

  const close = () => setVisible(false);

  // 把实例上的动画钩子换掉：md-dialog 的 getOpenAnimation 是实例字段（构造器里赋的），
  // 只能在元素上覆盖，不能改原型。ref 回调在 commit 阶段同步执行，
  // 早于 md-dialog show() 里 await 后才读取动画的时机。
  const bindAnimations = (el: HTMLElement | null) => {
    if (!el) return;
    const d = el as HTMLElement & { getOpenAnimation?: () => unknown; getCloseAnimation?: () => unknown };
    d.getOpenAnimation = () => SHEET_OPEN;
    d.getCloseAnimation = () => SHEET_CLOSE;
  };

  return (
    <Dialog
      ref={bindAnimations}
      className="pop-sheet"
      open={visible}
      onCancel={(e: Event) => {
        // 开场 400ms 内的「取消」多半是长按手势顺带补出来的，不是用户想关卡片
        if (Date.now() - openedAt.current < 400) e.preventDefault();
      }}
      onClose={close}
      onClosed={() => {
        if (!visible && open) onClose();
      }}
    >
      <div slot="headline" className="pop-sheet-head">
        <span className="pop-sheet-grip" aria-hidden="true" />
        <IconButton className="pop-sheet-close" aria-label="关闭预览" onClick={close}>
          <span className="material-symbols-outlined">close</span>
        </IconButton>
      </div>
      <div slot="content" className="pop-sheet-body">{children}</div>
    </Dialog>
  );
}

// 与 md-dialog 默认动画同构：每个部位是「[关键帧, 时间参数] 的数组」，
// md-dialog 会把每一项展开成 element.animate(...args)（见内部 animateDialog）。
type SheetAnimation = {
  dialog?: [Keyframe[], KeyframeAnimationOptions][];
  scrim?: [Keyframe[], KeyframeAnimationOptions][];
  container?: [Keyframe[], KeyframeAnimationOptions][];
  content?: [Keyframe[], KeyframeAnimationOptions][];
};

// MD3 emphasized / emphasized-decelerate 对应的贝塞尔
const EMPHASIZED = "cubic-bezier(0.2, 0, 0, 1)";
const EMPHASIZED_ACCELERATE = "cubic-bezier(0.3, 0, 0.8, 0.15)";

const SHEET_OPEN: SheetAnimation = {
  // 整块卡片自视口下方滑入
  dialog: [
    [
      [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }],
      { duration: 400, easing: EMPHASIZED },
    ],
  ],
  scrim: [
    [
      [{ opacity: "0" }, { opacity: "0.32" }],
      { duration: 250, easing: "linear" },
    ],
  ],
  // 容器自身只做淡入：默认那套「高度 35%→100%」是给居中对话框的生长效果，
  // 贴底卡片上会表现为向下撑出屏幕。
  container: [
    [
      [{ opacity: "0" }, { opacity: "1" }],
      { duration: 150, easing: "linear", pseudoElement: "::before" },
    ],
  ],
  content: [
    [
      [{ opacity: "0" }, { opacity: "0", offset: 0.25 }, { opacity: "1" }],
      { duration: 300, easing: "linear", fill: "forwards" },
    ],
  ],
};

const SHEET_CLOSE: SheetAnimation = {
  dialog: [
    [
      [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }],
      { duration: 200, easing: EMPHASIZED_ACCELERATE },
    ],
  ],
  scrim: [
    [
      [{ opacity: "0.32" }, { opacity: "0" }],
      { duration: 200, easing: "linear" },
    ],
  ],
  container: [
    [
      [{ opacity: "1" }, { opacity: "0" }],
      { delay: 60, duration: 120, easing: "linear", pseudoElement: "::before" },
    ],
  ],
};
