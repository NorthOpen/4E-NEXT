// 速览页：把人物卡里「打一场需要不停变动」的数字集中到一整块面板里。
// 版式上不再是一堆独立卡片，而是一块完整的 MD3 surface（顶部状态条 + 分隔线网格分区），
// 上半区数值追踪（生命 / 攻击伤害 / 防御 / 属性），下半区资源追踪（威能 / 专长 / 装备）。
// 所有改动直接写回人物卡，与人物页实时同步。
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { emptyGlance, type Character, type PowerSlots } from "./sheet/character";
import { safeSetItem } from "./lib/storage";
import { hybridPowerPoints, psionicPowerPoints } from "./sheet/powerpoints";
import SheetDialog from "./components/SheetDialog";
import { FilledButton, TextButton } from "./components/md";
import { useGlance } from "./overview/derive";
import GlanceVitals from "./overview/GlanceVitals";
import { GlanceAbilities, GlanceAttacks, GlanceDefenses, type RollAct } from "./overview/GlanceCombat";
import { rollExpr, fmtSigned, type RollResult } from "./overview/dice";
import { GlanceFeats, GlanceItems, GlancePowers, featUsageTag } from "./overview/GlanceResources";
import { GlanceCounter, GlanceToast, copyText, useToast } from "./overview/ui";

interface Props {
  layout: "single" | "double";
  char: Character;
  setChar: Dispatch<SetStateAction<Character>>;
}

const POWER_CATS: (keyof PowerSlots)[] = ["atWill", "encounter", "daily", "utility", "special"];

export default function OverviewView({ layout, char, setChar }: Props) {
  const d = useGlance(char);
  const { toast, show } = useToast();
  const [rest, setRest] = useState<null | "short" | "long">(null);
  const [restSurges, setRestSurges] = useState(0);
  // 点数字时是直接掷骰还是复制骰子指令（记住上次选择）
  const [rollMode, setRollMode] = useState<"roll" | "cmd">(() => (localStorage.getItem("4enext-glance-roll") === "cmd" ? "cmd" : "roll"));
  const [roll, setRoll] = useState<RollResult | null>(null);

  function switchMode(m: "roll" | "cmd") {
    setRollMode(m);
    safeSetItem("4enext-glance-roll", m);
  }
  const act: RollAct = {
    mode: rollMode,
    run: (label, expr) => {
      if (!expr) {
        show("该行没有基础武器，先在人物页装备武器");
        return;
      }
      if (rollMode === "cmd") void copyText(".r " + expr, show);
      else setRoll(rollExpr(expr, label));
    },
  };

  const hpCur = char.hpNow?.max ?? d.maxHp;
  const surgesCur = char.hpNow?.surges ?? d.surges;

  // 灵能点上限：混职灵能强化优先，其次灵能职业阶梯表；都没有则该职业不吃灵能点
  const ppMax = useMemo(
    () =>
      hybridPowerPoints(char, (id) => d.classMap.get(id), (id) => d.powerMap.get(id)) ??
      psionicPowerPoints(char.classId, char.level),
    [char, d.classMap, d.powerMap]
  );
  const showPp = ppMax !== undefined || (char.powerPoints ?? 0) > 0;

  const openShortRest = () => {
    setRestSurges(0);
    setRest("short");
  };

  // 短休：恢复遭遇威能与「每次遭遇」专长、回气可再用、临时效果与临时生命值结束，可顺便花掉若干回复力
  function doShortRest() {
    const spend = Math.max(0, Math.min(surgesCur, restSurges));
    setChar((p) => {
      const powerUsed = { ...(p.powerUsed ?? {}) };
      for (const key of Object.keys(powerUsed)) {
        const dash = key.lastIndexOf("-");
        const cat = key.slice(0, dash) as keyof PowerSlots;
        const idx = Number(key.slice(dash + 1));
        if (!POWER_CATS.includes(cat)) continue;
        const id = p.powerSlots[cat]?.[idx];
        const usage = id ? d.powerMap.get(id)?.usage : undefined;
        // 遭遇威能槽位、或槽位里放着的是遭遇频率威能 → 短休后恢复
        if (cat === "encounter" || usage === "encounter") delete powerUsed[key];
      }
      const featUsed = { ...(p.featUsed ?? {}) };
      for (const key of Object.keys(featUsed)) {
        const id = key.startsWith("g-") ? key.slice(2) : p.featSlots[Number(key)];
        if (featUsageTag(d.featMap.get(id ?? "")) === "encounter") delete featUsed[key];
      }
      const healed = spend > 0 ? Math.min(d.maxHp, Math.max(0, p.hpNow?.max ?? d.maxHp) + spend * d.surgeValue) : undefined;
      return {
        ...p,
        powerUsed,
        featUsed,
        tempHp: 0, // 临时生命值在休整时失效
        hpNow: {
          ...(p.hpNow ?? {}),
          ...(spend > 0 ? { surges: surgesCur - spend, max: healed } : {}),
        },
        glance: { ...p.glance, secondWind: false, atkTemp: 0, dmgTemp: 0, defTemp: { ac: 0, fort: 0, ref: 0, will: 0 }, surgeTemp: 0, deathFails: 0 },
      };
    });
    setRest(null);
    show(spend > 0 ? "短休完成，使用了 " + spend + " 次回复力" : "短休完成");
  }

  // 长休：生命值与回复力回满、全部威能/专长/物品标记清空、行动点与里程碑复位、灵能点回满
  function doLongRest() {
    setChar((p) => {
      const pp = hybridPowerPoints(p, (id) => d.classMap.get(id), (id) => d.powerMap.get(id)) ?? psionicPowerPoints(p.classId, p.level);
      const hpNow = { ...(p.hpNow ?? {}) };
      delete hpNow.max;    // 不再覆盖：显示回自动上限
      delete hpNow.surges;
      return {
        ...p,
        hpNow,
        tempHp: 0,
        powerUsed: {},
        equipmentUsed: {},
        featUsed: {},
        actionPoints: 1,
        milestones: 0,
        powerPoints: pp ?? p.powerPoints,
        glance: emptyGlance(),
      };
    });
    setRest(null);
    show("长休完成，全部资源已恢复");
  }

  const restPreviewHp = Math.min(d.maxHp, Math.max(0, hpCur) + restSurges * d.surgeValue);

  if (!d.ready) {
    return (
      <div className="glance">
        <div className="gl-shell">
          <div className="gl-loading">
            <span className="material-symbols-outlined gl-loading-ic">hourglass_top</span>
            正在读取词条数据，速览数值稍后显示…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={"glance" + (layout === "double" ? " double" : "")}>
      <div className="gl-shell">
        <header className="gl-bar">
          <div className="gl-bar-id">
            {/* 身份与常查数值连成一行：名字 · 等级/种族/职业 · 先攻 / 被动侦查 / 被动洞察 / 移动力 */}
            <span className="gl-bar-line">
              <span className="gl-bar-name">{char.name || "未命名角色"}</span>
              <span className="gl-bar-sub">
                Lv{char.level}
                {d.raceName ? " · " + d.raceName : ""}
                {d.className ? " · " + d.className : ""}
              </span>
              <button
                type="button"
                className="gl-qs"
                title={rollMode === "cmd" ? "点击复制先攻指令" : "点击掷先攻"}
                onClick={() => act.run("先攻", "d20" + fmtSigned(d.initiative))}
              >
                <span className="gl-qs-label">先攻</span>
                <span className="gl-qs-val">{fmtSigned(d.initiative)}</span>
              </button>
              <span className="gl-qs static" title="被动侦查 = 10 + 侦查技能加值">
                <span className="gl-qs-label">被动侦查</span>
                <span className="gl-qs-val">{d.passivePerception}</span>
              </span>
              <span className="gl-qs static" title="被动洞察 = 10 + 洞察技能加值">
                <span className="gl-qs-label">被动洞察</span>
                <span className="gl-qs-val">{d.passiveInsight}</span>
              </span>
              <span className="gl-qs static" title="移动力（种族基础速度 + 各类加值 − 重甲减值）">
                <span className="gl-qs-label">移动</span>
                <span className="gl-qs-val">{d.speedText}</span>
              </span>
            </span>
          </div>
          <div className="gl-bar-res">
            <GlanceCounter
              label="行动点"
              value={char.actionPoints}
              title="每次遭遇可用一点；长休后回到 1 点"
              onDec={() => setChar((p) => ({ ...p, actionPoints: Math.max(0, p.actionPoints - 1) }))}
              onInc={() => setChar((p) => ({ ...p, actionPoints: Math.min(5, p.actionPoints + 1) }))}
            />
            <GlanceCounter
              label="里程碑"
              value={char.milestones ?? 0}
              title="每达成一个里程碑，获得 1 点行动点，并多一次魔法物品每日威能"
              onDec={() => setChar((p) => ({ ...p, milestones: Math.max(0, (p.milestones ?? 0) - 1), actionPoints: Math.max(0, p.actionPoints - 1) }))}
              onInc={() => setChar((p) => ({ ...p, milestones: Math.min(99, (p.milestones ?? 0) + 1), actionPoints: Math.min(5, p.actionPoints + 1) }))}
            />
            {showPp && (
              <GlanceCounter
                label="灵能点"
                value={char.powerPoints ?? 0}
                title={ppMax !== undefined ? "长休后回到 " + ppMax + " 点" : "灵能点"}
                onDec={() => setChar((p) => ({ ...p, powerPoints: Math.max(0, (p.powerPoints ?? 0) - 1) }))}
                onInc={() => setChar((p) => ({ ...p, powerPoints: Math.min(99, (p.powerPoints ?? 0) + 1) }))}
              />
            )}
          </div>
          <div className="gl-bar-rest">
            <button type="button" className="gl-rest-btn" onClick={openShortRest} title="恢复遭遇威能与回气，可花费回复力回血">
              <span className="material-symbols-outlined">bedtime</span>短休
            </button>
            <button type="button" className="gl-rest-btn strong" onClick={() => setRest("long")} title="恢复全部生命、回复力、威能与物品">
              <span className="material-symbols-outlined">hotel</span>长休
            </button>
          </div>
        </header>

        {!char.classId && (
          <div className="gl-warn">
            <span className="material-symbols-outlined">info</span>
            人物页还没有选择职业，生命值、回复力与防御暂时按 0 起始值计算。
          </div>
        )}

        <div className="gl-body">
          <div className="gl-sub">
            <span className="material-symbols-outlined">monitoring</span>数值追踪
            <div className="md3-seg gl-mode" role="group" aria-label="点击数值时的行为">
              <button type="button" className={"md3-seg-btn" + (rollMode === "roll" ? " on" : "")} aria-pressed={rollMode === "roll"} title="点击数值直接掷骰并显示结果" onClick={() => switchMode("roll")}>
                <span className="material-symbols-outlined">casino</span>掷骰
              </button>
              <button type="button" className={"md3-seg-btn" + (rollMode === "cmd" ? " on" : "")} aria-pressed={rollMode === "cmd"} title="点击数值复制骰子指令到剪贴板" onClick={() => switchMode("cmd")}>
                <span className="material-symbols-outlined">content_copy</span>指令
              </button>
            </div>
          </div>
          <GlanceVitals char={char} setChar={setChar} d={d} />
          <GlanceDefenses char={char} setChar={setChar} d={d} />
          <GlanceAttacks char={char} setChar={setChar} d={d} act={act} />
          <GlanceAbilities d={d} act={act} />

          <div className="gl-sub">
            <span className="material-symbols-outlined">inventory</span>资源追踪
            <span className="gl-sub-hint">点击切换使用状态</span>
          </div>
          <GlancePowers char={char} setChar={setChar} d={d} />
          <div className="gl-col z-side">
            <GlanceFeats char={char} setChar={setChar} d={d} />
            <GlanceItems char={char} setChar={setChar} d={d} />
          </div>
        </div>
      </div>

      {rest === "short" && createPortal((
        <SheetDialog
          open
          headline="短休"
          sub="5 分钟"
          onClose={() => setRest(null)}
          actions={<FilledButton onClick={doShortRest}>确认短休</FilledButton>}
        >
          <p className="hint">短休会恢复遭遇资源，并结束临时效果：</p>
          <ul className="gl-rest-list">
            <li>恢复全部遭遇威能与标记为「遭遇」的专长</li>
            <li>回气重新可用</li>
            <li>临时生命值与本页的临时加值清零</li>
            <li>每日威能、回复力次数不会恢复</li>
          </ul>
          <div className="gl-rest-surge">
            <span className="gl-line-label">顺便使用回复力</span>
            <GlanceCounter
              label="次数"
              value={restSurges}
              onDec={() => setRestSurges((n) => Math.max(0, n - 1))}
              onInc={() => setRestSurges((n) => Math.min(surgesCur, n + 1))}
            />
            <span className="gl-line-hint">
              {restSurges > 0
                ? "生命 " + hpCur + " → " + restPreviewHp + "，回复力 " + surgesCur + " → " + (surgesCur - restSurges)
                : "当前生命 " + hpCur + " / " + d.maxHp + "，剩余回复力 " + surgesCur}
            </span>
          </div>
        </SheetDialog>
      ), document.body)}

      {rest === "long" && createPortal((
        <SheetDialog
          open
          headline="长休"
          sub="6 小时"
          onClose={() => setRest(null)}
          actions={
            <>
              <TextButton onClick={() => setRest(null)}>取消</TextButton>
              <FilledButton onClick={doLongRest}>确认长休</FilledButton>
            </>
          }
        >
          <p className="hint">长休会把这张卡的消耗类资源全部恢复到满值：</p>
          <ul className="gl-rest-list">
            <li>生命值回到 {d.maxHp}，回复力回到 {d.surges} 次，临时生命值清零</li>
            <li>全部威能、专长、魔法物品的「已使用」标记清空</li>
            <li>行动点回到 1，里程碑清零{ppMax !== undefined ? "，灵能点回到 " + ppMax + " 点" : ""}</li>
            <li>本页的临时加值、回气与死亡豁免记录清零</li>
          </ul>
          <p className="hint">人物页上的选择（威能、专长、装备本身）不会被改动。</p>
        </SheetDialog>
      ), document.body)}

      {roll && createPortal((
        <SheetDialog
          open
          headline={roll.label}
          sub={roll.expr}
          onClose={() => setRoll(null)}
          actions={<FilledButton onClick={() => setRoll(rollExpr(roll.expr, roll.label))}>再掷一次</FilledButton>}
        >
          <div className="gl-roll">
            <div className={"gl-roll-total" + (roll.crit === "high" ? " crit-high" : roll.crit === "low" ? " crit-low" : "")}>{roll.total}</div>
            <div className="gl-roll-dice">
              {roll.rolls.map((v, i) => (
                <span key={i} className={"gl-die" + (roll.faces === 20 && v === 20 ? " high" : roll.faces === 20 && v === 1 ? " low" : "")}>{v}</span>
              ))}
              {roll.modifier !== 0 && <span className="gl-die-mod">{fmtSigned(roll.modifier)}</span>}
            </div>
            <div className="gl-roll-detail">
              {roll.rolls.join(" + ")}
              {roll.modifier !== 0 ? " " + fmtSigned(roll.modifier) : ""} = {roll.total}
            </div>
            {roll.crit === "high" && <div className="gl-roll-crit high">自然 20</div>}
            {roll.crit === "low" && <div className="gl-roll-crit low">自然 1</div>}
          </div>
        </SheetDialog>
      ), document.body)}

      {createPortal(<GlanceToast text={toast} />, document.body)}
    </div>
  );
}