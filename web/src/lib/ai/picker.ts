// AI 车卡：单步决策 —— 把「一项决定 + 候选列表」交给模型，拿回一个 id。
//
// 硬校验就在这个函数里：返回的 choice 必须能在候选列表里命中（先按 id，再按名称精确匹配），
// 否则把错误回灌一次让它自己改；两次都不行就抛错。
// 这是「AI 只能挑已有资源」的最后一道闸门 —— 模型无论说什么，落不到候选里的答案都不会被采纳。

import type { Entry } from "../../data/types";
import type { Decision } from "../../sheet/candidates";
import { ABILITY_KEYS, BUY_POINTS, buyPointsUsed, type AbilityKey } from "../../sheet/character";
import { chatJson } from "./chat";
import { abilityPrompt, decisionPrompt, invalidPickPrompt, skillPrompt, systemPrompt } from "./prompts";
import { excerpt } from "./transport";
import { AiError, type AiConfig, type ChatMessage } from "./types";

export interface PickArgs {
  cfg: AiConfig;
  /** 角色现状摘要（lib/ai/brief 生成） */
  brief: string;
  decision: Decision;
  candidates: Entry[];
  /** 玩家的自然语言要求 */
  instruction?: string;
  /** 改卡模式：当前该槽位已选内容的名称 */
  currentName?: string;
  signal?: AbortSignal;
}

export interface PickResult {
  id: string;
  name: string;
  reason: string;
}

interface RawPick {
  choice?: unknown;
  reason?: unknown;
}

// 理由是要显示在界面上的模型输出：长度封顶，且按纯文本渲染（React 会转义，不当作 HTML）
function capReason(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length > 300 ? t.slice(0, 300) + "…" : t;
}

function readReason(raw: RawPick): string {
  return capReason(raw.reason);
}

/** 命中候选才返回结果：先按 id，再按名称精确匹配（模型偶尔回报名称而不是 id）。 */
function resolveChoice(raw: RawPick, candidates: Entry[]): PickResult | null {
  const choice = typeof raw.choice === "string" ? raw.choice.trim() : "";
  if (!choice) return null;
  const byId = candidates.find((e) => e.id === choice);
  if (byId) return { id: byId.id, name: byId.name, reason: readReason(raw) };
  const byName = candidates.find((e) => e.name.trim() === choice);
  if (byName) return { id: byName.id, name: byName.name, reason: readReason(raw) };
  return null;
}

function slotNoteOf(d: Decision): string | undefined {
  if (d.slotLevel === undefined) return undefined;
  return typeof d.slotLevel === "number" ? "该槽位应选 " + d.slotLevel + " 级及以下" : d.slotLevel === "paragon" ? "典范槽位" : "传奇槽位";
}

/** 让模型为一项决定挑一个候选。返回的 id 保证在 candidates 里。 */
export async function pickForDecision(a: PickArgs): Promise<PickResult> {
  if (a.candidates.length === 0) {
    throw new AiError(
      "config",
      "这一项现在没有可选项。常见原因：还没选种族/职业（候选会因此为空），或该等级下确实没有符合条件的内容。",
    );
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    {
      role: "user",
      content: decisionPrompt({
        brief: a.brief,
        decisionLabel: a.decision.label,
        slotNote: slotNoteOf(a.decision),
        candidates: a.candidates,
        instruction: a.instruction,
        currentName: a.currentName,
      }),
    },
  ];

  const first = await chatJson<RawPick>(a.cfg, messages, { signal: a.signal });
  const picked = resolveChoice(first.data, a.candidates);
  if (picked) return picked;

  // 不在候选里：把规则再说一遍并回灌一次（等价于用户点了个列表外的选项，界面提示他重选）
  const second = await chatJson<RawPick>(
    a.cfg,
    [...messages, { role: "assistant", content: first.raw }, { role: "user", content: invalidPickPrompt(String(first.data.choice ?? "")) }],
    { signal: a.signal },
  );
  const again = resolveChoice(second.data, a.candidates);
  if (again) return again;

  throw new AiError("format", "模型两次都没有从候选列表里挑选。最后一次返回：" + excerpt(second.raw));
}

export interface AbilityPickArgs {
  cfg: AiConfig;
  brief: string;
  /** 当前基础属性（购点值） */
  current: Record<string, number>;
  racial: Record<string, number>;
  raceName: string;
  className: string;
  /** 当前已用购点 */
  used: number;
  instruction?: string;
  signal?: AbortSignal;
}

export interface AbilityPickResult {
  abilities: Record<AbilityKey, number>;
  reason: string;
  used: number;
}

interface RawAbilities {
  abilities?: unknown;
  reason?: unknown;
}

type AbilityRead = { ok: true; abilities: Record<AbilityKey, number>; used: number } | { ok: false; error: string };

/** 校验模型给的属性数组：六项齐全、8–18 的整数、购点不超过上限。 */
function readAbilities(raw: RawAbilities): AbilityRead {
  const src = raw.abilities;
  if (!src || typeof src !== "object") return { ok: false, error: "没有给出 abilities 对象" };
  const obj = src as Record<string, unknown>;
  const abilities = {} as Record<AbilityKey, number>;
  for (const k of ABILITY_KEYS) {
    const v = obj[k];
    if (typeof v !== "number" || !Number.isInteger(v)) {
      return { ok: false, error: "属性 " + k + " 不是整数（收到 " + JSON.stringify(v) + "）" };
    }
    if (v < 8 || v > 18) return { ok: false, error: "属性 " + k + " = " + v + "，超出 8–18 的范围" };
    abilities[k] = v;
  }
  const used = buyPointsUsed(abilities);
  if (used > BUY_POINTS) return { ok: false, error: "这个数组要花 " + used + " 点，超过上限 " + BUY_POINTS + " 点" };
  return { ok: true, abilities, used };
}

/**
 * 让模型分配 22 点属性。
 * 返回的数组保证合法（六项齐全、8–18 整数、购点 ≤ 22）；不合法就带原因回灌一次。
 */
export async function pickAbilities(a: AbilityPickArgs): Promise<AbilityPickResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    {
      role: "user",
      content: abilityPrompt({
        brief: a.brief,
        current: a.current,
        racial: a.racial,
        raceName: a.raceName,
        className: a.className,
        used: a.used,
        instruction: a.instruction,
      }),
    },
  ];

  const first = await chatJson<RawAbilities>(a.cfg, messages, { signal: a.signal });
  const read = readAbilities(first.data);
  if (read.ok) return { abilities: read.abilities, reason: capReason(first.data.reason), used: read.used };

  const second = await chatJson<RawAbilities>(
    a.cfg,
    [
      ...messages,
      { role: "assistant", content: first.raw },
      {
        role: "user",
        content:
          "上面的分配不合法：" + read.error + "。请重新给出合法数组（六项 str/con/dex/int/wis/cha 齐全、8–18 的整数、总花费不超过 " + BUY_POINTS + " 点）。",
      },
    ],
    { signal: a.signal },
  );
  const again = readAbilities(second.data);
  if (again.ok) return { abilities: again.abilities, reason: capReason(second.data.reason), used: again.used };
  throw new AiError("format", "模型两次给出的属性分配都不合法（" + again.error + "）。");
}

export interface SkillPickArgs {
  cfg: AiConfig;
  brief: string;
  available: { name: string; ability: string }[];
  count: number;
  current: string[];
  instruction?: string;
  signal?: AbortSignal;
}

export interface SkillPickResult {
  skills: string[];
  reason: string;
}

interface RawSkills {
  skills?: unknown;
  reason?: unknown;
}

type SkillRead = { ok: true; skills: string[] } | { ok: false; error: string };

/** 校验模型给的技能列表：每一项都在职业可选里、数量不超上限。 */
function readSkills(raw: RawSkills, available: { name: string }[], count: number): SkillRead {
  const arr = raw.skills;
  if (!Array.isArray(arr)) return { ok: false, error: "没有给出 skills 数组" };
  const names = new Set(available.map((s) => s.name));
  const out: string[] = [];
  for (const s of arr) {
    if (typeof s !== "string") return { ok: false, error: "skills 里混入了非字符串项" };
    if (!names.has(s)) return { ok: false, error: "技能「" + s + "」不在职业可选列表里" };
    if (!out.includes(s)) out.push(s);
  }
  if (count > 0 && out.length > count) {
    return { ok: false, error: "最多选 " + count + " 个，给出了 " + out.length + " 个" };
  }
  return { ok: true, skills: out };
}

/** 让模型从职业技能里挑受训技能；返回的技能保证都在可选列表里且数量合法。 */
export async function pickSkills(a: SkillPickArgs): Promise<SkillPickResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    {
      role: "user",
      content: skillPrompt({
        brief: a.brief,
        available: a.available,
        count: a.count,
        current: a.current,
        instruction: a.instruction,
      }),
    },
  ];

  const first = await chatJson<RawSkills>(a.cfg, messages, { signal: a.signal });
  const read = readSkills(first.data, a.available, a.count);
  if (read.ok) return { skills: read.skills, reason: capReason(first.data.reason) };

  const second = await chatJson<RawSkills>(
    a.cfg,
    [
      ...messages,
      { role: "assistant", content: first.raw },
      {
        role: "user",
        content: "上面的技能选择不合法：" + read.error + "。请重新给出合法列表（每一项都必须是可选技能名，数量不超过 " + a.count + "）。",
      },
    ],
    { signal: a.signal },
  );
  const again = readSkills(second.data, a.available, a.count);
  if (again.ok) return { skills: again.skills, reason: capReason(second.data.reason) };
  throw new AiError("format", "模型两次给出的受训技能都不合法（" + again.error + "）。");
}
