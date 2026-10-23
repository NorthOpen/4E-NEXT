// 速览页「生命」分区：当前生命值 / 临时生命值 / 回复力 / 回气 / 死亡豁免。
// 全部写回人物页同一份字段（hpNow / tempHp / glance），两页数字实时一致。
import { useState, type Dispatch, type SetStateAction } from "react";
import type { Character } from "../sheet/character";
import type { GlanceData } from "./derive";
import { FilledButton, FilledTonalButton, IconButton, OutlinedTextField } from "../components/md";
import { GlancePips, GlanceZone, fmtMod } from "./ui";

interface Props {
  char: Character;
  setChar: Dispatch<SetStateAction<Character>>;
  d: GlanceData;
}

const QUICK = [1, 5, 10];

export default function GlanceVitals({ char, setChar, d }: Props) {
  const [amount, setAmount] = useState("");

  const hpCur = char.hpNow?.max ?? d.maxHp;
  const temp = char.tempHp ?? 0;
  const surgesCur = char.hpNow?.surges ?? d.surges;
  const surgeTemp = char.glance.surgeTemp;
  const healPerSurge = Math.max(0, d.surgeValue + surgeTemp);
  const dying = hpCur <= 0;
  const bloodied = !dying && hpCur <= d.bloodied;
  const state = dying ? "濒死" : bloodied ? "重伤" : "健康";
  const pct = Math.max(0, Math.min(100, d.maxHp > 0 ? (hpCur / d.maxHp) * 100 : 0));
  const tempPct = Math.max(0, Math.min(100 - pct, d.maxHp > 0 ? (temp / d.maxHp) * 100 : 0));

  // 受到伤害：先扣临时生命值，再扣生命值（4E 规则）；生命值可为负，最低到 −生命上限
  function hurt(n: number) {
    if (n <= 0) return;
    setChar((p) => {
      const t = p.tempHp ?? 0;
      const absorbed = Math.min(t, n);
      const cur = p.hpNow?.max ?? d.maxHp;
      return {
        ...p,
        tempHp: t - absorbed,
        hpNow: { ...(p.hpNow ?? {}), max: Math.max(-d.maxHp, cur - (n - absorbed)) },
      };
    });
  }

  // 治疗：生命值为负时先归零再加（4E 规则），并清空死亡豁免失败记录
  function heal(n: number) {
    if (n <= 0) return;
    setChar((p) => {
      const cur = p.hpNow?.max ?? d.maxHp;
      const next = Math.min(d.maxHp, Math.max(0, cur) + n);
      return {
        ...p,
        hpNow: { ...(p.hpNow ?? {}), max: next },
        glance: { ...p.glance, deathFails: next > 0 ? 0 : p.glance.deathFails },
      };
    });
  }

  // 使用一次回复力：回复力 −1，生命值 +（回复值 + 临时回复值）；回气额外记一次「本次遭遇已用」
  function spendSurge(secondWind: boolean) {
    setChar((p) => {
      const cur = p.hpNow?.surges ?? d.surges;
      if (cur <= 0) return p;
      const hp = p.hpNow?.max ?? d.maxHp;
      const next = Math.min(d.maxHp, Math.max(0, hp) + Math.max(0, d.surgeValue + p.glance.surgeTemp));
      return {
        ...p,
        hpNow: { ...(p.hpNow ?? {}), surges: cur - 1, max: next },
        glance: {
          ...p.glance,
          deathFails: 0,
          secondWind: secondWind ? true : p.glance.secondWind,
          // 回气：在你下回合开始前所有防御 +2，四项临时加值各自 +2
          defTemp: secondWind
            ? {
                ac: p.glance.defTemp.ac + 2,
                fort: p.glance.defTemp.fort + 2,
                ref: p.glance.defTemp.ref + 2,
                will: p.glance.defTemp.will + 2,
              }
            : p.glance.defTemp,
        },
      };
    });
  }

  const custom = Math.max(0, Math.floor(Number(amount) || 0));

  return (
    <GlanceZone
      label="生命"
      className={"z-vit" + (dying ? " is-dying" : bloodied ? " is-bloodied" : "")}
      meta={<span className={"gl-state gl-state-" + (dying ? "dying" : bloodied ? "bloodied" : "ok")}>{state}</span>}
    >
      <div className="gl-hp-num">
        <span className="gl-hp-cur">{hpCur}</span>
        <span className="gl-hp-max">/ {d.maxHp}</span>
        {temp > 0 && <span className="gl-hp-temp">临时 +{temp}</span>}
        <FilledTonalButton
          className="gl-md-btn gl-hp-sw"
          disabled={surgesCur <= 0 || char.glance.secondWind}
          title={char.glance.secondWind ? "本次遭遇已用过回气，短休后恢复" : "消耗一次回复力：回血并在下回合开始前获得 +2 全防御"}
          onClick={() => spendSurge(true)}
        >
          {char.glance.secondWind ? "回气（已用）" : "回气"}
        </FilledTonalButton>
      </div>
      <div className="gl-hp-bar" title={"重伤线 " + d.bloodied}>
        <div className="gl-hp-fill" style={{ width: pct + "%" }} />
        {tempPct > 0 && <div className="gl-hp-tempfill" style={{ width: tempPct + "%" }} />}
        <span className="gl-hp-mark" />
      </div>

      <div className="gl-hp-pad">
        <div className="md3-seg hurt" role="group" aria-label="快捷扣血">
          {QUICK.map((n) => (
            <button key={n} type="button" className="md3-seg-btn" onClick={() => hurt(n)}>−{n}</button>
          ))}
        </div>
        <div className="md3-seg heal" role="group" aria-label="快捷回血">
          {QUICK.map((n) => (
            <button key={n} type="button" className="md3-seg-btn" onClick={() => heal(n)}>＋{n}</button>
          ))}
        </div>
        <OutlinedTextField
          className="gl-num-field"
          type="number"
          min="0"
          inputMode="numeric"
          placeholder="数值"
          aria-label="自定义生命值增减"
          value={amount}
          onInput={(e) => setAmount((e.target as HTMLInputElement).value ?? "")}
        />
        <FilledTonalButton className="gl-md-btn danger" disabled={custom <= 0} onClick={() => { hurt(custom); setAmount(""); }}>受伤</FilledTonalButton>
        <FilledTonalButton className="gl-md-btn" disabled={custom <= 0} onClick={() => { heal(custom); setAmount(""); }}>治疗</FilledTonalButton>
      </div>

<div className="gl-line">
        <span className="gl-line-label">临时生命值</span>
        <div className="gl-stepper" title="受伤时先扣临时生命值；休整后清零">
          <IconButton className="gl-icon-btn" aria-label="临时生命值 −1" disabled={temp <= 0} onClick={() => setChar((p) => ({ ...p, tempHp: Math.max(0, (p.tempHp ?? 0) - 1) }))}>
            <span className="material-symbols-outlined">remove</span>
          </IconButton>
          <input
            className="gl-plain-num"
            type="number"
            min={0}
            aria-label="临时生命值"
            value={temp}
            onChange={(e) => setChar((p) => ({ ...p, tempHp: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
          />
          <IconButton className="gl-icon-btn" aria-label="临时生命值 +1" onClick={() => setChar((p) => ({ ...p, tempHp: Math.max(0, (p.tempHp ?? 0) + 1) }))}>
            <span className="material-symbols-outlined">add</span>
          </IconButton>
        </div>
      </div>

      <div className="gl-line">
        <span className="gl-line-label">回复力</span>
        <span className="gl-surge-num"><b>{surgesCur}</b> / {d.surges}</span>
        <GlancePips total={d.surges} filled={surgesCur} label="回复力" onPick={(n) => setChar((p) => ({ ...p, hpNow: { ...(p.hpNow ?? {}), surges: Math.max(0, Math.min(d.surges, n)) } }))} />
        <FilledButton className="gl-md-btn" disabled={surgesCur <= 0} onClick={() => spendSurge(false)} title={surgeTemp !== 0 ? "回复值 " + d.surgeValue + " ＋临时 " + fmtMod(surgeTemp) : "回复值 " + d.surgeValue}>
          使用回复力 ＋{healPerSurge}
        </FilledButton>
        {/* 临时回复值自成一组：窄屏换行时标签必须跟步进器走，不能被拆到两行
            （外层 .gl-line 是 flex-wrap，不包一层的话「− 0 ＋」会掉到下一行开头、
            与上一行末尾的标签失去对应）。桌面端 .gl-line-group 是 display: contents，
            排布与包这层之前完全一致。 */}
        <span className="gl-line-group">
          <span className="gl-line-label">临时回复值</span>
          <div className="gl-stepper" title="每次花掉回复力时额外回复的生命值（治疗药水、督军激励等短时效果）；休整后清零">
            <IconButton className="gl-icon-btn" aria-label="临时回复值 −1" onClick={() => setChar((p) => ({ ...p, glance: { ...p.glance, surgeTemp: Math.max(-50, p.glance.surgeTemp - 1) } }))}>
              <span className="material-symbols-outlined">remove</span>
            </IconButton>
            <input
              className="gl-plain-num"
              type="number"
              aria-label="临时回复值"
              value={surgeTemp}
              onChange={(e) => setChar((p) => ({ ...p, glance: { ...p.glance, surgeTemp: Math.max(-50, Math.min(50, Math.floor(Number(e.target.value) || 0))) } }))}
            />
            <IconButton className="gl-icon-btn" aria-label="临时回复值 +1" onClick={() => setChar((p) => ({ ...p, glance: { ...p.glance, surgeTemp: Math.min(50, p.glance.surgeTemp + 1) } }))}>
              <span className="material-symbols-outlined">add</span>
            </IconButton>
          </div>
        </span>
      </div>

      {dying && (
        <div className="gl-line death">
          <span className="gl-line-label">死亡豁免失败</span>
          <GlancePips total={3} filled={char.glance.deathFails} tone="death" label="死亡豁免失败" onPick={(n) => setChar((p) => ({ ...p, glance: { ...p.glance, deathFails: Math.min(3, n) } }))} />
          <span className="gl-line-hint danger">
            {char.glance.deathFails >= 3 ? "已失败三次：角色死亡" : "生命值降至 −" + d.bloodied + " 时直接死亡"}
          </span>
        </div>
      )}
    </GlanceZone>
  );
}