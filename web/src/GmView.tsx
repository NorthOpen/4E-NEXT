import { useEffect, useRef, useState } from "react";
import type { MdOutlinedTextField } from "@material/web/textfield/outlined-text-field.js";
import { FilledButton, FilledTextField, FilledTonalButton, IconButton, OutlinedTextField, TextButton } from "./components/md";
import ConditionPicker from "./components/ConditionPicker";
import MonsterCard from "./components/MonsterCard";
import MonsterPicker from "./components/MonsterPicker";
import {
  CONDITION_DESC, clearEncounter, damageMonster, dismissUndo, duplicateMonster, healMonster,
  removeMonster, resetEncounter, selectMonster, setHp, toggleCondition, undoEncounter,
  updateMonster, useEncounter, type EncounterMonster,
} from "./data/encounter";
import { baseRank, bookLabel } from "./data/monsters";

/**
 * 主持页 · 怪物追踪。
 *
 * 站在 DM 那一侧想这个页面：跑团中他每几秒就要回答一次「谁还剩多少血、谁身上挂了什么、
 * 轮到他时这张卡写了什么」，而花在界面上的每一秒都是从牌桌上偷的。于是三条硬约束：
 *   1. **同时看得见所有人**——4E 一场遭遇常有 6~12 个单位（还夹着一堆 1 点血的杂兵），
 *      每只怪铺一整张卡谁也看不全，所以默认「名册 + 详情」：名册一屏装下全场状态，
 *      点谁，详情面板就渲染谁；
 *   2. **数据一直在场上**——详情面板从不空着，选中的那一只永远完整渲染它的数据块；
 *      想「一次看完所有卡」时切到「卡片」视图；
 *   3. **手比眼快**——扣血输入框、状态、改名都在详情面板上半截，不随卡片滚动。
 *
 * 组件语言与速览页共用同一套（见 styles.extra.css ⑪）：面板是 .gl-shell + .gl-bar +
 * 发丝分区的做法，控件直接用速览的 .gl-md-btn / .gl-num-field / .gl-stepper /
 * .gl-icon-btn / .gl-state / .gl-hp-*，所以「玩家看到的血条」和「DM 看到的血条」
 * 是同一个东西，两个页面不会各自漂移。
 *
 * 破坏性操作（移除 / 清空 / 重置）都会弹一条 MD3 Snackbar 给一次撤销机会——
 * 手滑清空一整场是对 DM 最贵的失误，这条 Snackbar 是本页最划算的功能。
 */

const QUICK = [1, 5, 10];
type ViewMode = "roster" | "cards";
const VIEW_KEY = "4enext-gm-view";

export default function GmView({ layout }: { layout: "single" | "double" }) {
  const { list, selected, undo } = useEncounter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [view, setView] = useState<ViewMode>(() => {
    try { return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "roster"; } catch { return "roster"; }
  });

  // Snackbar 到点自己走；期间 DM 又干了别的（undo 被清）也会立刻收掉
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(dismissUndo, 8000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  function switchView(v: ViewMode) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* 隐私模式下不记住也行 */ }
  }

  function clearAll() {
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 6000);   // 6 秒没确认就自动撤销，避免误触
      return;
    }
    clearEncounter();
    setConfirmClear(false);
  }

  const current = list.find((m) => m.uid === selected) ?? list[0] ?? null;
  const dead = list.filter((m) => m.hp <= 0).length;

  return (
    <div className="gm-view">
      <div className="gl-shell gm-shell">
        <div className="gl-bar">
          <div className="gl-bar-id">
            <div className="gl-bar-line">
              <h2 className="gl-bar-name gm-h2">怪物追踪</h2>
              {list.length > 0 && (
                <span className="gl-state gl-state-ok">
                  {list.length} 只在场{dead > 0 ? " · 倒地 " + dead : ""}
                </span>
              )}
            </div>
          </div>
          <div className="gm-bar-acts">
            {list.length > 0 && (
              <div className="md3-seg" role="radiogroup" aria-label="名册或卡片视图">
                <button type="button" role="radio" aria-checked={view === "roster"}
                  className={"md3-seg-btn" + (view === "roster" ? " on" : "")} onClick={() => switchView("roster")}>
                  名册
                </button>
                <button type="button" role="radio" aria-checked={view === "cards"}
                  className={"md3-seg-btn" + (view === "cards" ? " on" : "")} onClick={() => switchView("cards")}>
                  卡片
                </button>
              </div>
            )}
            <FilledButton className="gl-md-btn" onClick={() => setPickerOpen(true)}>
              <span slot="icon" className="material-symbols-outlined">add</span>
              添加怪物
            </FilledButton>
            {list.length > 0 && (
              <>
                <TextButton className="gm-tbtn" onClick={resetEncounter} title="全员回满血、清临时生命值与状态，名单保留">重置</TextButton>
                <TextButton className="gm-tbtn gm-danger" onClick={clearAll}>{confirmClear ? "确认清空？" : "清空"}</TextButton>
              </>
            )}
          </div>
        </div>

        {list.length === 0 ? (
          <div className="gm-empty">
            <span className="material-symbols-outlined gm-empty-ic">swords</span>
            <h3>场上还没有怪物</h3>
            <FilledButton className="gl-md-btn" onClick={() => setPickerOpen(true)}>
              <span slot="icon" className="material-symbols-outlined">add</span>
              添加怪物
            </FilledButton>
            <p className="gm-empty-tip">也可以在词条页搜到怪物后点「加入遭遇」，它会直接出现在这里。</p>
          </div>
        ) : view === "roster" ? (
          <div className={"gc" + (layout === "single" ? " single" : "")}>
            <div className="gc-roster" role="list" aria-label="场上怪物">
              {list.map((m) => <RosterRow key={m.uid} m={m} on={m.uid === current?.uid} />)}
            </div>
            <div className="gc-detail">
              {current && (
                <div className={"gd" + stateClass(current)}>
                  <div className="gd-deck">
                    <MonsterControls key={current.uid} m={current} hotkeys />
                  </div>
                  <div className="gd-card"><MonsterCard text={current.text} /></div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={"gm-board" + (layout === "single" ? " single" : "")}>
            {list.map((m) => (
              <section key={m.uid} className={"bi" + stateClass(m)}>
                <div className="bi-strip"><MonsterControls m={m} showMeta /></div>
                <MonsterCard text={m.text} />
              </section>
            ))}
          </div>
        )}
      </div>

      <MonsterPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />

      {undo && (
        <div className="d4e-snackbar" key={undo.stamp} role="status">
          <span className="d4e-snackbar-text">{undo.text}</span>
          <TextButton onClick={undoEncounter}>撤销</TextButton>
        </div>
      )}
    </div>
  );
}

/** 血条与血字的状态色挂在祖先上，规则写在 ⑪（速览的 .z-vit.is-* 是按分区类名写的，不能直接复用） */
function stateClass(m: EncounterMonster): string {
  if (m.hp <= 0) return " is-dying";
  if (m.bloodied > 0 && m.hp <= m.bloodied) return " is-bloodied";
  return "";
}

function rankOf(m: EncounterMonster): string {
  return m.rank ? baseRank(m.rank) : "";
}

/** 身份副信息：职能 · 图鉴（名册上跟在名字后面，卡片视图里补在控制台上） */
function metaOf(m: EncounterMonster): string {
  return [m.role, m.book ? bookLabel(m.book) : ""].filter(Boolean).join(" · ");
}

function hpWidth(m: EncounterMonster): string {
  if (m.maxHp <= 0) return "0%";
  return Math.max(0, Math.min(100, Math.round((m.hp / m.maxHp) * 100))) + "%";
}

/** 名册里的一行：一屏内看完全场状态 */
function RosterRow({ m, on }: { m: EncounterMonster; on: boolean }) {
  const down = m.hp <= 0;
  const hurt = !down && m.bloodied > 0 && m.hp <= m.bloodied;
  const rank = rankOf(m);
  const meta = metaOf(m);
  const shown = m.conditions.slice(0, 2);
  const rest = m.conditions.length - shown.length;
  return (
    <button
      type="button"
      className={"gr" + (on ? " on" : "") + (down ? " dead" : hurt ? " hurt" : "")}
      aria-current={on || undefined}
      title={m.tag}
      onClick={() => selectMonster(m.uid)}
    >
      <span className="gr-top">
        <span className="gr-name">{m.name}</span>
        {meta && <span className="gl-chip-sub gr-meta">{meta}</span>}
        {m.level !== undefined && <span className="gl-item-slot">LV{m.level}</span>}
        {rank && <span className="gl-item-slot">{rank}</span>}
        {down ? <span className="gl-state gl-state-dying">倒地</span>
          : hurt ? <span className="gl-state gl-state-bloodied">重伤</span> : null}
      </span>
      <span className="gr-bot">
        <span className="gl-hp-bar gr-bar">
          <span className="gl-hp-fill" style={{ width: hpWidth(m) }} />
        </span>
        <span className="gr-hp">{m.hp}<em>/{m.maxHp}</em></span>
        {m.tempHp > 0 && <span className="gl-hp-temp">临时 +{m.tempHp}</span>}
        {shown.map((c) => (
          <span key={c} className="gl-item-slot" title={CONDITION_DESC[c]}>{c}</span>
        ))}
        {rest > 0 && <span className="gl-item-slot">+{rest}</span>}
      </span>
    </button>
  );
}

/**
 * 一只怪的整块控制台：名册视图的详情面板与卡片视图共用**同一个组件**，
 * 两种视图的能力因此完全等价，不存在「这个视图少个功能」。
 * showMeta：名册视图里「职能 · 图鉴」已经在左侧行上了，控制台不再重复一行。
 */
function MonsterControls({ m, hotkeys, showMeta }: { m: EncounterMonster; hotkeys?: boolean; showMeta?: boolean }) {
  const [amount, setAmount] = useState("");
  const [condOpen, setCondOpen] = useState(false);
  const dmgRef = useRef<MdOutlinedTextField | null>(null);

  const value = Math.max(0, Math.floor(Number(amount) || 0));
  const meta = metaOf(m);

  /**
   * 「直接打字」（只挂在名册视图的详情面板上）：点了谁之后不必再去点一次输入框 ——
   * 敲数字就落进伤害框，回车即结算。跑团时这一下点击省的是真人等你的时间。
   * 只在没有真实输入焦点时接管；md-* 组件的宿主元素也算输入焦点，不会抢弹窗里的搜索框。
   */
  useEffect(() => {
    if (!hotkeys) return;
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.length !== 1 || e.key < "0" || e.key > "9") return;
      const ae = document.activeElement as HTMLElement | null;
      const tag = ae?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag.startsWith("MD-") || ae?.isContentEditable) return;
      setAmount((v) => (v + e.key).slice(0, 6));
      dmgRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys]);

  function apply(kind: "damage" | "heal") {
    if (value <= 0) return;
    if (kind === "damage") damageMonster(m.uid, value);
    else healMonster(m.uid, value);
    setAmount("");
  }

  const rank = rankOf(m);

  return (
    <>
      <div className="gd-head">
        {/* 改名栏＝人物页「姓名」那个组件的体验：带标签的 MD3 filled 文本域 */}
        <FilledTextField
          className="gm-name-field"
          label="名字"
          value={m.name}
          title="同名怪会自动带 A / B / C"
          onInput={(e) => updateMonster(m.uid, { name: (e.target as unknown as { value: string }).value ?? "" })}
        />
        {rank && <span className="gl-item-slot">{rank}</span>}
        <IconButton className="gl-icon-btn" title="再放一只（复制）" onClick={() => duplicateMonster(m.uid)}>
          <span className="material-symbols-outlined">content_copy</span>
        </IconButton>
        <IconButton className="gl-icon-btn" title="移出场外" onClick={() => removeMonster(m.uid)}>
          <span className="material-symbols-outlined">delete</span>
        </IconButton>
      </div>
      {showMeta && meta && <div className="gl-bar-sub">{meta}</div>}

      {/* 生命：与速览页「生命」分区同一套写法（大数字 + 带重伤线的血条 + 状态徽标） */}
      <div className="gl-hp-num">
        <span className="gl-hp-cur">{m.hp}</span>
        <span className="gl-hp-max">/ {m.maxHp}</span>
        {m.tempHp > 0 && <span className="gl-hp-temp">临时 +{m.tempHp}</span>}
        {m.hp <= 0 ? <span className="gl-state gl-state-dying">倒地</span>
          : m.bloodied > 0 && m.hp <= m.bloodied ? <span className="gl-state gl-state-bloodied">重伤</span>
          : <span className="gl-state gl-state-ok">健康</span>}
      </div>
      <div className="gl-hp-bar" title={m.bloodied > 0 ? "重伤线 " + m.bloodied : "该怪物没有重伤值"}>
        <div className="gl-hp-fill" style={{ width: hpWidth(m) }} />
        {m.bloodied > 0 && <span className="gl-hp-mark" />}
      </div>

      <div className="gd-act">
        <div className="md3-seg hurt" role="group" aria-label="快捷扣血">
          {QUICK.map((n) => (
            <button key={n} type="button" className="md3-seg-btn" onClick={() => damageMonster(m.uid, n)}>−{n}</button>
          ))}
        </div>
        <div className="md3-seg heal" role="group" aria-label="快捷回血">
          {QUICK.map((n) => (
            <button key={n} type="button" className="md3-seg-btn" onClick={() => healMonster(m.uid, n)}>＋{n}</button>
          ))}
        </div>
        <OutlinedTextField
          className="gl-num-field"
          type="number"
          min="0"
          inputMode="numeric"
          placeholder="数值"
          aria-label="伤害或治疗数值"
          title="直接敲数字就会落在这里，回车即结算"
          value={amount}
          onInput={(e) => setAmount((e.target as unknown as { value: string }).value ?? "")}
          ref={dmgRef}
        />
        <FilledTonalButton className="gl-md-btn danger" disabled={value <= 0} onClick={() => apply("damage")}>伤害</FilledTonalButton>
        <FilledTonalButton className="gl-md-btn" disabled={value <= 0} onClick={() => apply("heal")}>治疗</FilledTonalButton>
      </div>

      <div className="gl-line">
        <span className="gl-line-label">生命值</span>
        <div className="gl-stepper" title="DM 记错数时直接改，也可以 ±1 微调">
          <IconButton className="gl-icon-btn" aria-label="生命值 −1" disabled={m.hp <= 0} onClick={() => setHp(m.uid, m.hp - 1)}>
            <span className="material-symbols-outlined">remove</span>
          </IconButton>
          <input
            className="gl-plain-num"
            type="number"
            min={0}
            max={m.maxHp}
            aria-label="当前生命值"
            value={m.hp}
            onChange={(e) => setHp(m.uid, Math.floor(Number(e.target.value) || 0))}
          />
          <IconButton className="gl-icon-btn" aria-label="生命值 +1" disabled={m.hp >= m.maxHp} onClick={() => setHp(m.uid, m.hp + 1)}>
            <span className="material-symbols-outlined">add</span>
          </IconButton>
        </div>
        <span className="gl-line-label">临时生命值</span>
        <div className="gl-stepper" title="受伤时先扣临时生命值；短休后清零">
          <IconButton className="gl-icon-btn" aria-label="临时生命值 −1" disabled={m.tempHp <= 0} onClick={() => updateMonster(m.uid, { tempHp: Math.max(0, m.tempHp - 1) })}>
            <span className="material-symbols-outlined">remove</span>
          </IconButton>
          <input
            className="gl-plain-num"
            type="number"
            min={0}
            aria-label="临时生命值"
            value={m.tempHp}
            onChange={(e) => updateMonster(m.uid, { tempHp: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          />
          <IconButton className="gl-icon-btn" aria-label="临时生命值 +1" onClick={() => updateMonster(m.uid, { tempHp: m.tempHp + 1 })}>
            <span className="material-symbols-outlined">add</span>
          </IconButton>
        </div>
      </div>

      <div className="gd-conds">
        {m.conditions.map((c) => {
          const desc = CONDITION_DESC[c];
          return (
            <button key={c} type="button" className="gm-pill on" onClick={() => toggleCondition(m.uid, c)}>
              <span className="material-symbols-outlined">check</span>
              {c}
              {/* 悬浮速查：牌桌上「震慑到底能不能动」这种问题不该逼人去翻书 */}
              {desc && <span className="gm-tip" role="tooltip">{desc}<em className="gm-tip-hint">点击取消</em></span>}
            </button>
          );
        })}
        <button type="button" className="gm-pill" aria-haspopup="dialog" onClick={() => setCondOpen(true)}>
          <span className="material-symbols-outlined">add</span>
          状态
        </button>
      </div>

      {condOpen && <ConditionPicker m={m} open onClose={() => setCondOpen(false)} />}
    </>
  );
}
