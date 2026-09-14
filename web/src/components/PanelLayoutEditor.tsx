// 设置页「车卡页面板块」：拖动调整板块在车卡页的先后与所在栏位
//
// 交互：HTML5 拖放（按住板块行拖到目标位置），另配 ↑ ↓ ← → 按钮做精细调整——
// 触屏拖放不可靠，按钮同时也是键盘用户的操作入口。
// 面板宽度只占设置页一栏，因此双栏用「顶部区 + 左右两栏」三段式预览来对应车卡页的实际版面。

import { useState, type DragEvent } from "react";
import { TextButton } from "./md";
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
      >
        <span className="material-symbols-outlined ple-grip">drag_indicator</span>
        <span className="material-symbols-outlined ple-ic">{meta.icon}</span>
        <span className="ple-name">{meta.label}</span>
        <span className="ple-actions">
          {slot === "top" ? (
            // 顶部区是双栏横排：重排用左右移（前面/后面），不用上下移
            <>
              <button type="button" className="ple-btn" disabled={index === 0} title="左移" aria-label={`${meta.label}左移`} onClick={() => setSheetLayout(nudgeSheetPanel(cfg, id, slot, -1))}>
                <span className="material-symbols-outlined">keyboard_arrow_left</span>
              </button>
              <button type="button" className="ple-btn" disabled={index === total - 1} title="右移" aria-label={`${meta.label}右移`} onClick={() => setSheetLayout(nudgeSheetPanel(cfg, id, slot, 1))}>
                <span className="material-symbols-outlined">keyboard_arrow_right</span>
              </button>
            </>
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
          <div className="ple-empty">拖动板块到这里</div>
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
    <div className="ple">
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
      <div className={"ple-board" + (mode === "double" ? " ple-board-double" : "")}>{slots.map(renderZone)}</div>
    </div>
  );
}
