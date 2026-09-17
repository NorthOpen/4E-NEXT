import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TUTORIAL_STEPS, type TutorialStep } from "../lib/tutorial";
import { FilledButton, OutlinedButton, TextButton } from "./md";
import type { View } from "../App";

// 教学模式的分步聚光灯。
//
// 结构自下而上三层：
//   · .tour-block —— 铺满视口的透明层，负责吃掉所有点击（用户点不到被遮住的东西）
//   · .tour-mask  —— 真正压暗后方的遮罩：一张铺满视口的 SVG，用 <mask> 在中间挖一个圆角洞
//   · .tour-hole  —— 洞口那圈呼吸用的高亮描边（本身不压暗任何东西）
//
// 为什么遮罩不再用「一个元素加超大 box-shadow 扩散」那套：
// CSS 规定阴影外缘的圆角半径要跟着扩散距离一起放大，扩散一大，半径就超过外框的一半，
// 外缘于是退化成一个圆；高亮块又几乎总在屏幕一侧（左侧导航轨），圆的圆心就偏了，
// 屏幕对角那一片压不到 —— 大屏上会露出亮色。SVG 遮罩的覆盖范围是实打实的矩形，不会有这个问题。
//
// 另外三条硬性约束：
//   · 目标元素可能还没挂载（上一步刚切了页面），所以定位要逐帧重试；
//     一直找不到就退化成居中卡片，绝不能因为找不到锚点把教学卡死。
//   · 目标可能在视口外（车卡页的板块比一屏还高）。教学期间页面滚动是锁住的，
//     不主动滚过去用户就永远看不到它，所以定位前先把它滚进视口。
//   · 气泡方位由可用空间算，不按锚点硬编码：手机上底部导航在屏幕最下沿，
//     固定「右侧」会直接顶出屏幕。

/** 与 styles.tutorial.css 里 .tour-card 的 width 保持一致：算方位要先知道卡片多大 */
const CARD_W = 344;
/** 气泡与高亮块之间的间距 */
const GAP = 16;
/** 气泡距视口边缘的最小留白 */
const MARGIN = 12;
/** 高亮框在高亮块外扩的尺寸，让光斑比按钮本身大一圈 */
const HOLE_PAD = 6;
/** 洞口的圆角；与 styles.tutorial.css 里 .tour-hole 的 border-radius 保持一致 */
const HOLE_RAD = 16;
/** SVG 遮罩的 id：整个页面同时只会有一个教学实例 */
const MASK_ID = "tour-hole-mask";

type Side = "top" | "bottom" | "left" | "right";

interface Placement {
  side: Side;
  top: number;
  left: number;
  /** 箭头沿卡片边的中心偏移（px），让箭头对准目标中心 */
  arrow: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** 找这一步要高亮的元素：桌面导航轨与手机底栏各给一个候选，取第一个真正画出来的。 */
function findTarget(step: TutorialStep): Element | null {
  for (const sel of step.anchor ?? []) {
    let el: Element | null = null;
    try {
      el = document.querySelector(sel);
    } catch {
      // 选择器写错不该让整场教学崩掉，跳过这个候选继续找
      continue;
    }
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/**
 * 把目标滚进视口。
 * 已经露得够多就不动 —— 车卡页有些板块比一屏还高，永远满足不了「整块可见」，
 * 每次都滚一下会让光斑在页面上乱窜。
 */
function ensureVisible(el: Element): void {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.top >= 0 && r.bottom <= vh) return;
  const shown = Math.min(r.bottom, vh) - Math.max(r.top, 0);
  if (shown >= Math.min(r.height, vh) * 0.75) return;

  const root = document.documentElement;
  const prev = root.style.scrollBehavior;
  // html 上有 scroll-behavior: smooth（styles.css），不临时改掉的话这次滚动会变成动画，
  // 紧接着量的位置就还是旧的
  root.style.scrollBehavior = "auto";
  try {
    if (r.height > vh - 24) {
      // 比一屏还高的板块（角色信息就是）：把顶端对到视口顶部。
      // 居中会把上下两头一起切掉，用户连板块名都看不到。
      window.scrollBy(0, r.top - 24);
    } else {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    }
  } catch {
    /* 老引擎不认 options 形式，忽略：找不到就只是不滚，教学继续 */
  }
  root.style.scrollBehavior = prev;
}

/**
 * 摆气泡：优先放在步骤指定的方位；放不下就换一个放得下的。
 * 四个方向都局促时（例如手机横屏、目标几乎占满视口）选空间最大的一侧，
 * 再把坐标夹回视口内 —— 宁可压住一点页面，也不能把卡片推到屏幕外。
 */
function placeCard(rect: DOMRect, cardW: number, cardH: number, prefer: Side | undefined): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const room: Record<Side, number> = {
    top: rect.top - MARGIN,
    bottom: vh - rect.bottom - MARGIN,
    left: rect.left - MARGIN,
    right: vw - rect.right - MARGIN,
  };
  const need: Record<Side, number> = {
    top: cardH + GAP,
    bottom: cardH + GAP,
    left: cardW + GAP,
    right: cardW + GAP,
  };
  const fallbackOrder: Side[] = ["right", "left", "bottom", "top"];
  const order = prefer ? [prefer, ...fallbackOrder.filter((s) => s !== prefer)] : fallbackOrder;
  const side = order.find((s) => room[s] >= need[s]) ?? order.reduce((a, b) => (room[b] > room[a] ? b : a));

  let top: number;
  let left: number;
  if (side === "left" || side === "right") {
    left = side === "right" ? rect.right + GAP : rect.left - GAP - cardW;
    top = rect.top + rect.height / 2 - cardH / 2;
  } else {
    top = side === "bottom" ? rect.bottom + GAP : rect.top - GAP - cardH;
    left = rect.left + rect.width / 2 - cardW / 2;
  }

  left = clamp(left, MARGIN, Math.max(MARGIN, vw - cardW - MARGIN));
  top = clamp(top, MARGIN, Math.max(MARGIN, vh - cardH - MARGIN));

  // 箭头指向目标中心，但不许跑出卡片边缘的圆角范围
  const arrow =
    side === "left" || side === "right"
      ? clamp(rect.top + rect.height / 2 - top, 22, cardH - 22)
      : clamp(rect.left + rect.width / 2 - left, 22, cardW - 22);

  return { side, top, left, arrow };
}

export default function TutorialGuide(props: {
  open: boolean;
  /** 看完、跳过、按 Esc 都走这里。记「已看过」由调用方负责。 */
  onClose: () => void;
  /** 进入某一步时把应用切到对应页面，让用户看到真实内容 */
  onGoToView: (view: View) => void;
  /** 手机端布局：部分入口收在底栏「更多」里，另有一些步骤只在手机端讲 */
  isMobile: boolean;
}) {
  const { open, onClose, onGoToView, isMobile } = props;
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLSpanElement>(null);

  // 回调放进 ref：下面的步骤 effect 只该因为「换了一步」重跑，
  // 不该因为父组件每次渲染都给出新的函数身份而重跑 —— 那会打断正在进行的定位轮询。
  const goRef = useRef(onGoToView);
  goRef.current = onGoToView;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 只讲当前端型用得上的步骤：单栏/双栏切换只存在于桌面端，手机端顶部分组反过来。
  // 两边共用一套步骤定义，靠 only 标记筛，进度条与总步数都按筛完的算，
  // 否则手机用户会看到「第 3 / 15 步」却怎么也走不到第 15 步。
  const steps = useMemo(
    () => TUTORIAL_STEPS.filter((s) => !s.only || (s.only === "mobile") === isMobile),
    [isMobile],
  );
  const total = steps.length;
  // 视口在讲解途中变化时（旋转屏幕、拖窗口跨过断点）index 可能越界，读的时候夹一下
  const idx = Math.min(index, Math.max(0, total - 1));
  const step = steps[idx];
  const isLast = idx === total - 1;
  /** 卡片可以定位了。居中形态（无高亮块）天然可定位，不必等 place。 */
  const ready = !rect || place !== null;

  // 关闭时就把进度归零（而不是等下次打开才归零）：
  // 打开那一次只应触发一轮定位，否则会先按上回的步骤量一次位置再跳回第一步，光斑闪一下。
  useEffect(() => {
    if (!open) setIndex(0);
  }, [open]);

  // 换步：先切页面、把目标滚进视口，再把光斑对准它；目标还没挂载就逐帧重试
  useEffect(() => {
    if (!open || !step) return;
    if (step.view) goRef.current(step.view);

    if (!step.anchor?.length) {
      setRect(null); // 欢迎页这类没有高亮对象：走居中卡片
      return;
    }

    let raf = 0;
    let tries = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const el = findTarget(step);
      if (el) {
        ensureVisible(el);
        setRect(el.getBoundingClientRect());
        return;
      }
      // 约 0.7 秒还找不到（例如手机端这个入口收在「更多」面板里）就退化为居中卡片
      if (++tries < 45) raf = requestAnimationFrame(tick);
      else setRect(null);
    };
    tick();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [open, idx, step]);

  // 目标位置会随窗口尺寸变化（旋转屏幕、缩放、拖窗口），跟着重测。
  // 这条路径只重量位置、不滚动：用户没换步时不该被页面自己动一下。
  useEffect(() => {
    if (!open || !step?.anchor?.length) return;
    const remeasure = () => {
      const el = findTarget(step);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener("resize", remeasure);
    // 捕获阶段：高亮块可能落在可滚动容器里（左侧导轨内容多时本身可滚）
    window.addEventListener("scroll", remeasure, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
      vv?.removeEventListener("resize", remeasure);
    };
  }, [open, idx, step]);

  // 量出卡片的真实尺寸再定坐标。写在 useLayoutEffect 里，
  // 定位落在浏览器绘制之前，卡片不会先在屏幕角上闪一下。
  useLayoutEffect(() => {
    if (!open || !step) return;
    if (!rect) {
      setPlace(null);
      return;
    }
    const el = cardRef.current;
    if (!el) return;
    // 宽度取实测值（窄屏下 CSS 的 max-width 会把卡片压到 CARD_W 以下）；
    // 万一还没参与布局测不到，退回设计宽度。
    const cardW = el.offsetWidth || CARD_W;
    setPlace(placeCard(rect, cardW, el.offsetHeight, step.prefer));
  }, [open, idx, rect, step]);

  // 键盘：Esc 退出，左右方向键翻步
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!isLast) setIndex(clamp(idx + 1, 0, total - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex(clamp(idx - 1, 0, total - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, idx, isLast, total]);

  // 焦点圈在卡片内：遮罩挡住了鼠标，但 Tab 仍能走到被遮住的页面上，
  // 用户会对着看不见的控件按回车。焦点一跑出去就拉回主按钮。
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const card = cardRef.current;
      if (!card || card.contains(e.target as Node)) return;
      card.querySelector<HTMLElement>("md-filled-button")?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  // 换步后把焦点交给主按钮：连按回车就能一路看完
  useLayoutEffect(() => {
    if (!open || !ready) return;
    primaryRef.current?.querySelector<HTMLElement>("md-filled-button")?.focus();
  }, [open, idx, ready]);

  const go = useCallback(
    (delta: number) => setIndex((i) => clamp(i + delta, 0, Math.max(0, total - 1))),
    [total],
  );
  const finish = useCallback(() => closeRef.current(), []);

  if (!open || !step) return null;

  // 正文可能为空（比如某一步只想报个名字）：那种步骤不渲染 <p>，
  // 也别让 aria-describedby 指过去，否则读屏会念一段空内容、卡片里还多一块空白。
  const hasBody = step.body.trim().length > 0;

  const hole = rect
    ? {
        x: rect.left - HOLE_PAD,
        y: rect.top - HOLE_PAD,
        w: rect.width + HOLE_PAD * 2,
        h: rect.height + HOLE_PAD * 2,
      }
    : null;

  return (
    <div
      className="tour-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby={hasBody ? "tour-body" : undefined}
    >
      {/* 拦截点击的透明层：遮罩只是视觉上的暗，点击仍然要落在这里被吃掉 */}
      <div className="tour-block" />

      {/* 全局遮罩：铺满整个视口的一张暗色矩形，中间按高亮块挖一个圆角洞。
          没有高亮对象时不挖洞 —— 整屏压暗，卡片居中。 */}
      <svg className="tour-mask" aria-hidden="true" focusable="false">
        <defs>
          <mask id={MASK_ID}>
            <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
            {hole && (
              <rect
                className="tour-mask-hole"
                x={hole.x}
                y={hole.y}
                width={hole.w}
                height={hole.h}
                rx={HOLE_RAD}
                fill="#000"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0, 0, 0, 0.55)" mask={"url(#" + MASK_ID + ")"} />
      </svg>

      {/* 洞口的描边：只画圈，不压暗（压暗是上面那张 SVG 的事） */}
      {hole && (
        <div className="tour-hole" style={{ top: hole.y, left: hole.x, width: hole.w, height: hole.h }} />
      )}

      <div
        ref={cardRef}
        className={"tour-card" + (rect ? (place ? "" : " pending") : " center")}
        style={rect && place ? { top: place.top, left: place.left } : undefined}
      >
        {rect && place && (
          <span
            className={"tour-arrow tour-arrow-" + place.side}
            style={place.side === "left" || place.side === "right" ? { top: place.arrow } : { left: place.arrow }}
          />
        )}

        {/* 滚动区单独一层：卡片本身不能设 overflow（会把贴在外缘的箭头一起裁掉） */}
        <div className="tour-card-body">
          <div className="tour-head">
            <span className="tour-count">
              {idx + 1} / {total}
            </span>
            <span className="tour-title" id="tour-title">
              {step.title}
            </span>
          </div>
          {hasBody && (
            <p className="tour-body" id="tour-body">
              {step.body}
            </p>
          )}
          {isMobile && step.mobileNote && (
            <p className="tour-note">
              <span className="material-symbols-outlined">phone_iphone</span>
              <span>{step.mobileNote}</span>
            </p>
          )}

          <div className="tour-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} className={"tour-dot" + (i < idx ? " done" : i === idx ? " on" : "")} />
            ))}
          </div>

          <div className="tour-actions">
            <TextButton onClick={finish}>跳过</TextButton>
            <span className="tour-spacer" />
            {idx > 0 && <OutlinedButton onClick={() => go(-1)}>上一步</OutlinedButton>}
            <span ref={primaryRef} className="tour-primary">
              <FilledButton onClick={() => (isLast ? finish() : go(1))}>{isLast ? "完成" : "下一步"}</FilledButton>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
