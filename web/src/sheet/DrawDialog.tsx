import { useEffect, useMemo, useRef, useState } from "react";
import SheetDialog from "../components/SheetDialog";
import { FilledButton } from "../components/md";
import DrawAssist from "./DrawAssist";
import { loadCategory, loadRelations } from "../data/loaders";
import type { Entry } from "../data/types";
import { LEVELS } from "./leveling";
import { powerSlotLevels, classPowerIds, racePowerIds, featTierOf } from "./candidates";
import type { Character, SlotLevel } from "./character";
import { applyFeatPick, applyPowerPick } from "./transitions";
import { POWER_COLORS, FEAT_COLOR, powerCategory } from "../lib/colors";
import type { GuideDrawKind } from "../lib/guide";

// 抽卡弹窗（导引模式专用）：**一次把这一步该填的槽位抽满**。
//
// 流程：打开 → 自动落在第一个空槽 → 发一手牌（3 张，可重抽 2 次）→ 选一张写进去
// → 自动跳到下一个空槽、重新发牌 → …… → 没有空槽了就关窗。
// 抽不出来的槽位可以「跳过这个槽位」，跳过的不再回头。
//
// 为什么不做成「选择器里的一种模式」：抽卡是导引特别提供的挑选辅助，
// 普通车卡只该有清单挑选；而且它要能自己安排槽位顺序，才不会因为用户没点中某个空位而抽不了。
//
// 落子一律走 sheet/transitions 的纯函数（applyPowerPick / applyFeatPick）——
// 与 AI 代选、与用户手点产生的结果逐字段一致，不在这里另写一套写卡逻辑。

/** 威能四类槽位（顺序与人物页一致；special 放的是种族/职业赠送威能，不参与抽卡） */
const SLOT_DEFS: { key: "atWill" | "encounter" | "daily" | "utility"; label: string; color: string }[] = [
  { key: "atWill", label: "随意威能", color: POWER_COLORS.atWill },
  { key: "encounter", label: "遭遇威能", color: POWER_COLORS.encounter },
  { key: "daily", label: "每日威能", color: POWER_COLORS.daily },
  { key: "utility", label: "辅助威能", color: POWER_COLORS.utility },
];

type SlotCat = (typeof SLOT_DEFS)[number]["key"];

/** 槽位标签（升级表给的那一步是几级；典范/传奇槽位没有等级数字） */
function slotLevelLabel(sl: SlotLevel | undefined): string {
  if (sl === "paragon") return "典范";
  if (sl === "legendary") return "传奇";
  return sl !== undefined ? sl + " 级" : "";
}

interface Props {
  kind: GuideDrawKind;
  char: Character;
  setChar: React.Dispatch<React.SetStateAction<Character>>;
  onClose: () => void;
}

/** 一个槽位 */
interface SlotTarget {
  key: string;
  cat?: SlotCat;
  index: number;
  label: string;
  color: string;
  filled?: Entry;
}

export default function DrawDialog({ kind, char, setChar, onClose }: Props) {
  const [powers, setPowers] = useState<Entry[]>([]);
  const [feats, setFeats] = useState<Entry[]>([]);
  const [classes, setClasses] = useState<Entry[]>([]);
  const [races, setRaces] = useState<Entry[]>([]);
  const [relations, setRelations] = useState<{ powerByGrantedBy: Record<string, string[]> }>({ powerByGrantedBy: {} });
  // 本窗口里被跳过的槽位：不再回头，也不阻塞「抽完收工」
  const [skipped, setSkipped] = useState<string[]>([]);
  // 抽到的专长若还需要补选（武器/法器/混职天赋）或指定替换槽位，抽完后留在弹窗里说清楚
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void loadCategory("power").then(setPowers).catch(console.error);
    void loadCategory("feat").then(setFeats).catch(console.error);
    void loadCategory("class").then(setClasses).catch(console.error);
    void loadCategory("race").then(setRaces).catch(console.error);
    void loadRelations().then(setRelations).catch(console.error);
  }, []);

  const powerMap = useMemo(() => new Map(powers.map((p) => [p.id, p])), [powers]);
  const featMap = useMemo(() => new Map(feats.map((f) => [f.id, f])), [feats]);
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  // 与人物页同一口径：正文里的 [[id]] 链接只认 id
  const lookup = useMemo(() => (t: string) => powerMap.get(t) ?? featMap.get(t), [powerMap, featMap]);

  // ===== 这一步的全部槽位 =====
  const slots = useMemo<SlotTarget[]>(() => {
    if (kind === "power") {
      const out: SlotTarget[] = [];
      for (const def of SLOT_DEFS) {
        const levels = powerSlotLevels(def.key, char.level);
        const count = Math.max(levels.length, (char.powerSlots[def.key] ?? []).length);
        for (let i = 0; i < count; i++) {
          const id = char.powerSlots[def.key]?.[i] ?? "";
          out.push({
            key: def.key + "-" + i,
            cat: def.key,
            index: i,
            label: def.label + " " + (i + 1) + (levels[i] !== undefined ? "（" + slotLevelLabel(levels[i]) + "）" : ""),
            color: def.color,
            filled: id ? powerMap.get(id) : undefined,
          });
        }
      }
      return out;
    }
    const count = Math.max(LEVELS[Math.max(0, char.level - 1)].feats, char.featSlots.length);
    return Array.from({ length: count }, (_, i) => {
      const id = char.featSlots[i] ?? "";
      return { key: "feat-" + i, index: i, label: "专长 " + (i + 1), color: FEAT_COLOR, filled: id ? featMap.get(id) : undefined };
    });
  }, [kind, char.level, char.powerSlots, char.featSlots, powerMap, featMap]);

  /** 还没填、也没被跳过的槽位 = 这一轮要抽的目标 */
  const pending = useMemo(() => slots.filter((s) => !s.filled && !skipped.includes(s.key)), [slots, skipped]);
  const pendingKey = pending.map((s) => s.key).join("|");
  const slotsKey = slots.map((s) => s.key + (s.filled ? "1" : "0")).join("|");

  // 当前目标恒为「第一个待抽的槽位」：抽完一个自动跳到下一个，顺序永远可预期，
  // 所以不需要记住用户的手动选择 —— 位置完全由「还有哪些空槽」决定。
  const slot = pending[0];

  // 全部抽完（含被跳过的）→ 关窗；有事情要交代（专长需补选）时留着让用户看完
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (slots.length === 0) return;
    if (pending.length > 0) return;
    if (notice) return;
    closeRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, slotsKey, notice]);

  // ===== 候选池：与「自己挑选」同一套规则（类别 / 来源 / 排除已选） =====
  const pool = useMemo<Entry[]>(() => {
    if (!slot) return [];
    if (kind === "power" && slot.cat) {
      const wantKey = slot.cat === "atWill" ? "at-will" : slot.cat;
      const used = new Set<string>();
      for (const id of Object.values(char.powerSlots).flat()) if (id) used.add(id);
      const lvOf = (p: Entry) => parseInt(String(p.level ?? "0"), 10) || 0;
      // 等级上限按**角色等级**（与人物页选择器默认的「当前及以下」一致，见 candidates.ts 的说明）：
      // 按槽位标签等级卡死会出现「手点选得到、抽卡抽不到」的不对等
      const byCatAndLevel = (p: Entry) => powerCategory(p.usage, p.powerKind) === wantKey && lvOf(p) <= char.level && !used.has(p.id);
      const classIds = classPowerIds([classMap.get(char.classId ?? ""), classMap.get(char.classId2 ?? "")], relations);
      const raceIds = racePowerIds(races.find((r) => r.id === char.raceId), relations);
      const scoped = powers.filter((p) => {
        if (!byCatAndLevel(p)) return false;
        if (classIds && raceIds) return classIds.has(p.id) || raceIds.has(p.id);
        if (classIds) return classIds.has(p.id);
        if (raceIds) return raceIds.has(p.id);
        return true;
      });
      // 职业/种族限定下无候选时放宽到「同类同级全部」——与人物页选择器的兜底一致
      return scoped.length > 0 ? scoped : powers.filter(byCatAndLevel);
    }
    const tier = featTierOf(char.level);
    const taken = new Set(char.featSlots.filter(Boolean));
    return feats.filter((f) => (!tier || f.tierZh === tier) && !taken.has(f.id));
  }, [kind, slot, powers, feats, char.powerSlots, char.featSlots, char.level, char.classId, char.classId2, char.raceId, classMap, races, relations]);

  function pick(id: string) {
    if (!slot) return;
    if (kind === "power" && slot.cat) {
      const cat = slot.cat;
      const index = slot.index;
      setChar((p) => applyPowerPick(p, cat, index, id, { classById: classMap, powerById: powerMap }));
      return; // 下一个空槽由上面的 effect 自动接管
    }
    const feat = featMap.get(id);
    if (!feat) return;
    const outcome = applyFeatPick(char, slot.index, feat, lookup);
    setChar(outcome.char);
    // 需要补选的专长不静默处理：说清楚去哪儿补、补什么
    if (outcome.needsChoice || outcome.needsReplacement) {
      setNotice("「" + feat.name + "」已填进" + slot.label + "，还需要你在专长板块里点它一次：" + (outcome.needsReplacement ? "指定替换掉哪个威能槽位。" : "补一个选择（武器 / 法器 / 混职天赋）。"));
    }
  }

  const title = kind === "power" ? "抽卡挑选威能" : "抽卡挑选专长";
  const doneCount = slots.filter((s) => s.filled).length;
  const allDone = slots.length > 0 && pending.length === 0;

  return (
    <SheetDialog open headline={title} sub={allDone ? "已抽完" : "还剩 " + pending.length + " 个空位"} onClose={onClose}>
      <div className="draw-dialog">
        {/* 槽位进度：只读地展示「哪些填好了、现在抽哪个」，顺序由空槽决定 */}
        <div className="draw-dialog-target">
          <span className="draw-dialog-label">
            {kind === "power" ? "威能槽位" : "专长槽位"}（{doneCount}/{slots.length} 已有内容）
          </span>
          <div className="draw-dialog-chips">
            {slots.map((s) => {
              const on = !allDone && slot?.key === s.key;
              const skippedNow = skipped.includes(s.key);
              return (
                <span
                  key={s.key}
                  className={"guide-slot-chip" + (on ? " on" : "") + (s.filled ? " done" : "") + (skippedNow ? " skip" : "")}
                  title={s.filled ? "已填：" + s.filled.name : skippedNow ? "本窗口内已跳过" : on ? "正在抽这一个" : "空槽位"}
                >
                  <span className="guide-slot-dot" style={{ background: s.color }} />
                  {s.label}
                  <span className="guide-slot-state">{s.filled ? s.filled.name : skippedNow ? "跳过" : on ? "正在抽" : "空"}</span>
                </span>
              );
            })}
          </div>
        </div>

        {notice && <p className="draw-dialog-notice">{notice}</p>}

        {allDone ? (
          <div className="draw-dialog-done">
            <span className="material-symbols-outlined">task_alt</span>
            <p>
              {"这一步该填的 " + slots.length + " 个槽位都抽好了" + (skipped.length > 0 ? "（跳过了 " + skipped.length + " 个）" : "") + "。"}
            </p>
            <div className="guide-card-actions">
              <FilledButton onClick={onClose}>完成</FilledButton>
            </div>
          </div>
        ) : (
          <DrawAssist
            pool={pool}
            currentId={slot?.filled?.id}
            label={slot ? slot.label : undefined}
            lookup={lookup}
            onPick={pick}
            onSkip={() => setSkipped((prev) => (slot ? [...prev, slot.key] : prev))}
          />
        )}
      </div>
    </SheetDialog>
  );
}
