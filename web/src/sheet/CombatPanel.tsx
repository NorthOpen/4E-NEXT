import { Fragment, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { AbilityKey, AttackRowData, Character, DamageRowData } from "./character";
import { ABILITY_LABELS, ABILITY_KEYS, customSum, emptyCombatMods, emptyCustomBonuses, type CustomBonuses, type CustomEntry } from "./character";
import type { CombatSource } from "./combat-source";
import { Menu, MenuItem, Divider } from "../components/md";
import { CustomBonusEditor } from "../components/CustomBonusEditor";

const ABILITY_OPTIONS = ABILITY_KEYS.map((k) => ({ key: k, zh: ABILITY_LABELS[k].zh }));

// 增强加值来源：0/1 = 主手/副手魔法物品（自动取该槽位的增强加值；无魔法物品则为 0）
const ENHANCE_SOURCES: { slot: number; label: string }[] = [
  { slot: 0, label: "主手" },
  { slot: 1, label: "副手" },
];
const enhanceSlotLabel = (slot: number): string => ENHANCE_SOURCES.find((o) => o.slot === slot)?.label ?? "手动";

const MAX_ROWS = 6;

function fmtMod(n: number): string {
  return n >= 0 ? "+" + n : String(n);
}

function parseNum(v: string, min = -20, max = 50): number {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : Math.max(min, Math.min(max, n));
}

// 攻击面板列头（与 CombatMods.attacks 一一对应）
const ATTACK_HEAD = ["名称", "总加值", "½等级", "属性调整值", "职业加值", "熟练加值", "专长加值", "增强加值", "其他"] as const;
// 伤害面板列头（与 CombatMods.damages 一一对应；原「其他1/其他2」合并为详情右栏自定义列表，合计显示为「其他」）
const DAMAGE_HEAD = ["名称", "总加值", "伤害骰", "属性调整值", "专长加值", "增强加值", "其他"] as const;

// 攻击详情弹窗：双栏结构——左栏逐行展示每对攻击的加值构成（½等级 + 属性调整 + 职业/熟练/专长/增强 + 自定义条目），
// 右栏是「自定义」编辑器（条目合计即面板「其他」），风格仿照「抵御」详情弹窗
function AttackDetailDialog(props: {
  attacks: AttackRowData[];
  mods: Record<AbilityKey, number>;
  halfLevel: number;
  enhanceOf: (slot: number) => number;
  profOf: (slot: number, override: boolean) => number;
  custom: CustomEntry[][];
  onChangeCustom: (i: number, entries: CustomEntry[]) => void;
  onClose: () => void;
}) {
  const { attacks, mods, halfLevel, enhanceOf, profOf, custom, onChangeCustom, onClose } = props;
  type Row = { label: string; value: string; auto?: boolean };
  const blocks: { label: string; value: number; rows: Row[] }[] = attacks.map((r, i) => {
    const ability = r.ability;
    const prof = profOf((r.profSlot ?? 0) >= 0 ? r.profSlot! : 0, !!r.profOverride);
    const enhance = enhanceOf(r.enhanceSlot ?? 0);
    const entries = custom[i] ?? [];
    const otherSum = customSum(entries);
    const rows: Row[] = [];
    if (halfLevel !== 0) rows.push({ label: "½等级", value: "+" + halfLevel, auto: true });
    if (mods[ability] !== 0) rows.push({ label: "属性调整值（" + ABILITY_LABELS[ability].zh + "）", value: fmtMod(mods[ability]), auto: true });
    if (r.classBonus !== 0) rows.push({ label: "职业加值", value: fmtMod(r.classBonus) });
    if (prof !== 0) rows.push({ label: "熟练加值", value: fmtMod(prof), auto: true });
    if (r.feat !== 0) rows.push({ label: "专长加值", value: fmtMod(r.feat) });
    if (enhance !== 0) rows.push({ label: "增强加值", value: fmtMod(enhance), auto: true });
    for (const e of entries) if (e.value !== 0) rows.push({ label: e.label || "其他", value: fmtMod(e.value) });
    const total = halfLevel + mods[ability] + r.classBonus + prof + r.feat + enhance + otherSum;
    return { label: attacks[i]?.label || "攻击 " + (i + 1), value: total, rows };
  });
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog def-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">攻击详情</span>
          <div className="picker-head-btns">
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="def-detail-cols">
          {attacks.map((_, i) => {
            const b = blocks[i];
            return (
              <div key={i} className="def-detail-col">
                <div className="def-detail-block">
                  <div className="def-detail-title">{b.label} <span className="def-detail-total">{fmtMod(b.value)}</span></div>
                  <div className="def-detail-rows">
                    {b.rows.map((row, j) => (
                      <div key={j} className={"def-detail-row" + (row.auto ? " auto" : "")}>
                        <span className="ddr-label">{row.label}</span>
                        <span className="ddr-value">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <CustomBonusEditor
                  title="其他"
                  entries={custom[i] ?? []}
                  onChange={(entries) => onChangeCustom(i, entries)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}

// 伤害详情弹窗：双栏结构——左栏逐行展示每对伤害的加值构成（伤害骰 + 属性调整 + 专长/增强 + 自定义条目），
// 右栏是「自定义」编辑器（条目合计即面板「其他」），风格仿照「抵御」详情弹窗
function DamageDetailDialog(props: {
  damages: DamageRowData[];
  labels: (string | undefined)[];
  mods: Record<AbilityKey, number>;
  diceOf: (slot: number) => string;
  enhanceOf: (slot: number) => number;
  custom: CustomEntry[][];
  onChangeCustom: (i: number, entries: CustomEntry[]) => void;
  onClose: () => void;
}) {
  const { damages, labels, mods, diceOf, enhanceOf, custom, onChangeCustom, onClose } = props;
  type Row = { label: string; value: string; auto?: boolean };
  const blocks: { label: string; value: number; rows: Row[] }[] = damages.map((r, i) => {
    const ability = r.ability;
    const enhance = enhanceOf(r.enhanceSlot ?? 0);
    const dice = diceOf(r.enhanceSlot ?? 0);
    const entries = custom[i] ?? [];
    const otherSum = customSum(entries);
    const rows: Row[] = [];
    if (dice) rows.push({ label: "伤害骰", value: dice, auto: true });
    if (mods[ability] !== 0) rows.push({ label: "属性调整值（" + ABILITY_LABELS[ability].zh + "）", value: fmtMod(mods[ability]), auto: true });
    if (r.feat !== 0) rows.push({ label: "专长加值", value: fmtMod(r.feat) });
    if (enhance !== 0) rows.push({ label: "增强加值", value: fmtMod(enhance), auto: true });
    for (const e of entries) if (e.value !== 0) rows.push({ label: e.label || "其他", value: fmtMod(e.value) });
    const total = mods[ability] + r.feat + enhance + otherSum;
    return { label: labels[i] || "攻击 " + (i + 1), value: total, rows };
  });
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog def-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">伤害详情</span>
          <div className="picker-head-btns">
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="def-detail-cols">
          {damages.map((_, i) => {
            const b = blocks[i];
            return (
              <div key={i} className="def-detail-col">
                <div className="def-detail-block">
                  <div className="def-detail-title">{b.label} <span className="def-detail-total">{fmtMod(b.value)}</span></div>
                  <div className="def-detail-rows">
                    {b.rows.map((row, j) => (
                      <div key={j} className={"def-detail-row" + (row.auto ? " auto" : "")}>
                        <span className="ddr-label">{row.label}</span>
                        <span className="ddr-value">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <CustomBonusEditor
                  title="其他"
                  entries={custom[i] ?? []}
                  onChange={(entries) => onChangeCustom(i, entries)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function CombatPanels(props: {
  /** 渲染哪一块：attack=命中（攻击表）/ damage=伤害（伤害表）。两者共享同一份 combatMods。 */
  part: "attack" | "damage";
  char: Character;
  setChar: Dispatch<SetStateAction<Character>>;
  mods: Record<AbilityKey, number>; // 各属性调整值
  halfLevel: number;               // ½ 等级（自动）
  enhanceOf: (slot: number) => number; // 某装备槽位的增强加值（无魔法物品则 0）
  diceOf: (slot: number) => string;    // 某装备槽位基础武器的伤害骰（无则空串）
  profOf: (slot: number, override: boolean) => number; // 某槽位基础武器的擅长加值（未擅长/无武器则 0；override=true 视为擅长）
  classAttackSources: CombatSource[]; // 职业特性中提及「攻击骰」的条目（职业加值来源）
  featAttackSources: CombatSource[];  // 已选专长中提及「攻击骰」的（攻击面板专长加值来源）
  featDamageSources: CombatSource[];  // 已选专长中提及「伤害骰」的（伤害面板专长加值来源）
  mode: "edit" | "render";
}) {
  const { part, char, setChar, mods, halfLevel, enhanceOf, diceOf, profOf, classAttackSources, featAttackSources, featDamageSources, mode } = props;
  const isAttack = part === "attack";
  // 属性选项：按调整值从高到低排序（并列时保持属性原有顺序）
  const abilityOptions = useMemo(
    () => [...ABILITY_OPTIONS].sort((a, b) => mods[b.key] - mods[a.key]),
    [mods],
  );
  const combat = char.combatMods;
  const attacks = combat.attacks;
  const damages = combat.damages;
  // 当前打开的来源菜单（记录单元格 id，点击单元格后弹出 Material 菜单）
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  // 处于「手动输入」模式的来源单元格 id（此时该单元格显示数字输入框）
  const [manualCell, setManualCell] = useState<string | null>(null);
  // 是否显示骰子指令（攻击/伤害各自独立切换）
  const [showDiceAtk, setShowDiceAtk] = useState(false);
  const [showDiceDmg, setShowDiceDmg] = useState(false);
  // 详情弹窗开关（攻击/伤害各自独立）
  const [atkDetailOpen, setAtkDetailOpen] = useState(false);
  const [dmgDetailOpen, setDmgDetailOpen] = useState(false);
  // 居中提示（复制成功后弹出）
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  // 复制指令到剪贴板（优先 Clipboard API，失败时回退 execCommand）
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast("已复制到剪贴板");
  };

  function setAttack(i: number, patch: Partial<AttackRowData>) {
    setChar((p) => {
      const c = p.combatMods;
      const rows = c.attacks.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      return { ...p, combatMods: { ...c, attacks: rows } };
    });
  }
  function setDamage(i: number, patch: Partial<DamageRowData>) {
    setChar((p) => {
      const c = p.combatMods;
      const rows = c.damages.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      return { ...p, combatMods: { ...c, damages: rows } };
    });
  }
  // 详情弹窗「自定义」列写入：attack/damage 都是「行 → 条目列表」
  function setCustom(fn: (c: CustomBonuses) => CustomBonuses) {
    setChar((p) => ({ ...p, customBonuses: fn(p.customBonuses ?? emptyCustomBonuses()) }));
  }
  const setAttackCustom = (i: number, entries: CustomEntry[]) =>
    setCustom((c) => ({ ...c, attack: c.attack.map((row, idx) => (idx === i ? entries : row)) }));
  const setDamageCustom = (i: number, entries: CustomEntry[]) =>
    setCustom((c) => ({ ...c, damage: c.damage.map((row, idx) => (idx === i ? entries : row)) }));
  // 攻击与伤害成对增减：一次操作同时改两张表，保证「第 N 行攻击」永远对应「第 N 行伤害」
  function addPair() {
    setChar((p) => {
      const c = p.combatMods;
      if (c.attacks.length >= MAX_ROWS) return p;
      const blank = emptyCombatMods();
      return {
        ...p,
        combatMods: {
          attacks: [...c.attacks, { ...blank.attacks[0] }],
          damages: [...c.damages, { ...blank.damages[0] }],
        },
      };
    });
  }
  function removePair() {
    setChar((p) => {
      const c = p.combatMods;
      if (c.attacks.length <= 1) return p;
      return { ...p, combatMods: { attacks: c.attacks.slice(0, -1), damages: c.damages.slice(0, -1) } };
    });
  }
  // 名称按对存储（写在攻击行上），两张表任意一边编辑都改同一份
  function setPairLabel(i: number, label: string) {
    setChar((p) => {
      const c = p.combatMods;
      return { ...p, combatMods: { ...c, attacks: c.attacks.map((r, idx) => (idx === i ? { ...r, label } : r)) } };
    });
  }
  const labelCell = (i: number, key: string) => {
    const label = attacks[i]?.label ?? "";
    if (mode === "render") {
      return <div className="ct-cell ct-label-cell" key={key}><span className="ct-label-text">{label || "攻击 " + (i + 1)}</span></div>;
    }
    return (
      <div className="ct-cell ct-label-cell" key={key}>
        <input
          className="ct-label-input"
          value={label}
          placeholder={"攻击 " + (i + 1)}
          maxLength={12}
          title="给这一对攻击/伤害起个名字，便于分辨它服务于哪件武器或哪个威能"
          onChange={(e) => setPairLabel(i, e.target.value)}
        />
      </div>
    );
  };

  // 属性调整值单元格：单框内显示属性名 + 自动数值，点击单元格弹出 Material 菜单（选项为"中文 + 对应调整值"）
  const abilityCell = (ability: AbilityKey, onChange: (k: AbilityKey) => void, uid: string) => {
    const pickable = mode === "edit";
    return (
      <div className="ct-cell ct-pick" id={uid} onClick={() => pickable && setActiveMenu(uid)}>
        <span className="ct-ability-name">{ABILITY_LABELS[ability].zh}</span>
        <span className="ct-auto">{fmtMod(mods[ability])}</span>
        {pickable && (
          <Menu anchor={uid} positioning="popover" quick open={activeMenu === uid} onClosed={() => setActiveMenu(null)}>
            {abilityOptions.map((o) => (
              <MenuItem key={o.key} onClick={() => { onChange(o.key); setActiveMenu(null); }}>
                <span slot="headline">{o.zh}</span>
                <span slot="supporting-text">{fmtMod(mods[o.key])}</span>
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>
    );
  };

  // 增强加值单元格：单框内显示来源名 + 自动数值（取所选装备槽位的增强加值），点击单元格弹出 Material 菜单选择来源
  const enhanceCell = (slot: number | undefined, onSlot: (s: number) => void, uid: string) => {
    const s = (slot ?? 0) >= 0 ? slot! : 0; // 缺省按主手处理
    const pickable = mode === "edit";
    return (
      <div className="ct-cell ct-pick" id={uid} onClick={() => pickable && setActiveMenu(uid)}>
        <span className="ct-ability-name">{enhanceSlotLabel(s)}</span>
        <span className="ct-auto" title="由所选装备的增强加值自动计算">{fmtMod(enhanceOf(s))}</span>
        {pickable && (
          <Menu anchor={uid} positioning="popover" quick open={activeMenu === uid} onClosed={() => setActiveMenu(null)}>
            {ENHANCE_SOURCES.map((o) => (
              <MenuItem key={o.slot} onClick={() => { onSlot(o.slot); setActiveMenu(null); }}>
                <span slot="headline">{o.label}</span>
                <span slot="supporting-text">{fmtMod(enhanceOf(o.slot))}</span>
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>
    );
  };

  // 熟练加值单元格：来源（主手/副手）自动取该槽位基础武器的擅长加值（未擅长则 0），点击单元格弹出菜单；
  // 菜单内可切换来源，并提供「视为擅长」手动覆盖（用于选择型专长等无法自动判定的情况）
  const profCell = (slot: number | undefined, override: boolean | undefined, onSlot: (s: number) => void, onToggleOverride: (v: boolean) => void, uid: string) => {
    const s = (slot ?? 0) >= 0 ? slot! : 0;
    const ov = !!override;
    const pickable = mode === "edit";
    return (
      <div className="ct-cell ct-pick" id={uid} onClick={() => pickable && setActiveMenu(uid)} title={profOf(s, false) > 0 ? "已擅长该武器，熟练加值自动计算" : "未擅长该武器（可在菜单中「视为擅长」手动覆盖）"}>
        <span className="ct-ability-name">{enhanceSlotLabel(s)}</span>
        <span className="ct-auto" title={ov ? "已手动视为擅长" : undefined}>{fmtMod(profOf(s, ov))}</span>
        {pickable && (
          <Menu anchor={uid} positioning="popover" quick open={activeMenu === uid} onClosed={() => setActiveMenu(null)}>
            {ENHANCE_SOURCES.map((o) => (
              <MenuItem key={o.slot} onClick={() => { onSlot(o.slot); setActiveMenu(null); }}>
                <span slot="headline">{o.label}</span>
                <span slot="supporting-text">{fmtMod(profOf(o.slot, ov))}</span>
              </MenuItem>
            ))}
            <Divider />
            <MenuItem onClick={() => { onToggleOverride(!ov); setActiveMenu(null); }}>
              <span slot="headline">视为擅长</span>
              {ov && <span slot="start" className="material-symbols-outlined">check</span>}
            </MenuItem>
          </Menu>
        )}
      </div>
    );
  };

  // 「其他」单元格：只读显示详情右栏自定义列合计，点击展开详情弹窗编辑
  const otherCell = (v: number, onClick: () => void, key: string) => (
    <div className="ct-cell" key={key}>
      <button type="button" className="ct-other-link" onClick={onClick} title="点击展开详情，在右栏编辑自定义加值">
        其他 {fmtMod(v)}
      </button>
    </div>
  );

  // 来源单元格（职业加值/专长加值）：点击弹出菜单列出可选来源（职业特性/已选专长），点选填入数值；
  // 菜单底部提供「归零」与「手动输入」（进入输入框）兜底
  const sourceCell = (v: number, onChange: (n: number) => void, sources: CombatSource[], uid: string, hint: string) => {
    const pickable = mode === "edit";
    if (manualCell === uid && pickable) {
      return (
        <div className="ct-cell" key="manual">
          <input type="number" min={-20} max={50} value={v} autoFocus onChange={(e) => onChange(parseNum(e.target.value))} onBlur={() => setManualCell(null)} />
        </div>
      );
    }
    return (
      <div className="ct-cell ct-pick" id={uid} onClick={() => pickable && setActiveMenu(uid)} title={hint}>
        <span className="ct-auto">{fmtMod(v)}</span>
        {pickable && (
          <Menu anchor={uid} positioning="popover" quick open={activeMenu === uid} onClosed={() => setActiveMenu(null)}>
            {sources.length === 0 ? (
              <MenuItem disabled>
                <span slot="headline">无可选来源</span>
                <span slot="supporting-text">未找到相关特性/专长</span>
              </MenuItem>
            ) : (
              sources.map((s) => (
                <MenuItem key={s.label} title={s.text} onClick={() => { onChange(s.value); setActiveMenu(null); }}>
                  <span slot="headline">{s.label}</span>
                  <span slot="supporting-text">{fmtMod(s.value)}</span>
                </MenuItem>
              ))
            )}
            <Divider />
            <MenuItem onClick={() => { onChange(0); setActiveMenu(null); }}>
              <span slot="headline">归零</span>
            </MenuItem>
            <MenuItem onClick={() => { setManualCell(uid); setActiveMenu(null); }}>
              <span slot="headline">手动输入</span>
            </MenuItem>
          </Menu>
        )}
      </div>
    );
  };

  // 伤害骰单元格：只读显示，自动取自所选槽位（主手/副手）基础武器的伤害骰
  const diceCell = (slot: number | undefined, key: string) => {
    const dice = diceOf((slot ?? 0) >= 0 ? slot! : 0);
    return (
      <div className="ct-cell" key={key} title="伤害骰由所选槽位基础武器的伤害骰自动获取">
        <span className="ct-auto">{dice || "—"}</span>
      </div>
    );
  };

  return (
    <>
      <section className="block">
        <div className="block-head">
          <h3 className="block-title">{isAttack ? "命中" : "伤害"}</h3>
          <span className="block-head-actions">
            {mode === "edit" && (
              <span className="combat-actions">
                <button type="button" className="sg-step" title="移除最后一对（攻击与伤害同时减少）" disabled={attacks.length <= 1} onClick={removePair}>−</button>
                <button type="button" className="sg-step" title="新增一对（攻击与伤害同时增加）" disabled={attacks.length >= MAX_ROWS} onClick={addPair}>+</button>
              </span>
            )}
            <button type="button" className="def-detail-btn" onClick={() => (isAttack ? setAtkDetailOpen(true) : setDmgDetailOpen(true))} title={isAttack ? "查看每对攻击加值的构成" : "查看每对伤害加值的构成"}>查看详情</button>
            <button type="button" className={"mode-chip" + (isAttack ? (showDiceAtk ? " active" : "") : (showDiceDmg ? " active" : ""))} onClick={() => (isAttack ? setShowDiceAtk((v) => !v) : setShowDiceDmg((v) => !v))} title="在每个栏位下方显示可复制的骰子指令">
              <span className="material-symbols-outlined mode-chip-ic">casino</span>
              显示骰子指令
            </button>
          </span>
        </div>
        {isAttack ? (
          <div className="combat-table attack">
            <div className="ct-head">{ATTACK_HEAD.map((h) => <span key={h}>{h}</span>)}</div>
            {attacks.map((row, i) => {
              const enhance = enhanceOf(row.enhanceSlot ?? 0);
              const prof = profOf((row.profSlot ?? 0) >= 0 ? row.profSlot! : 0, !!row.profOverride);
              const otherSum = customSum(char.customBonuses?.attack?.[i]);
              const total = halfLevel + mods[row.ability] + row.classBonus + prof + row.feat + enhance + otherSum;
              return (
                <Fragment key={i}>
                  <div className="ct-row">
                    {labelCell(i, "label")}
                    <div className="ct-cell ct-total-cell" key="total"><span className="ct-total">{fmtMod(total)}</span></div>
                    <div className="ct-cell" key="half"><span className="ct-auto">{halfLevel}</span></div>
                    {abilityCell(row.ability, (k) => setAttack(i, { ability: k }), `ct-ab-a-${i}`)}
                    {sourceCell(row.classBonus, (n) => setAttack(i, { classBonus: n }), classAttackSources, `ct-cl-a-${i}`, "点击选择职业特性中提及攻击骰的加值来源")}
                    {profCell(row.profSlot, row.profOverride, (s) => setAttack(i, { profSlot: s }), (v) => setAttack(i, { profOverride: v }), `ct-pr-a-${i}`)}
                    {sourceCell(row.feat, (n) => setAttack(i, { feat: n }), featAttackSources, `ct-fe-a-${i}`, "点击选择已选专长中提及攻击骰的加值来源")}
                    {enhanceCell(row.enhanceSlot, (s) => setAttack(i, { enhanceSlot: s }), `ct-en-a-${i}`)}
                    {otherCell(otherSum, () => setAtkDetailOpen(true), "other")}
                  </div>
                  {showDiceAtk && (
                    <div className="ct-dice-row" onClick={() => copyText(`.r d20${fmtMod(total)}`)} title="点击复制指令">
                      <span>{(attacks[i]?.label || "攻击 " + (i + 1)) + " 命中指令："}</span>
                      <code>{`.r d20${fmtMod(total)}`}</code>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        ) : (
          <div className="combat-table damage">
            <div className="ct-head">{DAMAGE_HEAD.map((h) => <span key={h}>{h}</span>)}</div>
            {damages.map((row, i) => {
              const enhance = enhanceOf(row.enhanceSlot ?? 0);
              const otherSum = customSum(char.customBonuses?.damage?.[i]);
              const total = mods[row.ability] + row.feat + enhance + otherSum;
              const dice = diceOf((row.enhanceSlot ?? 0) >= 0 ? row.enhanceSlot! : 0);
              return (
                <Fragment key={i}>
                  <div className="ct-row">
                    {labelCell(i, "label")}
                    <div className="ct-cell ct-total-cell" key="total"><span className="ct-total">{fmtMod(total)}</span></div>
                    {diceCell(row.enhanceSlot, "dice")}
                    {abilityCell(row.ability, (k) => setDamage(i, { ability: k }), `ct-ab-d-${i}`)}
                    {sourceCell(row.feat, (n) => setDamage(i, { feat: n }), featDamageSources, `ct-fe-d-${i}`, "点击选择已选专长中提及伤害骰的加值来源")}
                    {enhanceCell(row.enhanceSlot, (s) => setDamage(i, { enhanceSlot: s }), `ct-en-d-${i}`)}
                    {otherCell(otherSum, () => setDmgDetailOpen(true), "other")}
                  </div>
                  {showDiceDmg && (
                    <div className="ct-dice-row" onClick={() => copyText(`.r ${dice || "?"}${fmtMod(total)}`)} title="点击复制指令">
                      <span>{(attacks[i]?.label || "攻击 " + (i + 1)) + " 伤害指令："}</span>
                      <code>{`.r ${dice || "?"}${fmtMod(total)}`}</code>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
      </section>

      {toast && (
        <div className="ct-toast" role="status">
          <span className="material-symbols-outlined">check_circle</span>
          {toast}
        </div>
      )}
      {isAttack && atkDetailOpen && (
        <AttackDetailDialog
          attacks={attacks}
          mods={mods}
          halfLevel={halfLevel}
          enhanceOf={enhanceOf}
          profOf={profOf}
          custom={char.customBonuses?.attack ?? []}
          onChangeCustom={setAttackCustom}
          onClose={() => setAtkDetailOpen(false)}
        />
      )}
      {!isAttack && dmgDetailOpen && (
        <DamageDetailDialog
          damages={damages}
          labels={attacks.map((r) => r.label)}
          mods={mods}
          diceOf={diceOf}
          enhanceOf={enhanceOf}
          custom={char.customBonuses?.damage ?? []}
          onChangeCustom={setDamageCustom}
          onClose={() => setDmgDetailOpen(false)}
        />
      )}
    </>
  );
}