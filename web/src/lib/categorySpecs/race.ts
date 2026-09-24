import type { Entry } from "../../data/types";
import {
  CATEGORY_FIELDS, CATEGORY_SECTIONS,
  parseLevelSections,
} from "../homebrewSchema";
import { parseRaceTraitLines, splitAuxPowers, RACE_HEADER_NAMES } from "../wikirender";
import type { CategorySpec, BuildResult, RaceTraitRow, RaceLoreBlock, RaceAuxGroup, RaceAuxPower } from "./types";
import { RaceCard } from "../../sheet/EntryCard";

// —— 编辑态 form.raceTraits（JSON 字符串）→ RaceTraitRow[] ——
// keepEmpty：编辑态必须保留空白行（否则刚点「添加特性行」的空行会在重渲染时被剔除，表现为按钮无反应），
//            同时也保留原始空白（输入中的行尾空格/换行不被吞掉）；保存态（默认）则裁剪并剔除空行。
export function parseRaceTraitsJson(json?: string, opts?: { keepEmpty?: boolean }): RaceTraitRow[] {
  if (!json || !json.trim()) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    const rows: RaceTraitRow[] = (v as RaceTraitRow[]).map((t) => ({
      name: String(t?.name ?? ""),
      body: String(t?.body ?? ""),
      ...(t?.replaces ? { replaces: String(t.replaces) } : {}),
    }));
    if (opts?.keepEmpty) return rows;
    return rows
      .map((t) => ({
        name: t.name.trim(),
        body: t.body.trim(),
        ...(t.replaces?.trim() ? { replaces: t.replaces.trim() } : {}),
      }))
      .filter((t) => t.name || t.body);
  } catch {
    return [];
  }
}

// —— 编辑态 form.loreSections（JSON 字符串）→ RaceLoreBlock[] ——
// keepEmpty 语义同 parseRaceTraitsJson：编辑态保留空块，保存态裁剪并剔除全空块。
export function parseRaceLoreJson(json?: string, opts?: { keepEmpty?: boolean }): RaceLoreBlock[] {
  if (!json || !json.trim()) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    const blocks: RaceLoreBlock[] = (v as RaceLoreBlock[]).map((b) => ({
      title: String(b?.title ?? ""),
      body: String(b?.body ?? ""),
    }));
    if (opts?.keepEmpty) return blocks;
    return blocks
      .map((b) => ({ title: b.title.trim(), body: b.body.trim() }))
      .filter((b) => b.title || b.body);
  } catch {
    return [];
  }
}

/** 标题是否属于「辅助威能」小节（官方命名有「XX辅助威能」「XX种族威能」两种） */
export function isAuxSectionTitle(title: string): boolean {
  return title.includes("辅助威能") || title.includes("种族威能");
}

/** 空辅助威能组（编辑器初始态）：标题预置「辅助威能」，无引言无条目 */
export function emptyRaceAuxGroup(): RaceAuxGroup {
  return { title: "辅助威能", intro: "", powers: [] };
}

// —— 编辑态 form.raceAuxPowers（JSON 字符串）→ RaceAuxGroup ——
// keepEmpty 语义同前：编辑态保留空条目（否则刚「＋添加威能」的空行会立即被剔除）。
export function parseRaceAuxJson(json?: string, opts?: { keepEmpty?: boolean }): RaceAuxGroup {
  const empty = emptyRaceAuxGroup();
  if (!json || !json.trim()) return empty;
  try {
    const v = JSON.parse(json) as Partial<RaceAuxGroup>;
    const powers: RaceAuxPower[] = Array.isArray(v?.powers)
      ? (v.powers as RaceAuxPower[]).map((p) => ({ name: String(p?.name ?? ""), body: String(p?.body ?? "") }))
      : [];
    const g: RaceAuxGroup = {
      title: String(v?.title ?? ""),
      intro: String(v?.intro ?? ""),
      powers: opts?.keepEmpty
        ? powers
        : powers
            .map((p) => ({ name: p.name.trim(), body: p.body.trim() }))
            .filter((p) => p.name || p.body),
    };
    return g;
  } catch {
    return empty;
  }
}

/** 辅助威能组 → 官方格式：`!! 标题` + 引言 + （`!!! 威能名` + 描述 + `{{威能名}}`）× N */
export function serializeRaceAux(g: RaceAuxGroup): string {
  const title = g.title.trim();
  const intro = g.intro.trim();
  const powers = g.powers
    .map((p) => ({ name: p.name.trim(), body: p.body.trim() }))
    .filter((p) => p.name || p.body);
  // 只有标题而无引言/条目时不输出：编辑器未填写时默认标题是「辅助威能」，
  // 若按标题非空就输出，会给每个种族凭空加一个空的辅助威能小节。
  if (!intro && powers.length === 0) return "";
  const out: string[] = [];
  if (title) out.push(`!! ${title}`);
  if (intro) out.push(intro);
  for (const p of powers) {
    // 威能名是车卡识别悬浮卡/「选择此威能」的钥匙，缺名时该条无法渲染，故无名条目不输出
    if (!p.name) continue;
    out.push(`!!! ${p.name}`);
    if (p.body) out.push(p.body);
    out.push(`{{${p.name}}}`);
  }
  return out.join("\n\n");
}

/**
 * 正文块 → 官方正文格式：有标题写 `!! 标题` + 正文；无标题块只有**首块**能直接输出正文
 * （车卡 splitRaceLore 会把第一个 `!! ` 之前的文本归入「种族背景」引言），
 * 非首位无标题块并入前一块，避免「写了却没显示」。
 */
export function serializeLoreBlocks(blocks: RaceLoreBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    const title = b.title.trim();
    const body = b.body.trim();
    if (!title && !body) continue;
    if (!title) {
      if (out.length === 0) out.push(body);
      else out[out.length - 1] = [out[out.length - 1], body].filter(Boolean).join("\n");
      continue;
    }
    out.push(`!! ${title}\n${body}`);
  }
  return out.filter(Boolean).join("\n\n");
}

/** classTrait 块之后的正文 → 正文块数组（按 `!! 标题` 切分，首个标题前的文本归入首块）；编辑态保留原始空白 */
export function splitLoreBlocks(body: string): RaceLoreBlock[] {
  const clean = body.replace(/^@@\.indent$/gm, "").replace(/^@@\s*$/gm, "");
  const out: RaceLoreBlock[] = [];
  const heads: { index: number; end: number; title: string }[] = [];
  const re = /^!!\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) heads.push({ index: m.index, end: m.index + m[0].length, title: m[1].trim() });
  if (heads.length === 0) {
    const t = clean.trim();
    return t ? [{ title: "", body: t }] : [];
  }
  const pre = clean.slice(0, heads[0].index).trim();
  if (pre) out.push({ title: "", body: pre });
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].index : clean.length;
    out.push({ title: heads[i].title, body: clean.slice(heads[i].end, end).trim() });
  }
  return out;
}

/** 威能名的中文短名（去掉尾部英文，如「矮人恢复力 Dwarven Resilience」→「矮人恢复力」） */
function shortPowerName(s: string): string {
  const i = s.search(/[A-Za-z]/);
  return (i < 0 ? s : s.slice(0, i)).trim() || s.trim();
}

/** 速度归一化：原版 54 个种族的速度一律是纯数值（4/5/6/7 格），用户只填数字时自动补「格」 */
export function normalizeRaceSpeed(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return /^\d+$/.test(s) ? `${s}格` : s;
}

/** 常用种族语言（chip 辅助用；「另外任选一种」「A或B」等自由写法直接写在文本框里） */
export const RACE_LANGUAGES = ["通用语", "精灵语", "矮人语", "巨人语", "地精语", "龙语", "荒神语", "异怪语", "深渊语", "螳螂人语"];

/** 以「，」分隔的文本片段 toggle（语言/技能奖励这类「自由文本 + chip 辅助」字段共用） */
export function toggleCommaToken(text: string, token: string): string {
  const parts = text ? text.split("，").map((p) => p.trim()).filter(Boolean) : [];
  const i = parts.indexOf(token);
  if (i >= 0) parts.splice(i, 1);
  else parts.push(token);
  return parts.join("，");
}

/** 技能奖励 chip 的片段：官方「技能奖励」行的标准写法 `+2技能名` */
export function skillBonusToken(skill: string): string {
  return `+2${skill}`;
}

/** 与 8 个自动头部槽位同名的特性行：车卡按 RACE_HEADER_NAMES 过滤头部行，同名特性会被一并剔除（填了不显示） */
export function raceTraitNameConflicts(traits: RaceTraitRow[]): string[] {
  return traits.map((t) => t.name.trim()).filter((n) => n && RACE_HEADER_NAMES.has(n));
}

/** 抽取文本里的 [[链接]] 目标（`[[A]]` / `[[A|B]]` → A），与车卡 wikiLinkTargets 同规则 */
export function extractWikiRefs(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

/** 种族条目里会驱动车卡授予威能的引用名，按来源字段分组（供保存前「未收录」校验逐字段定位） */
export function collectRacePowerRefs(form: Record<string, string>): { key: string; label: string; refs: string[] }[] {
  const groups: { key: string; label: string; refs: string[] }[] = [];
  const traitRefs: string[] = [];
  for (const t of parseRaceTraitsJson(form.raceTraits)) traitRefs.push(...extractWikiRefs(t.body));
  if (traitRefs.length) groups.push({ key: "raceTraits", label: "种族特性", refs: [...new Set(traitRefs)] });
  const sp = (form.startingPower ?? "").trim();
  if (sp) groups.push({ key: "startingPower", label: "起始威能", refs: [sp] });
  const auxRefs = parseRaceAuxJson(form.raceAuxPowers).powers.map((p) => p.name.trim()).filter(Boolean);
  if (auxRefs.length) groups.push({ key: "raceAuxPowers", label: "辅助威能", refs: [...new Set(auxRefs)] });
  return groups;
}

/**
 * 种族 spec：脱离旧的「等级特性小节（!! N级）」结构，改为结构化种族特性 + 官方 classTrait 拼装。
 * 车卡侧通过 classTrait 块的「技能奖励/语言」行自动回填技能加值与语言槽，特性行内 [[威能]] 引用自动授予。
 */
export const raceSpec: CategorySpec = {
  key: "race",
  label: "种族",
  fields: CATEGORY_FIELDS.race,
  sections: CATEGORY_SECTIONS.race,
  editors: {
    raceTraits: "raceTraits",
    loreSections: "loreSections",
    raceAuxPowers: "raceAuxPowers",
    languages: "raceLanguages",
    skillBonus: "raceSkills",
    abilityTwo: "raceAbilityTwo",
    // 单选字段也走「手动输入框 + 下方候选」统一形态（板块内每个字段都必须能自由输入）
    abilityOne: "raceInputChips",
    size: "raceInputChips",
  },
  build: ({ form }) => {
    const out: BuildResult = {};
    const v = (k: string) => (form[k] ?? "").trim();
    // 五个 race-* fields 键：供正文 {{!!race-*}} 宏展开（车卡 WikiBody / wikiToHtml 消费）
    const raceFields: Record<string, string> = {};
    if (v("size")) raceFields["race-size"] = v("size");
    if (v("speed")) raceFields["race-speed"] = normalizeRaceSpeed(v("speed"));
    if (v("vision")) raceFields["race-vision"] = v("vision");
    if (v("abilityOne")) raceFields["race-abilityone"] = v("abilityOne");
    if (v("abilityTwo")) raceFields["race-abilitytwo"] = v("abilityTwo");
    if (Object.keys(raceFields).length) out.extras = raceFields;

    const traits = parseRaceTraitsJson(form.raceTraits);
    const startingPower = v("startingPower");
    // 无条件拼 classTrait 前缀：车卡从该块解析 属性/体型/速度/视觉/语言/技能奖励 并自动回填，
    // 若因无特性行而省略，则只填了头部字段的种族在车卡上解析不到任何数据，被视为「无效」。
    // 头部 8 槽顺序固定（平均身高→平均体重→属性调整→体型→速度→视觉→语言→技能奖励），
    // 按有值字段选择性写入，且必须排在特性行之前（车卡「简洁」模式按位置切分头部与实用特性）。
    const lines: string[] = [];
    if (v("avgHeight")) lines.push(`''平均身高：''${v("avgHeight")}`);
    if (v("avgWeight")) lines.push(`''平均体重：''${v("avgWeight")}`);
    if (v("abilityOne") || v("abilityTwo")) {
      const ability = v("abilityTwo") ? "+2{{!!race-abilityone}}；+2{{!!race-abilitytwo}}" : "+2{{!!race-abilityone}}";
      lines.push(`''属性调整：''${ability}`);
    }
    if (v("size")) lines.push("''体型：''{{!!race-size}}");
    if (v("speed")) lines.push("''速度：''{{!!race-speed}}");
    if (v("vision")) lines.push("''视觉：''{{!!race-vision}}");
    if (v("languages")) lines.push(`''语言：''${v("languages")}`);
    if (v("skillBonus")) lines.push(`''技能奖励：''${v("skillBonus")}`);
    for (const t of traits) {
      let body = t.body;
      // 替代标记：replaces 填了但正文未含「替代「XX」」语义时自动补写（车卡 parseRaceTraitLines 据此识别）
      if (t.replaces && t.replaces !== t.name && !body.includes("替代「")) body = `${body} 替代「${t.replaces}」`;
      // 特性名是车卡 parseRaceTraitLines 定位该行的唯一锚点（`''名称：''正文`），
      // 缺名时正文会整体消失、表现为「填了没用」，故正文非空时给一个显式占位名（保存前有校验拦截）。
      const label = t.name || "未命名特性";
      lines.push(`''${label}：''${body}`);
    }
    // 起始威能：官方写法是在 classTrait **内**写一行 `''短名：''你具有[[威能全名]]威能。`
    // —— 车卡 raceGrantedPowerEntries 只认特性正文里的 [[链接]]，块后的 {{威能名}} 是 transclusion、
    // 渲染时会被 wikiToHtml 剥掉（只为与官方文本保持一致而保留）。
    // 已写的特性里若已提及该威能就不追加：官方矮人的「矮人恢复力」本身是一条含 [[链接]] 的特性行；
    // 半精灵「成功诀窍」是「半精灵威能选择」的二选一子项，追加会把互斥选项变成默认授予。
    if (startingPower) {
      const short = shortPowerName(startingPower);
      const mentioned = traits.some((t) => t.name.includes(short) || t.body.includes(short) || t.body.includes(startingPower));
      if (!mentioned) lines.push(`''${short}：''你具有[[${startingPower}]]威能。`);
    }
    const block = `@@.classTrait """\n${lines.join("\n")}\n"""`;
    // classTrait 块 → @@ → {{起始威能}} → 按序各正文块 → 辅助威能小节
    // 正文只取 loreSections：draftToForm 会把 entry.sourceText 原样放进 form（含 classTrait 块本身），
    // 若再把 form.sourceText 拼在末尾会造成整块重复。
    const lore = serializeLoreBlocks(parseRaceLoreJson(form.loreSections));
    const aux = serializeRaceAux(parseRaceAuxJson(form.raceAuxPowers));
    out.sourceText = [block, "@@", startingPower ? `{{${startingPower}}}` : "", lore, aux].filter(Boolean).join("\n");
    return out;
  },
  parse: (entry: Entry, form: Record<string, string>) => {
    const src = entry.sourceText ?? "";
    const ctMatch = src.match(/@@\.classTrait\s+"""([\s\S]*?)"""/);
    // 老存档迁移：无 classTrait 块（旧版以「!! N级：」等级特性分节存储 / 或纯文本正文）
    if (!ctMatch || ctMatch.index === undefined) {
      const legacySkill = (entry as Record<string, unknown>).skill;
      if (typeof legacySkill === "string" && legacySkill && !form.skillBonus) form.skillBonus = legacySkill;
      const plain = src.replace(/^@@\.indent$/gm, "").replace(/^@@\s*$/gm, "").trim();
      if (/^!!\s+[0-9]+\s*级/m.test(plain)) {
        const secs = parseLevelSections(plain, { allowPlain: true });
        const rows = secs.map((s) => ({ name: s.title || s.level || "特性", body: s.body ?? "" }));
        if (rows.length) form.raceTraits = JSON.stringify(rows);
      } else if (plain) {
        form.loreSections = JSON.stringify([{ title: "", body: plain }]);
      }
      return;
    }
    const ct = ctMatch[1];
    // 头部行回填（优先保留顶层已填充的 size/speed/vision/ability，只补长度/体重/技能奖励/语言）
    const lineVal = (label: string): string => {
      const m = ct.match(new RegExp(`^''\\s*${label}[：:]\\s*''\\s*(.*)$`, "m"));
      return m ? m[1].trim() : "";
    };
    if (!(form.avgHeight ?? "").trim()) form.avgHeight = lineVal("平均身高");
    if (!(form.avgWeight ?? "").trim()) form.avgWeight = lineVal("平均体重");
    if (!form.skillBonus) form.skillBonus = lineVal("技能奖励");
    if (!form.languages) form.languages = lineVal("语言");
    const all = parseRaceTraitLines(ct);
    const traits = all.filter((t) => !RACE_HEADER_NAMES.has(t.name));
    if (traits.length) form.raceTraits = JSON.stringify(traits);
    // 起始威能：classTrait 块后紧跟的 {{威能名}} 行；其余正文按 `!! ` 切为正文块
    const rest = src.slice(ctMatch.index + ctMatch[0].length);
    let after = rest.replace(/^@@\s*$/m, "").replace(/^\s*\n/, "").trim();
    const sp = after.match(/^\{\{\s*([^{}]+?)\s*\}\}/);
    if (sp) {
      form.startingPower = sp[1].trim();
      after = after.slice(sp.index! + sp[0].length).trim();
    }
    // 正文块里若含「XX辅助威能」小节，抽成独立的 raceAuxPowers（该小节在编辑器里有专属结构化编辑器，
    // 不再混在自由正文块里）；其余块按序留在 loreSections。
    const blocks = splitLoreBlocks(after);
    const auxIdx = blocks.findIndex((b) => isAuxSectionTitle(b.title));
    if (auxIdx >= 0) {
      const sec = blocks[auxIdx];
      const parsed = splitAuxPowers(sec.body);
      form.raceAuxPowers = JSON.stringify({
        title: sec.title,
        intro: parsed.intro ?? "",
        powers: parsed.powers.map((p) => ({ name: p.title, body: p.body ?? "" })),
      });
      blocks.splice(auxIdx, 1);
    }
    form.loreSections = JSON.stringify(blocks);
  },
  Preview: RaceCard,
};