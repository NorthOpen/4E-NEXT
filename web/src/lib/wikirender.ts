// wikitext → HTML 轻量渲染（供角色卡职业能力板块使用，不影响词条查询页）
export function wikiToHtml(text: string, fields: Record<string, string>): string {
  return text
    .replace(/<div class="sidebar">[\s\S]*?<\/div>/g, "") // 剥离词条侧边栏块（如守望者形态威能等补充说明），不混入角色卡正文
    .replace(/<<[^>]+>>/g, "")
    .replace(/<\$[^>]*\/?>/g, "")
    .replace(/@@\.\w+\s*/g, "")
    .replace(/^@@\s*$/gm, "")
    .replace(/\{\{!!([^}]+)\}\}/g, (_m, n: string) => String(fields[n] ?? ""))
    .replace(/\{\{[^}]+\}\}/g, "") // 剔除 {{标题}} 转clusion（内容在独立词条中）
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/''(.+?)''/g, "<b>$1</b>")
    .replace(/\/\/([^\/]*)\/\//g, "<i>$1</i>")
    .replace(/^!{3,} (.+)$/gm, "<h6>$1</h6>")
    .replace(/^!{2} (.+)$/gm, "<h5>$1</h5>")
    .replace(/^! (.+)$/gm, "<h4>$1</h4>")
    .replace(/^\s*-{3,}\s*$/gm, "");
}

// @@.classTrait """...""" 引言块
export function classTraitHtml(text: string): string | undefined {
  const m = text.match(/@@\.classTrait\s+"""([\s\S]*?)"""/);
  return m ? m[1].trim() : undefined;
}

// 职业特性章节：优先「! XX职业特性」标题，其次变体职业的「!! N级：」起始段
export function classFeaturesHtml(text: string): string | undefined {
  // 有后续一级标题：取到下一个「! 」前
  const m = text.match(/^! [^\n]*职业特性[^\n]*\n([\s\S]*?)(?=^! )/m);
  if (m && m[1].trim()) return m[1].trim();
  // 无后续一级标题：取到结尾
  const mEnd = text.match(/^! [^\n]*职业特性[^\n]*\n([\s\S]*)$/m);
  if (mEnd && mEnd[1].trim()) return mEnd[1].trim();
  // 无「职业特性」一级标题（吸血鬼/精华职业变体）：从第一个「!! N级：」标题起始。
  // 捕获组必须包含标题行本身，否则 parseFeatureSections 会丢失第一个特性（如吸血鬼「暗夜之子」）。
  const m2 = text.match(/^(!! [^\n]*\n[\s\S]*?)(?=^! )/m);
  if (m2 && m2[1].trim()) return m2[1].trim();
  const m2End = text.match(/^(!! [^\n]*\n[\s\S]*)$/m);
  return m2End && m2End[1].trim() ? m2End[1].trim() : undefined;
}

// 种族 classTrait：剔除「体型/速度/视觉」行（这三个已在角色信息自动填写）
export function raceTraitHtml(text: string): string | undefined {
  const m = text.match(/@@\.classTrait\s+"""([\s\S]*?)"""/);
  if (!m) return undefined;
  const lines = m[1].split("\n").filter((line) => {
    const t = line.trim();
    return !/^''?(体型|速度|视觉)['':：]/.test(t);
  });
  return lines.join("\n").trim();
}

// classTrait 块的自动头部槽行（由种族数据字段派生，不是可编辑特性）：
// 车卡「简洁」模式据此剔除、编辑器反解时据此排除。
export const RACE_HEADER_NAMES: ReadonlySet<string> = new Set([
  "平均身高", "平均体重", "属性调整", "体型", "速度", "视觉", "语言", "技能奖励",
]);

// 解析 classTrait 里的 ''名称：''正文 条目（用于亚种替换交互，按名称定位可替换的种族特性）
export interface RaceTraitLine {
  name: string;
  body: string;
  replaces?: string; // 若该特性是可替代型（如「龙惧」替代「龙息」），此处为被替代的基础特性名
}
export function parseRaceTraitLines(classTraitBody: string): RaceTraitLine[] {
  const out: RaceTraitLine[] = [];
  const re = /''([^：:]+?)\s*[：:]\s*''/g;
  const segs: { start: number; end: number; name: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(classTraitBody)) !== null) segs.push({ start: m.index, end: m.index + m[0].length, name: m[1].trim() });
  for (let i = 0; i < segs.length; i++) {
    const end = i + 1 < segs.length ? segs[i + 1].start : classTraitBody.length;
    const body = classTraitBody.slice(segs[i].end, end).replace(/^\s*$/gm, "").trim();
    // 只填了名称、正文尚空的行也要保留：否则编辑器里刚写下的特性行会在预览/车卡上凭空消失。
    // 8 个自动头部槽行例外——它们由种族数据字段派生，无值时应整体缺席而不是渲染成空标题。
    if (!body && (!segs[i].name || RACE_HEADER_NAMES.has(segs[i].name))) continue;
    const replaces = body.match(/替代「([^」]+)」/)?.[1];
    out.push({ name: segs[i].name, body, ...(replaces ? { replaces } : {}) });
  }
  return out;
}

// 种族正文（classTrait 块之后），仅详细模式渲染
export function raceBodyHtml(text: string): string | undefined {
  const m = text.match(/@@\.classTrait\s+"""[\s\S]*?"""/);
  if (!m || m.index === undefined) return undefined;
  const rest = text.slice(m.index + m[0].length)
    // 剥离指令行（classTrait 的收尾 @@、@@.indent 等）：它们是排版指令不是正文，
    // 若留给 splitRaceLore，会被当成首个「!! 」标题之前的引言，渲染出一个只有空白的「种族背景」折叠。
    .replace(/^[ \t]*@@(?:\.\w+)?[ \t]*$/gm, "")
    // 剥离独立的 {{威能名}} 转clusion 行：威能由条目列表/特性行承载，正文不重复展示。
    .replace(/^[ \t]*\{\{[^}]+\}\}[ \t]*$/gm, "")
    .trim();
  return rest.length > 0 ? rest : undefined;
}

// 种族 lore 分段：按「!! 章节标题」切分为独立小节，供折叠展示（背景/外貌特征/态度信仰等）
export interface RaceLoreSection {
  title?: string;
  body: string;
}
export function splitRaceLore(body: string): RaceLoreSection[] {
  const out: RaceLoreSection[] = [];
  const heads: { index: number; title: string }[] = [];
  const re = /^!!\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) heads.push({ index: m.index, title: m[1].trim() });
  if (heads.length === 0) {
    const t = body.trim();
    if (t) out.push({ body: t });
    return out;
  }
  // 首个章节标题之前的引言（背景概述）作为独立小节
  if (heads[0].index > 0) {
    const pre = body.slice(0, heads[0].index).replace(/^\s*$/gm, "").trim();
    if (pre) out.push({ title: "种族背景", body: pre });
  }
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].index : body.length;
    const secBody = body.slice(heads[i].index, end).replace(/^!!\s+.+$/m, "").replace(/^\s*$/gm, "").trim();
    // 有标题即保留：只写了标题、正文还没填的小节也要出现在预览里（否则「角色扮演」这类
    // 已选标题的块会整体消失，表现为「点了标题没反应」）。
    if (secBody || heads[i].title) out.push({ title: heads[i].title, body: secBody });
  }
  return out;
}

// 职业 lore 分段：classTrait 块与「! XX职业特性」之间的引言叙述段 + 侧边栏「XX简介」，
// 与种族 lore 同样按折叠小节返回，供职业面板详图模式在职业特性上方展示
export function splitClassLore(text: string): RaceLoreSection[] {
  const ct = text.match(/@@\.classTrait\s+"""[\s\S]*?"""/);
  if (!ct || ct.index === undefined) return [];
  const rest = text.slice(ct.index + ct[0].length);
  // lore 区间终点：优先「! XX职业特性」标题；若无该标题（如刺客(行刑者)直接用「!! 刺客公会」），
  // 则在第一个「!! 」特性标题处截断，避免把全部职业特性误吞进「职业背景」
  const feat = rest.match(/^! [^\n]*职业特性/m);
  const h22 = rest.search(/^!!\s/m);
  let cut = feat ? feat.index! : (h22 >= 0 ? h22 : rest.length);
  const region = rest.slice(0, cut)
    .replace(/^@@\s*$/m, "")        // classTrait 块的收尾 @@
    .replace(/^#{3,}?$/gm, "")      // 分隔线
    .replace(/^[-]{3,}\s*$/gm, "")
    .replace(/^\s*$/gm, "")
    .trim();
  if (!region) return [];
  const out: RaceLoreSection[] = [];
  // 抽出性侧边栏「XX简介」，作为独立折叠小节
  const narrate = region.replace(/<div class="sidebar">([\s\S]*?)<\/div>/g, (_m, inner: string) => {
    const t = inner.match(/^!!!\s+(.+?)\s*$/m);
    const b = inner
      .replace(/^!!!\s+.+$/m, "")
      .replace(/@@\.\w+\s*/g, "")
      .replace(/^@@\s*$/gm, "")
      .replace(/\{\{[^}]+\}\}/g, "")
      .replace(/^\s*$/gm, "")
      .trim();
    if (b) out.push({ title: t ? t[1].trim() : "职业简介", body: b });
    return "";
  });
  const main = narrate
    .replace(/@@\.\w+\s*/g, "")
    .replace(/^@@\s*$/gm, "")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/^\s*$/gm, "")
    .trim();
  if (main) out.unshift({ title: "职业背景", body: main });
  return out;
}

// 辅助威能小节拆分：小节标题不折叠，仅各威能的描述文本折叠
export interface AuxPowerSection {
  intro?: string; // 首个威能之前的简介描述（@@.indent 块）
  powers: { title: string; body?: string }[]; // 各威能：标题 + 描述（剔除 {{威能}} 引用）
}
export function splitAuxPowers(body: string): AuxPowerSection {
  const out: AuxPowerSection = { powers: [] };
  const firstHead = body.search(/^!!! /m);
  if (firstHead < 0) {
    const t = body.replace(/^\s*$/gm, "").trim();
    if (t) out.intro = t;
    return out;
  }
  const introRaw = body.slice(0, firstHead).replace(/^\s*$/gm, "").trim();
  if (introRaw) out.intro = introRaw;
  const parts = body.slice(firstHead).split(/^(?=!!! )/m);
  for (const part of parts) {
    const m = part.match(/^!!!\s+(.+?)\s*$/m);
    if (!m) continue;
    const b = part
      .replace(/^!!!\s+.+$/m, "")
      .replace(/\{\{[^}]+\}\}/g, "")
      .replace(/^\s*$/gm, "")
      .trim();
    out.powers.push({ title: m[1].trim(), body: b.length > 0 ? b : undefined });
  }
  return out;
}

// 亚种解析：源文本含「属于[[原种族]]的亚种」模板的种族条目
export interface SubraceBenefit {
  title: string; // 增益名，如「钢铁意志」
  body: string; // 完整描述（风味 + 增益效果）
  replaces?: string; // 替代的标准种族特性，如「铁胃」
}
export interface SubraceInfo {
  baseRaceName: string; // 原种族显示名，如「矮人 Dwarf」
  note?: string; // 增益选择说明（如"只能选择其中一个"）
  loreSections: RaceLoreSection[]; // 亚种自身的 lore 小节（背景/角色扮演等）
  benefits: SubraceBenefit[];
}
export function parseSubraceInfo(sourceText: string): SubraceInfo | undefined {
  const mk = sourceText.match(/属于\[\[([^\]|]+)(?:\|[^\]]+)?\]\]的亚种/);
  if (!mk) return undefined;
  const baseRaceName = mk[1].trim();
  // 切出「XX增益」章节
  const benefitHead = sourceText.match(/^!!\s+.+增益.*$/m);
  const lorePart = benefitHead ? sourceText.slice(0, benefitHead.index) : sourceText;
  const benefitsPart = benefitHead ? sourceText.slice(benefitHead.index) : "";
  // lore：去掉「<<< 属于XX的亚种 <<<」标记块、通用说明（以"当你创建…亚种角色"开头）与分隔线
  const loreClean = lorePart
    .replace(/^<<<[\s\S]*?^<<<$/m, "")
    .replace(/@@\.indent\n当你创建一个亚种角色时[\s\S]*?^@@$/m, "")
    .replace(/^---$/m, "")
    .replace(/^\s*$/gm, "")
    .trim();
  const loreSections = loreClean ? splitRaceLore(loreClean) : [];
  // 增益块：''标题：''风味… 增益：效果…（替代「XX」）
  const benefits: SubraceBenefit[] = [];
  const re = /''([^：:]+?)\s*[：:]\s*''/g;
  const segs: { start: number; end: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(benefitsPart)) !== null) segs.push({ start: m.index, end: m.index + m[0].length, title: m[1].trim() });
  let note: string | undefined;
  if (segs.length > 0) {
    const intro = benefitsPart.slice(0, segs[0].start).replace(/^!!\s+.+$/m, "").replace(/^@@\.indent$/m, "").replace(/^\s*$/gm, "").trim();
    if (intro) note = intro;
  }
  for (let i = 0; i < segs.length; i++) {
    const end = i + 1 < segs.length ? segs[i + 1].start : benefitsPart.length;
    const body = benefitsPart.slice(segs[i].end, end).replace(/^\s*$/gm, "").trim();
    if (!body) continue;
    const replaces = body.match(/替代「([^」]+)」/)?.[1];
    benefits.push({ title: segs[i].title, body, replaces });
  }
  return { baseRaceName, note, loreSections, benefits };
}

// 简略模式：防具擅长 / 武器擅长 / 法器（无法器则不显示）
export function classSummary(text: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const armor = text.match(/^''?防具擅长[：:]''?\s*([^\n]+)/m);
  if (armor) out.push({ label: "防具擅长", value: armor[1].trim() });
  const weapon = text.match(/^''?武器擅长[：:]''?\s*([^\n]+)/m);
  if (weapon) out.push({ label: "武器擅长", value: weapon[1].trim() });
  const impl = text.match(/^''?法器[：:]''?\s*([^\n]+)/m);
  if (impl) out.push({ label: "法器", value: impl[1].trim() });
  return out;
}

// 典范特性：典范之道的 11 级特性条目（连续多个「!! 11级：」段）
export function paragonFeaturesHtml(text: string): string | undefined {
  const m = text.match(/^!! 11级[^\n]*\n([\s\S]*?)(?=^!! (?!11级)\d+级|^! |$)/m);
  if (m && m[1].trim()) return m[1].trim();
  const m2 = text.match(/^!! [^\n]*\n([\s\S]*)$/m);
  return m2 && m2[1].trim() ? m2[1].trim() : undefined;
}

// 典范正文（详细模式）：剔除 11 级特性段后的其余内容
export function paragonBodyHtml(text: string): string | undefined {
  const m = text.match(/^!! 11级[^\n]*\n[\s\S]*?(?=^!! (?!11级)\d+级|^! |$)/m);
  if (!m || m.index === undefined) {
    const t = text.trim();
    return t.length > 0 ? t : undefined;
  }
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  return rest.length > 0 ? rest : undefined;
}

// 天命特性：传奇天命的 21 级特性条目
export function epicFeaturesHtml(text: string): string | undefined {
  const m = text.match(/^!! 21级[^\n]*\n([\s\S]*?)(?=^!! (?!21级)\d+级|^! |$)/m);
  if (m && m[1].trim()) return m[1].trim();
  const m2 = text.match(/^!! [^\n]*\n([\s\S]*)$/m);
  return m2 && m2[1].trim() ? m2[1].trim() : undefined;
}

// 天命正文（详细模式）：剔除 21 级特性段后的其余内容
export function epicBodyHtml(text: string): string | undefined {
  const m = text.match(/^!! 21级[^\n]*\n[\s\S]*?(?=^!! (?!21级)\d+级|^! |$)/m);
  if (!m || m.index === undefined) {
    const t = text.trim();
    return t.length > 0 ? t : undefined;
  }
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  return rest.length > 0 ? rest : undefined;
}

// 典范/天命特性结构化渲染：把连续「!! N级：标题」段拆分为独立特性块（标题 + 正文）
export function featureBlocksHtml(text: string, fields: Record<string, string> = {}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sections = text.split(/^(?=!! )/m);
  const out: string[] = [];
  for (const sec of sections) {
    const m = sec.match(/^!! (.+?)\n([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].trim();
    const body = m[2]
      .replace(/^@@\.\w+\s*/gm, "")
      .replace(/^@@\s*$/gm, "")
      .replace(/\{\{[^}]+\}\}/g, "")
      .replace(/^\s*$/gm, "")
      .trim();
    if (!body) {
      out.push('<div class="pf-item"><div class="pf-title">' + esc(title) + "</div></div>");
      continue;
    }
    const html = wikiToHtml(body, fields).replace(/\n/g, "<br/>");
    out.push('<div class="pf-item"><div class="pf-title">' + esc(title) + '</div><div class="pf-body">' + html + "</div></div>");
  }
  return out.join("");
}

// 结构化解析典范/天命条目：按「!! N级：标题」分段，识别描述正文（@@ 块）与威能引用（{{名}}）
export interface FeatureSection {
  title: string;
  body?: string;
  powerRef?: string;      // 正文中第一个 {{威能}} 模板引用（兼容旧逻辑）
  powerRefs?: string[];   // 正文中全部 {{威能}} 模板引用（普通特性：「获得下列N个威能」同时授予全部）
}
export interface FeatureParse {
  hasTitle: boolean; // 存在 ! 开头标题（{{!!title}} 宏）
  intro?: string; // !! 之前的 @@.indent 引言描述块（已清理标记）
  sections: FeatureSection[];
}
export function parseFeatureSections(text: string): FeatureParse {
  const hasTitle = /^!\{\{!!\w+\}\}\s*$/m.test(text) || /^! .+$/m.test(text);
  const first = text.search(/^!! /m);
  const head = first >= 0 ? text.slice(0, first) : text;
  const rest = first >= 0 ? text.slice(first) : "";
  const introM = head.match(/@@\.\w+\s*([\s\S]*?)^@@/m);
  const intro = introM
    ? introM[1]
        .replace(/^''前提条件[^\n]*\n+/m, "")
        .replace(/^\s*$/gm, "")
        .trim()
    : undefined;
  const out: FeatureSection[] = [];
  const sections = rest.split(/^(?=!! )/m);
  for (const sec of sections) {
    const m = sec.match(/^!! (.+?)\n([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].trim();
    let body = m[2].trim();
    // 收集正文全部 {{威能}} 模板引用：普通特性（如「获得下列3个威能」的专业射手）需同时授予全部，
    // 而不仅是第一个；选择型/替换型特性的选项威能由各自分支按所选逐项授予。
    const powerRefs = [...body.matchAll(/\{\{([^}]+)\}\}/g)].map((mm) => mm[1].trim()).filter(Boolean);
    const powerRef = powerRefs[0];
    body = body
      .replace(/\{\{[^}]+\}\}/g, "")
      .replace(/^@@\.\w+\s*/gm, "")
      .replace(/^@@\s*$/gm, "")
      .replace(/^\s*$/gm, "")
      .trim();
    out.push({ title, body: body.length > 0 ? body : undefined, powerRef, powerRefs });
  }
  return { hasTitle, intro, sections: out };
}

// —— 职业特性「选择一个」细则 ——
export interface ClassFeatureOption {
  label: string; // 选项名（如「明晰护罩 Mantle of Clarity」）
  desc: string;  // 选项描述（wiki 源文本，渲染前再经 wikiToHtml）
}
export interface ClassFeatureOptionsParse {
  selectable: boolean;   // 是否为「在/从……选择一个」的选择型特性（可交互）
  intro?: string;        // 选项之前的引言（含选择说明，需渲染）
  options: ClassFeatureOption[];
  count?: number;        // 需选择的个数（默认 1；多选型如戏法「获得 4 个」）
  forceDefault?: string; // 4c「代替」型：未选择时默认生效的保留项（如机关术士「治疗注射」的耐力制剂、邪术师「魔能爆」）
}

// 明确的「选择一个」指示语（仅命中明确的建立角色时的选择表述，避免把战斗中的临时抉择/描述性文字误判为可选项）。
// 覆盖：在以下选项中选择 / 从下列契约中选择一种 / 从下列选项中挑选一个 /
// 选择下列(一个)选项 / 选择以下……中(一个) / 获得 N 个(由)你选择的……（戏法/原力协调类）
const CLASS_CHOICE_INSTR =
  /(在(以下|下列)(选项)?中选择|从(所列|下列|以下)[^。！？\n]{0,12}?中(选(择)?|挑选)(一个|一项|一种)?|选择(下列|以下)?(其中|其一|一个|1个|一项|一种)|选择下列(选项|契约)?中?(一个|一项|一种)|选择(下列|以下)[^。！？\n]{0,25}?(中)?(一个|一项|一种|之(?:[一二三四五六七八九十]{1,3}|两))|(选择|挑选)[^。！？\n]{0,10}?(下列|以下)[^。！？\n]{0,18}?[0-9一二三四五六七八九十两]+个|选择获得(下列|以下)[^。！？\n]{0,30}?的?[0-9一二三四五六七八九十两]+[种项个]|选择获得[0-9一二三四五六七八九十两]+个的?(下列|以下)(选项|特性|增益)?|获得[0-9一二三四五六七八九十两]*个?[^。！？\n]{0,12}?(由|你|由你)?选择|获得[0-9一二三四五六七八九十两]+个[^。！？\n]{0,24}威能|选择[^。！？\n]{0,12}魔宠)/;

// C 形态（[[链接]] 列表选项）额外要求：引言必须引用「下列/以下/所列」的列表，
// 避免把正文中顺带提及的[[链接]]（如混职特性里的交叉引用）误判为选项列表
const C_LINK_INSTR = /(下列|以下|所列)/;

// 多替换组：正文含 ≥2 个相互独立的「可以选择[[A]](或[[B]])来替代[[C]]」句时，
// 每个替换对都是一组独立单选（如牧师「引导神力」：神圣幸运↔神之恩惠、驱散不死↔医者仁心/亵渎之罚）。
export interface ReplacementPairGroup { base: string; alts: string[] } // base=被替代项，alts=可选项
export interface ReplacementPairParse {
  intro?: string;                        // 剔除所有替换句后的引导正文
  groups: ReplacementPairGroup[];
}
export function parseReplacementPairs(body: string): ReplacementPairParse | undefined {
  const re = /你可以?选择(?:用)?\[\[([^\]]+)\]\]\s*(?:或\[\[([^\]]+)\]\]\s*)?来(?:替代|代替|替换)\[\[([^\]]+)\]\][。！？．.。;；！?]?/g;
  const groups: ReplacementPairGroup[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const altA = m[1].trim();
    const altB = m[2] ? m[2].trim() : "";
    const base = m[3].trim();
    groups.push({ base, alts: altB ? [altA, altB] : [altA] });
  }
  if (groups.length < 2) return undefined; // 单个替换对走现有 4c/4b 逻辑；多替换才在此处理
  return { intro: body.replace(re, "").replace(/\n\s*\n+/g, "\n").trim() || undefined, groups };
}

// 从引言中解析「需要选择几个」（如「获得4个」「中的3个威能」），无数字则默认 1。
// 在「选择一个」指示语附近（前16/后50字）查找 N 个，避免引言前段的描述性文字
// （如刺客公会训练的「两个公会会…」）干扰计数。
function parseChoiceCount(intro: string): number {
  const m = CLASS_CHOICE_INSTR.exec(intro);
  const idx = m ? m.index : 0;
  const win = intro.slice(Math.max(0, idx - 16), idx + 50);
  const mm = win.match(/(\d+|[一二三四五六七八九十两]+)\s*个/);
  if (!mm) return 1;
  const s = mm[1];
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  let sum = 0;
  for (const ch of s) sum += map[ch] ?? 0;
  return sum || 1;
}

// 选取型职业特性：从特性正文中抽出引言与选项列表。
// 选项有三种形态：
//  A. ''选项名：''描述条目（多数职业，如炽念护罩/精通奥术法器）
//  B. !!! 选项名 章节标题（萨满精魂伙伴等，选项是 !!! 标题，块内 ''精魂恩赐：'' 等为重复的子增益）
//  C. [[链接]] 列表（法师戏法/剑法庇护等，选项是一串威能链接，如「从下列…中获得4个由你选择的」）
// 规则：需含明确「选择一个」指示语；若 ''选项：'' 存在重复（子增益重复出现）则改用 !!! 标题作为选项；
// 否则用 ''选项：'' 条目。最终选项数须为 2~16，且指示语在选项之前的引言中。
export function parseClassFeatureOptions(body: string | undefined): ClassFeatureOptionsParse {
  if (!body) return { selectable: false, options: [] };
  // 数据块型特性（如游侠「兽王」的 @@.classTrait 野兽数据）不是简洁选项列表，整体排除，保持文本展示
  if (/@@\.classTrait/.test(body)) return { selectable: false, options: [] };
  // 1. 收集 ''选项名：'' 描述条目
  const labelOpts: { label: string; desc: string; index: number }[] = [];
  const re = /''\s*([^'\n]*?)\s*[：:]\s*''\s*([\s\S]*?)(?=''\s*[^\n]*\s*[：:]\s*''|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const label = m[1].trim();
    const bare = label.replace(/^(增益|随意攻击威能|灵能点|基礎?技能)/, "").trim();
    if (!label || label === "增益" || label.startsWith("增益：") || bare === "" || bare.length === 0) continue;
    labelOpts.push({ label, desc: m[2].trim(), index: m.index });
  }
  // 2. 收集 ''!!! 选项名'' 章节标题（需同时含中文与英文，才是选项而非普通小标题）
  const headOpts: { label: string; index: number }[] = [];
  const hr = /^!!! (.+?)\s*$/gm;
  let hm: RegExpExecArray | null;
  while ((hm = hr.exec(body)) !== null) {
    const label = hm[1].trim();
    if (!/[\u4e00-\u9fff]/.test(label) || !/[A-Za-z]/.test(label)) continue;
    headOpts.push({ label, index: hm.index });
  }
  // 2b. 收集行首「//选项名：//」斜体条目（混职督军「督军领导」等），排除通用说明标签（特殊/增益等）
  const slashOpts: { label: string; desc: string; index: number }[] = [];
  const slRe = /(?:^|\n)\/\/\s*([^\/\n]*?)\s*[：:]\s*\/\/\s*([\s\S]*?)(?=(?:^|\n)\/\/\s*[^\/\n]*?\s*[：:]\s*\/\/|$)/g;
  let slm: RegExpExecArray | null;
  while ((slm = slRe.exec(body)) !== null) {
    const label = slm[1].trim();
    if (!label || /^(特殊|增益|注意|规则|前提|说明|基础|额外)$/.test(label)) continue;
    slashOpts.push({ label, desc: slm[2].trim(), index: slm.index });
  }
  // 3. 判定真实选项形态
  let useHeaders = false;
  if (headOpts.length >= 2) {
    const seen = new Set<string>();
    let dup = false;
    for (const o of labelOpts) {
      if (seen.has(o.label)) { dup = true; break; }
      seen.add(o.label);
    }
    // 若 ''选项：'' 条目全部位于 !!! 标题小节内部（即它们是各小节里的子增益，
    // 如术士「法术本源」的巨龙之力/混沌爆发等），则 !!! 标题才是真正的可选项
    let nested = false;
    if (labelOpts.length > 0) {
      nested = labelOpts.every((o) => {
        let h = -1;
        for (let i = 0; i < headOpts.length; i++) {
          if (o.index >= headOpts[i].index) h = i; else break;
        }
        if (h < 0) return false;
        const hEnd = h + 1 < headOpts.length ? headOpts[h + 1].index : body.length;
        return o.index < hEnd;
      });
    }
    useHeaders = dup || labelOpts.length === 0 || nested;
  }
  let firstIdx = -1;
  let options: ClassFeatureOption[] = [];
  if (useHeaders) {
    firstIdx = headOpts[0].index;
    options = headOpts.map((h, i) => {
      const nextIdx = i + 1 < headOpts.length ? headOpts[i + 1].index : body.length;
      const nl = body.indexOf("\n", h.index);
      const start = nl >= 0 ? nl + 1 : body.length;
      const desc = body.slice(start, nextIdx).replace(/^\s*$/gm, "").trim();
      return { label: h.label, desc };
    });
  } else if (labelOpts.length >= 2) {
    firstIdx = labelOpts[0].index;
    options = labelOpts.map((o) => ({ label: o.label, desc: o.desc }));
  } else if (slashOpts.length >= 2) {
    // E 形态：行首「//选项名：//」斜体条目作为选项（混职督军「督军领导」）
    firstIdx = slashOpts[0].index;
    options = slashOpts.map((o) => ({ label: o.label, desc: o.desc }));
  }
  if (options.length < 2 || options.length > 16) {
    // 4. C 形态：A/B 不成立时，尝试把正文中的 [[链接]] 列表当作选项（法师戏法、剑法庇护等）
    const linkOpts: { label: string; index: number }[] = [];
    const seenLinks = new Set<string>();
    const lr = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let lm: RegExpExecArray | null;
    while ((lm = lr.exec(body)) !== null) {
      const target = lm[1].trim();
      if (seenLinks.has(target)) continue;
      seenLinks.add(target);
      linkOpts.push({ label: (lm[2] ?? lm[1]).trim(), index: lm.index });
    }
    if (linkOpts.length >= 2 && linkOpts.length <= 16) {
      const firstIdxC = linkOpts[0].index;
      const introC = (firstIdxC > 0 ? body.slice(0, firstIdxC) : "").replace(/^\s*$/gm, "").trim();
      // 需为明确的选择指示语，且引言引用「下列/以下」的链接列表（排除交叉引用的描述性文字）
      if (introC && C_LINK_INSTR.test(introC) && CLASS_CHOICE_INSTR.test(introC)) {
        return {
          selectable: true,
          intro: introC,
          options: linkOpts.map((o) => ({ label: o.label, desc: "" })),
          count: parseChoiceCount(introC),
        };
      }
    }
    // 4b. 「替换」形态：「选择[[A]]或[[B]]…来替换[[C]]」→ 保留原威能 或 更换其为另一，故三选一（如圣武士「圣疗术」）
    const replM = body.match(/选择\[\[([^\]]+)\]\]或\[\[([^\]]+)\]\]\s*来替换\[\[([^\]]+)\]\]/);
    if (replM) {
      const replA = replM[1].trim();
      const replB = replM[2].trim();
      const replDef = replM[3].trim();
      if (replA && replB && replDef && replA !== replB) {
      // 把「你可以选择[[A]]或[[B]]…来替换[[C]]」改写为「除C之外，你还可以选择另外两个威能」，避免引言残留「你可以」
      const introR = body.replace(/你可以?选择\[\[([^\]]+)\]\]或\[\[([^\]]+)\]\]\s*来替换\[\[([^\]]+)\]\]/, "除[[$3]]之外，你还可以选择另外两个威能").replace(/\n?\s*-{3,}\s*$/g, "").trim();
      return {
        selectable: true,
        intro: introR,
        options: [{ label: replDef, desc: "" }, { label: replA, desc: "" }, { label: replB, desc: "" }],
        count: 1,
      };
    }
    }
    // 4c. 「代替」形态：「可以选择用[[A]]来代替[[B]]」→ 保留 B 或改用 A，二选一（邪术师「魔能爆」= 魔能爆/魔能击）
    // 兼容「选择[[A]]来替换[[B]]威能」的句式（刺客「阴影形态」可替换为「影焰形态」，
    // 威能词位于第二个链接之后），避免把两个威能都当作普通特性正文自动授予。
    const repl2M = body.match(/(?:你可以)?选择(?:用)?\[\[([^\]]+)\]\]来(?:代替|替代|替换)\[\[([^\]]+)\]\](?:威能)?/);
    if (repl2M) {
      const replA = repl2M[1].trim();
      const replDef = repl2M[2].trim();
      if (replA && replDef && replA !== replDef) {
        // 引言：替换句之前若为多段实质规则正文（如机关术士「治疗注射」的制造/消耗规则），
        // 保留全文并把替换句改写为选择提示，避免整节正文被吞掉；单段短引言（如魔能爆）则只留改写提示。
        const prompt = "除[[" + replDef + "]]之外，你还可以选择[[" + replA + "]]";
        const introR = /\n\s*\n/.test(body.slice(0, repl2M.index))
          ? body.replace(repl2M[0], prompt).trim()
          : prompt;
        return {
          selectable: true,
          intro: introR,
          options: [{ label: replDef, desc: "" }, { label: replA, desc: "" }],
          count: 1,
          forceDefault: replDef, // 未选择时默认保留原威能（如机关术士「治疗注射」的耐力制剂）
        };
      }
    }
    // 5. D 形态：「选择 X 或 Y」的两项选择（战士武器天赋/狙击手天赋等，无标准列表结构）
    const orM = body.match(/(?:^|[；。\n])选择\s*([^或。！？\n]{1,12}?)\s*或\s*([^或。！？\n]{1,12}?)([^。！？\n]{0,4})/);
    if (orM) {
      const optA = orM[1].trim();
      const optB = orM[2].trim();
      if (optA && optB && optA !== optB) {
        const introD = (orM.index! > 0 ? body.slice(0, orM.index!) : "").replace(/^\s*$/gm, "").trim();
        return {
          selectable: true,
          intro: introD || undefined,
          options: [{ label: optA, desc: "" }, { label: optB, desc: "" }],
          count: 1,
        };
      }
    }
    // 5b. D-链接形态：「必须选择[[A]]或[[B]]」的威能二选一（混职战魂「灵能防御」）
    const orLinkM = body.match(/必须选择\[\[([^\]]+)\]\]或\[\[([^\]]+)\]\]/);
    if (orLinkM) {
      const optA = orLinkM[1].trim();
      const optB = orLinkM[2].trim();
      if (optA && optB && optA !== optB) {
        const introD = (orLinkM.index! > 0 ? body.slice(0, orLinkM.index!) : "").replace(/^\s*$/gm, "").trim();
        return {
          selectable: true,
          intro: introD || undefined,
          options: [{ label: optA, desc: "" }, { label: optB, desc: "" }],
          count: 1,
        };
      }
    }
    return { selectable: false, options: [] };
  }
  const intro = (firstIdx > 0 ? body.slice(0, firstIdx) : "").replace(/^\s*$/gm, "").trim();
  // 关键：「选择一个」指示语必须出现在选项之前的引言里，
  // 否则只是描述正文里顺带提到「选择」，而非可交互的选项列表
  if (!intro || !CLASS_CHOICE_INSTR.test(intro)) return { selectable: false, options: [] };
  // 若选择指令后直接内联列出选项（如游侠「兽王」：从以下类型中选择：熊，野猪，猫…），
  // 说明真正的选项已写进引言，!!! 标题只是数据小节而非可选项，应整体按文本展示
  if (/选择[：:][^。！？\n]{1,24}?[，、]/.test(intro)) return { selectable: false, options: [] };
  return { selectable: true, intro: intro || undefined, options, count: parseChoiceCount(intro) };
}

// —— 职业特性正文渲染：拆分原始 HTML 块 / [[链接]] / 文本，保留换行 ——
// 原始 HTML 块（如 <table>）整体提取为占位符，避免换行转换破坏其内部结构
function protectHtmlBlocks(text: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) { out.push(text.slice(i)); break; }
    // 保留 < 之前的普通文本（避免保护 HTML 块时吞掉前文）
    if (lt > i) { out.push(text.slice(i, lt)); i = lt; continue; }
    // 仅识别完整的开标签
    const om = /^<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>/.exec(text.slice(lt));
    if (!om) { out.push(text[lt]); i = lt + 1; continue; }
    const tag = om[1].toLowerCase();
    const openRe = new RegExp("<" + tag + "(?:\\s[^>]*)?>", "i");
    const closeRe = new RegExp("</" + tag + "\\s*>", "i");
    let depth = 1;
    let j = lt + om[0].length;
    let end = -1;
    let closeStart = -1;
    while (j < text.length) {
      const rest = text.slice(j);
      const o = openRe.exec(rest);
      const c = closeRe.exec(rest);
      const oi = o ? j + o.index : -1;
      const ci = c ? j + c.index : -1;
      if (ci >= 0 && (oi < 0 || ci < oi)) {
        depth--;
        if (depth === 0) { closeStart = j + c!.index; end = closeStart + c![0].length; break; }
        j = ci + c![0].length;
      } else if (oi >= 0) {
        depth++;
        j = oi + o![0].length;
      } else break;
    }
    if (end >= 0) {
      // 词条侧边栏块（<div class="sidebar">…</div>）：保留内部规则文本（去掉 div 标签），
      // 使其作为普通正文随小节渲染（如守望者「守望者形态威能」）
      if (tag === "div" && /class=["']sidebar["']/.test(text.slice(lt, lt + 60))) {
        out.push(text.slice(lt + om[0].length, closeStart));
        i = end;
        continue;
      }
      blocks.push(text.slice(lt, end));
      out.push("\u0001" + (blocks.length - 1) + "\u0001");
      i = end;
    } else {
      out.push(text[lt]);
      i = lt + 1;
    }
  }
  return { text: out.join(""), blocks };
}

export type WikiBodyToken =
  | { kind: "html"; html: string }          // 原始 HTML 块（表格等）
  | { kind: "link"; target: string; alias: string } // [[目标|别名]] 超链接
  | { kind: "text"; html: string };          // 已转换文本（换行 → <br/>）

// 文本段：换行→<br/>，并去掉紧贴标题（h4/h5/h6）的 <br/>，避免标题上下出现多余空行；
// 标题靠自身的 CSS 边距留白即可。
function textTokenHtml(segment: string, fields: Record<string, string>): string {
  return wikiToHtml(segment, fields)
    .replace(/\n/g, "<br/>")
    // 去掉紧贴标题（h4/h5/h6）前后的 <br/>，避免标题上下出现多余空行；标题靠自身的 CSS 边距留白
    .replace(/(<br\/>\s*)+(?=<h[1-6])/g, "")
    .replace(/(<\/h[1-6]\s*>)(\s*<br\/>)+/g, "$1");
}

// 段落首行缩进两格（全角空格 ×2）：供职业能力面板中风味以外的规则正文使用。
// 跳过空行、标题行（! 开头）、@@ 指令行、以及独立成行的 HTML 块占位符行。
function indentParagraphs(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const t = line.trimStart();
      if (!t) return line; // 空行
      if (/^[!@]/.test(t)) return line; // 标题 / @@ 指令行不缩进
      if (/^-{3,}\s*$/.test(t)) return line; // wikitext 水平分隔线不缩进（保持整行，便于后续移除）
      if (/^\u0001\d+\u0001$/.test(t)) return line; // 独立 HTML 块占位符行不缩进
      return "\u3000\u3000" + line;
    })
    .join("\n");
}

// 将职业特性正文拆为 token：原始 HTML 块原样保留；[[链接]] 供 hover 卡片查找；
// 其余文本经 wikiToHtml 渲染并保留换行（<br/>）。
// indent=true 时对全文（含跨 [[链接]] 的段落）的每个自然段首行缩进两格。
export function tokenizeWikiBody(body: string, fields: Record<string, string>, indent?: boolean): WikiBodyToken[] {
  const { text, blocks } = protectHtmlBlocks(body);
  const src = indent ? indentParagraphs(text) : text;
  const tokens: WikiBodyToken[] = [];
  const linkRe = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(src)) !== null) {
    if (m.index > last) tokens.push({ kind: "text", html: textTokenHtml(src.slice(last, m.index), fields) });
    tokens.push({ kind: "link", target: m[1].trim(), alias: (m[2] ?? m[1]).trim() });
    last = m.index + m[0].length;
  }
  if (last < src.length) tokens.push({ kind: "text", html: textTokenHtml(src.slice(last), fields) });
  // 还原 HTML 块占位符（同时移除占位符相邻的换行标记）
  // 块内（如层级表的 <td> 单元格）可能残留原始 wiki 链接 [[目标|别名]]，这里统一剥离方括号，
  // 避免 `[[威能]]` 以字面量形式泄露到角色卡正文（HTML 块内容不参与链接 token 化，无 hover 交互）
  for (const t of tokens) {
    if (t.kind === "text") {
      t.html = t.html.replace(/(?:<br\/>\s*)?\u0001(\d+)\u0001(?:\s*<br\/>)?/g, (_a, n: string) =>
        (blocks[Number(n)] ?? "")
          .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
          .replace(/\[\[([^\]]+)\]\]/g, "$1"));
    }
  }
  return tokens;
}
