import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonl } from "../../lib/io.js";
import { MONSTERS_CANONICAL_DIR, MONSTERS_TIDDLERS_DIR } from "../../lib/paths.js";
import type { MonsterEntry, MonsterPower } from "../../schema/monster.js";

/**
 * 展示态导出：把规范层渲染成 4E Wiki 的 creature 词条（TiddlyWiki tiddler）。
 *
 * 为什么要这一层：web 端已有的生物卡就是按这套形态做的——
 *   · wikirender.ts 会解析 {{!!字段}} 自转写；
 *   · EntryCard 用 gen-creature-card 渲染 sourceText；
 *   · styles.css 里 .bg-title / .bg-category / .bg-power / .description 都是为它写的。
 * 也就是说，产出这种形态的数据，前端零改动就能显示——而规范层是给计算用的扁平结构。
 *
 * 形态取自同源的另一套产出（另一项目拆解的 mm1~3怪物/ 数据集），
 * 它验证过这套标记能与官方 205 条 creature 数据共存：图标宏（meleebasic/close/range/area/aura/
 * five/six）、段头词（标准动作/特性/触发动作/次要动作/移动动作/自由动作）、✦频率，
 * 全部是官方语汇的子集。我们额外补上它丢掉的东西：译注、插图说明、数据表行号。
 */

// ——— 用词归一 ———

/**
 * 展示层用词对齐官方 creature 数据：官方 205 条里「抗力」出现 26 次、「抗性」0 次，
 * 所以这里把来源（怪物手册）的「抗性」渲染成「抗力」。规范层保留来源原文，只在展示态归一。
 */
const DISPLAY_TERMS: [RegExp, string][] = [[/^抗性$/, "抗力"]];

function displayTerm(s: string): string {
  let out = s;
  for (const [re, to] of DISPLAY_TERMS) out = out.replace(re, to);
  return out;
}

/** 威能「类型」前缀 → 官方动作图标宏 */
const ICON_BY_KIND: Record<string, string> = {
  基本近战: "meleebasic",
  近战: "meleebasic",
  基本远程: "range",
  远程: "range",
  射程: "range",
  近程: "close",
  区域: "area",
  爆发: "area",
  灵气: "aura",
};

const DICE_ICON: Record<string, string> = { "4": "four", "5": "five", "6": "six" };

/**
 * 段头用词归一：来源里「触发」是「触发动作」的简写（死亡骑士块里就有一行孤零零的「触发」），
 * 官方 205 条用的都是「触发动作」，展示层统一过去。
 */
const GROUP_DISPLAY: Record<string, string> = { 触发: "触发动作" };

function displayGroup(g: string): string {
  return GROUP_DISPLAY[g] ?? g;
}

/**
 * 灵气图标：精华版体例把灵气写成「热浪（火焰） 灵气 2：…」——
 * 灵气名在威能头、灵气体现在正文里，类型前缀取不到，只能从正文的「灵气 N」反推。
 */
function auraFromText(p: MonsterPower): boolean {
  // 只在「某行以 灵气 N 开头」或「·灵气 N」时判定，避免正文里顺口提到「灵气 5 格内」被误认
  return /^灵气\s*\d/m.test(p.text) || /[·・]灵气\s*\d/.test(p.text);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function iconMacro(name: string): string {
  return "{{$:/dnd/images/" + name + "}}";
}

// ——— 头部与数据行 ———

function headerRows(e: MonsterEntry, placeholders: boolean): string[] {
  const roleLine = [e.level !== undefined ? e.level + "级" : "", e.rank ?? "", e.role ?? ""]
    .filter((s) => s !== "")
    .join(" ");
  const subLine = [e.origin, e.creatureType].filter(Boolean).join(" ");
  const sizeLine = [e.fields["体型"], subLine].filter(Boolean).join(" ");
  const title = placeholders ? "{{!!title}}" : esc(e.id);
  const xp = placeholders ? "XP {{!!xp}}" : e.xp !== undefined ? "XP " + e.xp : "";
  return [
    '<div class="bold font-size-h4 bg-title"><span>' + title + "</span><span>" + esc(roleLine) + "</span></div>",
    "<div class=bg-title><span>" + esc(sizeLine) + "</span><span>" + xp + "</span></div>",
  ];
}

/** 双栏数值行：左栏 HP/AC/免疫…，右栏 先攻/侦查/感官 */
function statRows(e: MonsterEntry): string[] {
  const rows: string[] = [];
  const cell = (l: string, r: string): string => "<div><span>" + l + "</span><span>" + r + "</span></div>";

  // 第 1 行：HP（杂兵另有「失手攻击无法伤害杂兵」）/ 先攻
  if (e.hp !== undefined) {
    const hpText = e.bloodied !== undefined
      ? "''HP'' " + e.hp + "；''重伤'' " + e.bloodied
      : "''HP'' " + e.hp + "；失手攻击无法伤害杂兵";
    rows.push(cell(hpText, e.initiative !== undefined ? "''先攻'' " + esc(e.initiative) : ""));
  }

  // 第 2 行：AC 与三防 / 侦查
  if (e.ac !== undefined) {
    const def = ["''AC'' " + e.ac];
    if (e.fortitude !== undefined) def.push("''强韧'' " + e.fortitude);
    if (e.reflex !== undefined) def.push("''反射'' " + e.reflex);
    if (e.will !== undefined) def.push("''意志'' " + e.will);
    rows.push(cell(def.join("，"), e.perception !== undefined ? "''侦查'' " + esc(e.perception) : ""));
  }

  // 第 3 行：免疫 / 抗力 / 易伤 / 豁免 / 行动点；右栏放感官
  const extras: string[] = [];
  if (e.immunities.length > 0) extras.push("''免疫'' " + esc(e.immunities.join("，")));
  if (e.resistances.length > 0) extras.push("''" + displayTerm("抗性") + "'' " + esc(e.resistances.join("，")));
  if (e.vulnerabilities.length > 0) extras.push("''易伤'' " + esc(e.vulnerabilities.join("，")));
  if (e.savingThrow !== undefined) extras.push("''豁免'' " + esc(e.savingThrow));
  if (e.actionPoints !== undefined) extras.push("''行动点'' " + e.actionPoints);
  const sensesText = e.senses.length > 0 ? "''感官'' " + esc(e.senses.join("，")) : "";

  if (extras.length > 0) {
    rows.push(cell(extras.join("；"), sensesText));
  }

  // 第 4 行：速度（第 3 行没有内容时，感官并到这一行）
  if (e.speed !== undefined) {
    rows.push(cell("''速度'' " + esc(e.speed), extras.length > 0 ? "" : sensesText));
  } else if (sensesText !== "" && extras.length === 0) {
    rows.push(cell("", sensesText));
  }
  return rows;
}

// ——— 威能 ———

function powerKind(p: MonsterPower): string | undefined {
  return p.parts.find((x) => x.label === "类型")?.text;
}

function powerLine(p: MonsterPower): string {
  const kind = powerKind(p);
  const iconName = kind && ICON_BY_KIND[kind] ? ICON_BY_KIND[kind] : auraFromText(p) ? "aura" : "";
  const icon = iconName ? iconMacro(iconName) : "";
  const kw = p.keywords.length > 0 ? "（" + esc(p.keywords.join("，")) + "）" : "";
  const usage = p.usage ? "✦" + esc(p.usage) : "";
  const dice = [...(p.usage ?? "").matchAll(/\d/g)]
    .map((m) => DICE_ICON[m[0]])
    .filter((x): x is string => Boolean(x))
    .map(iconMacro)
    .join("");
  return '<div class="bold bg-power">' + icon + esc(p.name) + kw + usage + dice + "</div>";
}

/**
 * 正文 → 描述段。
 * 精华版体例的正文形如「触及 5；+39vs.AC；3d8+8 伤害。」，其中含 vs. 的一段是攻击、
 * 其后是命中；把它拆成「攻击：/命中：」两行，和早期体例（本就以 攻击：/命中：/效果： 分行）
 * 在展示态上统一。
 */
function bodyParts(p: MonsterPower): string[] {
  const out: string[] = [];
  // 触发条件写在威能名括注里时，正文首行补出来，读起来才完整
  if (p.trigger && !p.parts.some((x) => x.label === "触发")) {
    out.push("触发：" + esc(p.trigger) + "。");
  }
  for (const part of p.parts) {
    if (part.label === "类型") continue;
    if (part.label !== "正文") {
      out.push(esc(part.label) + "：" + esc(part.text));
      continue;
    }
    const segs = part.text.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
    const vi = segs.findIndex((s) => /vs\./.test(s));
    if (vi >= 0 && segs.length >= 2) {
      const atk = segs.slice(0, vi + 1).join("，").replace(/\s*vs\.\s*/, " vs. ");
      const hit = segs.slice(vi + 1).join("；");
      out.push("攻击：" + esc(atk));
      if (hit) out.push("命中：" + esc(hit));
      continue;
    }
    out.push(esc(part.text));
  }
  return out;
}

function powerBlock(p: MonsterPower): string[] {
  const body = bodyParts(p);
  const lines = [powerLine(p)];
  if (body.length > 0) lines.push("<div class=description>" + body.join("<br>") + "</div>");
  return lines;
}

/**
 * 段头分组。规范层的 group 可能因精华版体例落在「未分组」，
 * 此时用动作类别补（parse 层已尽量补过，这里再兜一次）。
 */
function groupOf(p: MonsterPower): string {
  // 段头没写、由动作词推出来的段（group === action）算「软归属」：
  // 这类威能若带触发条件，按 4E 的排版惯例归到「触发动作」而不是它自己的动作类别。
  const inferredFromAction = p.group === p.action;
  if (inferredFromAction && p.trigger) return "触发动作";
  if (p.group && p.group !== "未分组" && !inferredFromAction) return p.group;
  if (p.trigger) return "触发动作";
  return p.action ?? "特性";
}

/** 段序：特性在前、行动段按官方顺序，未登记的段排到最后，段内保持原文顺序 */
const GROUP_ORDER = ["特性", "标准动作", "移动动作", "次要动作", "自由动作", "触发动作", "无动作"];

// ——— 能力值 / 技能 / 阵营 / 装备 ———

const ABILITY_ORDER = ["力量", "敏捷", "感知", "体质", "智力", "魅力"];

function abilityRows(e: MonsterEntry): string[] {
  const rows: string[] = [];
  const names = ABILITY_ORDER.filter((n) => e.abilities[n]);
  if (names.length > 0) {
    for (let i = 0; i < names.length; i += 3) {
      const cells = names.slice(i, i + 3).map((n) => {
        const a = e.abilities[n];
        return "<span>''" + n + "'' " + a.score + "（" + a.mod + "）</span>";
      });
      rows.push('<div class="bg-power"><div class="ability">' + cells.join("") + "</div></div>");
    }
  }
  if (e.skills.length > 0) {
    const txt = "''技能'' " + e.skills.map((s) => s.name + s.bonus).join("，");
    rows.splice(0, 0, '<div class="bg-power"><div class="ability"><span style=flex-basis:auto>' + esc(txt) + "</span></div></div>");
  }
  const bottom: string[] = [];
  if (e.alignment) bottom.push("<span>''阵营'' " + esc(e.alignment) + "</span>");
  if (e.languages.length > 0) {
    bottom.push("<span style=flex-basis:auto>''语言'' " + esc(e.languages.join("，")) + "</span>");
  }
  if (bottom.length > 0) rows.push('<div><div class="ability">' + bottom.join("") + "</div></div>");
  if (e.equipment.length > 0) {
    rows.push(
      "<div><div class=\"ability\"><span style=flex-basis:auto>''装备'' " + esc(e.equipment.join("，")) + "</span></div></div>"
    );
  }
  return rows;
}

/** 译注：官方 creature 形态里没有专门位置，用斜体段落承载，保证不丢 */
function noteRows(e: MonsterEntry): string[] {
  if (e.notes.length === 0) return [];
  return ['<div class="italic bg-flavortext">' + esc(e.notes.join(" ")) + "</div>"];
}

export interface RenderOptions {
  /**
   * true（默认）：头部写 {{!!title}} 等字段自转写 —— TiddlyWiki 词条用，靠 tiddler 字段解析。
   * false：把值直接写进 HTML —— web 端展示用，前端不必再带一份字段映射。
   */
  placeholders?: boolean;
}

export function renderCreatureText(e: MonsterEntry, opts: RenderOptions = {}): string {
  const placeholders = opts.placeholders !== false;
  const powers = [...e.traits, ...e.powers];
  const seen: string[] = [];
  for (const p of powers) {
    const g = groupOf(p);
    if (!seen.includes(g)) seen.push(g);
  }
  const groups = seen
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.g);
      const gb = GROUP_ORDER.indexOf(b.g);
      return (ga < 0 ? GROUP_ORDER.length : ga) - (gb < 0 ? GROUP_ORDER.length : gb) || a.i - b.i;
    })
    .map((x) => x.g);

  const body: string[] = [];
  for (const g of groups) {
    body.push('<div class="bold font-size-h4 bg-category">' + esc(displayGroup(g)) + "</div>");
    for (const p of powers.filter((x) => groupOf(x) === g)) body.push(...powerBlock(p));
  }
  const inner = [
    ...headerRows(e, placeholders),
    ...statRows(e),
    ...body,
    ...noteRows(e),
    ...abilityRows(e),
  ];
  return "<div class=creature>\n" + inner.join("\n") + "\n</div>";
}

// ——— tiddler 组装与落盘 ———

function twTime(d: Date): string {
  const p = (n: number, w: number): string => String(n).padStart(w, "0");
  return (
    d.getFullYear() +
    p(d.getMonth() + 1, 2) +
    p(d.getDate(), 2) +
    p(d.getHours(), 2) +
    p(d.getMinutes(), 2) +
    p(d.getSeconds(), 2) +
    p(d.getMilliseconds(), 3)
  );
}

const BOOK_TAG: Record<string, string> = { MM1: "MM", MM2: "MM2", MM3: "MM3" };

export function toTiddler(e: MonsterEntry, now: Date): Record<string, string> {
  const stamp = twTime(now);
  return {
    created: stamp,
    text: renderCreatureText(e),
    title: e.id,
    creator: "4E NEXT 数据管线",
    modified: stamp,
    modifier: "4E NEXT 数据管线",
    source: BOOK_TAG[e.book] ?? e.book,
    tags: "生物",
    type: "text/vnd.tiddlywiki",
    revision: "0",
    bag: "default",
    level: e.level !== undefined ? String(e.level) : "",
    role: e.role ?? "",
    "specialty-role": e.rank ?? "",
    size: e.fields["体型"] ?? "",
    origin: e.origin ?? "",
    "creature-type": e.creatureType ?? "",
    xp: e.xp !== undefined ? String(e.xp) : "",
    // 官方格式之外的补充字段：溯源（另一项目的同源数据集没有这两项）
    upstream: "DnD4E 怪物手册 1~3 合订本（六巫翻译 · 灵霜整理）",
    row: String(e.provenance.rowStart),
  };
}

export interface MonsterTiddlerSummary {
  dir: string;
  files: number;
  byBook: Record<string, number>;
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_");
}

export function runMonsterTiddlers(): MonsterTiddlerSummary {
  const src = join(MONSTERS_CANONICAL_DIR, "monster.jsonl");
  if (!existsSync(src)) throw new Error("缺少规范层产物，请先运行 pnpm monsters：" + src);
  const entries = readJsonl<MonsterEntry>(src);

  if (existsSync(MONSTERS_TIDDLERS_DIR)) rmSync(MONSTERS_TIDDLERS_DIR, { recursive: true, force: true });
  const now = new Date();
  const byBook: Record<string, number> = {};
  let files = 0;

  entries.forEach((e, i) => {
    const book = BOOK_TAG[e.book] ?? e.book;
    const dir = join(MONSTERS_TIDDLERS_DIR, book);
    mkdirSync(dir, { recursive: true });
    const name = String(i).padStart(3, "0") + "-" + safeName(e.id) + ".json";
    writeFileSync(join(dir, name), JSON.stringify([toTiddler(e, now)], null, 2) + "\n", "utf8");
    byBook[book] = (byBook[book] ?? 0) + 1;
    files++;
  });

  return { dir: MONSTERS_TIDDLERS_DIR, files, byBook };
}

/** 单独渲染一条（供测试/预览） */
export function renderOne(id: string): string | undefined {
  const p = join(MONSTERS_CANONICAL_DIR, "monster.jsonl");
  if (!existsSync(p)) return undefined;
  const e = readJsonl<MonsterEntry>(p).find((x) => x.id === id);
  return e ? renderCreatureText(e) : undefined;
}
