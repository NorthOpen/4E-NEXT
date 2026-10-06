import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useSheetPopovers } from "../lib/media";
import PreviewSheet from "../components/PreviewSheet";

// 通用「悬停弹出」：触发元素 + 弹出层。
// 鼠标进入时根据触发元素距视口的位置智能判断弹出方位：
//   .p-up    触发元素在下半屏且上方有空间 → 向上弹出
//   .p-right 触发元素靠右导致右侧放不下    → 向右对齐左边界（left:auto; right:0）
// 沿用各触发元素自身的 :hover 显隐规则，仅新增方位 class，无需改动显隐逻辑。
//
// portal=true：弹出层经 createPortal 渲染到 body 并用固定定位（坐标由 JS 计算），
// 用于弹出层位于 overflow:hidden 容器（如词条卡片、滚动列表）内的场景，避免被裁剪。
// 此时显隐由 onMouseEnter/onMouseLeave 控制（不再依赖 :hover 父子关系）。
//
// ===== 触屏（底部卡片）=====
// 上面那套的前提是「有鼠标」。手机上既没有悬停，浮层又会被祖先的 overflow 裁掉、
// 位置还会横向超出视口，因此触屏改走 MD3 的模态底部卡片（PreviewSheet）：
//   · 触发元素自己没有动作、且按到的是纯文本 → 轻点 = 看详情（弹卡片）；
//   · 触发元素自己有动作（点一下是选择 / 填入），或内部有按钮 → 轻点仍然执行原动作，
//     长按 420ms = 看详情。这样「选威能」和「看威能卡」两件事不必二选一。
// 判定见 lib/media 的 useSheetPopovers：手机版面，或压根没有悬停能力的设备。

const LONG_PRESS_MS = 420;
/** 手指移动超过这个距离就认为是滚动，取消长按 */
const LONG_PRESS_SLOP = 10;

// 长按是否应该计时：只有「轻点有别的含义」时才需要长按来区分，
// 否则轻点本身就会弹卡片，再抢长按只会妨碍用户选中文字。
const INTERACTIVE_SEL =
  "button,a,input,select,textarea,summary,label,[role='button'],[role='radio'],[role='tab'],[role='link'],[contenteditable='true']";

/** 点击落点是否落在触发元素内部的交互控件上（按钮 / 链接 / @material/web 组件）。 */
function hitsInteractive(target: EventTarget | null, root: HTMLElement | null): boolean {
  let el: Element | null = target instanceof Element ? target : null;
  while (el && el !== root) {
    if (el.matches(INTERACTIVE_SEL)) return true;
    // md-* 自带交互（md-text-button / md-icon-button …），标签名以 MD- 开头即可判定
    if (el.tagName.startsWith("MD-")) return true;
    el = el.parentElement;
  }
  return false;
}

export function SmartHover({
  className,
  popClass = "hp-pop",
  children,
  pop,
  onClick,
  title,
  portal,
  as,
}: {
  className?: string;   // 触发元素类（如 .wiki-ref / .cls-option / .cls-choice-power / .compact-row）
  popClass?: string;    // 弹出层类（如 .wiki-ref-pop）。缺省用统一 .hp-pop
  children: ReactNode;
  pop?: ReactNode;      // 弹出内容；空则不渲染弹出层
  onClick?: (e: ReactMouseEvent) => void;
  title?: string;
  portal?: boolean;     // 弹出层通过 portal 固定定位渲染，避免被 overflow 容器裁剪
  as?: "span" | "button"; // 触发元素标签；原本就是 <button> 的位置（如基础物品块）别丢语义
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const sheetMode = useSheetPopovers();
  // 触屏：底部卡片是否展开
  const [sheet, setSheet] = useState(false);
  // 长按已经弹过卡片：紧随其后的那次 click 要吃掉，别顺手把「选择」也执行了
  const longFired = useRef(false);
  const pressTimer = useRef<number | undefined>(undefined);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);

  // 运行时是 <button> 还是 <span> 只影响语义，事件与引用都是 HTMLElement 这一层
  const Tag = (as ?? "span") as "span";
  const tagProps = as === "button" ? ({ type: "button" } as const) : null;

  const cancelPress = useCallback(() => {
    if (pressTimer.current !== undefined) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = undefined;
    }
    pressOrigin.current = null;
  }, []);

  // 组件卸载时别留下悬空的定时器
  useEffect(() => cancelPress, [cancelPress]);

  const orient = () => {
    const el = ref.current;
    if (!el) return;
    const vr = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 预计弹出层宽度（样式上限 400px，再受视口宽度约束）
    const estW = Math.min(400, vw - 120);
    if (portal) {
      // 固定定位：直接按视口坐标摆放；优先下弹，底部放不下且上方有空间则上弹，右侧放不下则右对齐
      const up = vr.bottom + 8 + 280 > vh && vr.top - 8 - 280 > 8;
      let top = up ? Math.max(8, vr.top - 8 - 280) : vr.bottom + 8;
      if (!up && top + 8 > vh - 8) top = Math.max(8, vh - 8 - 280);
      const left = vr.left + estW > vw - 8 ? Math.max(8, vr.right - estW) : vr.left;
      setPos({ top, left });
      return;
    }
    const pc = popRef.current;
    if (!pc) return;
    // 弹出层的高度只能实测：估成宽度会让矮而宽的卡片被误判成「下方放不下」
    const ph = pc.offsetHeight || 280;
    // 下方放不下、且上方有足够余量 → 上弹
    const up = vr.bottom + 8 + ph > vh - 8 && vr.top - 8 - ph > 8;
    // 右侧放不下 → 右对齐避免溢出窗口右缘
    const right = vr.left + estW > vw - 8;
    pc.classList.toggle("p-up", up);
    pc.classList.toggle("p-right", right);
  };

  if (pop == null) {
    return (
      <Tag {...(tagProps ?? {})} className={className} onClick={onClick} title={title}>{children}</Tag>
    );
  }

  if (sheetMode) {
    // 长按弹卡片
    const openSheet = () => {
      longFired.current = true;
      setSheet(true);
    };
    const handleClick = (e: ReactMouseEvent) => {
      if (longFired.current) {
        // 长按的收尾：这次 click 只是手势的余波，既不弹卡片也不执行动作
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // 自己没有动作、并且点到的是纯文本 → 这一下就是「看详情」
      if (!onClick && !hitsInteractive(e.target, ref.current)) {
        e.preventDefault();
        e.stopPropagation();
        setSheet(true);
        return;
      }
      onClick?.(e);
    };
    return (
      <>
        <Tag
          {...(tagProps ?? {})}
          ref={ref}
          // sh-touch：触屏形态；sh-peek：轻点有自己的含义，长按才是看详情（CSS 据此关掉长按呼出菜单）
          className={(className ?? "") + " sh-touch" + (onClick ? " sh-peek" : "")}
          title={title}
          onClick={handleClick}
          onPointerDown={(e: ReactPointerEvent) => {
            if (e.pointerType === "mouse") return;
            // 轻点没有别的含义时不必抢长按，留给系统选中文字
            if (!onClick && !hitsInteractive(e.target, ref.current)) return;
            cancelPress();
            pressOrigin.current = { x: e.clientX, y: e.clientY };
            pressTimer.current = window.setTimeout(openSheet, LONG_PRESS_MS);
          }}
          onPointerMove={(e: ReactPointerEvent) => {
            const o = pressOrigin.current;
            if (o && (Math.abs(e.clientX - o.x) > LONG_PRESS_SLOP || Math.abs(e.clientY - o.y) > LONG_PRESS_SLOP)) cancelPress();
          }}
          onPointerUp={() => {
            cancelPress();
            // 松手后浏览器补的那一次 click 马上就到，给它留够时间再解除标记
            if (longFired.current) window.setTimeout(() => { longFired.current = false; }, 400);
          }}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onContextMenu={(e) => {
            // 长按期间不要弹系统菜单，否则卡片和菜单会一起冒出来
            if (pressTimer.current !== undefined || longFired.current) e.preventDefault();
          }}
        >
          {children}
        </Tag>
        {sheet && createPortal(
          <PreviewSheet open onClose={() => setSheet(false)}>
            <div className={popClass}>{pop}</div>
          </PreviewSheet>,
          document.body
        )}
      </>
    );
  }

  if (portal) {
    return (
      <Tag {...(tagProps ?? {})} ref={ref} className={className} onMouseEnter={orient} onMouseLeave={() => setPos(null)} onClick={onClick} title={title}>
        {children}
        {pos && createPortal(
          <span className={popClass} style={{ display: "block", position: "fixed", top: pos.top, left: pos.left }}>
            {pop}
          </span>,
          document.body
        )}
      </Tag>
    );
  }
  return (
    <Tag {...(tagProps ?? {})} ref={ref} className={className} onMouseEnter={orient} onClick={onClick} title={title}>
      {children}
      <span ref={popRef} className={popClass}>{pop}</span>
    </Tag>
  );
}
