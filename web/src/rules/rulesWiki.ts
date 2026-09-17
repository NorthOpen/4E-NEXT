import type { RuleEntry } from "./types";

/**
 * 万律 wikitext → HTML（规则页速查正文专用）。
 * 覆盖万律书实际使用的语法子集：标题 !~!!!!、''粗体''、//斜体//、* # 列表（含 *# 混排）、
 * [[链接|别名]]、{{转写}}（就地展开为引文块）、<div class="sidebar"> 边栏块，
 * 以及正文里大量存在的原生 HTML（dndTable 表格、说明块）——原生 HTML 走白名单原样放行，
 * 非白名单标签（<<power-format>> 等模板、$:/dnd/images/*）剥离，模板词条改由字段渲染成数据卡。
 */

export interface RuleContext {
  byId: Map<string, RuleEntry>;
  /** 链接目标（标题 / 别名）→ 词条 id */
  resolve: (target: string) => string | undefined;
}

const TOKEN_RE = /\u0000(\d+)\u0000/g;
const INLINE_TOKEN_RE = /\u0001(\d+)\u0001/g;
const VOID_TAGS = new Set(["br", "hr", "img", "input", "col", "wbr"]);
const ALLOWED_TAGS = new Set([
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "div", "span", "p", "b", "strong", "i", "em", "u", "s", "br", "hr", "a",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "sup", "sub", "code", "pre", "blockquote", "dl", "dt", "dd",
]);
/** 内部只可能是行内内容的标签（其文本不再包 <p>） */
const INLINE_INNER = new Set([
  "td", "th", "caption", "tr", "thead", "tbody", "tfoot", "span", "b", "strong", "i", "em", "u", "s",
  "sup", "sub", "a", "li", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "code", "blockquote", "dl",
]);
const BLOCK_LINE_TAGS = new Set(["table", "div", "p", "ul", "ol", "blockquote", "dl"]);
/** 这几个标签本身可能只是排版外壳（<div class="text">…</div>），内部无块级结构时按行内处理 */
const MAYBE_INLINE = new Set(["div", "p", "td", "th"]);
const BLOCK_INSIDE = /<(table|div|ul|ol|p|blockquote|dl|h[1-6]|tr)\b/i;

/** 保留合法实体（&nbsp; 等）的文本转义 */
export function escapeText(s: string): string {
  return s.replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,8};|#\d{1,6};)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

/**
 * 去掉事件处理器 / javascript: 伪协议，其余属性原样保留。
 *
 * 这里是**第二道**过滤：真正的边界在 lib/sanitize.ts（所有 dangerouslySetInnerHTML 都过它）。
 * 之所以还留着，是因为本函数的输出会先经过几轮字符串替换，早一步清掉更省事。
 *
 * 两处细节都是真实踩过的坑：
 *   · 第一个正则要求属性前有空白，但 HTML 解析器在「带引号的属性值」后面遇到非空白字符时
 *     是**报错后继续解析**——`href="x"onclick="y"` 里 onclick 依然是有效属性，
 *     所以分隔符必须是 \s / " / ' / / 四种之一（否则就漏了）。
 *   · 保留分隔符本身（$1），别把引号一起吃掉，否则后面的标签会解析错乱。
 */
function sanitizeTag(tag: string): string {
  return tag
    .replace(/([\s"'/])on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "$1")
    .replace(/(href|src)\s*=\s*(["']?)\s*(javascript|vbscript|data)\s*:[^"'>\s]*/gi, '$1="#"');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

interface Frame {
  entry: RuleEntry;
  ctx: RuleContext;
  depth: number;
  blocks: string[];
}

function stash(f: Frame, html: string): string {
  f.blocks.push(html);
  return "\u0000" + (f.blocks.length - 1) + "\u0000";
}

/** 逐层还原占位符：块级 HTML 内部可能还嵌着更早生成的占位符 */
function restore(html: string, blocks: string[]): string {
  let out = html;
  for (let pass = 0; pass < 12 && out.includes("\u0000"); pass++) {
    const next = out.replace(TOKEN_RE, (_m, i: string) => blocks[Number(i)] ?? "");
    if (next === out) break;
    out = next;
  }
  return out;
}

function linkHtml(f: Frame, target: string, label: string): string {
  const id = f.ctx.resolve(target);
  if (id && id !== f.entry.id) {
    return '<a class="rule-link" role="link" tabindex="0" data-rule="' + escapeAttr(id) + '">' + escapeText(label) + "</a>";
  }
  return escapeText(label);
}

/** 找到同名闭合标签（计同层嵌套），返回闭合标签区间；找不到返回 null */
function findClosing(src: string, from: number, name: string): { start: number; end: number } | null {
  let depth = 1;
  let i = from;
  const openRe = new RegExp("<" + name + "(?=[\\s/>])", "gi");
  const closeRe = new RegExp("</" + name + "\\s*>", "gi");
  while (i < src.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const o = openRe.exec(src);
    const c = closeRe.exec(src);
    if (!c) return null;
    if (o && o.index < c.index) {
      depth++;
      i = o.index + o[0].length;
      continue;
    }
    depth--;
    if (depth === 0) return { start: c.index, end: c.index + c[0].length };
    i = c.index + c[0].length;
  }
  return null;
}

// —— 行内：标签保护 → 转义 → 万律行内语法 ——
function inline(f: Frame, s: string): string {
  const tags: string[] = [];
  // <a href="##anchor">词</a>：术语表内的交叉引用，改为按链接文字就近跳转到同名词条
  let src = s.replace(/<a\s[^>]*href\s*=\s*["']##[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, label: string) => {
    const text = stripTags(label);
    return text ? "@@RULELINK:" + text + "@@" : "";
  });
  src = src.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g, (m, name: string) => {
    const n = name.toLowerCase();
    if (!ALLOWED_TAGS.has(n)) return "";
    tags.push(sanitizeTag(m));
    return "\u0001" + (tags.length - 1) + "\u0001";
  });
  let out = escapeText(src);
  out = out.replace(/@@RULELINK:([^@]+)@@/g, (_m, label: string) => linkHtml(f, label, label));
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, target: string, label: string) => linkHtml(f, target, label));
  out = out.replace(/\[\[([^\]]+)\]\]/g, (_m, target: string) => linkHtml(f, target, target));
  out = out.replace(/''([^'\n]+)''/g, "<b>$1</b>");
  out = out.replace(/\/\/([^/\n]+)\/\//g, "<i>$1</i>");
  out = out.replace(/__(.+?)__/g, "<u>$1</u>");
  out = out.replace(/\^\^([^\^]+)\^\^/g, "<sup>$1</sup>");
  out = out.replace(/~~([^~]+)~~/g, "<sub>$1</sub>");
  out = out.replace(/@@([^@]*)@@/g, "$1");
  out = out.replace(/\{\{!!([^}]+)\}\}/g, (_m, key: string) => escapeText(f.entry.fields[key.trim()] ?? ""));
  return out.replace(INLINE_TOKEN_RE, (_m, i: string) => tags[Number(i)] ?? "");
}

// —— 原生 HTML 抽取（白名单放行，其余剥离） ——
function extractRaw(f: Frame, src: string): string {
  let text = "";
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      text += src.slice(i);
      break;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(lt));
    if (!m) {
      text += src.slice(i, lt + 1);
      i = lt + 1;
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const gt = src.indexOf(">", lt);
    if (gt < 0) {
      text += src.slice(i);
      break;
    }
    if (!ALLOWED_TAGS.has(name)) {
      text += src.slice(i, lt);
      i = gt + 1;
      continue;
    }
    if (closing || VOID_TAGS.has(name) || /\/>$/.test(src.slice(lt, gt + 1))) {
      text += src.slice(i, lt) + stash(f, sanitizeTag(src.slice(lt, gt + 1)));
      i = gt + 1;
      continue;
    }
    const end = findClosing(src, gt + 1, name);
    if (!end) {
      text += src.slice(i, gt + 1);
      i = gt + 1;
      continue;
    }
    const inner = src.slice(gt + 1, end.start);
    const tag = sanitizeTag(src.slice(lt, gt + 1));
    const useInline = INLINE_INNER.has(name) || (MAYBE_INLINE.has(name) && !BLOCK_INSIDE.test(inner));
    const rendered = useInline
      ? inline(f, inner.replace(/\s*\n\s*/g, " ").trim())
      : renderSource(inner, f, f.depth + 1);
    text += src.slice(i, lt);
    const html = tag + rendered + "</" + name + ">";
    text += BLOCK_LINE_TAGS.has(name) ? "\n" + stash(f, html) + "\n" : stash(f, html);
    i = end.end;
  }
  return text;
}

/** 标题纯文本（去链接与粗体标记），用于判断标题是否重复 */
function headingText(raw: string): string {
  return stripTags(raw)
    .replace(/''/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .trim();
}

/**
 * 章节词条常写成「! 战斗顺序」+「{{战斗顺序}}」，转写块会再把同名标题渲染一遍。
 * 若引文块的标题（含边栏块内的标题）与紧邻的上一个标题同名，则省略重复的那一份。
 */
function dedupeEmbedTitle(html: string, lastHeading: string): string {
  if (!html.startsWith('<section class="rule-embed">')) return html;
  const headRe = /^<section class="rule-embed"><div class="rule-embed-head">([\s\S]*?)<\/div>/;
  const headMatch = headRe.exec(html);
  if (!headMatch) return html;
  // 引文块标题去掉维基内部的「边栏-」前缀，与正文里的词条名保持一致
  const label = headingText(headMatch[1]).replace(/^边栏-/, "").trim();
  const targets = new Set<string>();
  if (label) targets.add(label);
  if (lastHeading) targets.add(lastHeading);
  const same = (text: string) => targets.has(headingText(text).replace(/^边栏-/, "").trim());

  let out = html.replace(
    /^(<section class="rule-embed"><div class="rule-embed-head"><a[^>]*>)([^<]*)(<\/a>)/,
    (_m, pre: string, text: string, post: string) => pre + escapeText(text.replace(/^边栏-/, "")) + post,
  );
  // 与紧邻的上一个标题同名时，连引文块标题一起省略
  if (lastHeading && label === lastHeading) out = out.replace(headRe, '<section class="rule-embed">');
  out = out.replace(
    /^(<section class="rule-embed">(?:<div class="rule-embed-head">[\s\S]*?<\/div>)?\s*<aside class="rule-callout">\s*)<h([4-6])>([\s\S]*?)<\/h\2>/,
    (m, pre: string, _lv: string, text: string) => (same(text) ? pre : m),
  );
  out = out.replace(
    /^(<section class="rule-embed">(?:<div class="rule-embed-head">[\s\S]*?<\/div>)?)<h([4-6])>([\s\S]*?)<\/h\2>/,
    (m, pre: string, _lv: string, text: string) => (same(text) ? pre : m),
  );
  return out;
}

// —— 行级块渲染 ——
function renderLines(f: Frame, src: string): string {
  const out: string[] = [];
  const listStack: string[] = [];
  let para: string[] = [];
  const closeList = () => {
    while (listStack.length) out.push("</" + listStack.pop() + ">");
  };
  const flushPara = () => {
    if (para.length) {
      out.push("<p>" + inline(f, para.join(" ")) + "</p>");
      para = [];
    }
  };

  let lastHeading = "";
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const token = /^\u0000(\d+)\u0000$/.exec(line.trim());
    if (token) {
      flushPara();
      closeList();
      const idx = Number(token[1]);
      if (f.blocks[idx] !== undefined) f.blocks[idx] = dedupeEmbedTitle(f.blocks[idx], lastHeading);
      out.push(line.trim());
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    const h = /^(!{1,6})\s*(.+?)\s*$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      const level = Math.min(6, h[1].length + 3);
      lastHeading = headingText(h[2]);
      out.push("<h" + level + ">" + inline(f, h[2]) + "</h" + level + ">");
      continue;
    }
    const li = /^([*#]+)\s*(.*)$/.exec(line);
    if (li) {
      flushPara();
      const depth = li[1].length;
      const kind = li[1][depth - 1] === "#" ? "ol" : "ul";
      while (listStack.length > depth) out.push("</" + listStack.pop() + ">");
      while (listStack.length < depth - 1) {
        out.push("<ul>");
        listStack.push("ul");
      }
      if (listStack.length === depth && listStack[depth - 1] !== kind) out.push("</" + listStack.pop() + ">");
      if (listStack.length < depth) {
        out.push("<" + kind + ">");
        listStack.push(kind);
      }
      out.push("<li>" + inline(f, li[2]) + "</li>");
      continue;
    }
    if (/^={3,}\s*$/.test(line) || /^-{4,}\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push("<hr>");
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  closeList();
  return out.join("\n");
}

// —— 模板词条（威能/物品/专长/疾病）字段卡 ——
function statRow(label: string, value?: string): string {
  if (!value) return "";
  return '<div class="rule-stat-row"><dt>' + escapeText(label) + "</dt><dd>" + escapeText(value) + "</dd></div>";
}

function renderStatCard(f: Frame): string {
  const e = f.entry;
  const fl = e.fields;
  const rows: string[] = [];
  if (e.kind === "power") {
    rows.push(statRow("威能类型", fl["power-type"]), statRow("等级", fl.level), statRow("使用", fl.usage));
    rows.push(statRow("动作", fl.actionType), statRow("射程", fl.range), statRow("关键字", fl.keywords));
  } else if (e.kind === "item") {
    rows.push(statRow("物品等级", fl["item-level"] ?? fl.level), statRow("种类", fl["item-category"]));
    rows.push(statRow("适用", fl["item-suitable"]), statRow("稀有度", fl.rarity));
  } else if (e.kind === "feat") {
    rows.push(statRow("前提", fl.prerequisite), statRow("增益", fl.benefit));
  } else if (e.kind === "disease") {
    rows.push(statRow("等级", fl.level));
  }
  const flavor = fl.flavorText ? '<p class="rule-flavor">' + escapeText(fl.flavorText) + "</p>" : "";
  const details = fl.details ? '<div class="rule-details">' + renderSource(fl.details, f, f.depth + 1) + "</div>" : "";
  const body = e.text.replace(/^<<[^>]+>>\s*$/m, "").trim();
  const extra = body ? renderSource(body, f, f.depth + 1) : "";
  return '<div class="rule-stat">' + flavor + '<dl class="rule-stat-list">' + rows.join("") + "</dl>" + details + extra + "</div>";
}

/** 边栏块：按标签配对抽取（内部可能嵌套 <div>，不能用非贪婪匹配） */
function expandSidebars(text: string, f: Frame, depth: number): string {
  let out = "";
  let i = 0;
  for (;;) {
    const start = text.indexOf('<div class="sidebar">', i);
    if (start < 0) {
      out += text.slice(i);
      return out;
    }
    const open = start + '<div class="sidebar">'.length;
    const end = findClosing(text, open, "div");
    if (!end) {
      out += text.slice(i);
      return out;
    }
    const inner = text.slice(open, end.start);
    out += text.slice(i, start) + "\n" + stash(f, '<aside class="rule-callout">' + renderSource(inner, f, depth + 1) + "</aside>") + "\n";
    i = end.end;
  }
}

// —— 主入口 ——
function renderSource(src: string, f: Frame, depth: number): string {
  const frame: Frame = { entry: f.entry, ctx: f.ctx, depth, blocks: f.blocks };
  const text = src.replace(/\r\n?/g, "\n");
  if (/^<<(power|item|feat|disease)-format>>\s*$/.test(text.trim())) return renderStatCard(frame);

  // 宏调用（<<item-level-5ns>> 等模板开关）与图片转写一样不参与正文，直接剥离
  let out = expandSidebars(text.replace(/<<[^>]*>>/g, "").replace(/\[img\[[^\]]*\]\]/g, ""), frame, depth);

  // 转写：就地展开为引文块（限制递归深度，避免自引用死循环）
  out = out.replace(/\{\{([^{}]+)\}\}/g, (_m, raw: string) => {
    const target = raw.trim();
    if (target.startsWith("!!")) {
      return stash(frame, '<span class="rule-field-val">' + escapeText(frame.entry.fields[target.slice(2).trim()] ?? "") + "</span>");
    }
    const id = frame.ctx.resolve(target);
    const child = id ? frame.ctx.byId.get(id) : undefined;
    if (!child || child.id === frame.entry.id || depth >= 4) return "";
    const body = renderSource(child.text, { ...frame, entry: child }, depth + 1);
    return "\n" + stash(frame, '<section class="rule-embed"><div class="rule-embed-head">' + linkHtml(frame, child.id, child.title) + "</div>" + body + "</section>") + "\n";
  });

  return restore(renderLines(frame, extractRaw(frame, out)), frame.blocks);
}

export function renderRule(entry: RuleEntry, ctx: RuleContext): string {
  return renderSource(entry.text, { entry, ctx, depth: 0, blocks: [] }, 0);
}

/** 检索用纯文本（不展开转写：父词条的转写目标本身就是独立词条） */
export function rulePlainText(src: string): string {
  return src
    .replace(/<div class="sidebar">([\s\S]*?)<\/div>/g, " $1 ")
    .replace(/\{\{!![^}]*\}\}/g, " ")
    .replace(/\{\{([^{}]+)\}\}/g, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$1 $2")
    .replace(/\[\[([^\]]+)\]\]/g, " $1 ")
    .replace(/''/g, "")
    .replace(/\/\//g, " ")
    .replace(/^!+\s*/gm, " ")
    .replace(/^[*#]+\s*/gm, " ")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
