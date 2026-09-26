// AI 车卡页：用户自备 API（BYOK）+ 决策清单 + 单步代选。
//
// 这一页做三件事：
//   ① 连接设置：供应商 / 模型 / Key / 地址 +「测试连接」
//      —— 把传输层的错误分类（Key 无效 / 跨域被拦 / 模型名写错）变成用户能照着做的一句话
//   ② 决策清单：这张卡还差哪些决定、每一步有多少合法候选
//      —— 候选由 sheet/candidates 的同源纯函数算出（与选择器同一份规则）
//   ③ 单步代选：把「一项决定 + 候选」交给模型，拿回一个 id 并落到卡上
//      —— 落子走 sheet/transitions 的纯函数，与用户点选的结果逐字段一致
// 跨步编排（一路跑完、逐项确认、决策日志）在下一阶段接入，见 AI车卡设计.md。
//
// ① 的界面（含连接配置弹窗）在 components/AiSetupBar，与主持「AI」页共用同一条顶栏。

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Checkbox,
  FilledButton,
  FilledSelect,
  IconButton,
  LinearProgress,
  OutlinedButton,
  SelectOption,
  TextButton,
} from "./components/md";
import AiSetupBar from "./components/AiSetupBar";
import { loadCategory, loadRelations } from "./data/loaders";
import type { Entry } from "./data/types";
import { cardBrief } from "./lib/ai/brief";
import { applyPicked, buildAll, candidatesFor, skillsFor, type EngineCtx } from "./lib/ai/driver";
import { isAiConfigured, loadAiConfig } from "./lib/ai/config";
import { pickAbilities, pickForDecision, pickSkills } from "./lib/ai/picker";
import { AiError, type AiConfig } from "./lib/ai/types";
import { countPending, decisionList, type Decision, type Relations } from "./sheet/candidates";
import { SmartHover } from "./sheet/SmartHover";
import EntryCard from "./sheet/EntryCard";
import PickerModal from "./sheet/PickerModal";
import ClassPickerModal from "./sheet/ClassPickerModal";
import { applyAbilityScores, applyClassPick, applyLevel, applyRacePick } from "./sheet/transitions";
import { BUY_POINTS, defaultCharacter, racialBonus, type Character, type PowerSlots } from "./sheet/character";

interface CardData {
  powers: Entry[];
  feats: Entry[];
  races: Entry[];
  classes: Entry[];
  paragons: Entry[];
  epics: Entry[];
  relations: Relations;
}

/** 反馈列表里可以悬浮出卡片预览的条目类别（这几类 EntryCard 有像样的卡片渲染；职业/典范/天命的正文太大，不预览） */
const CARD_PREVIEW = new Set(["power", "feat", "equipment", "gear", "ritual", "race"]);

/** 威能四个大类：清单里每个大类一行，下面是该大类按等级排开的槽位 */
const POWER_GROUPS: { cat: keyof PowerSlots; label: string }[] = [
  { cat: "atWill", label: "随意威能" },
  { cat: "encounter", label: "遭遇威能" },
  { cat: "daily", label: "每日威能" },
  { cat: "utility", label: "辅助威能" },
];

type Mode = "new" | "tune";

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "new", label: "从零建卡", hint: "按目标等级把每一项从头选一遍。" },
  { key: "tune", label: "优化现有卡", hint: "按当前卡的等级审一遍，把不满意的槽位换掉。" },
];

function byId(arr: Entry[], id?: string): Entry | undefined {
  return id ? arr.find((e) => e.id === id) : undefined;
}

function describeError(e: unknown): string {
  if (e instanceof AiError) return e.message;
  if (e instanceof Error) return "调用失败：" + e.message;
  return "调用失败：未知错误。";
}

export default function AiView({
  layout,
  char,
  setChar,
  onNewCard,
}: {
  layout: "single" | "double";
  char: Character;
  setChar: (c: Character) => void;
  /** 把一张准备好的卡建成新存档并切过去（由 App 提供，与存档页的「新建人物卡」同一套） */
  onNewCard: (c: Character) => void;
}) {
  const [cfg, setCfg] = useState<AiConfig>(() => loadAiConfig());
  const [mode, setMode] = useState<Mode>("new");
  const [targetLevel, setTargetLevel] = useState<number>(() => Math.max(1, Math.min(30, char.level || 1)));
  const [instruction, setInstruction] = useState("");
  const [data, setData] = useState<CardData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  // 结果输出：右侧「结果输出」板块里的行，**每项决定一行**。
  // 同一项再次让 AI 挑（单步 / 重roll / 再跑一遍主按钮）都是就地覆盖这一行，不往后追加
  // —— 否则失败行会永远红着，用户没法「一直重roll到全绿」。
  const [feedback, setFeedback] = useState<
    { id: string; label: string; kind: "ok" | "warn" | "err"; text: string; pickId?: string }[]
  >([]);
  // 种族 / 职业直接复用人物页那两个挑选弹窗（带搜索、筛选、悬浮预览）
  const [picker, setPicker] = useState<null | "race" | "class">(null);
  // 「从零建卡」在一张**草稿卡**上工作：快捷指定与单步代选都只改草稿、只是预览；
  // 只有点主按钮「新建并车一张 N 级的卡」时才把这张草稿建成新存档并切过去。
  const [draft, setDraft] = useState<Character>(() => defaultCharacter());
  // 「从零建卡」按下主按钮后，草稿已经变成一张真实存档卡并切了过去：此后工作对象必须是那张卡，
  // 否则单步 / 重roll 会写回没人看的草稿（界面上看起来就是「点了没反应」）。
  const [built, setBuilt] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 玩家决定「这一轮让 AI 处理哪些项」：默认全部 AI 可做的项都参与，skipSet 记被取消勾选的项
  const [skipSet, setSkipSet] = useState<Set<string>>(() => new Set());
  /** 写一条输出行：按决定 id 定位，已有就**就地覆盖**（保持它第一次出现的位置），没有才追加。 */
  function upsertFeed(id: string, label: string, note: { kind: "ok" | "warn" | "err"; text: string }, pickId?: string) {
    setFeedback((p) => {
      const row = { id, label, kind: note.kind, text: note.text, pickId };
      const i = p.findIndex((f) => f.id === id);
      if (i < 0) return [...p, row];
      const next = p.slice();
      next[i] = row;
      return next;
    });
  }
  function toggleSkip(id: string) {
    setSkipSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 卡表按需载入：power.json 有十几兆，浏览器会缓存，第一次进这一页多等一会儿。
  useEffect(() => {
    let alive = true;
    void Promise.all([
      loadCategory("power"),
      loadCategory("feat"),
      loadCategory("race"),
      loadCategory("class"),
      loadCategory("paragon-path"),
      loadCategory("epic-destiny"),
      loadRelations(),
    ])
      .then(([powers, feats, races, classes, paragons, epics, relations]) => {
        if (!alive) return;
        setData({ powers, feats, races, classes, paragons, epics, relations });
      })
      .catch((e) => {
        if (alive) setLoadErr(e instanceof Error ? e.message : "卡表载入失败");
      });
    return () => {
      alive = false;
    };
  }, []);

  // 连接配置全部由顶栏组件（components/AiSetupBar）持有与落库：本页只读它做判断，
  // 「预设地址固化」「测试连接」那些逻辑都在那边，两页共用一份。
  const ready = isAiConfigured(cfg);

  const nameMap = useMemo(() => {
    const m = new Map<string, Entry>();
    if (data) {
      for (const arr of [data.powers, data.feats, data.races, data.classes, data.paragons, data.epics]) {
        for (const e of arr) m.set(e.id, e);
      }
    }
    return m;
  }, [data]);

  const classById = useMemo(() => new Map((data?.classes ?? []).map((c) => [c.id, c])), [data]);
  const powerById = useMemo(() => new Map((data?.powers ?? []).map((p) => [p.id, p])), [data]);
  // 专长正文里的 [[威能]] 链接按 id 解析 —— 与人物页 wikiLookup 同一口径（只认 id，不猜名字）
  const wikiLookup = useMemo(() => (t: string) => powerById.get(t) ?? nameMap.get(t), [powerById, nameMap]);
  const raceById = useMemo(() => new Map((data?.races ?? []).map((r) => [r.id, r])), [data]);
  // 单步与一键共用的上下文：候选 / 落子都从这里取（见 lib/ai/driver）
  const ctx = useMemo<EngineCtx | null>(
    () => (data ? { data, classById, powerById, raceById, nameMap, wikiLookup } : null),
    [data, classById, powerById, raceById, nameMap, wikiLookup],
  );

  // 切模式 / 改目标等级（含卡表刚载入）时：草稿重置为「目标等级的空白卡」，输出列表一并清空
  // —— 输出行是按决定 id 定位的，换了目标卡这些行就没有意义了。
  useEffect(() => {
    setBuilt(false);
    setFeedback([]);
    if (mode !== "new") return;
    setDraft(applyLevel(defaultCharacter(), targetLevel, { classById, powerById }));
  }, [mode, targetLevel, classById, powerById]);

  // 本页正在操作的那张卡：从零建卡且还没按主按钮时是草稿（仅预览），其余情况都是当前存档
  const workChar = mode === "new" && !built ? draft : char;
  /** 落子去处：草稿阶段写草稿（预览）；按下主按钮建卡之后、以及优化模式，都直接写当前存档 */
  const applyWork = (next: Character) => {
    if (mode === "new" && !built) setDraft(next);
    else setChar(next);
  };

  const level = mode === "new" ? targetLevel : Math.max(1, Math.min(30, workChar.level || 1));
  const list = useMemo(() => decisionList(workChar, { targetLevel: level }), [workChar, level]);

  /** 当前职业显示名（混职时两个并列） */
  const classLabel = workChar.hybrid
    ? [classById.get(workChar.classId ?? "")?.name, classById.get(workChar.classId2 ?? "")?.name].filter(Boolean).join(" / ") || "未指定"
    : classById.get(workChar.classId ?? "")?.name ?? "未指定";

  const pending = countPending(list);
  const nameOf = (id: string) => nameMap.get(id)?.name;

  // 每项决定的合法候选：清单行、槽位格、重roll 可用性共用这一份（威能表很大，别每处各算一遍）
  const candMap = useMemo(() => {
    const m = new Map<string, Entry[] | null>();
    if (!ctx) return m;
    for (const d of list) {
      // 属性（购点数数组）与受训技能（从职业文本解析）不走候选表，见 pickAbilities / skillsFor
      if (d.kind === "abilities" || d.kind === "skills") continue;
      m.set(d.id, candidatesFor(d, ctx, workChar, level));
    }
    return m;
  }, [ctx, list, workChar, level]);

  // 这轮 AI 会不会先把职业选出来：若会，受训技能也可以先勾上（默认全选，见 aiEligible）
  const classDecision = list.find((d) => d.kind === "class");
  const classWillPick = !!classDecision && classDecision.status === "empty" && !skipSet.has(classDecision.id);
  /** 这一项是否「可以交给 AI」：属性永远可以；受训技能看职业是否已有、或这轮 AI 会先把职业选出来；其余看候选 */
  const aiEligible = (d: Decision): boolean => {
    // 属性永远可代选：AI 会按等级重算「22 点购点 + 升级提升」，不依赖当前值是否合规
    if (d.kind === "abilities") return true;
    if (d.kind === "skills") {
      if (!workChar.classId) return classWillPick;
      const sc = ctx ? skillsFor(workChar, ctx) : null;
      return !!sc && sc.available.length > 0;
    }
    const cands = candMap.get(d.id);
    return (
      (d.kind === "power" || d.kind === "feat" || d.kind === "race" || d.kind === "class" || d.kind === "paragon" || d.kind === "epic") &&
      !!cands &&
      cands.length > 0
    );
  };
  // 这一轮被勾选、且还空着、会交给一键去跑的决定数（只统计 AI 真会跑的项）
  const selCount = list.filter((d) => d.status === "empty" && !skipSet.has(d.id) && aiEligible(d)).length;

  /** 让 AI 为这一项挑一个，然后落子。落子一律走 sheet/transitions 的纯函数（与手点结果一致）。 */
  async function onPick(d: Decision, cands: Entry[]) {
    setPicking(d.id);
    try {
      const res = await pickForDecision({
        cfg,
        brief: cardBrief(workChar, { nameOf }),
        decision: d,
        candidates: cands,
        instruction,
        currentName: d.current ? nameOf(d.current) : undefined,
      });
      // 落子与「一键建卡」共用同一份 applyPicked（lib/ai/driver），避免单步与整体两处规则分叉
      if (!ctx) return;
      const out = applyPicked(workChar, d, res, ctx);
      applyWork(out.char);
      upsertFeed(d.id, d.label, out.note, res.id);
    } catch (e) {
      upsertFeed(d.id, d.label, { kind: "err", text: describeError(e) });
    } finally {
      setPicking(null);
    }
  }

  /** 属性分配：不是从候选里挑，而是让模型给一组购点数组（合法性在 lib/ai/picker 里校验）。 */
  async function onPickAbilities() {
    setPicking("abilities");
    try {
      const race = byId(data?.races ?? [], workChar.raceId);
      const cls = byId(data?.classes ?? [], workChar.classId);
      const res = await pickAbilities({
        cfg,
        brief: cardBrief(workChar, { nameOf }),
        current: workChar.abilities,
        racial: racialBonus(race, workChar.raceAbility2Choice),
        raceName: race?.name ?? "",
        className: cls?.name ?? "",
        level: workChar.level,
        instruction,
      });
      applyWork(applyAbilityScores(workChar, res.abilities));
      upsertFeed("abilities", "属性分配", {
        kind: "ok",
        text:
          "已分配（购点 " + res.used + "/" + BUY_POINTS + " 点" +
          (res.boostTotal
            ? "，升级提升 +" + res.boostTotal + " 点 = " +
              [res.allPlus ? res.allPlus + " 次全体 +1" : "", res.twoPlus ? res.twoPlus + " 次两项 +1" : ""].filter(Boolean).join(" + ")
            : "") +
          "）" +
          (res.reason ? " —— " + res.reason : ""),
      });
    } catch (e) {
      upsertFeed("abilities", "属性分配", { kind: "err", text: describeError(e) });
    } finally {
      setPicking(null);
    }
  }

  /** 受训技能：从职业可选技能里挑（写进 classTrainedSkills，与人物页同源）。 */
  async function onPickSkills(sc: { available: { name: string; ability: string }[]; count: number }) {
    setPicking("skills");
    try {
      const res = await pickSkills({
        cfg,
        brief: cardBrief(workChar, { nameOf }),
        available: sc.available,
        count: sc.count,
        current: workChar.classTrainedSkills ?? [],
        instruction,
      });
      applyWork({ ...workChar, classTrainedSkills: res.skills });
      upsertFeed("skills", "受训技能", {
        kind: "ok",
        text: "已选 " + (res.skills.length ? res.skills.join("、") : "（未选）") + (res.reason ? " —— " + res.reason : ""),
      });
    } catch (e) {
      upsertFeed("skills", "受训技能", { kind: "err", text: describeError(e) });
    } finally {
      setPicking(null);
    }
  }

  /**
   * 快捷指定种族：直接落到卡上（与人物页种族选择同一套结果），AI 再在这基础上挑选其余项。
   * 选「（不指定）」= 清空，交回给 AI 决定。
   */
  function pickRace(id: string) {
    if (!id) {
      applyWork({ ...workChar, raceId: undefined, subraceId: undefined, subraceBenefits: {}, raceSwaps: {} });
      return;
    }
    const race = byId(data?.races ?? [], id);
    if (race) applyWork(applyRacePick(workChar, race, data?.races ?? []));
  }

  /** 快捷指定职业：与人物页 ClassPickerModal 的选择同一套结果（支持混职）。 */
  function pickClass(ids: string[], isHybrid: boolean) {
    if (ids.length === 0) {
      applyWork({ ...workChar, classId: undefined, classId2: undefined, hybrid: false });
      return;
    }
    applyWork(applyClassPick(workChar, ids, isHybrid, { classById, powerById }));
  }

  /** 一键：让 AI 按决策清单从头到尾把这张卡跑出来（每步实时写回，随时可中止）。 */
  async function startBuild() {
    if (building || !ctx) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBuilding(true);
    setBuildProgress({ done: 0, total: 1, current: "准备中…" });
    // 只跑玩家勾选、且还空着、AI 真会跑的项。跑完**不重置**输出列表（逐项就地覆盖），
    // 这样「跑一遍 → 对红行重roll → 再跑一遍补漏」都是在同一份结果上迭代。
    const include = new Set(list.filter((d) => d.status === "empty" && !skipSet.has(d.id) && aiEligible(d)).map((d) => d.id));
    // 从零建卡：只有第一次按主按钮才把草稿建成新存档并切过去（App 负责建卡 + 切 activeId）；
    // 之后再按都固定在这张卡上，免得攒出一堆半成品新卡。
    const base = workChar;
    if (mode === "new" && !built) {
      onNewCard(base);
      setBuilt(true);
    }
    try {
      const result = await buildAll({
        cfg,
        instruction,
        level,
        char: base,
        ctx,
        signal: ctrl.signal,
        include,
        onStep: (i, total, working, step) => {
          setBuildProgress({ done: i, total, current: step.label });
          upsertFeed(step.id, step.label, step.note, step.pickId);
          setChar(working); // 实时写回，用户能看到卡在长出来
        },
      });
      setChar(result.char); // 以 buildAll 的最终值为准
    } catch (e) {
      if (!ctrl.signal.aborted) upsertFeed("build", "一键建卡", { kind: "err", text: describeError(e) });
    } finally {
      setBuilding(false);
      abortRef.current = null;
      setBuildProgress(null);
    }
  }

  function cancelBuild() {
    abortRef.current?.abort();
  }

  /**
   * 重roll 一行：按 id 把那一项决定找回来，让 AI 在**现有结果的基础上**只重挑这一项
   * （其余已经选好的都保留）。成功行也能重roll —— 看哪条不顺眼就重挑一次。
   */
  function rerollDecision(id: string) {
    if (!ctx || building || picking !== null) return;
    const d = list.find((x) => x.id === id);
    if (!d) return;
    if (d.kind === "abilities") {
      void onPickAbilities();
      return;
    }
    if (d.kind === "skills") {
      const sc = skillsFor(workChar, ctx);
      if (sc.available.length > 0) void onPickSkills(sc);
      return;
    }
    const cands = candMap.get(id);
    if (cands && cands.length > 0) void onPick(d, cands);
  }

  // 哪些输出行能重roll（决定项还在、且现在有得可选）。成功行也算 —— 用户要能对着结果反复调，直到没有红行。
  const rerollable = useMemo(() => {
    const m = new Map<string, boolean>();
    if (!ctx) return m;
    for (const f of feedback) {
      if (m.has(f.id)) continue;
      const d = list.find((x) => x.id === f.id);
      if (!d) continue;
      if (d.kind === "abilities") m.set(f.id, true);
      else if (d.kind === "skills") m.set(f.id, skillsFor(workChar, ctx).available.length > 0);
      else {
        const cands = candMap.get(f.id);
        m.set(f.id, !!cands && cands.length > 0);
      }
    }
    return m;
  }, [ctx, feedback, list, workChar, candMap]);
  const failCount = feedback.filter((f) => f.kind === "err").length;

  // 清单分组：基础 / 威能四类（横排槽位）/ 专长 / 进阶 / 装备与仪式
  const basicItems = list.filter((d) => d.kind === "race" || d.kind === "class" || d.kind === "abilities" || d.kind === "skills");
  const featItems = list.filter((d) => d.kind === "feat");
  const advancedItems = list.filter((d) => d.kind === "paragon" || d.kind === "epic");
  const otherItems = list.filter((d) => d.kind === "equipment" || d.kind === "ritual");
  const powerGroups = POWER_GROUPS.map((g) => ({
    ...g,
    items: list.filter((d) => d.kind === "power" && d.slotCat === g.cat),
  })).filter((g) => g.items.length > 0);

  /** 清单里的一行（基础 / 专长 / 进阶 / 装备） */
  function renderRow(d: Decision) {
    const cands = candMap.get(d.id) ?? null;
    const sc = d.kind === "skills" && ctx ? skillsFor(workChar, ctx) : null;
    const cur = d.current ? nameOf(d.current) ?? d.current : undefined;
    const isAbilities = d.kind === "abilities";
    // 受训技能「现在就有可选技能」时才能单选；仅「AI 会先选职业」时只有勾选框参与一键
    const skillsReady = d.kind === "skills" && !!sc && sc.available.length > 0;
    const canPick = aiEligible(d);
    const showSingle = canPick && !(d.kind === "skills" && !skillsReady);
    const scale =
      d.kind === "skills"
        ? skillsReady
          ? "可选 " + sc.available.length + " 个"
          : classWillPick
            ? "AI 选好职业后自动可选"
            : d.detail ?? ""
        : cands
          ? "候选 " + cands.length + " 条"
          : d.detail ?? "";
    const sub = (d.status === "filled" ? (cur ? "已选：" + cur : "已选") : "待选") + (scale ? " · " + scale : "");
    return (
      <div className="ai-item" key={d.id}>
        {canPick ? (
          <Checkbox checked={!skipSet.has(d.id)} onChange={() => toggleSkip(d.id)} aria-label={"这一轮是否让 AI 处理：" + d.label} />
        ) : (
          <span className="ai-item-gap" aria-hidden="true" />
        )}
        <span className="ai-item-text">
          <span className="ai-item-title">{d.label}</span>
          <span className="ai-item-sub">{sub}</span>
        </span>
        {showSingle && (
          <TextButton
            disabled={!ready || picking !== null}
            title={ready ? "让 AI 替你决定这一项" : "请先配置 AI 连接"}
            onClick={() =>
              isAbilities ? void onPickAbilities() : d.kind === "skills" ? void onPickSkills(sc!) : void onPick(d, cands!)
            }
          >
            {picking === d.id ? "调用中…" : isAbilities ? "重新配置" : "重新挑选"}
          </TextButton>
        )}
      </div>
    );
  }

  /** 威能槽位的一格（大类下横排显示）：等级 + 已选/待选 + 单独让 AI 挑 */
  function renderSlot(d: Decision) {
    const cands = candMap.get(d.id) ?? null;
    const cur = d.current ? nameOf(d.current) ?? d.current : undefined;
    const canPick = aiEligible(d);
    const lvl = d.slotLevel === "paragon" ? "典范" : d.slotLevel === "legendary" ? "传奇" : (d.slotLevel ?? "") + " 级";
    return (
      <div className="ai-slot" key={d.id}>
        <div className="ai-slot-head">
          {canPick ? (
            <Checkbox checked={!skipSet.has(d.id)} onChange={() => toggleSkip(d.id)} aria-label={"这一轮是否让 AI 处理：" + d.label} />
          ) : (
            <span className="ai-slot-gap" aria-hidden="true" />
          )}
          <span className="ai-slot-level">{lvl}</span>
          {canPick && (
            <IconButton
              className="ai-slot-btn"
              title={ready ? "重新挑选这个槽位" : "请先配置 AI 连接"}
              disabled={!ready || picking !== null || !cands || cands.length === 0}
              onClick={() => void onPick(d, cands!)}
            >
              <span className="material-symbols-outlined">auto_awesome</span>
            </IconButton>
          )}
        </div>
        <div className={"ai-slot-value" + (cur ? " on" : "")} title={cur ?? "待选"}>
          {picking === d.id ? "挑选中…" : cur ?? "待选"}
        </div>
      </div>
    );
  }

  return (
    <div className={"ai-view" + (layout === "double" ? " layout-double" : "")}>
      {/* ① 意图：说清想要什么 + 快捷指定种族/职业（连接配置收进弹窗，不占版面）。
          顶栏与主持「AI」页共用 components/AiSetupBar；本页额外挂模式切换与快捷指定 */}
      <AiSetupBar
        title="AI 车卡"
        cfg={cfg}
        onCfgChange={setCfg}
        placeholder={mode === "new" ? "想车一张什么样的卡？" : "想怎么调整这张卡？"}
        onInstructionChange={setInstruction}
        extra={
          <div className="md3-seg" role="radiogroup" aria-label="任务模式">
            {MODES.map((m) => (
              <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} className={"md3-seg-btn" + (mode === m.key ? " on" : "")} onClick={() => setMode(m.key)}>
                {mode === m.key && <span className="material-symbols-outlined md3-seg-check">check</span>}
                {m.label}
              </button>
            ))}
          </div>
        }
      >
        {/* 快捷指定：打开人物页那两个挑选弹窗（可搜索、可筛选、带条目预览）。
            这里只是预览，点右侧「生成」的主按钮才会真正建卡 */}
        <div className="ai-hero-picks">
          <OutlinedButton disabled={!data} onClick={() => setPicker("race")}>
            <span slot="icon" className="material-symbols-outlined">diversity_3</span>
            种族：{raceById.get(workChar.raceId ?? "")?.name ?? "未指定"}
          </OutlinedButton>
          <OutlinedButton disabled={!data} onClick={() => setPicker("class")}>
            <span slot="icon" className="material-symbols-outlined">school</span>
            职业：{classLabel}
          </OutlinedButton>
          {mode === "new" && (
            <FilledSelect label="目标等级" value={String(targetLevel)} onChange={(e) => setTargetLevel(parseInt((e.target as any).value, 10) || 1)}>
              {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                <SelectOption key={n} value={String(n)}>{n} 级</SelectOption>
              ))}
            </FilledSelect>
          )}
        </div>
      </AiSetupBar>

      <div className="ai-col">
        {/* 决策清单：这轮交给 AI 的项（勾选 + 一键） */}
        <section className="block">
          <div className="block-head">
            <h3 className="block-title">决策清单</h3>
            <span className="hint">{data ? "待填 " + pending + " 项 · 共 " + list.length + " 项" : "正在载入卡表…"}</span>
          </div>

          {loadErr && <p className="ai-msg err">卡表载入失败：{loadErr}</p>}

          {!data && !loadErr && (
            <p className="hint">
              <span className="material-symbols-outlined ai-inline-ic">hourglass_top</span>
              正在载入卡表（威能表较大，第一次会慢一些）…
            </p>
          )}

          {data && (
            <>
              {basicItems.length > 0 && (
                <div className="ai-group">
                  <div className="ai-group-head">基础</div>
                  <div className="ai-items">{basicItems.map(renderRow)}</div>
                </div>
              )}

              {powerGroups.map((g) => (
                <div className="ai-group" key={g.cat}>
                  <div className="ai-group-head">
                    {g.label}
                    <span className="ai-group-count">
                      {g.items.filter((d) => d.status === "filled").length}/{g.items.length}
                    </span>
                  </div>
                  <div className="ai-slots">{g.items.map(renderSlot)}</div>
                </div>
              ))}

              {featItems.length > 0 && (
                <div className="ai-group">
                  <div className="ai-group-head">
                    专长
                    <span className="ai-group-count">
                      {featItems.filter((d) => d.status === "filled").length}/{featItems.length}
                    </span>
                  </div>
                  <div className="ai-items">{featItems.map(renderRow)}</div>
                </div>
              )}

              {advancedItems.length > 0 && (
                <div className="ai-group">
                  <div className="ai-group-head">进阶</div>
                  <div className="ai-items">{advancedItems.map(renderRow)}</div>
                </div>
              )}

              {otherItems.length > 0 && (
                <div className="ai-group">
                  <div className="ai-group-head">装备与仪式</div>
                  <div className="ai-items">{otherItems.map(renderRow)}</div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ④ 结果输出（右栏）：每一项决定一行结果，和左边的决策清单对照着看 */}
      <div className="ai-col">
        <section className="block">
          <div className="block-head">
            <h3 className="block-title">结果输出</h3>
            <span className="hint">
              {selCount} 项已勾选{feedback.length > 0 ? (failCount > 0 ? " · " + failCount + " 条失败" : " · 全部就绪") : ""}
            </span>
          </div>

          <div className="ai-actions">
            <FilledButton disabled={!ready || building || !ctx || selCount === 0} onClick={() => void startBuild()}>
              {building
                ? "正在输出…"
                : !ready
                  ? "没有配置有效API"
                  : mode === "new" && !built
                    ? "新建并输出 " + targetLevel + " 级的卡"
                    : selCount > 0
                      ? "输出这 " + selCount + " 项"
                      : "没有待输出的项"}
            </FilledButton>
            {building && <TextButton onClick={cancelBuild}>中止</TextButton>}
            {!building && feedback.length > 0 && <TextButton onClick={() => setFeedback([])}>清空</TextButton>}
          </div>
          {building && <LinearProgress className="ai-progress" />}
          {buildProgress && (
            <p className="hint">
              进度：{buildProgress.done}/{buildProgress.total} · {buildProgress.current}
            </p>
          )}

          <div className="ai-group">
            <div className="ai-group-head">
              挑选理由
              <span className="ai-group-count">{feedback.length} 条</span>
            </div>
            {feedback.length === 0 ? (
              <p className="hint">还没有内容。</p>
            ) : (
              <div className="ai-items">
                {feedback.map((f, i) => {
                  // 挑中的是「有卡片渲染」的条目（威能 / 专长 / 装备）时，鼠标移上去悬浮显示那张卡
                  const pe = f.pickId ? nameMap.get(f.pickId) : undefined;
                  const preview = pe && CARD_PREVIEW.has(pe.category) ? <EntryCard entry={pe} lookup={wikiLookup} /> : undefined;
                  return (
                    <SmartHover
                      key={f.id + ":" + i}
                      className="ai-item"
                      popClass="ai-pop"
                      portal
                      pop={preview}
                      title={pe?.name}
                    >
                      <span className={"ai-feed-dot " + f.kind} aria-hidden="true" />
                      <span className="ai-item-text">
                        <span className="ai-item-title">{f.label}</span>
                        <span className="ai-item-sub">{f.text}</span>
                      </span>
                      {preview && <span className="material-symbols-outlined ai-feed-ic">style</span>}
                      {rerollable.get(f.id) && (
                        <TextButton
                          className="ai-feed-retry"
                          disabled={!ready || picking !== null || building}
                          title={"让 AI 只重挑这一项，其余已选好的保留：" + f.label}
                          onClick={() => rerollDecision(f.id)}
                        >
                          {picking === f.id ? "…" : "重roll"}
                        </TextButton>
                      )}
                    </SmartHover>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 种族挑选：与人物页同一个 PickerModal（搜索 / 全文搜索 / 属性筛选 / 卡片预览） */}
      {picker === "race" && (
        <PickerModal
          title="选择种族"
          entries={data?.races ?? []}
          selectedId={workChar.raceId}
          onSelect={(id) => {
            pickRace(id);
            setPicker(null);
          }}
          onClear={() => {
            pickRace("");
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
          renderSub={(e) =>
            [e.abilityOne, e.abilityTwo, e.size ? "体型 " + e.size : "", e.speed ? "速度 " + e.speed : ""].filter(Boolean).join(" · ")
          }
          abilityFilter
        />
      )}

      {/* 职业挑选：与人物页同一个 ClassPickerModal（来源 / 定位筛选、混职开关） */}
      {picker === "class" && (
        <ClassPickerModal
          entries={data?.classes ?? []}
          hybrid={!!workChar.hybrid}
          selectedIds={[workChar.classId, workChar.classId2].filter((x): x is string => !!x)}
          onSelect={(ids, isHybrid) => {
            pickClass(ids, isHybrid);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}

    </div>
  );
}
