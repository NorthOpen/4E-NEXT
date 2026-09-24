import SheetDialog from "./SheetDialog";
import { TextButton } from "./md";
import { CONDITION_GROUPS, CONDITION_DESC, toggleCondition, type EncounterMonster } from "../data/encounter";

/**
 * 状态候选（二级弹窗）。
 *
 * 原来是在详情面板里展开一块浮层，问题是它盖住了怪物卡、又容易被误当成卡片的一部分。
 * 收进弹窗后：候选互不挤占面板空间，可以连着勾好几个再关掉；每组还带上速查文本，
 * 「震慑能不能动」这类问题在选的时候就答了，不必挂上去再悬停问一遍。
 */
export default function ConditionPicker({ m, open, onClose }: {
  m: EncounterMonster | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!m) return null;
  const on = m.conditions;

  return (
    <SheetDialog
      open={open}
      headline={"状态 · " + m.name}
      sub={on.length > 0 ? "已挂 " + on.length + " 个" : "尚未挂状态"}
      onClose={onClose}
      actions={
        <TextButton disabled={on.length === 0} onClick={() => on.forEach((c) => toggleCondition(m.uid, c))}>
          全部取消
        </TextButton>
      }
    >
      <div className="cp">
        {CONDITION_GROUPS.map((g) => (
          <section key={g.label} className="cp-group">
            <h4 className="cp-group-label">{g.label}</h4>
            <div className="cp-items">
              {g.items.map((c) => {
                const has = on.includes(c.name);
                return (
                  <button
                    key={c.name}
                    type="button"
                    className={"cp-item" + (has ? " on" : "")}
                    aria-pressed={has}
                    title={c.desc}
                    onClick={() => toggleCondition(m.uid, c.name)}
                  >
                    <span className="cp-item-name">
                      {has && <span className="material-symbols-outlined">check</span>}
                      {c.name}
                    </span>
                    <span className="cp-item-desc">{c.desc}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {/* 老存档里可能留着已不在候选表里的状态，也要能撤掉 */}
        {on.filter((c) => !CONDITION_DESC[c]).length > 0 && (
          <section className="cp-group">
            <h4 className="cp-group-label">其他（旧存档）</h4>
            <div className="cp-items">
              {on.filter((c) => !CONDITION_DESC[c]).map((c) => (
                <button key={c} type="button" className="cp-item on" aria-pressed
                  onClick={() => toggleCondition(m.uid, c)}>
                  <span className="cp-item-name">
                    <span className="material-symbols-outlined">check</span>
                    {c}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </SheetDialog>
  );
}
