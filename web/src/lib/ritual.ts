// 仪式卡片的头部拆解。
//
// 官方仪式卡把等级/类别/时间/材料花费/市场价格/关键技能/持续时间/前提塞进同一个
// <div class=ritualinfo>，每项一个 <span>。直接交给 HTML 渲染，八个 span 会连成一片，
// 读起来是一段没有断句的长句。这里把头部拆成「标签 → 值」的数据行，卡片据此按
// 「识别层 / 数据层 / 条件层」三层排版。
//
// 两种来源形态都要认：
//   · 管线产物（词条数据）：sourceText 里是 wikitext，行写作 <span>''等级：''{{!!ritual-level}}</span>
//   · 私设条目（buildEntry）：details 里已渲染成 HTML，行写作 <div><span class=bold>等级：</span>3</div>
//
// 另外顺手做两件事（都是「卡片抬头已经展示过、正文里不该再出现」的内容）：
//   · 删掉标题行 `! {{!!title}} ^^{{!!source}}{{!!magazine}}^^`（名字在卡片抬头，来源在抬头右上角）
//   · 把整行 `//风味引子//` 单独抽出来，供卡片排版成斜体引子

export interface RitualDatum {
  label: string;
  value: string;
}

export interface RitualParts {
  /** 头部数据行（按原文顺序，空行已剔除） */
  data: RitualDatum[];
  /** 风味引子（正文里整行 `//…//`），无则空串 */
  flavor: string;
  /** 去掉头部、标题行与风味引子后剩下的效果正文 */
  body: string;
  /** body 是 wikitext（true）还是已渲染好的 HTML（false） */
  bodyIsWiki: boolean;
}

/** 识别层三项：属于「这是什么仪式」，卡片用胶囊单独承载 */
export const RITUAL_IDENTITY_LABELS = ["等级", "类别", "关键技能"] as const;
/** 条件层：属于「能不能用」，卡片单独拎出来做注记 */
export const RITUAL_GATE_LABELS = ["前提", "特殊要求"] as const;
/** 数据层建议顺序：先「何时生效」，再「要花多少」——官方卡片的阅读顺序 */
export const RITUAL_STAT_ORDER = ["时间", "持续时间", "材料花费", "市场价格"] as const;

const HEAD_OPEN = /<div\s+class\s*=\s*"?ritualinfo"?\s*>/i;

/** 展开 `{{!!字段}}` 宏（未知宏与普通 `{{转clusion}}` 一并清空） */
function expandMacros(text: string, fields: Record<string, string>): string {
  return text
    .replace(/\{\{!!([^}]+)\}\}/g, (_m, name: string) => String(fields[name] ?? ""))
    .replace(/\{\{[^}]+\}\}/g, "");
}

/** 去掉标签与 wiki 标记，压成一行可读文本 */
function plainText(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/''/g, "")
    .replace(/\/\//g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 从 openIndex 处的开标签起，按同名标签配对切出整块，返回块、块内内容与剩余文本。
 * ritualinfo 在私设条目里是嵌套结构（外层 div 套多行 div），非贪婪正则会在第一行就收尾，
 * 所以这里老老实实数层级。块内内容是后面逐行取数据行的范围——不能拿整块直接扁平化，
 * 否则八行会被压成一行。
 */
function sliceBalanced(text: string, openIndex: number, tag = "div"): { block: string; inner: string; rest: string } {
  const tagRe = new RegExp("<(/?)" + tag + "\\b[^>]*>", "gi");
  tagRe.lastIndex = openIndex;
  let depth = 0;
  let innerStart = -1;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text))) {
    if (m[1] === "/") {
      depth--;
      if (depth === 0) {
        const end = m.index + m[0].length;
        return {
          block: text.slice(openIndex, end),
          inner: text.slice(innerStart, m.index),
          rest: text.slice(0, openIndex) + text.slice(end),
        };
      }
    } else {
      depth++;
      if (depth === 1) innerStart = m.index + m[0].length;
    }
  }
  return { block: text.slice(openIndex), inner: text.slice(innerStart), rest: text.slice(0, openIndex) };
}

/** ritualinfo 块内逐行取 `标签：值`（重复标签只取首个） */
function parseRows(inner: string, fields: Record<string, string>): RitualDatum[] {
  const html = expandMacros(inner, fields);
  const rows: RitualDatum[] = [];
  const re = /<(span|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = plainText(m[2]);
    if (!text) continue;
    const i = text.search(/[：:]/);
    if (i <= 0) continue;
    const label = text.slice(0, i).trim();
    const value = text.slice(i + 1).trim();
    // 标签过长说明这不是一行数据，而是被误匹配的正文
    if (!label || !value || label.length > 10) continue;
    if (rows.some((r) => r.label === label)) continue;
    rows.push({ label, value });
  }
  return rows;
}


/** 剥掉外层 `<div class=ritual>` 容器（正文抽走后会剩下孤零零的闭合标签） */
function unwrapRitualDiv(text: string): string {
  return text
    .replace(/^\s*<div\s+class\s*=\s*"?ritual"?\s*>\s*/i, "")
    .replace(/\s*<\/div>\s*$/i, "");
}

/**
 * 拆解一条仪式词条的头部。
 * 优先用带 ritualinfo 的那一版文本（词条数据用 sourceText，私设条目用 details）。
 */
export function ritualParts(entry: { sourceText?: string; details?: string; fields?: Record<string, string> }): RitualParts {
  const fields = entry.fields ?? {};
  const sourceText = (entry.sourceText ?? "").replace(/\r\n/g, "\n");
  const details = entry.details ?? "";

  // 选源：哪一版带 ritualinfo 就用哪一版；都不带时，wikitext 优先（私设条目的 details 可能还是空的）
  const useWiki = HEAD_OPEN.test(sourceText) || (!HEAD_OPEN.test(details) && !!sourceText);
  let work = useWiki ? sourceText : details;

  let data: RitualDatum[] = [];
  const head = HEAD_OPEN.exec(work);
  if (head) {
    const { inner, rest } = sliceBalanced(work, head.index);
    data = parseRows(inner, fields);
    work = rest;
  }

  let flavor = "";
  if (useWiki) {
    // 标题行：名字与来源都已在卡片抬头展示，正文里不再重复
    work = work.replace(/^![^\n]*\{\{!!title\}\}[^\n]*$/m, "");
    // 风味引子：整行 `//…//`（官方卡片名称下方那句引子）
    const fm = work.match(/^\/\/\s*([^\n]*?)\s*\/\/\s*$/m);
    if (fm) {
      flavor = plainText(fm[1]);
      work = work.replace(fm[0], "");
    }
    work = unwrapRitualDiv(work);
  }

  return { data, flavor, body: work.trim(), bodyIsWiki: useWiki };
}

/** 按给定标签顺序取数据行；未列出但确实存在的标签按原顺序追加在后 */
export function orderStats(data: RitualDatum[], order: readonly string[] = RITUAL_STAT_ORDER): RitualDatum[] {
  const used = new Set<string>([...RITUAL_IDENTITY_LABELS, ...RITUAL_GATE_LABELS]);
  const get = (label: string) => data.find((d) => d.label === label);
  const out: RitualDatum[] = [];
  for (const label of order) {
    const hit = get(label);
    if (hit) out.push(hit);
  }
  for (const d of data) {
    if (used.has(d.label) || out.some((o) => o.label === d.label)) continue;
    out.push(d);
  }
  return out;
}

/** 条件层数据行（前提/特殊要求） */
export function gateRows(data: RitualDatum[]): RitualDatum[] {
  return data.filter((d) => (RITUAL_GATE_LABELS as readonly string[]).includes(d.label));
}
