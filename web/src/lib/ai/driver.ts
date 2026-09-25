// AI 车卡：编排引擎 —— 「让 AI 从头顶到尾把一张卡跑出来」。
//
// 单步（决策清单上点「让 AI 选」）与一键（buildAll）共用这里的 applyPicked，
// 保证两处的落子规则是同一份 —— 否则一条路改对了、另一条漏了，出来的卡会长得不一样。
//
// 编排是「决策清单驱动」：应用按顺序把每一项目前还空的决定交给模型，
// 模型只能从应用给的候选里挑 id（候选与选择器同源），落子走 sheet/transitions 的纯函数。
// 这样每步都是确定性的、可中止的，也比让模型自己决定"看什么、什么时候停"可靠得多。

import type { Entry } from "../../data/types";
import type { PowerCategoryKey } from "../colors";
import {
  decisionList,
  featCandidates,
  featTierOf,
  powerCandidates,
  type Decision,
  type Relations,
} from "../../sheet/candidates";
import type { Character } from "../../sheet/character";
import { BUY_POINTS, parseClassSkills, parseTrainedSkillCount, racialBonus, type PowerSlots } from "../../sheet/character";
import {
  applyAbilityScores,
  applyClassPick,
  applyFeatPick,
  applyPathPick,
  applyPowerPick,
  applyRacePick,
  type PowerCat,
} from "../../sheet/transitions";
import { cardBrief } from "./brief";
import { pickAbilities, pickForDecision, pickSkills } from "./picker";
import { AiError, type AiConfig } from "./types";

export interface EngineData {
  powers: Entry[];
  feats: Entry[];
  races: Entry[];
  classes: Entry[];
  paragons: Entry[];
  epics: Entry[];
  relations: Relations;
}

export interface EngineCtx {
  data: EngineData;
  classById: Map<string, Entry>;
  powerById: Map<string, Entry>;
  raceById: Map<string, Entry>;
  nameMap: Map<string, Entry>;
  wikiLookup: (t: string) => Entry | undefined;
}

/**
 * 卡上已有的威能 id：槽位里的 + 职业/种族/主题/专长赠送的。
 * 同一张卡不能重复选同一个威能（4E 规则），候选集合里必须把这些剔掉 ——
 * 高等级时同一类威能的候选几乎完全重叠（每个槽位都是「≤角色等级」），
 * 不剔就会看到模型把最好的那一个往每个槽位里各挑一遍。
 */
function takenPowerIds(char: Character): Set<string> {
  const out = new Set<string>();
  for (const c of ["atWill", "encounter", "daily", "utility", "special"] as (keyof PowerSlots)[]) {
    for (const id of char.powerSlots?.[c] ?? []) if (id) out.add(id);
  }
  for (const arr of [char.classGrantedPowerIds, char.raceGrantedPowerIds, char.raceAutoGrantedPowerIds, char.themeGrantedPowerIds]) {
    for (const id of arr ?? []) if (id) out.add(id);
  }
  for (const ids of Object.values(char.featGrantedPowerIds ?? {})) for (const id of ids) if (id) out.add(id);
  return out;
}

/** 卡上已有的专长 id：常规专长槽位 + 职业赠送专长。 */
function takenFeatIds(char: Character): Set<string> {
  const out = new Set<string>();
  for (const id of char.featSlots ?? []) if (id) out.add(id);
  for (const id of char.classGrantedFeatIds ?? []) if (id) out.add(id);
  return out;
}

/** 某一项决定的合法候选（与选择器同源；属性/技能/装备这类不走候选表的返回 null）。 */
export function candidatesFor(d: Decision, ctx: EngineCtx, char: Character, level: number): Entry[] | null {
  if (d.kind === "race") return ctx.data.races;
  if (d.kind === "class") return ctx.data.classes;
  if (d.kind === "paragon") return ctx.data.paragons;
  if (d.kind === "epic") return ctx.data.epics;
  if (d.kind === "power" && d.slotCat && d.slotCat !== "special") {
    const category: PowerCategoryKey =
      d.slotCat === "atWill" ? "at-will" : d.slotCat === "encounter" ? "encounter" : d.slotCat === "daily" ? "daily" : "utility";
    const taken = takenPowerIds(char);
    return powerCandidates({
      entries: ctx.data.powers,
      relations: ctx.data.relations,
      classes: [char.classId ? ctx.classById.get(char.classId) : undefined, char.classId2 ? ctx.classById.get(char.classId2) : undefined],
      race: char.raceId ? ctx.raceById.get(char.raceId) : undefined,
      category,
      // 等级上限用角色等级：与人物页槽位选择器默认「当前及以下」一致
      maxLevel: level,
    }).filter((p) => !taken.has(p.id));
  }
  if (d.kind === "feat") {
    const taken = takenFeatIds(char);
    return featCandidates(ctx.data.feats, featTierOf(level)).filter((f) => !taken.has(f.id));
  }
  return null;
}

export interface SkillCandidates {
  available: { name: string; ability: string }[];
  count: number;
}

/** 受训技能的可选池：来自职业文本（parseClassSkills / parseTrainedSkillCount），与人物页同源。 */
export function skillsFor(char: Character, ctx: EngineCtx): SkillCandidates {
  const cls = char.classId ? ctx.classById.get(char.classId) : undefined;
  if (!cls) return { available: [], count: 0 };
  return {
    available: parseClassSkills(cls.sourceText).map((s) => ({ name: s.name, ability: s.ability })),
    count: parseTrainedSkillCount(cls.sourceText),
  };
}

export interface PickedNote {
  kind: "ok" | "warn" | "err";
  text: string;
}

/** 把「一项决定 + 模型挑中的结果」落成对 Character 的一次纯更新。 */
export function applyPicked(
  char: Character,
  d: Decision,
  pick: { id: string; name: string; reason: string },
  ctx: EngineCtx,
): { char: Character; note: PickedNote } {
  const reason = pick.reason ? " —— " + pick.reason : "";
  const maps = { classById: ctx.classById, powerById: ctx.powerById };

  if (d.kind === "power" && d.slotCat && d.slotCat !== "special" && d.slotIndex !== undefined) {
    return {
      char: applyPowerPick(char, d.slotCat as PowerCat, d.slotIndex, pick.id, maps),
      note: { kind: "ok", text: "已选 " + pick.name + reason },
    };
  }

  if (d.kind === "feat" && d.slotIndex !== undefined) {
    const feat = ctx.nameMap.get(pick.id);
    if (!feat) return { char, note: { kind: "err", text: "找不到专长条目：" + pick.id } };
    const outcome = applyFeatPick(char, d.slotIndex, feat, ctx.wikiLookup);
    const extras: string[] = [];
    if (outcome.granted.length) extras.push("已加入它赠送的 " + outcome.granted.length + " 个威能");
    if (outcome.needsChoice) extras.push("这条专长还需要你在人物页选定具体选项（武器 / 法器 / 混职天赋）");
    if (outcome.needsReplacement) extras.push("这条专长会替换已有威能，请到人物页选择替换哪一个槽位");
    return {
      char: outcome.char,
      note: { kind: extras.length ? "warn" : "ok", text: "已选 " + pick.name + (extras.length ? "，" + extras.join("；") : "") + reason },
    };
  }

  if (d.kind === "class") {
    // AI 只选单一职业（混职由玩家在人物页或快捷选择器里决定）
    return { char: applyClassPick(char, [pick.id], false, maps), note: { kind: "ok", text: "已选职业 " + pick.name + reason } };
  }
  if (d.kind === "race") {
    const race = ctx.nameMap.get(pick.id);
    if (!race) return { char, note: { kind: "err", text: "找不到种族条目：" + pick.id } };
    return { char: applyRacePick(char, race, ctx.data.races), note: { kind: "ok", text: "已选种族 " + pick.name + reason } };
  }
  if (d.kind === "paragon" || d.kind === "epic") {
    return { char: applyPathPick(char, pick.id, d.kind), note: { kind: "ok", text: "已选 " + pick.name + reason } };
  }
  if (d.kind === "abilities") {
    const a = pick as unknown as { abilities: Record<string, number> };
    return { char: applyAbilityScores(char, a.abilities), note: { kind: "ok", text: "已分配属性" + reason } };
  }

  return { char, note: { kind: "err", text: "这一项暂不支持代选。" } };
}

export interface BuildStep {
  id: string;
  label: string;
  ok: boolean;
  note: PickedNote;
  /** 这一步选中的条目 id（有意挑选出来的威能/专长等，界面可据此做悬浮卡片预览） */
  pickId?: string;
}

export interface BuildOptions {
  cfg: AiConfig;
  instruction?: string;
  level: number;
  char: Character;
  ctx: EngineCtx;
  signal?: AbortSignal;
  /** 只跑这些 id（玩家在清单里勾选的项）；不传则跑全部可代选的决定 */
  include?: ReadonlySet<string>;
  /** 每跑完一步回调：进度（i/total）与当前的卡（可用来做实时展示） */
  onStep?: (i: number, total: number, working: Character, step: BuildStep) => void;
}

function describeError(e: unknown): string {
  if (e instanceof AiError) return e.message;
  if (e instanceof Error) return "调用失败：" + e.message;
  return "调用失败：未知错误。";
}

/**
 * 让 AI 按决策清单从头到尾把一张卡跑出来。
 *
 * - 只跑「还空着、且能提供候选 / 选项」的决定；装备 / 仪式这一版不代选，会静默跳过。
 * - 受训技能单独走 pickSkills（从职业可选技能里挑，写进 classTrainedSkills）。
 * - 每步都是独立请求；用 AbortSignal 可随时中止（已跑完的步骤会保留）。
 */
export async function buildAll(o: BuildOptions): Promise<{ char: Character; steps: BuildStep[] }> {
  const steps: BuildStep[] = [];
  let working = o.char;
  const nameOf = (id: string) => o.ctx.nameMap.get(id)?.name;
  const list = decisionList(working, { targetLevel: o.level });
  const total = list.length;

  for (let i = 0; i < total; i++) {
    if (o.signal?.aborted) break; // 用户中止：已跑完的步骤保留，不再继续
    const d = list[i];
    if (d.status === "filled") continue;
    // 只跑玩家勾选的项（buildAll 直接改动当前卡，跑没勾的项会越过玩家的选择）
    if (o.include && !o.include.has(d.id)) continue;

    try {
      if (d.kind === "skills") {
        const sc = skillsFor(working, o.ctx);
        if (sc.available.length === 0) continue; // 还没选职业，无可选技能
        const res = await pickSkills({
          cfg: o.cfg,
          brief: cardBrief(working, { nameOf }),
          available: sc.available,
          count: sc.count,
          current: working.classTrainedSkills ?? [],
          instruction: o.instruction,
          signal: o.signal,
        });
        working = { ...working, classTrainedSkills: res.skills };
        const note: PickedNote = { kind: "ok", text: "已选受训技能 " + (res.skills.length ? res.skills.join("、") : "（未选）") };
        steps.push({ id: d.id, label: d.label, ok: true, note });
        o.onStep?.(i + 1, total, working, steps[steps.length - 1]);
        continue;
      }

      if (d.kind === "abilities") {
        const race = working.raceId ? o.ctx.raceById.get(working.raceId) : undefined;
        const cls = working.classId ? o.ctx.classById.get(working.classId) : undefined;
        const res = await pickAbilities({
          cfg: o.cfg,
          brief: cardBrief(working, { nameOf }),
          current: working.abilities,
          racial: racialBonus(race, working.raceAbility2Choice),
          raceName: race?.name ?? "",
          className: cls?.name ?? "",
          level: working.level,
          instruction: o.instruction,
          signal: o.signal,
        });
        working = applyAbilityScores(working, res.abilities);
        const note: PickedNote = {
          kind: "ok",
          text: "已分配（购点 " + res.used + "/" + BUY_POINTS + " 点" + (res.boostTotal ? "，升级提升 +" + res.boostTotal + " 点" : "") + "）",
        };
        steps.push({ id: d.id, label: d.label, ok: true, note });
        o.onStep?.(i + 1, total, working, steps[steps.length - 1]);
        continue;
      }

      const cands = candidatesFor(d, o.ctx, working, o.level);
      if (!cands || cands.length === 0) continue; // 技能 / 装备 / 仪式：本版不代选
      const res = await pickForDecision({
        cfg: o.cfg,
        brief: cardBrief(working, { nameOf }),
        decision: d,
        candidates: cands,
        instruction: o.instruction,
        currentName: d.current ? nameOf(d.current) : undefined,
        signal: o.signal,
      });
      const out = applyPicked(working, d, res, o.ctx);
      working = out.char;
      steps.push({ id: d.id, label: d.label, ok: out.note.kind !== "err", note: out.note, pickId: res.id });
      o.onStep?.(i + 1, total, working, steps[steps.length - 1]);
    } catch (e) {
      // 中止引发的取消错误：不算失败，直接停
      if (o.signal?.aborted) break;
      const note: PickedNote = { kind: "err", text: describeError(e) };
      steps.push({ id: d.id, label: d.label, ok: false, note });
      o.onStep?.(i + 1, total, working, steps[steps.length - 1]);
    }
  }
  return { char: working, steps };
}
