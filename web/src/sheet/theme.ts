import type { Entry } from "../data/types";

// 主题（Theme）威能解析：从主题条目正文中提取可授予/可选择的威能。
// 主题正文结构（经 wiki 语法，如 theme.json）：
//   !! 起始特性\n… ''增益：''… [[威能 英名]]…/ {{威能 英名}}\n
//   !! 额外特性\n… !!! 5级特性 … !!! 10级特性 …（可能授予新威能，或引用起始威能的增强）
//   !! 可选威能\n… !!! 2级辅助威能 … {{威能}} …（一节可能含多个备选威能，如“A 或 B”）
//
// 与职业能力面板一致：每个特性小节可能带一个或多个威能 powerRef；解析时逐小节拆出每个威能引用。
// powerRef 引用名（如「宝藏感知 Treasure Sense」）经 resolve 映射威能条目：
// 优先精确匹配 id，再按中文前缀兜底（id 英文名可能与正文引用的不同），未收录返回 undefined。

/** resolve：把引用名映射为威能条目（未收录返回 undefined） */
type Resolve = (ref: string) => Entry | undefined;

/** 截取 src 中 `!! 标题` 到下一个（可选的）`!! ` 标题之间的正文 */
function sectionBetween(src: string, startTitle: string, endTitle?: string): string {
  const re = new RegExp("\\n!! " + startTitle + "\\n(.*?)(?:\\n!! |$)", "s");
  const m = src.match(re);
  if (!m) return "";
  let body = m[1];
  if (endTitle) {
    const idx = body.search(new RegExp("\\n!! " + endTitle + "\\n"));
    if (idx >= 0) body = body.slice(0, idx);
  }
  return body;
}

/** 收集正文中的 `{{名称}}` / `[[名称]]` 引用名（去重，保持出现顺序） */
function extractRefs(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const ref = m[1].trim();
    if (ref && !seen.has(ref)) { seen.add(ref); out.push(ref); }
  }
  for (const m of body.matchAll(/\[\[([^[|\]]+?)\]\]/g)) {
    const ref = m[1].trim();
    if (ref && !seen.has(ref)) { seen.add(ref); out.push(ref); }
  }
  return out;
}

/** 按 `!!! ` 小节切分正文，返回「小节标题 → 该节引用名列表」。前导介绍段标题不以「N级」开头则被过滤。 */
function tierSubsections(body: string): { title: string; refs: string[] }[] {
  return body.split(/^!!!\s+/m)
    .filter((s) => s.trim())
    .map((part) => {
      const lines = part.trim().split("\n");
      const title = lines[0].trim();
      return { title, refs: extractRefs(lines.slice(1).join("\n")) };
    })
    .filter((s) => /\d+级/.test(s.title));
}

/** 从小节标题解析最低等级（如「2级辅助威能」→2，「3级，13级，23级攻击威能」→3） */
export function tierLevel(title: string): number {
  const m = title.match(/\d+/);
  return m ? parseInt(m[0], 10) : 1;
}

export interface StartingPower {
  ref: string;
  power: Entry | undefined;
}

/** 起始特性的威能引用列表（含解析结果，供展示「未收录」提示与自动加入判定） */
export function themeStarting(entry: Entry, resolve: Resolve): StartingPower[] {
  const body = sectionBetween(entry.sourceText, "起始特性", "额外特性");
  return extractRefs(body).map((ref) => ({ ref, power: resolve(ref) }));
}

/** 起始特性可解析的威能条目（自动加入威能面板用，多选时返回全部交用户择一） */
export function themeStartingPowers(entry: Entry, resolve: Resolve): Entry[] {
  return themeStarting(entry, resolve).map((s) => s.power).filter((p): p is Entry => !!p);
}

export interface PowerOption {
  title: string;               // 小节标题（如「5级特性」「2级辅助威能」）
  ref: string;                 // 引用名
  power: Entry | undefined;    // 解析所得威能（未收录为 undefined）
}

// 解析每个小节内的每个威能引用为一个独立选项（用于多选小节：荒神能手「A 或 B」、火焰工匠分级造火等）
function refOptions(subs: { title: string; refs: string[] }[], resolve: Resolve): PowerOption[] {
  const out: PowerOption[] = [];
  for (const sub of subs) for (const ref of sub.refs) out.push({ title: sub.title, ref, power: resolve(ref) });
  return out;
}

/** 额外特性（5级/10级）中授予的威能。跳过已由起始特性提供的威能（如大地锻工 5级 引用同一石质甲胄，属增强而非新授予）。 */
export function themeExtraPowers(entry: Entry, resolve: Resolve): PowerOption[] {
  const body = sectionBetween(entry.sourceText, "额外特性", "可选威能");
  const startIds = new Set(themeStarting(entry, resolve).map((s) => s.power && s.power.id).filter(Boolean) as string[]);
  return refOptions(tierSubsections(body), resolve).filter((o) => o.ref && !(o.power && startIds.has(o.power.id)));
}

/** 可选威能：2/6/10 级以及部分主题的「3/13/23级攻击威能」等小节的备选威能 */
export function themeOptionalPowers(entry: Entry, resolve: Resolve): PowerOption[] {
  const body = sectionBetween(entry.sourceText, "可选威能");
  return refOptions(tierSubsections(body), resolve);
}

// 主题正文章节树：按「!! 一级标题」与「!!! 子标题」切分为嵌套结构，
// 供主题面板把「扮演/创建」等 lore 章节折叠、机制章节（起始特性起）展开。
export interface ThemeSection {
  title?: string;          // 标题（无标题的引言段为 undefined，渲染为「主题简介」）
  level: number;           // 标题层级（!!=2，!!!=3+）
  body: string;            // 本节点下、不含标题行的正文
  subs: ThemeSection[];    // 子章节（低层标题）
}

/** 把主题 sourceText 按标题层级解析为章节树（标题行不进入 body） */
export function splitThemeSections(src: string): ThemeSection[] {
  const lines = src.split("\n");
  const root: ThemeSection = { level: 0, body: "", subs: [] };
  const stack: ThemeSection[] = [root];
  for (const raw of lines) {
    const trimmed = raw.trim();
    const m = /^(!{2,})\s+(.*)$/.exec(trimmed);
    if (m) {
      const level = m[1].length;
      const sec: ThemeSection = { title: m[2].trim(), level, body: "", subs: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      stack[stack.length - 1].subs.push(sec);
      stack.push(sec);
    } else {
      stack[stack.length - 1].body += raw + "\n";
    }
  }
  const roots = root.subs;
  // 首个标题前的无标题引言（若有）作为「主题简介」小节排在最前
  const intro = root.body.replace(/^\s*$/gm, "").trim();
  if (intro) roots.unshift({ title: undefined, level: 2, body: intro, subs: [] });
  return roots;
}

/** 主题正文中机制部分的起始标题名（其之前的章节视为 lore，折叠） */
export const THEME_MECH_START = "起始特性";