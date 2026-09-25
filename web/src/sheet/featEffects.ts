// 专长的「效果解析」：从正文里读出它赠送/替换了哪些威能。
//
// 从 CharacterSheet.tsx 原样搬来（那两处用法与 AI 车卡必须共用同一份判断）：
// 选择专长时人物页据此把赠送威能加入面板、把替换型专长送去选槽位，
// AI 代选专长时走的是同一条路 —— 否则「AI 选的专长」与「手点的专长」效果会不一样。
//
// 全部是纯函数：只读 Entry 文本 + 一个 id/名称解析器，不碰 React 状态。

import type { Entry } from "../data/types";
import type { PowerSlots } from "./character";

/** 专长正文（前提 + 增益 + 特殊）拼接，用于扫描其中赠送/替换威能的表述 */
export function featBodyText(f: Entry): string {
  return [f.prerequisite, f.benefit, (f as { fields?: { special?: string } }).fields?.special].filter(Boolean).join("\n");
}

// 专长赠送的威能：正文「获得[[威能]]威能」的明确赠送句。
// 排除否定语境（不/不会/不再/没有/未曾获得）与被动引用（「获得[[X]]的通常效果」），
// 也不把替换型专长（单独用 featReplacementInfo 处理）算作普通赠送。
export function featGrantedPowers(f: Entry, lookup: (t: string) => Entry | undefined): Entry[] {
  const out: Entry[] = [];
  const text = featBodyText(f);
  const re = /获得\[\[([^\]|]+)(?:\|[^\]]+)?\]\](?:威能)?(?![^。！？!?.,，、\n])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 3), m.index);
    if (/(不|不会|不再|没有|未曾|并非)$/.test(before)) continue;
    const e = lookup(m[1].trim());
    if (e && e.category === "power" && !out.some((x) => x.id === e.id)) out.push(e);
  }
  return out;
}

// 专长前提是否与「职业特性」相关：前提中出现「」引用的职业特性名或「职业特性」字样（如「引导神力」职业特性）。
// 相关时，该专长赠送的威能应送入「种族/职业威能」（special），而非标准攻击/辅助空位。
export function featPrereqClassFeature(f: Entry): boolean {
  const p = f.prerequisite ?? "";
  if (!p) return false;
  return /「[^」]+」/.test(p) || /职业特性/.test(p);
}

export interface FeatReplacement {
  newPower: Entry;
  hint: string; // 目标说明文字（如「替换你的一个16级或更高级的辅助威能」）
  targetCat?: keyof PowerSlots; // 被替换威能所在的槽位类别（供替换弹窗只显示相关槽位）
}

// 从目标说明片段解析被替换威能的槽位类别
function replTargetCat(fragment: string): keyof PowerSlots | undefined {
  if (/辅助/.test(fragment)) return "utility";
  if (/遭遇攻击|遭遇/.test(fragment)) return "encounter";
  if (/每日攻击|每日/.test(fragment)) return "daily";
  if (/种族威能/.test(fragment)) return "special";
  return undefined;
}

// 专长将旧威能替换为新威能：识别三类替换表述，返回新威能与目标说明（供选择后弹面板询问填入哪个格子）。
//  - 「获得[[新]]专长威能，它会替换你的N级辅助威能」
//  - 「[[新]]专长威能替换你的一个N级或更高级的辅助威能」
//  - 「将你的[[旧]]种族威能替换成[[新]]威能」
export function featReplacementInfo(f: Entry, lookup: (t: string) => Entry | undefined): FeatReplacement | undefined {
  const text = featBodyText(f);
  const resolve = (t: string): Entry | undefined => {
    const e = lookup(t.trim());
    return e && e.category === "power" ? e : undefined;
  };
  let m: RegExpMatchArray | null;
  // 「将一个N级或更高级的X威能替换成[[新]]威能」/「你将一个N级或更高级的X威能替换成[[新]]威能」
  m = text.match(/(?:你可以)?将一个(\d+)级或更高级的(辅助|遭遇攻击|每日攻击)威能替换成\[\[([^\]]+)\]\](?:威能)?/);
  if (m) {
    const np = resolve(m[3]);
    if (np) {
      const cat = m[2] === "辅助" ? "utility" : m[2] === "遭遇攻击" ? "encounter" : "daily";
      return { newPower: np, hint: "替换你的" + m[1] + "级或更高级的" + m[2] + "威能", targetCat: cat };
    }
  }
  // 「获得[[新]]专长威能，它会替换你的N级辅助威能」
  m = text.match(/获得\[\[([^\]]+)\]\](?:专长威能)?，?\s*它会替换你的([^。！？\n]+)/);
  if (m) { const np = resolve(m[1]); if (np) return { newPower: np, hint: "替换你的" + m[2].trim(), targetCat: replTargetCat(m[2]) }; }
  m = text.match(/\[\[([^\]]+)\]\](?:专长威能)?替换你的([^。！？\n]+)/);
  if (m) { const np = resolve(m[1]); if (np) return { newPower: np, hint: "替换你的" + m[2].trim(), targetCat: replTargetCat(m[2]) }; }
  m = text.match(/将你的\[\[([^\]]+)\]\][^。！？\n]{0,12}?替换成\[\[([^\]]+)\]\][^。！？\n]{0,8}?威能/);
  if (m) { const np = resolve(m[2]); if (np) return { newPower: np, hint: "替换你的" + m[1].trim() + "威能", targetCat: "special" }; }
  // 「你失去该威能，且获得[[新]]威能」（如游荡者专长「背刺」）
  m = text.match(/你失去该威能，?\s*且获得\[\[([^\]]+)\]\](?:威能)?/);
  if (m) { const np = resolve(m[1]); if (np) return { newPower: np, hint: "替换一个你已有的相关攻击威能", targetCat: replTargetCat(text) }; }
  return undefined;
}
