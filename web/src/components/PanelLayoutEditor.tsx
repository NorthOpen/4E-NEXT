// 设置页「自定义人物板块」：拖动调整板块在车卡页的先后与所在栏位
//
// 交互分两套输入设备：
//   · 鼠标 —— HTML5 拖放（按住板块行拖到目标位置）；
//   · 手指 —— 触屏不派发 drag 事件，按住拖动只会滚动页面，所以另走一条指针事件路径：
//             按住约 0.26 秒「拿起」板块，之后跟着手指走，松手落到当时指向的行 / 栏位。
//             拿起之前一律让页面正常滚动，拿起之后才挡掉滚动（见 blockScroll）。
// 两套之外都配 ↑ ↓ ← → 按钮做精细调整，也是键盘用户的操作入口。
// 面板宽度只占设置页一栏，因此双栏用「顶部区 + 左右两栏」三段式预览来对应车卡页的实际版面。

import { useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { TextButton } from "./md";
import { useNoHover } from "../lib/media";
import {
  DOUBLE_ZONES,
  moveSheetPanel,
  nudgeSheetPanel,
  panelMeta,
  resetSheetLayout,
  setSheetLayout,
  topAllowedPanel,
  topOnlyPanel,
  useSheetLayout,
  type SheetLayoutConfig,
  type SheetLayoutSlot,
  type SheetPanelId,
} from "../lib/sheetLayout";

type Mode = "single" | "double";

/** 触屏上按住多久算「拿起」：比长按菜单短得多，拿起要跟手； */
/** 移动超过这个距离（px）则判定为滚动，放弃拿起。 */
const TOUCH_LIFT_MS = 260;
const TOUCH_SLOP = 10;

const SLOT_LABEL: Record<SheetLayoutSlot, string> = {
  single: "单栏",
  top: "顶部区",
  left: "左栏",
  right: "右栏",
};

const SLOT_HINT: Partial<Record<SheetLayoutSlot, string>> = {
  single: "从上到下依次排列；手机端固定使用单栏。",
  left: "左栏从上到下排列。",
  right: "右栏从上到下排列。",
};

export default function PanelLayoutEditor({ defaultMode = "double" }: { defaultMode?: Mode }) {
  const cfg = useSheetLayout();
  const touch = useNoHover();
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [dragId, setDragId] = useState<SheetPanelId | null>(null);
  const [overSlot, setOverSlot] = useState<SheetLayoutSlot | null>(null);
  const [overId, setOverId] = useState<SheetPanelId | null>(null);

  const slots: SheetLayoutSlot[] = mode === "single" ? ["single"] : DOUBLE_ZONES;
  const listOf = (c: SheetLayoutConfig, slot: SheetLayoutSlot): SheetPanelId[] => (slot === "single" ? c.single : c.double[slot]);

  function clearDrag() {
    setDragId(null);
    setOverSlot(null);
    setOverId(null);
  }

  // ===== 触屏拖动（指针事件）=====
  // 指针捕获会把后续事件全部送到起始行，所以落点要用 elementsFromPoint 现问，
  // 并从命中栈里挑出第一个「不是自己」的板块行。
  const touchDrag = useRef<{
    id: SheetPanelId;
    sx: number;
    sy: number;
    lifted: boolean;
    timer: number | undefined;
    after: boolean;
    target: { slot: SheetLayoutSlot; id: SheetPanelId | null } | null;
  } | null>(null);
  // 拿起过之后紧跟的那次 click 是手势余波，别让它落到别的按钮上
  const swallowClick = useRef(false);

  const blockScroll = (ev: TouchEvent) => ev.preventDefault();

  function endTouchDrag(commit: boolean) {
    const d = touchDrag.current;
    if (!d) return;
    if (d.timer !== undefined) window.clearTimeout(d.timer);
    if (d.lifted) {
      window.removeEventListener("touchmove", blockScroll);
      if (commit && d.target) {
        const { slot, id } = d.target;
        if (id !== d.id && canDrop(d.id, slot)) setSheetLayout(moveSheetPanel(cfg, d.id, slot, id, d.after));
      }
    }
    touchDrag.current = null;
    clearDrag();
  }

  function rowPointerDown(e: ReactPointerEvent<HTMLDivElement>, id: SheetPanelId, slot: SheetLayoutSlot) {
    if (e.pointerType === "mouse") return;      // 鼠标留给 HTML5 拖放
    if (e.button !== 0) return;
    // 行尾那几颗按钮各有各的动作，别把它们变成拖动起点（指针捕获会把 click 也带走）
    if ((e.target as HTMLElement).closest("button")) return;
    // 指针已经抬起等极端情形下 setPointerCapture 会抛 InvalidStateError；
    // 捕获失败只是拿不到后续 move，不该让整个编辑器崩掉。
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* 拿不到捕获就退化成「按住后不再响应移动」 */ }
    touchDrag.current = {
      id, sx: e.clientX, sy: e.clientY, lifted: false, after: false, target: null,
      timer: window.setTimeout(() => {
        const d = touchDrag.current;
        if (!d) return;
        d.lifted = true;
        setDragId(d.id);
        setOverSlot(slot);
        // 拿起之后必须挡掉 touchmove，否则手指一动页面就跟着滚、板块原地不动。
        // 必须是非被动监听：被动监听里 preventDefault 无效。
        window.addEventListener("touchmove", blockScroll, { passive: false });
        navigator.vibrate?.(8);
      }, TOUCH_LIFT_MS),
    };
  }

  function rowPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = touchDrag.current;
    if (!d) return;
    if (!d.lifted) {
      // 还没拿起就移动 = 用户想滚页面，直接放弃
      if (Math.abs(e.clientX - d.sx) > TOUCH_SLOP || Math.abs(e.clientY - d.sy) > TOUCH_SLOP) endTouchDrag(false);
      return;
    }
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    const rowEl = stack.map((el) => el.closest<HTMLElement>("[data-ple-id]")).find((el) => el && el.dataset.pleId !== d.id) ?? null;
    if (rowEl) {
      const targetId = rowEl.dataset.pleId as SheetPanelId;
      const targetSlot = rowEl.dataset.pleSlot as SheetLayoutSlot;
      if (!canDrop(d.id, targetSlot)) return endTouchDrag(false);
      const r = rowEl.getBoundingClientRect();
      // 落在行的上半 → 插到它前面；下半 → 插到它后面（与鼠标拖放同一判据）
      d.after = e.clientY > r.top + r.height / 2;
      d.target = { slot: targetSlot, id: targetId };
      setOverSlot(targetSlot);
      setOverId(targetId);
      return;
    }
    const zoneEl = stack.map((el) => el.closest<HTMLElement>("[data-ple-zone]")).find(Boolean) ?? null;
    if (zoneEl) {
      const targetSlot = zoneEl.dataset.pleZone as SheetLayoutSlot;
      if (!canDrop(d.id, targetSlot)) return endTouchDrag(false);
      d.target = { slot: targetSlot, id: null };
      setOverSlot(targetSlot);
      setOverId(null);
      return;
    }
    d.target = null;
    setOverId(null);
  }

  /** 板块能否放进某容器：
   *  - 顶部区锚板块（角色信息/角色数值）：只能待在顶部区，不能搬到左/右栏；
   *  - 命中/伤害：可放顶部区（锚板块之后），也可搬到左/右栏；
   *  - 其余板块：不能进入顶部区，只能在左/右栏间移动。
   *  单栏均为单列列表，不受顶部区约束。 */
  function canDrop(id: SheetPanelId, slot: SheetLayoutSlot): boolean {
    if (slot === "single") return true;
    if (slot === "top") return topAllowedPanel(id);
    return !topOnlyPanel(id);
  }

  function move(id: SheetPanelId, to: SheetLayoutSlot, targetId: SheetPanelId | null, after: boolean) {
    if (targetId === id) return clearDrag();
    if (!canDrop(id, to)) return clearDrag();
    setSheetLayout(moveSheetPanel(cfg, id, to, targetId, after));
    clearDrag();
  }

  /** 落在板块行的上半还是下半：决定插到它前面还是后面 */
  function isAfter(e: DragEvent<HTMLElement>): boolean {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  }

  function renderRow(id: SheetPanelId, slot: SheetLayoutSlot, index: number, total: number) {
    const meta = panelMeta(id);
    // 可换的栏位：
    //  - 锚板块（顶部区）：不能离开顶部，无可换栏；
    //  - 命中/伤害：可在 顶部区 ⇄ 左/右栏 间移动；
    //  - 其余左/右栏板块：只能在左右两栏间移动（不能进入顶部区）。
    const zoneMoves: { to: SheetLayoutSlot; icon: string; label: string }[] = [];
    if (slot === "left") {
      if (topAllowedPanel(id)) zoneMoves.push({ to: "top", icon: "expand_less", label: "顶部区" });
      zoneMoves.push({ to: "right", icon: "chevron_right", label: "右栏" });
    } else if (slot === "right") {
      zoneMoves.push({ to: "left", icon: "chevron_left", label: "左栏" });
      if (topAllowedPanel(id)) zoneMoves.push({ to: "top", icon: "expand_less", label: "顶部区" });
    }
    // interior reordering: top 区内的拖动仍用上/下移（锚板块固定在前，命中/伤害在其后）
    const dragging = dragId === id;
    return (
      <div
        key={id}
        // 触屏拖动要靠这两个 data 属性反查落点（指针捕获后拿不到真实的 e.target）
        data-ple-id={id}
        data-ple-slot={slot}
        className={
          "ple-row" +
          (dragging ? " dragging" : "") +
          (overId === id && !dragging ? " drag-over" : "") +
          (meta.wide && slot === "top" ? " ple-row-wide" : "")
        }
        draggable
        title={meta.hint}
        onDragStart={(e) => {
          setDragId(id);
          setOverSlot(slot);
          e.dataTransfer.effectAllowed = "move";
          // Firefox 需要写入数据才会真正开始拖动
          try {
            e.dataTransfer.setData("text/plain", id);
          } catch {
            /* 忽略 */
          }
        }}
        onDragEnd={clearDrag}
        onDragOver={(e) => {
          if (!dragId || dragId === id) return;
          if (!canDrop(dragId, slot)) return;
          e.preventDefault();
          e.stopPropagation();
          setOverSlot(slot);
          setOverId(id);
        }}
        onDrop={(e) => {
          if (!dragId) return;
          e.preventDefault();
          e.stopPropagation();
          move(dragId, slot, id, isAfter(e));
        }}
        onPointerDown={(e) => rowPointerDown(e, id, slot)}
        onPointerMove={rowPointerMove}
        onPointerUp={() => { if (touchDrag.current?.lifted) swallowClick.current = true; endTouchDrag(true); }}
        onPointerCancel={() => endTouchDrag(false)}
      >
        <span className="material-symbols-outlined ple-grip">drag_indicator</span>
        <span className="material-symbols-outlined ple-ic">{meta.icon}</span>
        <span className="ple-name">{meta.label}</span>
        <span className="ple-actions">
          {slot === "top" ? (
            // 顶部区是双栏横排：重排用左右移（前面/后面），不用上下移。
            // 锚板块（角色信息/角色数值）固定在顶部区最前、顺序不可调，因此不显示任何操控按钮；
            // 命中/伤害仍可左右重排（在锚板块之后）。
            topOnlyPanel(id) ? null : (
              <>
                <button type="button" className="ple-btn" disabled={index === 0} title="左移" aria-label={`${meta.label}左移`} onClick={() => setSheetLayout(nudgeSheetPanel(cfg, id, slot, -1))}>
                  <span className="material-symbols-outlined">keyboard_arrow_left</span>
                </button>
                <button type="button" className="ple-btn" disabled={index === total - 1} title="右移" aria-label={`${meta.label}右移`} onClick={() => setSheetLayout(nudgeSheetPanel(cfg, id, slot, 1))}>
                  <span className="material-symbols-outlined">keyboard_arrow_right</span>
                </button>
              </>
            )
          ) : (
            <>
              <button type="button" className="ple-btn" disabled={index === 0} title="上移" aria-label={`${meta.label}上移`} onClick={() => setSheetLayout(nudgeSheetPanel(cfg, id, slot, -1))}>
                <span className="material-symbols-outlined">keyboard_arrow_up</span>
              </button>
              <button type="button" className="ple-btn" disabled={index === total - 1} title="下移" aria-label={`${meta.label}下移`} onClick={() => setSheetLayout(nudgeSheetPanel(cfg, id, slot, 1))}>
                <span className="material-symbols-outlined">keyboard_arrow_down</span>
              </button>
            </>
          )}
          {zoneMoves.map((zm) => (
            <button key={zm.to} type="button" className="ple-btn" title={"移到" + zm.label} aria-label={`${meta.label}移到${zm.label}`} onClick={() => move(id, zm.to, null, false)}>
              <span className="material-symbols-outlined">{zm.icon}</span>
            </button>
          ))}
        </span>
      </div>
    );
  }

  function renderZone(slot: SheetLayoutSlot) {
    const list = listOf(cfg, slot);
    return (
      <div
        key={slot}
        data-ple-zone={slot}
        className={
          "ple-zone" +
          (slot === "single" ? " ple-zone-single" : "") +
          (slot === "top" ? " ple-zone-top" : "") +
          (overSlot === slot && !overId && dragId ? " drag-over" : "")
        }
        onDragOver={(e) => {
          if (!dragId) return;
          if (!canDrop(dragId, slot)) return;
          e.preventDefault();
          setOverSlot(slot);
          setOverId(null);
        }}
        onDrop={(e) => {
          if (!dragId) return;
          e.preventDefault();
          move(dragId, slot, null, false);
        }}
      >
        <div className="ple-zone-head">
          <span className="ple-zone-name">{SLOT_LABEL[slot]}</span>
          {SLOT_HINT[slot] && <span className="ple-zone-hint">{SLOT_HINT[slot]}</span>}
        </div>
        {list.length === 0 ? (
          <div className="ple-empty">{touch ? "把板块放到这里" : "拖动板块到这里"}</div>
        ) : (
          list.map((id, i) => renderRow(id, slot, i, list.length))
        )}
      </div>
    );
  }

  function onReset() {
    if (window.confirm("恢复默认摆放？当前的自定义排列会被清除。")) resetSheetLayout();
  }

  return (
    // data-tour：教学模式的锚点，见 lib/tutorial.ts
    <div className="ple" data-tour="panel-layout">
      <div className="ple-bar">
        <div className="md3-seg ple-tabs" role="radiogroup" aria-label="要调整的布局">
          {(["single", "double"] as Mode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={"md3-seg-btn" + (mode === m ? " on" : "")} onClick={() => { setMode(m); clearDrag(); }}>
              {mode === m && <span className="material-symbols-outlined md3-seg-check">check</span>}
              {m === "single" ? "单栏" : "双栏"}
            </button>
          ))}
        </div>
        <TextButton onClick={onReset}>恢复默认摆放</TextButton>
      </div>
      {/* 触屏上没法靠光标暗示「这一行能拖」，得把话说清楚 */}
      {touch && <p className="ple-touch-hint">按住板块行约 0.3 秒拿起，拖到目标位置松手；行尾箭头可逐个微调。</p>}
      <div
        className={"ple-board" + (mode === "double" ? " ple-board-double" : "")}
        // 触屏拖动的收尾 click 可能落到别的按钮上，这里拦一次（见 swallowClick）
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {slots.map(renderZone)}
      </div>
    </div>
  );
}
