import { useState } from "react";
import SheetDialog from "../components/SheetDialog";
import { FilledButton, TextButton } from "../components/md";
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  abilityModifier,
  applyAbilityBonus,
  type AbilityKey,
} from "./character";

/**
 * 升级 · 属性成长弹窗（MD3）。
 *
 * 只由人物页等级「＋」按钮触发（见 CharacterSheet 的 bumpLevel），分两种形态：
 *   · all（11 / 21 级「全部 +1」）：加值在点「＋」时已经写进角色，这里只是一个提示，
 *     把「六项各 +1」的结果摊给玩家看一眼，点「我已知晓」或点遮罩即可关掉。
 *   · two（4 / 8 / 14 / 18 / 24 / 28 级「两个 +1」）：玩家在六项里点选两项，确定后各 +1；
 *     也可以点「我已知晓，稍后手动添加」跳过，完全由玩家自己在属性面板里调。
 *
 * 等级的直接输入 / 改经验 / 切卡 / 导入 / AI 落子都不会走到这里 —— 需求里明确不弹。
 */

/** 属性值上限（与人物页属性面板的 setAbility 一致） */
export const ABILITY_CAP = 30;

export interface AbilityBoostDialogProps {
  /** 本次升级到达的等级（弹窗文案里的「N 级」） */
  level: number;
  kind: "two" | "all";
  /** 升级前 / 升级后的**基础**属性（不含种族加值） */
  before: Record<AbilityKey, number>;
  after: Record<AbilityKey, number>;
  /** 种族加值：弹窗展示的是含种族加值的最终值，与人物页属性表同一口径 */
  racial: Partial<Record<AbilityKey, number>>;
  /** 两项 +1 模式：玩家选好两项并点「确定」 */
  onConfirm: (picks: AbilityKey[]) => void;
  /** 关闭且不写入（「我已知晓」/「我已知晓，稍后手动添加」/ 遮罩） */
  onDismiss: () => void;
}

function fmtMod(n: number): string {
  return n >= 0 ? "+" + n : String(n);
}

export default function AbilityBoostDialog({
  level,
  kind,
  before,
  after,
  racial,
  onConfirm,
  onDismiss,
}: AbilityBoostDialogProps) {
  const isTwo = kind === "two";
  const [picks, setPicks] = useState<AbilityKey[]>([]);

  const effBefore = applyAbilityBonus(before, racial);
  const effAfter = applyAbilityBonus(after, racial);
  const capped = (k: AbilityKey) => before[k] >= ABILITY_CAP;
  const full = picks.length === 2;

  const toggle = (k: AbilityKey) => {
    if (!isTwo || capped(k)) return;
    setPicks((prev) => {
      if (prev.includes(k)) return prev.filter((x) => x !== k);
      if (prev.length >= 2) return prev;
      return [...prev, k];
    });
  };

  const cards = ABILITY_KEYS.map((k) => {
    const sel = picks.includes(k);
    const isCapped = capped(k);
    const from = effBefore[k];
    // 两项 +1：选中即预览 +1；全部 +1：直接显示升级后的真实值
    const to = isTwo ? (sel ? from + 1 : from) : effAfter[k];
    const changed = to !== from;
    const modFrom = abilityModifier(from);
    const modTo = abilityModifier(to);
    const mark = isTwo
      ? sel ? "check_circle" : isCapped ? "block" : "add_circle"
      : changed ? "check_circle" : "block";

    const body = (
      <>
        <span className="ab-card-top">
          <span className="ab-card-name">
            {ABILITY_LABELS[k].zh}
            <span className="ab-card-en">{ABILITY_LABELS[k].en}</span>
          </span>
          <span className="ab-card-score">
            <span className="ab-card-cur">{from}</span>
            {changed && (
              <>
                <span className="ab-card-arrow" aria-hidden="true">→</span>
                <span className="ab-card-next">{to}</span>
              </>
            )}
          </span>
        </span>
        <span className="ab-card-bottom">
          <span className="ab-card-mod">
            调整值 {fmtMod(modTo)}
            {modTo !== modFrom && <span className="ab-card-mod-from">（原 {fmtMod(modFrom)}）</span>}
          </span>
          <span className="ab-card-mark material-symbols-outlined" aria-hidden="true">{mark}</span>
        </span>
        {isCapped && <span className="ab-card-cap">已达上限 {ABILITY_CAP}</span>}
      </>
    );

    if (!isTwo) {
      return (
        <div
          key={k}
          className={"ab-card static" + (changed ? " on" : "")}
          role="listitem"
          aria-label={ABILITY_LABELS[k].zh + " " + to + "，调整值 " + fmtMod(modTo)}
        >
          {body}
        </div>
      );
    }
    return (
      <button
        key={k}
        type="button"
        role="checkbox"
        aria-checked={sel}
        disabled={isCapped}
        className={"ab-card" + (sel ? " on" : "") + (isCapped ? " cap" : "")}
        title={isCapped ? ABILITY_LABELS[k].zh + "已达上限 " + ABILITY_CAP + "，无法再提升" : "选择" + ABILITY_LABELS[k].zh + " +1"}
        onClick={() => toggle(k)}
      >
        {body}
      </button>
    );
  });

  return (
    <SheetDialog
      open
      headline="属性提升"
      sub={"达到 " + level + " 级"}
      extraClass="sheet-dialog-boost"
      noCloseButton
      // 两项 +1 是要写进角色的选择：遮罩 / Esc 不关，必须明确点「确定」或「稍后手动添加」
      preventScrimClose={isTwo}
      onClose={onDismiss}
      actions={
        isTwo ? (
          <>
            <TextButton onClick={onDismiss}>我已知晓，稍后手动添加</TextButton>
            <FilledButton disabled={!full} onClick={() => onConfirm(picks)}>确定</FilledButton>
          </>
        ) : (
          <FilledButton onClick={onDismiss}>我已知晓</FilledButton>
        )
      }
    >
      <p className="ab-msg">
        {isTwo ? (
          <>人物已达到 <b>{level}</b> 级，请选择两项属性获得 1 点提升。</>
        ) : (
          <>人物已达到 <b>{level}</b> 级，六项属性获得 1 点提升。</>
        )}
      </p>

      {isTwo && (
        <div className="ab-status">
          <span className={"ab-count" + (full ? " full" : "")} aria-live="polite">已选 {picks.length} / 2</span>
          <span className="ab-status-hint">{full ? "确定后，这两项属性各 +1。" : "在下方点选 " + (2 - picks.length) + " 项属性。"}</span>
        </div>
      )}

      <div className="ab-grid" role={isTwo ? "group" : "list"} aria-label="六项属性">
        {cards}
      </div>
    </SheetDialog>
  );
}
