import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { CSSProperties } from "react";
import { HexColorPicker } from "react-colorful";
import type { Entry, PowerBlock } from "../data/types";
import { CATEGORY_LABELS } from "../data/labels";
import { FilledButton, FilledTextField, IconButton, OutlinedButton, TextButton } from "../components/md";
import EntryCard from "../sheet/EntryCard";
import { buildEntry, draftToForm, fieldsFor, CATEGORY_FIELDS, CATEGORY_LIST, CATEGORY_SECTIONS, WITHOUT_BODY, POWER_FREQUENCIES, POWER_TYPES, RANGE_TEMPLATES, composeRange, parseRange, parsePowerBlocks, POWER_BLOCK_LABELS, POWER_TEMPLATE_SECONDARY, POWER_PRESETS, PRESET_GROUPS, ITEM_FREQUENCIES, ITEM_POWER_KEYWORDS, POWER_HEAD_BASES, ACTION_TYPES, parseItemPowerSections, parseItemProperties, parseFeatRowsJson, parseSetBonusesJson, parseTerms, serializeTerms, FEAT_PRESETS, FEAT_PREREQ_CANDIDATES, parseLevelSectionsJson, parseCreatureBlockJson, CREATURE_ROLES, CREATURE_SIZES, CREATURE_ORIGINS, CREATURE_ACTIONS, CREATURE_FREQUENCIES, CREATURE_ROW_PRESETS, GROUPS_BY_CATEGORY, GROUPS, SUIT_CANDIDATES_BY_CATEGORY, suitRowFor, ENH_TARGETS_BY_CATEGORY, ENH_TARGETS_COMMON, enhTargetOf, enhBonusOf, enhAppliesTo, equipFamilyOf, equipmentStatRows, MUNDANE_STAT_ROWS, MUNDANE_CATEGORIES, MUNDANE_FIELDS, gearToForm, ITEM_CATEGORY_TIPS, RARITY_TIPS, ITEM_TYPE_TIPS, type LevelFeatureSection, type SheetField, type RangeTemplateItem, type PowerPreset, type HomebrewSection, type ItemPowerSection, type ItemPropertySection, type FeatRow, type SetBonusBlock, type CreatureBlock } from "../lib/homebrewSchema";
import { wikiToMarkdown } from "../lib/markdown";
import { itemLevels, enhancementBonusForLevel, priceForLevel } from "../lib/levelprices";
import { loadCategory, loadOfficialCategory } from "../data/loaders";
import { loadPools, uniqueEntryId, upsertEntryInPool, type HomebrewPool } from "../lib/userdata";

// 三级页面：条目编辑器（整页编辑，不使用弹窗）。
// 左侧表单 / 右侧实时预览；正文为 Markdown，配一排插入按钮，避免记语法。

const DRAFT_KEY = "4enext.homebrewDraft.v1";

function loadDraft(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function saveDraft(form: Record<string, string>) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
  } catch {
    /* 忽略 */
  }
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 忽略 */
  }
}

const blank = (cat?: string): Record<string, string> => ({
  name: "",
  nameEn: "",
  category: cat && CATEGORY_LIST.includes(cat) ? cat : "",
  tags: "",
  source: "",
  sourceText: "",
  bodyFormat: "md",
});

/** 正文工具栏：[标签, 插入前缀, 插入后缀, 占位文字, 整行插入] */
const TOOLS: { label: string; icon: string; before: string; after: string; sample: string; block?: boolean }[] = [
  { label: "标题", icon: "title", before: "## ", after: "", sample: "小节标题", block: true },
  { label: "加粗", icon: "format_bold", before: "**", after: "**", sample: "重点" },
  { label: "斜体", icon: "format_italic", before: "*", after: "*", sample: "强调" },
  { label: "列表", icon: "format_list_bulleted", before: "- ", after: "", sample: "一条内容", block: true },
  { label: "编号", icon: "format_list_numbered", before: "1. ", after: "", sample: "第一步", block: true },
  { label: "引用", icon: "format_quote", before: "> ", after: "", sample: "风味描述", block: true },
  { label: "表格", icon: "table", before: "| 名称 | 数值 |\n| --- | --- |\n| 示例 | 1d6 |", after: "", sample: "", block: true },
  { label: "分割线", icon: "horizontal_rule", before: "---", after: "", sample: "", block: true },
  { label: "链接", icon: "link", before: "[", after: "](https://)", sample: "链接文字" },
];

// 统计字段格式提示
const STAT_HINTS: Record<string, string> = {
  cost: "格式：数字 gp（如 1020 gp）",
  weight: "格式：数字 磅（如 4 磅）",
  critical: "如 1d6+增强 / 命中致盲",
  proficiency: "如 +3（武器擅长加值）",
  damage: "如 1d8（基础武器伤害骰）",
  range: "如 10/20；近战武器填 —",
  armorBonus: "如 +6（护甲加值，不含增强）",
  minEnhancement: "如 +1（精制品护甲所需最小增强加值）",
  checkPenalty: "如 -1（护甲检定罚值）",
  speed: "如 -1（护甲速度罚值）",
  shieldBonus: "如 +1（盾牌加值）",
};

// 可选区块（HomebrewSection.optional）按内容自动展开的判定：有内容 = 展开
const OPT_SEC_HAS: Record<string, (f: Record<string, string>) => boolean> = {
  sourceText: (f) => !!(f.sourceText ?? "").trim(),
  powerSections: (f) => parseItemPowerSections(f.powerSections).length > 0,
};

// 基础名录（gear.json）懒加载缓存
let gearIndexPromise: Promise<Entry[]> | undefined;

// 威能「标签块」编辑器：一块=标签+内容；顶部预设条一键套用官方高频行结构；
// 连续缩进（indent>0）的块自动聚合为独立的「次攻击组」面板（如官方次攻击：次目标/次攻击/命中/效果），
// 整组插入/删除、组内排序，不再提供逐行缩进开关——避免子行与相邻缩进行意外合并成一个大组。
// 每个块的渲染与右侧 PowerCard 一一行对应，保存时序列化为官方 <table class=details>。
function PowerBlockEditor({ value, onChange }: { value: PowerBlock[]; onChange: (blocks: PowerBlock[]) => void }) {
  // 非空列表套用预设需「再点一次确认替换」，防止误点清空已填内容
  const [armPreset, setArmPreset] = useState<string | null>(null);
  useEffect(() => {
    if (!armPreset) return;
    const t = window.setTimeout(() => setArmPreset(null), 2500);
    return () => window.clearTimeout(t);
  }, [armPreset]);
  const applyPreset = (p: PowerPreset) => {
    if (value.length === 0) {
      onChange(p.blocks.map((b) => ({ ...b })));
      return;
    }
    if (armPreset === p.name) {
      onChange(p.blocks.map((b) => ({ ...b })));
      setArmPreset(null);
    } else {
      setArmPreset(p.name);
    }
  };
  // 顶部预设条：按 攻击类/辅助类/特殊类 分组展示，点击填入（空）或确认替换（非空）
  const renderPresets = () => (
    <div className="hb-pblock-presets">
      <span className="hb-pblock-presets-label">
        {value.length === 0 ? "预设模板 · 点击填入对应标签块" : "预设模板 · 点击一次再点确认可替换当前内容"}
      </span>
      {PRESET_GROUPS.map((g) => (
        <div className="hb-pblock-preset-group" key={g}>
          <span className="hb-pblock-preset-group-label">{g}</span>
          {POWER_PRESETS.filter((p) => p.group === g).map((p) => (
            <button
              key={p.name}
              type="button"
              className={"chip mini" + (armPreset === p.name ? " armed" : "")}
              title={value.length === 0 ? p.desc : armPreset === p.name ? "再次点击确认替换为「" + p.name + "」" : p.desc + "（再点一次确认替换）"}
              onClick={() => applyPreset(p)}
            >
              {armPreset === p.name ? "确认替换？" : p.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
  const updateAt = (i: number, upd: Partial<PowerBlock>) =>
    onChange(value.map((b, j) => (j === i ? { ...b, ...upd } : b)));
  const hintOf = (label: string) => POWER_BLOCK_LABELS.find((l) => l.label === label)?.hint ?? "";
  // 官方行序：已识别标签按 POWER_BLOCK_LABELS 顺序，未知/纯文本段落保持原相对顺序排到末尾
  const canonicalIndex = (label: string) => {
    const i = POWER_BLOCK_LABELS.findIndex((l) => l.label === label);
    return i === -1 ? POWER_BLOCK_LABELS.length : i;
  };
  // 把平铺块切成「普通块」与「连续缩进子行组」交替的段（子行组=次攻击组）
  const segments: { group: boolean; blocks: PowerBlock[]; start: number }[] = [];
  for (let i = 0; i < value.length; ) {
    const sub = (value[i].indent ?? 0) > 0;
    let j = i;
    while (j < value.length && ((value[j].indent ?? 0) > 0) === sub) j++;
    segments.push({ group: sub, blocks: value.slice(i, j), start: i });
    i = j;
  }
  // 上移/下移：只在所属段内移动，子行不会移出「次攻击组」
  const move = (i: number, dir: -1 | 1) => {
    const a = [...value];
    [a[i + dir], a[i]] = [a[i], a[i + dir]];
    onChange(a);
  };
  const segmentOf = (i: number) => segments.find((s) => i >= s.start && i < s.start + s.blocks.length)!;
  // 按官方顺序排序：仅普通块段内排序，次攻击组保持原内部顺序不动
  const sortCanonical = () =>
    onChange(
      segments.flatMap((seg) =>
        seg.group
          ? seg.blocks
          : [...seg.blocks]
              .map((b, k) => ({ ...b, _k: k }))
              .sort((a, b) => canonicalIndex(a.label) - canonicalIndex(b.label) || (a as unknown as { _k: number })._k - (b as unknown as { _k: number })._k)
              .map(({ _k, ...b }) => b),
      ),
    );
  const labelSelect = (b: PowerBlock, i: number) => (
    <select className="hb-pblock-label" value={b.label} onChange={(e) => updateAt(i, { label: e.target.value })}>
      <option value="">（无标签 · 纯文本段落）</option>
      {POWER_BLOCK_LABELS.map((l) => (
        <option key={l.label} value={l.label}>{l.label}</option>
      ))}
    </select>
  );
  const ops = (i: number) => {
    const seg = segmentOf(i);
    const first = i === seg.start;
    const last = i === seg.start + seg.blocks.length - 1;
    return (
      <div className="hb-pblock-ops">
        <button type="button" className="chip mini" disabled={first} title="上移" onClick={() => move(i, -1)}>↑</button>
        <button type="button" className="chip mini" disabled={last} title="下移" onClick={() => move(i, 1)}>↓</button>
        <button type="button" className="chip mini" title="删除此块" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
      </div>
    );
  };
  const renderRow = (b: PowerBlock, i: number) => (
    <div key={i} className="hb-pblock">
      <div className="hb-pblock-head">
        {labelSelect(b, i)}
        {ops(i)}
      </div>
      <textarea
        className="hb-textarea hb-pblock-text"
        rows={2}
        value={b.text}
        placeholder={hintOf(b.label)}
        onChange={(e) => updateAt(i, { text: e.target.value })}
      />
    </div>
  );
  // 「次攻击组」独立面板：标题 + 子行（次目标/次攻击/命中/效果）+ 组内加行 + 整组删除
  const renderGroup = (seg: { group: boolean; blocks: PowerBlock[]; start: number }) => {
    const s = seg.start;
    const L = seg.blocks.length;
    return (
      <div key={s} className="hb-pblock-subgroup">
        <div className="hb-pblock-subgroup-head">
          <span className="hb-pblock-subgroup-title">
            <span className="material-symbols-outlined">bolt</span>
            次攻击组
          </span>
          <span className="hb-pblock-subgroup-sub">缩进子行 · 次目标 / 次攻击 / 命中 / 效果</span>
          <button type="button" className="chip mini hb-pblock-subgroup-del" title="删除整组" onClick={() => onChange(value.filter((_, j) => j < s || j >= s + L))}>× 删除整组</button>
        </div>
        {seg.blocks.map((b, k) => renderRow(b, s + k))}
        <button type="button" className="chip mini" title="在组末尾追加一行" onClick={() => onChange([...value.slice(0, s + L), { label: "效果", text: "", indent: 1 }, ...value.slice(s + L)])}>＋ 组内加行</button>
      </div>
    );
  };
  if (value.length === 0) {
    return (
      <div className="hb-pblock empty" data-ed-field="powerBlocks">
        {renderPresets()}
        <p className="hint" style={{ margin: "0 0 8px" }}>
          预设基于官方威能的高频行结构（已统计 8900+ 条威能的详情）；也可用「＋ 添加一个标签块」从空白开始逐行搭建。
        </p>
        <div className="hb-pblock-actions">
          <OutlinedButton onClick={() => onChange([{ label: "效果", text: "" }])}>＋ 添加一个标签块</OutlinedButton>
        </div>
      </div>
    );
  }
  return (
    <div className="hb-pblock-list" data-ed-field="powerBlocks">
      {renderPresets()}
      {segments.map((seg) =>
        seg.group ? renderGroup(seg) : seg.blocks.map((b, k) => renderRow(b, seg.start + k)),
      )}
      <div className="hb-pblock-actions">
        <OutlinedButton onClick={sortCanonical} disabled={value.length < 2}>按官方顺序排序</OutlinedButton>
        <OutlinedButton onClick={() => onChange([...value, ...POWER_TEMPLATE_SECONDARY])}>＋ 追加次攻击组</OutlinedButton>
        <OutlinedButton onClick={() => onChange([...value, { label: "效果", text: "" }])}>＋ 追加标签块</OutlinedButton>
      </div>
    </div>
  );
}

// —— 专长关联威能等级表编辑器（流派专长固定结构：等级 × 关联威能）——
function FeatTableEditor({ value, onChange }: { value: FeatRow[]; onChange: (rows: FeatRow[]) => void }) {
  const updateAt = (i: number, upd: Partial<FeatRow>) =>
    onChange(value.map((r, j) => (j === i ? { ...r, ...upd } : r)));
  return (
    <div className="hb-feattable" data-ed-field="featRows">
      <p className="hint" style={{ margin: "0 0 8px" }}>流派专长在「增益」末尾附等级×关联威能表。逐行填写等级与威能名，保存时拼装为官方 <code>&lt;table&gt;</code>。</p>
      <div className="hb-feattable-rows">
        {value.map((r, i) => (
          <div key={i} className="hb-feattable-row">
            <FilledTextField type="number" label="等级" value={r.level} onInput={(e) => updateAt(i, { level: (e.target as HTMLInputElement).value })} />
            <FilledTextField label="关联威能" value={r.power} placeholder="威能名（如 骑士冲锋）" onInput={(e) => updateAt(i, { power: (e.target as HTMLInputElement).value })} />
            <IconButton title="删除此行" onClick={() => onChange(value.filter((_, j) => j !== i))}><span className="material-symbols-outlined">close</span></IconButton>
          </div>
        ))}
      </div>
      <div className="hb-pblock-actions">
        <OutlinedButton onClick={() => onChange([...value, { level: (value.length ? value.length + 1 + "" : "1"), power: "" }])}>＋ 添加等级行</OutlinedButton>
        <OutlinedButton onClick={() => onChange(value.filter((r) => r.level.trim() || r.power.trim()).slice())}>清理空行</OutlinedButton>
      </div>
    </div>
  );
}

// —— 套装件数增益块编辑器（2件套/3件套/… + 增益文本）——
function SetBonusEditor({ value, onChange }: { value: SetBonusBlock[]; onChange: (blocks: SetBonusBlock[]) => void }) {
  const piecesSuggest = ["2件套", "3件套", "4件套", "5件套"];
  return (
    <div className="hb-setbonus" data-ed-field="setBonuses">
      <p className="hint" style={{ margin: "0 0 8px" }}>每个增益块 = 件数（如「2件套」）+ 增益描述。保存时生成「!! 套装增益」小节。</p>
      {value.map((b, i) => (
        <div key={i} className="hb-setbonus-block">
          <div className="hb-pblock-head">
            <FilledTextField label="件数" value={b.pieces} placeholder="如：2件套" onInput={(e) => onChange(value.map((x, j) => j === i ? { ...x, pieces: (e.target as HTMLInputElement).value } : x))} />
            <div className="hb-ed-chips">
              {piecesSuggest.map((p) => (
                <button key={p} type="button" className={"chip mini" + (b.pieces === p ? " active" : "")} onClick={() => onChange(value.map((x, j) => j === i ? { ...x, pieces: x.pieces === p ? "" : p } : x))}>{p}</button>
              ))}
            </div>
            <IconButton title="删除此增益块" onClick={() => onChange(value.filter((_, j) => j !== i))}><span className="material-symbols-outlined">close</span></IconButton>
          </div>
          <textarea
            className="hb-textarea"
            rows={3}
            value={b.text}
            placeholder="增益描述（可含 [[威能]] 链接）"
            onChange={(e) => onChange(value.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
          />
        </div>
      ))}
      <div className="hb-pblock-actions">
        <OutlinedButton onClick={() => onChange([...value, { pieces: (value.length + 2) + "件套", text: "" }])}>＋ 添加增益块</OutlinedButton>
      </div>
    </div>
  );
}

// —— 译名字典：词条对编辑（英 / 中 每行一对，支持批量粘贴）——
function TermsPairsEditor({ value, onChange }: { value: [string, string][]; onChange: (pairs: [string, string][]) => void }) {
  const [batch, setBatch] = useState("");
  const importBatch = () => {
    const pairs = parseTerms(batch);
    if (pairs.length) onChange(pairs.filter(([e, z]) => e.trim() || z.trim()));
    setBatch("");
  };
  const updateAt = (i: number, upd: [string, string]) =>
    onChange(value.map((p, j) => (j === i ? upd : p)));
  return (
    <div className="hb-terms" data-ed-field="termsPairs">
      <p className="hint" style={{ margin: "0 0 8px" }}>每个词条对 = 英文 + 中文。可在下方批量粘贴「英: 中」多行后自动拆分。</p>
      {value.map(([en, zh], i) => (
        <div key={i} className="hb-terms-row">
          <FilledTextField label="英文" value={en} onInput={(e) => updateAt(i, [(e.target as HTMLInputElement).value, zh])} />
          <FilledTextField label="中文" value={zh} onInput={(e) => updateAt(i, [en, (e.target as HTMLInputElement).value])} />
          <IconButton title="删除此词条" onClick={() => onChange(value.filter((_, j) => j !== i))}><span className="material-symbols-outlined">close</span></IconButton>
        </div>
      ))}
      <div className="hb-pblock-actions">
        <OutlinedButton onClick={() => onChange([...value, ["", ""]])}>＋ 添加词条对</OutlinedButton>
      </div>
      <details className="hb-terms-batch">
        <summary>批量粘贴（每行一对「英文: 中文」）</summary>
        <textarea className="hb-textarea" rows={5} value={batch} placeholder={"Achra: 阿克拉\nBane: 班恩"} onChange={(e) => setBatch(e.target.value)} />
        <OutlinedButton onClick={importBatch}>拆分并填入</OutlinedButton>
      </details>
    </div>
  );
}

// —— 装备·物品威能段编辑器 ——
// 官方装备威能 = 若干「段头（关键词✦频率（动作））+ 正文标签块」；每段正文复用 PowerBlockEditor。
const ITEM_POWER_PRESETS: { name: string; desc: string; freq: string; action: string; keywords: string; group: string }[] = [
  { name: "每日 · 自由动作 · 触发", desc: "每日（自由动作），正文 触发/效果", freq: "每日", action: "自由动作", keywords: "", group: "辅助类" },
  { name: "每日 · 次要动作 · 效果", desc: "每日（次要动作），正文 效果", freq: "每日", action: "次要动作", keywords: "", group: "辅助类" },
  { name: "遭遇 · 标准动作 · 攻击", desc: "遭遇（标准动作），正文 目标/攻击/命中", freq: "遭遇", action: "标准动作", keywords: "", group: "攻击类" },
  { name: "随意 · 标准动作 · 攻击", desc: "随意（标准动作），正文 攻击块", freq: "随意", action: "标准动作", keywords: "", group: "攻击类" },
  { name: "消耗 · 自由动作", desc: "消耗（自由动作），消耗品专属", freq: "消耗", action: "自由动作", keywords: "", group: "消耗类" },
  { name: "消耗 · 标准动作 · 攻击", desc: "消耗（标准动作），正文 目标/攻击/命中（攻击型消耗品）", freq: "消耗", action: "标准动作", keywords: "", group: "攻击类" },
  { name: "遭遇 · 次要动作 · 辅助", desc: "遭遇（次要动作），正文 效果", freq: "遭遇", action: "次要动作", keywords: "", group: "辅助类" },
  { name: "回复力 · 标准动作 · 效果", desc: "回复力（标准动作），正文 效果（回复力补给类）", freq: "回复力", action: "标准动作", keywords: "", group: "辅助类" },
  { name: "每日 · 回复力 · 自由动作", desc: "每日（自由动作），段头关键词「回复力」（如获得回复力的补给品）", freq: "每日", action: "自由动作", keywords: "回复力", group: "辅助类" },
  { name: "医疗 · 每日", desc: "关键词预填「医疗」", freq: "每日", action: "标准动作", keywords: "医疗", group: "辅助类" },
  { name: "传送 · 每日", desc: "关键词预填「传送」", freq: "每日", action: "标准动作", keywords: "传送", group: "辅助类" },
];
function ItemPowerSectionsEditor({ value, onChange }: { value: ItemPowerSection[]; onChange: (sections: ItemPowerSection[]) => void }) {
  const [armPreset, setArmPreset] = useState<string | null>(null);
  useEffect(() => {
    if (!armPreset) return;
    const t = window.setTimeout(() => setArmPreset(null), 2500);
    return () => window.clearTimeout(t);
  }, [armPreset]);
  const applyPreset = (p: (typeof ITEM_POWER_PRESETS)[number]) => {
    if (value.length === 0) {
      onChange([{ freq: p.freq as ItemPowerSection["freq"], action: p.action, keywords: p.keywords, blocks: [] }]);
      return;
    }
    if (armPreset === p.name) {
      onChange([...value, { freq: p.freq as ItemPowerSection["freq"], action: p.action, keywords: p.keywords, blocks: [] }]);
      setArmPreset(null);
    } else {
      setArmPreset(p.name);
    }
  };
  const updSection = (i: number, upd: Partial<ItemPowerSection>) =>
    onChange(value.map((s, j) => (j === i ? { ...s, ...upd } : s)));
  const chooseFreq = (i: number, f: string) => updSection(i, { freq: value[i].freq === f ? "" : (f as ItemPowerSection["freq"]) });
  const chooseAction = (i: number, a: string) => updSection(i, { action: value[i].action === a ? "" : a });
  const toggleKw = (i: number, kw: string) => {
    const cur = value[i].keywords ?? "";
    const tags = cur.split(/[，,、]/).map((s) => s.trim()).filter(Boolean);
    const next = tags.includes(kw) ? tags.filter((t) => t !== kw) : [...tags, kw];
    updSection(i, { keywords: next.join("，") });
  };
  return (
    <div className="hb-itempower" data-ed-field="powerSections">
      <div className="hb-pblock-presets">
        <span className="hb-pblock-presets-label">
          {value.length === 0 ? "物品威能段预设 · 点击填入段头" : "物品威能段预设 · 点击一次再点确认可追加一段"}
        </span>
        {["攻击类", "辅助类", "消耗类"].map((g) => {
          const gs = ITEM_POWER_PRESETS.filter((p) => p.group === g);
          if (!gs.length) return null;
          return (
            <div key={g} className="hb-kw-group">
              <div className="hb-kw-group-head"><span className="hb-kw-group-name">{g}</span></div>
              <div className="hb-ed-chips">
                {gs.map((p) => (
                  <button key={p.name} type="button" className={"chip mini" + (armPreset === p.name ? " armed" : "")} title={p.desc} onClick={() => applyPreset(p)}>
                    {armPreset === p.name ? "确认追加？" : p.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="hint" style={{ margin: "0 0 8px" }}>
        官方格式：<code>威能（关键词）✦每日（自由动作）</code> 段头 + <code>div.text</code> 正文标签块。段正文可复用下方标签块编辑器的全部标签与次攻击组。
      </p>
      {value.length === 0 && (
        <div className="hb-pblock-actions">
          <OutlinedButton onClick={() => onChange([{ base: "威能", freq: "每日", action: "标准动作", keywords: "", blocks: [] }])}>＋ 添加一个威能段</OutlinedButton>
        </div>
      )}
      {value.map((s, i) => {
        const isCustom = s.base === "自定义";
        const baseNow = isCustom ? "自定义" : (s.base || "威能");
        return (
          <div key={i} className="hb-itempower-sec">
            <div className="hb-itempower-head">
              <span className="hb-itempower-headlabel">{isCustom ? "标题段" : "威能段"} {i + 1}</span>
              <span className="hb-itempower-preview">
                预览：{isCustom
                  ? (s.head || "（自定义标题）")
                  : `${baseNow}${s.keywords ? `（${s.keywords}）` : ""}✦${s.freq || "（未设频率）"}${s.action ? `（${s.action}）` : ""}`}
              </span>
              <IconButton title="删除此段" onClick={() => onChange(value.filter((_, j) => j !== i))}><span className="material-symbols-outlined">delete</span></IconButton>
            </div>
            <div className="hb-itempower-freqrow">
              <span className="hb-label-sm">段头</span>
              <div className="hb-ed-chips">
                {POWER_HEAD_BASES.map((b) => (
                  <button key={b} type="button" className={"chip mini" + (!isCustom && baseNow === b ? " active" : "")} onClick={() => updSection(i, { base: b, head: "" })}>{b}</button>
                ))}
                <button type="button" className={"chip mini" + (isCustom ? " active" : "")} title="非威能标题段（官方如 固有增益/神圣展现/怪癖）" onClick={() => updSection(i, { base: "自定义", head: s.head || "" })}>自定义标题</button>
              </div>
            </div>
            {isCustom && (
              <div className="hb-itempower-kwrow">
                <span className="hb-label-sm">标题</span>
                <FilledTextField value={s.head ?? ""} placeholder="如：固有增益 / 神圣展现 / 怪癖" onInput={(e) => updSection(i, { head: (e.target as HTMLInputElement).value ?? "" })} />
              </div>
            )}
            {!isCustom && (
              <>
                <div className="hb-itempower-kwrow">
                  <span className="hb-label-sm">关键词</span>
                  <FilledTextField value={s.keywords ?? ""} placeholder="威能（关键词），可空" onInput={(e) => updSection(i, { keywords: (e.target as HTMLInputElement).value })} />
                  <div className="hb-ed-chips">
                    {[...new Set([...(s.keywords ?? "").split(/[，,、]/).map((t) => t.trim()).filter(Boolean), ...ITEM_POWER_KEYWORDS])].slice(0, 14).map((kw) => (
                      <button key={kw} type="button" className={"chip mini" + ((s.keywords ?? "").split(/[，,、]/).includes(kw) ? " active" : "")} onClick={() => toggleKw(i, kw)}>{kw}</button>
                    ))}
                  </div>
                </div>
                <div className="hb-itempower-freqrow">
                  <span className="hb-label-sm">频率</span>
                  <div className="hb-ed-chips">
                    {[...ITEM_FREQUENCIES].map((fr) => (
                      <button key={fr} type="button" className={"chip mini" + (s.freq === fr ? " active" : "")} onClick={() => chooseFreq(i, fr)}>{fr}</button>
                    ))}
                  </div>
                  <span className="hb-label-sm">动作</span>
                  <div className="hb-ed-chips">
                    {ACTION_TYPES.map((a) => (
                      <button key={a} type="button" className={"chip mini" + (s.action === a ? " active" : "")} onClick={() => chooseAction(i, a)}>{a}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <PowerBlockEditor value={s.blocks} onChange={(blocks) => updSection(i, { blocks })} />
          </div>
        );
      })}
      {value.length > 0 && (
        <div className="hb-pblock-actions">
          <OutlinedButton onClick={() => onChange([...value, { base: "威能", freq: "每日", action: "标准动作", keywords: "", blocks: [] }])}>＋ 再添加一个威能段</OutlinedButton>
        </div>
      )}
    </div>
  );
}

// —— 装备「物品特性」编辑器：多段纯文本特性，段 = 「特性」段头 + 若干 <div class=text> 行 ——
// 官方特性为自由文本（如潜行加值/免疫/威能补强）；多段特性逐段添加，每行输出一个段落。
// 段头支持 上移/下移（同列表内换位）与折叠；顶部徽标显示当前段数。不做骨架预设（官方特性自由文本、按类别差异大）。
function ItemPropertiesEditor({ value, onChange }: { value: ItemPropertySection[]; onChange: (v: ItemPropertySection[]) => void }) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const upd = (i: number, raw: string) => {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      onChange(value.filter((_, j) => j !== i));
      return;
    }
    onChange(value.map((s, j) => (j === i ? { lines } : s)));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setCollapsed((prev) => ({ ...prev, [i]: prev[j], [j]: prev[i] }));
  };
  return (
    <div className="hb-itempower" data-ed-field="properties">
      {value.length > 0 && <span className="hb-count-badge" title="当前特性段数">共 {value.length} 段</span>}
      <p className="hint" style={{ margin: "0 0 8px" }}>
        官方「特性」段为纯文本特性描述（如潜行加值、伤害免疫等）。每行输出一个 <code>div.text</code> 段落；多段特性可逐段添加。
        <br />消耗品等武装力无特性的条目可留空。
      </p>
      {value.length === 0 && (
        <div className="hb-pblock-actions">
          <OutlinedButton onClick={() => onChange([...value, { lines: [""] }])}>＋ 添加一个特性段</OutlinedButton>
        </div>
      )}
      {value.map((s, i) => (
        <div key={i} className={"hb-itempower-sec" + (collapsed[i] ? " collapsed" : "")}>
          <div className="hb-itempower-head">
            <span className="hb-itempower-headlabel">特性段 {i + 1}</span>
            <div className="hb-pblock-actions">
              <IconButton title="上移此段" disabled={i === 0} onClick={() => move(i, -1)}><span className="material-symbols-outlined">keyboard_arrow_up</span></IconButton>
              <IconButton title="下移此段" disabled={i === value.length - 1} onClick={() => move(i, 1)}><span className="material-symbols-outlined">keyboard_arrow_down</span></IconButton>
              <IconButton title={collapsed[i] ? "展开此段" : "折叠此段"} onClick={() => setCollapsed((prev) => ({ ...prev, [i]: !prev[i] }))}>
                <span className="material-symbols-outlined">{collapsed[i] ? "expand_more" : "expand_less"}</span>
              </IconButton>
              <IconButton title="删除此段" onClick={() => onChange(value.filter((_, j) => j !== i))}><span className="material-symbols-outlined">delete</span></IconButton>
            </div>
          </div>
          {!collapsed[i] && (
            <textarea
              className="hb-textarea"
              value={s.lines.join("\n")}
              rows={Math.max(2, s.lines.length + 1)}
              placeholder="每行一段特性描述；想加多个特性段时点下方按钮"
              onChange={(e) => upd(i, e.target.value)}
            />
          )}
        </div>
      ))}
      {value.length > 0 && (
        <div className="hb-pblock-actions">
          <OutlinedButton onClick={() => onChange([...value, { lines: [""] }])}>＋ 再添加一个特性段</OutlinedButton>
        </div>
      )}
    </div>
  );
}

// —— 装备「统计数据」横排表编辑器：行集由形态/类别(装备族)单一来源决定，与右侧 ItemCard 统计表逐行同构 ——
// 魔法形态 = equipmentStatRows（C 族恒补「增强」行，卡片侧仍按已填值显隐）；
// 基础形态 = MUNDANE_STAT_ROWS[类别] + 尾部「子类别」行（gearToForm 依赖）。
// data-ed-field 保留 → 右侧预览 Ghost 的 goField 跳转继续可用。
function EquipmentStatTableEditor({ form, set }: { form: Record<string, string>; set: (k: string, v: string) => void }) {
  const mundane = form.itemForm === "mundane";
  const fam = equipFamilyOf(form.itemCategory);
  // 行集单一来源：魔法形态 = 族行 + 适合行（武器/法器/护甲 用分类组承载适合，不重复）；基础形态 = MUNDANE 行 + 子类别
  const suit = mundane ? null : suitRowFor(form.itemCategory, !!form.itemSuitable);
  const rows: { key: string; label: string }[] = mundane
    ? [...(MUNDANE_STAT_ROWS[form.itemCategory] ?? []), { key: "subCategory", label: "子类别" }]
    : [...equipmentStatRows(fam, fam === "C" || !!form.enh), ...(suit ? [suit] : [])];
  // 等级联动提示（与威能标准的 itemLevel↔增强↔价格 联动一致）
  const levels = itemLevels(form.itemLevel ?? "");
  const firstEnh = levels.length ? enhancementBonusForLevel(levels[0]) : undefined;
  const firstLevel = levels.length ? levels[0] : undefined;
  const firstPrice = firstLevel ? priceForLevel(firstLevel) : undefined;
  const priceRangeAll = levels.map(priceForLevel).filter((n) => n > 0).sort((a, b) => a - b);
  // 增强算法：加值留空 = 按等级推导（enhBonusOf）；对象 = 类别默认（enhTargetOf）+ chips/自定义覆盖
  const enhDerived = !mundane && (enhAppliesTo(form.itemCategory) || (form.enhTarget ?? "").trim())
    ? enhBonusOf(form.itemLevel ?? "", "") : "";
  return (
    <div className="hb-stat-table" data-ed-field="stats">
      {rows.map((r) => {
        const val = form[r.key] ?? "";
        // 分类组/适合 候选 chips：分类组随类别过滤（武器→刀刃/矛…），适合按类别给盾位/纹身/药剂等候选
        const candCands = r.key === "group"
          ? (GROUPS_BY_CATEGORY[form.itemCategory ?? ""] ?? GROUPS)
          : r.key === "itemSuitable"
            ? (SUIT_CANDIDATES_BY_CATEGORY[form.itemCategory ?? ""] ?? [])
            : [];
        const renderCands = () => {
          if (!candCands.length) return null;
          if (r.key === "group") {
            const parts = val.split(/[\/、，,]/).map((t) => t.trim()).filter(Boolean);
            return (
              <div className="hb-ed-chips">
                {candCands.map((c) => (
                  <button key={c} type="button" className={"chip mini" + (parts.includes(c) ? " active" : "")} title={ITEM_TYPE_TIPS[c]} onClick={() => {
                    const next = parts.includes(c) ? parts.filter((p) => p !== c) : [...parts, c];
                    set(r.key, next.join("/"));
                  }}>{c}</button>
                ))}
              </div>
            );
          }
          return (
            <div className="hb-ed-chips">
              {candCands.map((c) => (
                <button key={c} type="button" className={"chip mini" + (val === c ? " active" : "")} onClick={() => set(r.key, val === c ? "" : c)}>{c}</button>
              ))}
            </div>
          );
        };
        return (
          <div key={r.key} className="hb-stat-row" data-ed-field={r.key}>
            <span className="hb-stat-row-label">{r.label}</span>
            <FilledTextField
              value={val}
              placeholder={
                r.key === "enh"
                  ? enhDerived ? `自动：${enhDerived}` : "如 +3"
                  : r.key === "subCategory" ? "如 巨剑/链甲（基础名录带自动填）" : undefined
              }
              onInput={(e) => set(r.key, (e.target as HTMLInputElement).value ?? "")}
            />
            {renderCands()}
            {r.key === "enh" && !mundane && (() => {
              // 增强对象：类别默认 chips + 自定义输入（用户自主设定；点当前项恢复默认）
              const cands = ENH_TARGETS_BY_CATEGORY[form.itemCategory ?? ""] ?? ENH_TARGETS_COMMON;
              const cur = enhTargetOf(form.itemCategory, form.enhTarget);
              return (
                <div className="hb-ed-chips">
                  <span className="hb-label-sm">对象</span>
                  {cands.map((t) => (
                    <button key={t} type="button" className={"chip mini" + (cur === t ? " active" : "")} onClick={() => set("enhTarget", cur === t ? "" : t)}>{t}</button>
                  ))}
                  <FilledTextField
                    value={cands.includes(cur) ? "" : (form.enhTarget ?? "")}
                    placeholder="自定义对象"
                    onInput={(e) => set("enhTarget", (e.target as HTMLInputElement).value ?? "")}
                  />
                </div>
              );
            })()}
            {r.key === "enh" && enhDerived && !val.trim() && (
              <span className="hint">按物品等级自动推导增强：{enhDerived}；手动填写后以填写为准（清空即恢复推导）。</span>
            )}
            {r.key === "enh" && val.trim() && firstEnh !== undefined && !val.includes("+" + firstEnh) && (
              <span className="hint hb-hint-warn">提示：按首个等级通常为 +{firstEnh}，当前「{val.trim()}」为手动覆盖。</span>
            )}
            {r.key === "enh" && val.trim() && !(firstEnh !== undefined && !val.includes("+" + firstEnh)) && (
              <span className="hint">已手动设置加值；清空输入框可恢复按等级推导。</span>
            )}
            {r.key === "cost" && priceRangeAll.length > 0 && (
              <span className={"hint" + (val.trim() && val.includes("gp") && priceRangeAll.every((p) => !val.includes(String(p))) ? " hb-hint-warn" : "")}>
                {val.trim() && val.includes("gp") && priceRangeAll.every((p) => !val.includes(String(p)))
                  ? `提示：当前「${val.trim()}」与按等级的价格（${priceRangeAll.map((p) => p + " gp").join("/")}）不符`
                  : priceRangeAll.length === 1
                    ? `该等级价格约 ${firstPrice} gp`
                    : `按这些等级价格：${levels.map((l) => `L${l}≈${priceForLevel(l)}gp`).join("，")}`}
              </span>
            )}
            {r.key === "cost" && priceRangeAll.length === 0 && <span className="hint">价格填数字 +「gp」，如「1020 gp」</span>}
            {STAT_HINTS[r.key] && <span className="hint">{STAT_HINTS[r.key]}</span>}
          </div>
        );
      })}
      {rows.length === 0 && <p className="hint" style={{ margin: 0 }}>先在上方选择装备类别，统计行将据此展开。</p>}
    </div>
  );
}

// —— 通用「等级特性小节」编辑器（power-ref 类型：魔法学派/契约/血统/主题/领域/典范/天命/职业/种族）——
// 每小节 = 等级 + 标题 + 类型（特性/威能）+ 正文 + 威能引用列表。
// value 为 JSON 字符串（form.levelSections），onChange 写回 JSON。
// —— 等级特性小节编辑器（服务 theme/domain/magic-school/pact/bloodline/paragon-path/epic-destiny/class/race）——
// 每小节 = 等级 + 标题 + 类型（特性/威能）+ 正文 + 威能引用；JSON 存储，保存时拼装「!! N级：标题」分节。
// 顶部提供按分类的「官方骨架模板」一键填充（非空列表需再点一次确认替换，避免误覆盖）。
const LEVELSECTION_TEMPLATES: Record<string, { label: string; sections: Partial<LevelFeatureSection>[] }[]> = {
  theme: [
    { label: "主题三段式", sections: [
      { level: "1级", title: "起始特性", kind: "feature" },
      { level: "", title: "额外特性", kind: "feature" },
      { level: "", title: "可选威能", kind: "power" },
    ] },
  ],
  domain: [
    { label: "领域威能三节", sections: [
      { level: "1级", title: "领域随意威能", kind: "power" },
      { level: "5级", title: "领域遭遇威能", kind: "power" },
      { level: "10级", title: "领域辅助威能", kind: "power" },
    ] },
  ],
  pact: [
    { label: "契约骨架", sections: [
      { level: "1级", title: "契约之赐", kind: "feature" },
      { level: "1级", title: "契约武器", kind: "feature" },
      { level: "1级", title: "契约威能", kind: "power" },
      { level: "2级", title: "契约威能", kind: "power" },
      { level: "5级", title: "契约威能", kind: "power" },
      { level: "10级", title: "契约威能", kind: "power" },
    ] },
  ],
  bloodline: [
    { label: "血统四槽位", sections: [
      { level: "11级", title: "血统威能", kind: "power" },
      { level: "12级", title: "血统威能", kind: "power" },
      { level: "16级", title: "血统威能", kind: "power" },
      { level: "20级", title: "血统每日威能", kind: "power" },
    ] },
  ],
  "magic-school": [
    { label: "学派六节骨架", sections: [
      { level: "1级", title: "学派威能", kind: "power" },
      { level: "5级", title: "学派遭遇威能", kind: "power" },
      { level: "10级", title: "学派每日威能", kind: "power" },
      { level: "11级", title: "学派特性", kind: "feature" },
      { level: "12级", title: "学派威能", kind: "power" },
      { level: "20级", title: "学派每日威能", kind: "power" },
    ] },
  ],
  "paragon-path": [
    { label: "典范四槽位", sections: [
      { level: "11级", title: "典范威能", kind: "power" },
      { level: "12级", title: "典范威能", kind: "power" },
      { level: "16级", title: "典范威能", kind: "power" },
      { level: "20级", title: "典范威能", kind: "power" },
    ] },
  ],
  "epic-destiny": [
    { label: "天命四槽位", sections: [
      { level: "21级", title: "天命威能", kind: "power" },
      { level: "24级", title: "天命威能", kind: "power" },
      { level: "26级", title: "天命威能", kind: "power" },
      { level: "30级", title: "天命特性", kind: "feature" },
    ] },
  ],
  class: [
    { label: "属性值增加槽位", sections: [
      { level: "4级", title: "属性值增加", kind: "feature" },
      { level: "8级", title: "属性值增加", kind: "feature" },
      { level: "11级", title: "属性值增加", kind: "feature" },
      { level: "14级", title: "属性值增加", kind: "feature" },
      { level: "18级", title: "属性值增加", kind: "feature" },
    ] },
  ],
};
function LevelSectionsEditor({ value, onChange, titleLabel, category }: {
  value: string; onChange: (json: string) => void;
  titleLabel?: (s: LevelFeatureSection) => string; category?: string;
}) {
  const sections = parseLevelSectionsJson(value, { allowPlain: true });
  const setSections = (s: LevelFeatureSection[]) => onChange(JSON.stringify(s));
  const upd = (i: number, u: Partial<LevelFeatureSection>) => setSections(sections.map((s, j) => (j === i ? { ...s, ...u } : s)));
  const kindCandidates: ("feature" | "power")[] = ["feature", "power"];
  const label = (i: number) => (titleLabel ? titleLabel(sections[i]) : sections[i].level || sections[i].title || `小节 ${i + 1}`);
  const [armed, setArmed] = useState<string | null>(null);
  const applyTemplate = (tplLabel: string, tpl: Partial<LevelFeatureSection>[]) => {
    if (sections.length > 0 && armed !== tplLabel) {
      setArmed(tplLabel);
      window.setTimeout(() => setArmed((a) => (a === tplLabel ? null : a)), 2500);
      return;
    }
    setArmed(null);
    setSections(tpl.map((s) => ({ level: "", title: "", kind: "feature", body: "", refs: [], ...s })));
  };
  const templates = category ? LEVELSECTION_TEMPLATES[category] : undefined;
  return (
    <div className="hb-levelsections" data-ed-field="levelSections">
      {templates && templates.length > 0 && (
        <div className="hb-pblock-presets">
          <span className="hb-pblock-presets-label">官方骨架模板 · 点击应用（已有内容时再点一次确认替换）</span>
          {templates.map((t) => (
            <button key={t.label} type="button" className={"chip mini" + (armed === t.label ? " armed" : "")} onClick={() => applyTemplate(t.label, t.sections)}>
              {armed === t.label ? "再点一次确认替换" : t.label}
            </button>
          ))}
        </div>
      )}
      <p className="hint" style={{ margin: "0 0 8px" }}>
        每小节 = 等级 + 标题 + 类型（特性/威能）+ 正文 + 威能引用。保存时拼装为「!! N级：标题」分节正文，威能引用回写为「&#123;&#123;威能名&#125;&#125;」行。
      </p>
      {sections.map((s, i) => (
        <div key={i} className="hb-levelsection" data-ed-field={`levelSections[${i}]`}>
          <div className="hb-itempower-head">
            <span className="hb-itempower-headlabel">{label(i)}</span>
            <IconButton title="删除此小节" onClick={() => setSections(sections.filter((_, j) => j !== i))}><span className="material-symbols-outlined">delete</span></IconButton>
          </div>
          <div className="hb-levelsection-rows">
            <FilledTextField label="等级" value={s.level} placeholder="如：1级 / 11级（可空）" onInput={(e) => upd(i, { level: (e.target as HTMLInputElement).value })} />
            <FilledTextField label="标题" value={s.title} placeholder="如：幻术学徒 / 遭遇威能" onInput={(e) => upd(i, { title: (e.target as HTMLInputElement).value })} />
            <div className="hb-label-sm" style={{ alignSelf: "center" }}>类型</div>
            <div className="hb-ed-chips" style={{ alignSelf: "center" }}>
              {kindCandidates.map((k) => (
                <button key={k} type="button" className={"chip mini" + (s.kind === k ? " active" : "")} onClick={() => upd(i, { kind: s.kind === k ? "feature" : k })}>{k === "feature" ? "特性" : "威能"}</button>
              ))}
            </div>
          </div>
          <textarea
            className="hb-textarea"
            rows={3}
            placeholder="本小节的描述正文（特性说明 / 威能效果简介）"
            value={s.body}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => upd(i, { body: e.target.value })}
          />
          <div className="hb-levelsection-refs">
            {s.refs.map((r, ri) => (
              <div key={ri} className="hb-levelsection-ref">
                <FilledTextField label="威能引用" value={r} placeholder="威能名（保存时回写为 {{威能名}}）" onInput={(e) => upd(i, { refs: s.refs.map((x, xj) => (xj === ri ? (e.target as HTMLInputElement).value : x)) })} />
                <IconButton title="删除引用" onClick={() => upd(i, { refs: s.refs.filter((_, xj) => xj !== ri) })}><span className="material-symbols-outlined">close</span></IconButton>
              </div>
            ))}
            <OutlinedButton onClick={() => upd(i, { refs: [...s.refs, ""] })}>＋ 威能引用</OutlinedButton>
          </div>
        </div>
      ))}
      <div className="hb-pblock-actions">
        <OutlinedButton onClick={() => setSections([...sections, { level: "", title: "", kind: "feature", body: "", refs: [] }])}>＋ 添加小节</OutlinedButton>
      </div>
    </div>
  );
}

// —— 生物·数据块编辑器 ——
// 三段：头部（名称 / 角色）/ 第二行加工标签（体型·源界·类别）+ 双栏数据行 + 行动/特质/灵气段。
// 数据存 CreatureBlock，序列化为官方 div.creature 格式（gen-creature-card 渲染）。
const CREATURE_ACTION_PRESETS: { label: string; action: string; freq: string; description: string }[] = [
  { label: "标准动作 · 随意", action: "标准动作", freq: "随意", description: "攻击：近战1（一个生物）；… vs. 防御\n命中：…伤害，且…" },
  { label: "标准动作 · 遭遇", action: "标准动作", freq: "遭遇", description: "攻击：…\n命中：…" },
  { label: "次要动作 · 随意", action: "次要动作", freq: "随意", description: "效果：…" },
  { label: "移动动作 · 随意", action: "移动动作", freq: "随意", description: "效果：…" },
  { label: "借机动作 · 随意", action: "借机动作", freq: "随意", description: "触发：…\n效果：…" },
  { label: "灵气 · 灵气2", action: "灵气", freq: "灵气2", description: "灵气：邻近… 的生物…" },
  { label: "特制", action: "特制", freq: "", description: "…" },
];
function CreatureBlockEditor({ value, onChange }: { value: CreatureBlock; onChange: (b: CreatureBlock) => void }) {
  const up = (patch: Partial<CreatureBlock>) => onChange({ ...value, ...patch });
  const upRow = (i: number, patch: Partial<CreatureBlock["rows"][number]>) =>
    up({ rows: value.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const upAct = (i: number, patch: Partial<CreatureBlock["actions"][number]>) =>
    up({ actions: value.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  // 第二行加工标签便捷：点体型/源界 chip 即插入或移除该词元（保持空格分隔）
  const toggleToken = (token: string) => {
    const parts = value.subtitleLabel.split(/\s+/).filter(Boolean);
    if (parts.includes(token)) up({ subtitleLabel: parts.filter((p) => p !== token).join(" ") });
    else up({ subtitleLabel: [...parts, token].join(" ") });
  };
  const addRowPreset = (label: string) =>
    up({ rows: [...value.rows, { leftLabel: label, leftValue: "", rightLabel: "", rightValue: "" }] });
  const addActionPreset = (p: (typeof CREATURE_ACTION_PRESETS)[number]) =>
    up({ actions: [...value.actions, { name: p.action === "灵气" && p.freq.startsWith("灵气") ? "（未命名）" : "", action: p.action, freq: p.freq, qualifier: "", description: p.description }] });
  const blankRow = () => up({ rows: [...value.rows, { leftLabel: "", leftValue: "", rightLabel: "", rightValue: "" }] });
  const blankAction = () => up({ actions: [...value.actions, { name: "", action: "标准动作", freq: "随意", qualifier: "", description: "" }] });
  return (
    <div className="hb-creature" data-ed-field="creatureBlock">
      {/* 头部：名称 + 角色 */}
      <div className="hb-creature-head">
        <FilledTextField label="名称" value={value.name} placeholder="如：哀悼侍女" onInput={(e) => up({ name: (e.target as HTMLInputElement).value })} />
        <div className="hb-label-sm" style={{ alignSelf: "center" }}>角色</div>
        <div className="hb-ed-chips">
          {CREATURE_ROLES.map((r) => (
            <button key={r} type="button" className={"chip mini" + (value.role === r ? " active" : "")}
              onClick={() => up({ role: value.role === r ? "" : r })}>{r}</button>
          ))}
        </div>
      </div>
      {/* 第二行加工标签：体型 · 源界 · 类别（合并为 subtitleLabel） */}
      <div className="hb-creature-sub">
        <FilledTextField label="体型 · 源界 · 类别" value={value.subtitleLabel} placeholder="如：中型 妖精界 类人生物（不死）"
          onInput={(e) => up({ subtitleLabel: (e.target as HTMLInputElement).value })} />
        <div className="hb-creature-chips">
          <span className="hb-label-sm">体型</span>
          {CREATURE_SIZES.map((s) => (
            <button key={s} type="button" className={"chip mini" + (value.subtitleLabel.split(/\s+/).includes(s) ? " active" : "")}
              onClick={() => toggleToken(s)}>{s}</button>
          ))}
        </div>
        <div className="hb-creature-chips">
          <span className="hb-label-sm">源界</span>
          {CREATURE_ORIGINS.map((s) => (
            <button key={s} type="button" className={"chip mini" + (value.subtitleLabel.split(/\s+/).includes(s) ? " active" : "")}
              onClick={() => toggleToken(s)}>{s}</button>
          ))}
        </div>
      </div>
      {/* 双栏数据行 */}
      <div className="hb-creature-rows">
        <div className="hb-label-sm" style={{ fontWeight: 600 }}>数据行（双栏：左标签+值 / 右标签+值）</div>
        {value.rows.map((r, i) => (
          <div key={i} className="hb-creature-row">
            <FilledTextField label="标签" value={r.leftLabel} onInput={(e) => upRow(i, { leftLabel: (e.target as HTMLInputElement).value })} />
            <FilledTextField label="值" value={r.leftValue} onInput={(e) => upRow(i, { leftValue: (e.target as HTMLInputElement).value })} />
            <FilledTextField label="标签" value={r.rightLabel} onInput={(e) => upRow(i, { rightLabel: (e.target as HTMLInputElement).value })} />
            <FilledTextField label="值" value={r.rightValue} onInput={(e) => upRow(i, { rightValue: (e.target as HTMLInputElement).value })} />
            <IconButton title="删除此行" onClick={() => up({ rows: value.rows.filter((_, j) => j !== i) })}><span className="material-symbols-outlined">close</span></IconButton>
          </div>
        ))}
        <div className="hb-pblock-actions">
          <OutlinedButton onClick={blankRow}>＋ 添加数据行</OutlinedButton>
          <span className="hb-label-sm">预设：</span>
          {CREATURE_ROW_PRESETS.map((p) => (
            <button key={p} type="button" className="chip mini" onClick={() => addRowPreset(p)}>{p}</button>
          ))}
        </div>
      </div>
      {/* 行动/特质/灵气段 */}
      <div className="hb-creature-acts">
        <div className="hb-label-sm" style={{ fontWeight: 600 }}>行动 / 特质 / 灵气段（动作图标按动作类型自动映射）</div>
        {value.actions.map((a, i) => (
          <div key={i} className="hb-creature-act">
            <div className="hb-pblock-head">
              <FilledTextField label="名称" value={a.name} placeholder="段名称（灵气/特制显示，其余可为动作关键词）"
                onInput={(e) => upAct(i, { name: (e.target as HTMLInputElement).value })} />
              <div className="hb-ed-chips">
                {CREATURE_ACTIONS.map((act) => (
                  <button key={act} type="button" className={"chip mini" + (a.action === act ? " active" : "")}
                    onClick={() => upAct(i, { action: a.action === act ? "" : act })}>{act}</button>
                ))}
              </div>
              <IconButton title="删除此段" onClick={() => up({ actions: value.actions.filter((_, j) => j !== i) })}><span className="material-symbols-outlined">close</span></IconButton>
            </div>
            <div className="hb-creature-act-freq">
              <div className="hb-label-sm" style={{ alignSelf: "center" }}>频率</div>
              <div className="hb-ed-chips">
                {CREATURE_FREQUENCIES.map((f) => (
                  <button key={f} type="button" className={"chip mini" + (a.freq === f ? " active" : "")}
                    onClick={() => upAct(i, { freq: a.freq === f ? "" : f })}>{f}</button>
                ))}
              </div>
              <FilledTextField label="自定义频率" value={CREATURE_FREQUENCIES.includes(a.freq) ? "" : a.freq}
                placeholder="如：灵气3" onInput={(e) => upAct(i, { freq: (e.target as HTMLInputElement).value })} />
              <FilledTextField label="限定词" value={a.qualifier} placeholder="如：每轮一次（频率后括号）"
                onInput={(e) => upAct(i, { qualifier: (e.target as HTMLInputElement).value })} />
            </div>
            <textarea className="hb-textarea" rows={3} value={a.description} placeholder="段描述（可换行，保存时转为 <br>）"
              onChange={(e) => upAct(i, { description: e.target.value })} />
          </div>
        ))}
        <div className="hb-pblock-actions">
          <OutlinedButton onClick={blankAction}>＋ 添加段</OutlinedButton>
          <span className="hb-label-sm">预设：</span>
          {CREATURE_ACTION_PRESETS.map((p) => (
            <button key={p.label} type="button" className="chip mini" onClick={() => addActionPreset(p)}>{p.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 卡片「配色」的自选色行：预置色板之外，再给一个与设置页「自选」同款的选色器
 *  （react-colorful 色盘 + HEX 输入框），两者共用同一 form.cardColor 字段；
 *  清空即回落到该类型卡片的默认语义色。 */
function CardColorCustomizer({
  presets,
  value,
  onChange,
}: {
  presets: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  // 值由外部改动（点预置色板 / 切换条目 / 导入 JSON）时同步 HEX 输入框
  useEffect(() => setHex(value), [value]);

  const isPreset = value !== "" && presets.some((p) => p.toLowerCase() === value.toLowerCase());
  const custom = value && !isPreset ? value : "";
  // 选色器需要一个合法色值：优先用输入框里当前合法的 HEX，其次自选色，最后预置色/主题色兜底
  const shown = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : custom || presets[0] || "#6750a4";

  return (
    <div className="hb-color-field">
      <div className="hb-color-custom">
        <span className="hb-color-custom-label">自选色</span>
        <button
          type="button"
          className={"swatch hb-color-custom-swatch" + (custom ? " active" : "")}
          style={{ background: shown }}
          title={open ? "收起选色器" : "展开选色器，自选卡片配色"}
          aria-label="自选卡片配色"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        />
        <input
          className="hex-input"
          value={hex}
          placeholder="#RRGGBB"
          aria-label="卡片配色 HEX 颜色值"
          onChange={(e) => {
            setHex(e.target.value);
            const v = e.target.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
          }}
          onKeyDown={(e) => { if (e.key === "Enter") setOpen(false); }}
        />
        {custom && (
          <button type="button" className="hb-color-clear" onClick={() => onChange("")} title="清除自选色，回到该类型的默认卡片配色">
            恢复默认
          </button>
        )}
      </div>
      {open && (
        <div className="color-picker-pop">
          <HexColorPicker color={shown} onChange={(c) => onChange(c.toLowerCase())} />
        </div>
      )}
    </div>
  );
}

// 预览「威能引用」懒加载缓存：首次需要时加载一次官方威能表，供 [[威能]] 悬浮解析
let powerIndexPromise: Promise<Entry[]> | undefined;
// 物品套装「套装组成」的装备库候选缓存：首次需要时加载一次官方装备表（名称候选）
let equipmentIndexPromise: Promise<Entry[]> | undefined;

export default function EntryEditor({
  poolId,
  entry,
  defaultCategory,
  layout,
  onBack,
  onSaved,
}: {
  poolId: string;
  /** null = 新建 */
  entry: Entry | null;
  defaultCategory?: string;
  layout: "single" | "double";
  onBack: () => void;
  /** done=true 表示保存后应返回列表 */
  onSaved: (saved: Entry, opts: { done: boolean }) => void;
}) {
  const isNew = entry === null;
  const [pools] = useState<HomebrewPool[]>(() => loadPools());
  const [form, setForm] = useState<Record<string, string>>(() => {
    if (entry) return { ...draftToForm(entry), __pool: poolId };
    const draft = loadDraft();
    const base = blank(defaultCategory);
    return {
      ...base,
      ...draft,
      category: defaultCategory && CATEGORY_LIST.includes(defaultCategory) ? defaultCategory : draft.category ?? base.category,
      bodyFormat: "md",
      __pool: poolId,
    };
  });
  const [err, setErr] = useState("");
  const [tip, setTip] = useState("");
  const [fieldErrs, setFieldErrs] = useState<{ key: string; label: string }[]>([]);
  /** 威能射程：当前选中的模板项（动态数字型），数字输入框由此驱动 */
  const [rangePick, setRangePick] = useState<RangeTemplateItem | null>(null);
  const [rangeN1, setRangeN1] = useState("");
  const [rangeN2, setRangeN2] = useState("");
  // 外部带入/导入 range 时，反向解析回填模板与数字位
  useEffect(() => {
    const r = parseRange(form.range ?? "");
    if (r && !r.tpl.fixed) {
      setRangePick(r.tpl);
      setRangeN1(r.n1);
      setRangeN2(r.n2);
    }
  }, [form.range]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // 模板复制：新建时选择既有同类别条目作为起点
  const [tmplOpen, setTmplOpen] = useState(false);
  const [tmplQuery, setTmplQuery] = useState("");
  const [tmplEntries, setTmplEntries] = useState<Entry[] | null>(null);
  // 预览威能引用：装备的 威能/正文 含 [[链接]] 时，懒加载官方威能表用于悬浮解析
  const [pwrMap, setPwrMap] = useState<Map<string, Entry> | null>(null);
  const pwrStartedRef = useRef(false);
  // 物品套装「套装组成」：懒加载官方装备名作候选（只加载一次），支持搜索过滤
  const [equipNames, setEquipNames] = useState<string[] | null>(null);
  const [equipQ, setEquipQ] = useState("");

  useEffect(() => {
    if (form.category !== "item-set" || equipNames) return;
    let alive = true;
    (equipmentIndexPromise ??= loadCategory("equipment")).then((entries) => {
      if (!alive) return;
      setEquipNames(entries.map((e) => e.name).filter(Boolean) as string[]);
    }).catch(() => {});
    return () => { alive = false; };
  }, [form.category, equipNames]);

  useEffect(() => {
    if (!isNew) clearDraft();
  }, [isNew]);

  // 打开模板面板（或切分类）时重新加载当前类别的模板候选：本包+其它包+官方
  useEffect(() => {
    if (!tmplOpen || !form.category) return;
    let alive = true;
    setTmplEntries(null);
    setTmplQuery("");
    (async () => {
      const user = pools.flatMap((p) => p.entries).filter((e) => e.category === form.category);
      let official: Entry[] = [];
      try {
        official = await loadCategory(form.category);
      } catch {
        official = [];
      }
      if (!alive) return;
      const byId = new Map(official.map((e) => [e.id, e]));
      for (const e of user) byId.set(e.id, e);
      setTmplEntries([...byId.values()]);
    })();
    return () => { alive = false; };
  }, [tmplOpen, form.category, pools]);

  // 装备预览的威能引用解析：仅当正文/威能出现 [[…]] 时懒加载官方威能索引（只加载一次）
  useEffect(() => {
    if (form.category !== "equipment" || pwrStartedRef.current) return;
    const src = (form.sourceText ?? "") + "\n" + (form.power ?? "");
    if (!src.includes("[[")) return;
    pwrStartedRef.current = true;
    let alive = true;
    (powerIndexPromise ??= loadCategory("power")).then((entries) => {
      if (!alive) return;
      const m = new Map<string, Entry>();
      for (const e of entries) {
        m.set(e.id, e);
        m.set(e.id.toLowerCase(), e);
        if (e.name) m.set(e.name, e);
        if (e.nameEn) m.set(e.nameEn, e);
      }
      setPwrMap(m);
    }).catch(() => {});
    return () => { alive = false; };
  }, [form.category, form.sourceText, form.power]);

  // —— 基础名录（gear.json）弹层：非魔法装备（基础武器/护甲/法器/盾牌/冒险装备）一键带入 ——
  const [gearOpen, setGearOpen] = useState(false);
  const [gearQ, setGearQ] = useState("");
  const [gearEntries, setGearEntries] = useState<Record<string, unknown>[] | null>(null);
  // 可选区块（装备 物品威能/正文）：键 = sec.keys[0]；值 null=按内容自动（有内容展开、空收起），true/false = 用户显式开关
  const [optSecs, setOptSecs] = useState<Record<string, boolean | null>>({});
  // 关闭「有内容」的可选区需二次确认（armPreset 同款：2.5s 未确认自动取消）
  const [armOptSec, setArmOptSec] = useState<string | null>(null);
  useEffect(() => {
    if (!armOptSec) return;
    const t = window.setTimeout(() => setArmOptSec(null), 2500);
    return () => window.clearTimeout(t);
  }, [armOptSec]);
  useEffect(() => {
    if (!gearOpen) return;
    let alive = true;
    setGearEntries(null);
    setGearQ("");
    (gearIndexPromise ??= loadOfficialCategory("gear")).then((entries) => {
      if (!alive) return;
      setGearEntries(entries as unknown as Record<string, unknown>[]);
    }).catch(() => { alive && setGearEntries([]); });
    return () => { alive = false; };
  }, [gearOpen]);
  const gearFiltered = useMemo(() => {
    const q = gearQ.trim().toLowerCase();
    const list = gearEntries ?? [];
    const items = q
      ? list.filter((e) => ((e.name ?? "") + " " + (e.nameEn ?? "")).toLowerCase().includes(q))
      : list;
    const groups = new Map<string, typeof items>();
    for (const it of items) {
      const g = (it.subCategory as string) || "其他";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(it);
    }
    return [...groups.entries()];
  }, [gearEntries, gearQ]);
  const applyGear = (g: Record<string, unknown>) => {
    const f = gearToForm(g);
    setForm((prev) => ({ ...prev, ...f, __pool: prev.__pool ?? poolId }));
    setTip(`已从基础名录带入「${g.name ?? ""}」的字段（基础装备形态），可在此基础上修改。`);
    setGearOpen(false);
  };

  const lookup = pwrMap ? (t: string) => pwrMap.get(t) ?? pwrMap.get(t.toLowerCase()) : undefined;
  const applyTemplate = (e: Entry) => {
    setForm((prev) => ({ ...draftToForm(e), bodyFormat: "md", __pool: prev.__pool ?? poolId }));
    setTip(`已从「${e.name}」带入字段作为起点，可在此基础上修改。`);
    setTmplOpen(false);
  };
  const tmplFiltered = useMemo(() => {
    const q = tmplQuery.trim().toLowerCase();
    const list = tmplEntries ?? [];
    if (!q) return list.slice(0, 120);
    return list.filter((e) => (e.name + " " + (e.nameEn ?? "")).toLowerCase().includes(q)).slice(0, 120);
  }, [tmplEntries, tmplQuery]);

  const fields = useMemo(() => fieldsFor(form.category ?? ""), [form.category]);
  const isLegacyWiki = form.bodyFormat === "wiki";

  function patch(next: Record<string, string>) {
    setForm((prev) => {
      const merged = { ...prev, ...next };
      if (isNew) saveDraft(merged);
      return merged;
    });
    setTip("");
    setFieldErrs([]);
    setErr("");
  }

  function set(k: string, v: string) {
    // 装备切换「类别」时：同时按新类别所属族清掉不适用项的统计值（重击仅 A、甲类/AC 仅 B、增强 D 无），保持结果干净。
    if (form.category === "equipment" && k === "itemCategory") {
      const patch2: Record<string, string> = { [k]: v };
      const fam = equipFamilyOf(v);
      // 「分类组」仅武器/法器/护甲(A/B)有；切到通用配件/消耗品清空
      if (fam !== "A" && fam !== "B") patch2.group = "";
      if (fam !== "A") patch2.critical = "";
      if (fam === "D") patch2.enh = "";
      // 「适合」候选按类别分化（臂部=盾位/奇物=纹身/消耗品=药剂…），切换即清空；增强对象默认同理按类别重推导
      patch2.itemSuitable = "";
      patch2.enhTarget = "";
      // 基础形态：切换类别时清空不适用于新类别的基础字段（如 武器→护甲 清 擅长/伤害/射程）
      if (form.itemForm === "mundane") {
        const rowKeys = new Set<string>((MUNDANE_STAT_ROWS[v] ?? []).map((r) => r.key));
        for (const kk of MUNDANE_FIELDS) {
          if (!rowKeys.has(kk)) patch2[kk] = "";
        }
      }
      patch(patch2);
      return;
    }
    // 装备切换「形态」（魔法物品 ↔ 基础装备）：清空另一形态的专属字段
    if (form.category === "equipment" && k === "itemForm") {
      const mundane = v === "mundane";
      const patch2: Record<string, string> = { [k]: v };
      if (mundane) {
        // 基础形态：清空魔法字段；若当前类别不在基础类别，落到「武器」
        patch2.itemLevel = "";
        patch2.rarity = "";
        patch2.enh = "";
        patch2.enhTarget = "";
        patch2.critical = "";
        patch2.itemSuitable = "";
        patch2.powerSections = "";
        // 仅当已选了基础形态不含的类别时才回落到「武器」；引导阶段（未选类别）保持空，让引导卡收窄到基础类别再选
        if (form.itemCategory && !MUNDANE_CATEGORIES.includes(form.itemCategory)) patch2.itemCategory = "武器";
      } else {
        // 魔法形态：清空基础专属字段与子类别
        for (const kk of MUNDANE_FIELDS) patch2[kk] = "";
        patch2.subCategory = "";
      }
      patch(patch2);
      return;
    }
    patch({ [k]: v });
  }

  /** 从预览虚线框点击跳转：把左侧对应字段滚动到视野内并聚焦、短暂高亮 */
  function goField(k: string) {
    const el = formRef.current?.querySelector(`[data-ed-field="${k}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("hb-focus-flash");
    window.setTimeout(() => el.classList.remove("hb-focus-flash"), 1600);
    const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    input?.focus();
  }

  /** 选择私设类型：切换时清空旧类型的专属字段，保留通用字段与归属包 */
  function pickCategory(cat: string) {
    if (cat === form.category) return;
    const was = form.category;
    setForm((prev) => {
      const oldKeys = new Set((CATEGORY_FIELDS[prev.category ?? ""] ?? []).map((f) => f.key));
      const next: Record<string, string> = { category: cat };
      for (const k of Object.keys(prev)) {
        // category 已由 { category: cat } 设置，避免循环用旧值覆盖
        if (k !== "category" && !oldKeys.has(k)) next[k] = prev[k];
      }
      return next;
    });
    setTip(was ? `已切换为「${CATEGORY_LABELS[cat] ?? cat}」，原「${CATEGORY_LABELS[was] ?? was}」的专属字段已清空。` : `已选择「${CATEGORY_LABELS[cat] ?? cat}」。`);
  }

  /** 在正文光标处插入 Markdown 片段 */
  function insert(tool: (typeof TOOLS)[number]) {
    const ta = bodyRef.current;
    const val = form.sourceText ?? "";
    if (!ta) {
      set("sourceText", val + (val && !val.endsWith("\n") ? "\n" : "") + tool.before + tool.sample + tool.after);
      return;
    }
    const start = ta.selectionStart ?? val.length;
    const end = ta.selectionEnd ?? start;
    const selected = val.slice(start, end) || tool.sample;
    let head = val.slice(0, start);
    if (tool.block && head && !head.endsWith("\n")) head += "\n";
    const insertText = tool.before + selected + tool.after;
    const next = head + insertText + val.slice(end);
    set("sourceText", next);
    const caret = head.length + tool.before.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret + selected.length);
    });
  }

  function toMarkdown() {
    patch({ sourceText: wikiToMarkdown(form.sourceText ?? ""), bodyFormat: "md" });
    setTip("已转换为 Markdown，请检查排版后保存。");
  }

  const previewEntry = useMemo(() => {
    if (!form.category) return null;
    const fused = { ...blank(form.category), ...form, category: form.category };
    const r = buildEntry(fused, entry?.id ?? "preview", { allowEmpty: true });
    return r.ok ? r.entry : null;
  }, [form, entry]);

  function save(keepCreating: boolean) {
    // 字段校验：清空旧错误，收集缺失的必填字段（去重），顶部红条列出并可点击定位
    const miss: { key: string; label: string }[] = [];
    const seen = new Set<string>();
    const pushMiss = (mm: { key: string; label: string }) => {
      if (!seen.has(mm.key)) {
        seen.add(mm.key);
        miss.push(mm);
      }
    };
    if (!(form.name ?? "").trim()) pushMiss({ key: "name", label: "名称" });
    if (!form.category) pushMiss({ key: "category", label: "私设类型" });
    for (const f of fields) {
      if (f.required && !(form[f.key] ?? "").trim()) pushMiss({ key: f.key, label: f.label });
    }
    if (miss.length) {
      setFieldErrs(miss);
      setErr("");
      return;
    }

    const targetId = isNew ? uniqueEntryId((form.name ?? "").trim()) : entry.id;
    const r = buildEntry(form, targetId);
    if (!r.ok) {
      setErr(r.error);
      setFieldErrs([]);
      return;
    }
    setErr("");
    setFieldErrs([]);
    const target = form.__pool && pools.some((p) => p.id === form.__pool) ? form.__pool : poolId;
    const saved = upsertEntryInPool(r.entry.id, r.entry, target);
    if (isNew) clearDraft();
    if (keepCreating && isNew) {
      onSaved(saved, { done: false });
      setForm({ ...blank(form.category), __pool: form.__pool ?? poolId });
      setTip("已保存「" + saved.name + "」，可继续创建下一条。");
      requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: 0 }));
      return;
    }
    onSaved(saved, { done: true });
  }

  /** 导出当前条目为 JSON 单文件（便于分享/备份） */
  function exportJson(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (!previewEntry) {
      setErr("请先选择类型并填写名称，再导出。");
      return;
    }
    const blob = new Blob([JSON.stringify(previewEntry, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${previewEntry.name || "条目"}.json`;
    document.body.appendChild(a);
    a.click();
    // 延迟释放，避免个别浏览器在下载前就撤销导致中断
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.body.removeChild(a);
  }

  /** 从 JSON 单文件导入并填充当前表单 */
  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as Partial<Entry> & Record<string, unknown>;
        if (!data.category) throw new Error("缺 category");
        const f = draftToForm(data as Entry);
        setForm({ ...f, category: f.category || String(data.category), bodyFormat: "md", __pool: poolId });
        setTip("已导入，请核对字段后保存。");
      } catch {
        setErr("导入失败：不是有效的 JSON 条目文件。");
      }
    };
    reader.readAsText(file);
  }

  // 装备「选择式引导卡」：新建装备未选类别时，形态+类别前置选择，其余面板据此展开
  const equipGuide = form.category === "equipment" && !form.itemCategory;

  function renderField(f: SheetField) {
    // 装备→先选类别再设计其余字段：未选 itemCategory 前隐藏所有依赖类别的字段，
    // 仅保留 名称/英文名/出处；形态/类别 chips 改在引导卡中呈现。
    if (equipGuide) {
      const categoryDependent = new Set(["itemLevel", "rarity", "group", "itemSuitable", "enh", "enhTarget", "critical", "cost", "weight", "subCategory", "powerSections", ...MUNDANE_FIELDS]);
      if (categoryDependent.has(f.key)) return null;
      if (f.key === "itemForm" || f.key === "itemCategory") return null;
    }
    const val = form[f.key] ?? "";
    const tipFor = (o: string) =>
      f.key === "itemCategory" ? ITEM_CATEGORY_TIPS[o] :
      f.key === "rarity" ? RARITY_TIPS[o] :
      f.key === "group" ? ITEM_TYPE_TIPS[o] : undefined;
    // 装备「统计数据按族分化」：魔法形态由 FAMILY_STAT_ROWS 决定统计行显示（重击仅 A、甲类/AC 仅 B、增强 D 无；C 可带增强）
    // 基础形态（itemForm=mundane）由 MUNDANE_STAT_ROWS 按 itemCategory 显示基础专属字段
    if (form.category === "equipment") {
      if (form.itemForm === "mundane") {
        const rowKeys = new Set<string>((MUNDANE_STAT_ROWS[form.itemCategory] ?? []).map((r) => r.key));
        const isStatKey = ["group", "enh", "enhTarget", "critical", "itemSuitable", "cost", "weight", ...MUNDANE_FIELDS].includes(f.key);
        if (isStatKey && !rowKeys.has(f.key)) return null;
        // 基础装备无威能段（威能仅魔法形态）；稀有度/物品等级 也是魔法维度，一并隐藏
        if (f.key === "powerSections" || f.key === "rarity" || f.key === "itemLevel") return null;
      } else {
        const fam = equipFamilyOf(form.itemCategory);
        const statKeys = new Set<string>(equipmentStatRows(fam, !!form.enh).map((r) => r.key));
        // C 族增强可编辑（颈部/臂部可含增强）：基础行不含但可能已填
        if (fam === "C") statKeys.add("enh");
        // 「适合」行：武器/法器/护甲 用分类组承载（同 token 空间）；其余类别按候选/已填值显示
        if (suitRowFor(form.itemCategory, !!form.itemSuitable)) statKeys.add("itemSuitable");
        if (f.key === "group" || f.key === "enh" || f.key === "critical" || f.key === "itemSuitable" || f.key === "cost" || f.key === "weight") {
          if (!statKeys.has(f.key)) return null;
        }
        // 魔法形态隐藏基础专属字段与子类别
        if (f.key === "subCategory" || MUNDANE_FIELDS.includes(f.key)) return null;
      }
    }
    // 「形态」单选：魔法物品 / 基础装备（装备专属）
    if (f.key === "itemForm") {
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <div className="hb-ed-chips">
            <button type="button" className={"chip mini" + (val !== "mundane" ? " active" : "")} onClick={() => set("itemForm", val === "mundane" ? "" : "")}>
              魔法物品
            </button>
            <button type="button" className={"chip mini" + (val === "mundane" ? " active" : "")} onClick={() => set("itemForm", val === "mundane" ? "" : "mundane")}>
              基础装备
            </button>
          </div>
          <span className="hint">
            {val === "mundane"
              ? "基础（非魔法）装备：含 武器擅长/伤害/护甲加值/检定/冒险装备 等，无增强/稀有度/等级/威能。"
              : "魔法物品：含 稀有度/等级/增强/威能段 等；非魔法基础装备可从「从基础名录选择」一键带入。"}
          </span>
        </div>
      );
    }
    // 「威能类型」单选：攻击 / 辅助 / 特殊，写入 powerType（buildEntry 派生 powerKind，卡头显示「战士攻击 1」）
    if (f.key === "powerType") {
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}{f.required ? " *" : ""}</span>
          <div className="hb-ed-chips">
            {POWER_TYPES.map((t) => (
              <button
                key={t.label}
                type="button"
                className={"chip mini" + (val === t.label ? " active" : "")}
                onClick={() => set("powerType", val === t.label ? "" : t.label)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="hint">威能类型会显示在卡头，如「战士攻击 1」「战士辅助 2」「战士特殊」。</span>
        </div>
      );
    }
    // 「再生频率」单选：随意 / 遭遇 / 每日，决定 usage 代码与卡面色（buildEntry 派生 usage）
    if (f.key === "usageZh") {
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}{f.required ? " *" : ""}</span>
          <div className="hb-ed-chips">
            {POWER_FREQUENCIES.map((fr) => (
              <button
                key={fr.label}
                type="button"
                className={"chip mini" + (val === fr.label ? " active" : "")}
                onClick={() => set("usageZh", val === fr.label ? "" : fr.label)}
              >
                {fr.label}
              </button>
            ))}
          </div>
          <span className="hint">决定使用次数与卡面色：随意·绿 / 遭遇·红 / 每日·灰。</span>
        </div>
      );
    }
    // 「动作」：按钮单选（选项不多，点选直观；全宽排列避免换行过多）
    if (f.key === "actionType") {
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <div className="hb-ed-chips">
            {(f.options ?? []).map((o) => (
              <button key={o} type="button" className={"chip mini" + (val === o ? " active" : "")} onClick={() => set(f.key, val === o ? "" : o)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    }
    // —— 各类型结构化编辑器 ——
    // 装备「物品威能段」
    if (f.key === "powerSections") {
      const secs = parseItemPowerSections(form.powerSections);
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <ItemPowerSectionsEditor value={secs} onChange={(s) => set("powerSections", JSON.stringify(s))} />
        </div>
      );
    }
    // 装备「物品特性」
    if (f.key === "properties") {
      const props = parseItemProperties(form.properties);
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <ItemPropertiesEditor value={props} onChange={(p) => set("properties", JSON.stringify(p))} />
        </div>
      );
    }
    // 专长「关联威能等级表」
    if (f.key === "featRows") {
      const rows = parseFeatRowsJson(form.featRows);
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <FeatTableEditor value={rows} onChange={(r) => set("featRows", JSON.stringify(r))} />
        </div>
      );
    }
    // 套装「件数增益块」
    if (f.key === "setBonuses") {
      const blocks = parseSetBonusesJson(form.setBonuses);
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <SetBonusEditor value={blocks} onChange={(b) => set("setBonuses", JSON.stringify(b))} />
        </div>
      );
    }
    // 词典「词条对」
    if (f.key === "termsPairs") {
      const pairs = parseTerms(form.termsPairs);
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <TermsPairsEditor value={pairs} onChange={(p) => set("termsPairs", serializeTerms(p))} />
        </div>
      );
    }
    // 威能引用类「等级特性小节」：结构化编辑（始于 form.levelSections 的 JSON）
    if (f.key === "levelSections") {
      const labelFor = (s: LevelFeatureSection) =>
        [s.level, s.title].filter(Boolean).join("：") || "（无标题小节）";
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <LevelSectionsEditor value={val} onChange={(j) => set("levelSections", j)} titleLabel={labelFor} category={form.category} />
        </div>
      );
    }
    // 生物「数据块」：结构化编辑（始于 form.creatureBlock 的 JSON）
    if (f.key === "creatureBlock") {
      const blk = parseCreatureBlockJson(form.creatureBlock) ?? { name: "", role: "", subtitleLabel: "", rows: [], actions: [] };
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <CreatureBlockEditor value={blk} onChange={(b) => set("creatureBlock", JSON.stringify(b))} />
        </div>
      );
    }
    // 专长「前提」：text + 前提句式候选
    if (f.key === "prerequisite" && form.category === "feat") {
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <div className="hb-ed-chips">
            {FEAT_PREREQ_CANDIDATES.map((c) => (
              <button key={c} type="button" className={"chip mini" + (val === c ? " active" : "")} onClick={() => set(f.key, val === c ? "" : c)}>{c}</button>
            ))}
          </div>
          <textarea className="hb-textarea" value={val} rows={3} placeholder={f.placeholder ?? "如：职业：战士"} onChange={(e) => set(f.key, e.target.value)} />
          <span className="hint">官方前提以 职业式 / 等级式 / 受训式 为主；点选候选或自由输入。</span>
        </div>
      );
    }
    // 专长「增益」：预设条 + 自由文本
    if (f.key === "benefit" && form.category === "feat") {
      const applyPreset = (t: string) => {
        set("benefit", t);
      };
      return (
        <div key={f.key} className="hb-field hb-field-full hb-field-feat-benefit" data-ed-field={f.key}>
          <div className="hb-field-head">
            <span className="hb-label">{f.label}</span>
            <span className="hb-pblock-presets-label hb-feat-hint">专长预设 · 点击以模板替换当前增益</span>
          </div>
          <div className="hb-pblock-presets hb-feat-presets">
            {FEAT_PRESETS.map((p) => (
              <button key={p.name} type="button" className="chip mini" title={p.desc} onClick={() => applyPreset(p.blocks.map((b) => b.text).join(""))}>{p.name}</button>
            ))}
          </div>
          <textarea className="hb-textarea" value={val} rows={5} placeholder={f.placeholder ?? "该专长带来的效果"} onChange={(e) => set(f.key, e.target.value)} />
        </div>
      );
    }
    // 「风味文本」：斜体风味描述，独立成段用全宽多行输入，便于书写
    if (f.key === "flavorText") {
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <textarea
            className="hb-textarea"
            value={val}
            rows={2}
            placeholder={f.placeholder ?? "可选的斜体风味描述"}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => set(f.key, e.target.value)}
          />
        </div>
      );
    }
    if (f.key === "powerBlocks") {
      const blocks = parsePowerBlocks(form.powerBlocks) ?? [];
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <PowerBlockEditor value={blocks} onChange={(b) => set("powerBlocks", JSON.stringify(b))} />
        </div>
      );
    }
    if (f.type === "select") {
      return (
        <div key={f.key} className="hb-field" data-ed-field={f.key}>
          <span className="hb-label">{f.label}{f.required ? " *" : ""}</span>
          <div className="hb-ed-chips">
            {f.key === "cardColor" ? (
              <>
                {(f.options ?? []).map((o) => (
                  <button
                    key={o}
                    type="button"
                    title={o}
                    className={"chip mini hb-color-chip" + (val === o ? " active" : "")}
                    style={{ "--sw": o } as CSSProperties}
                    onClick={() => set(f.key, val === o ? "" : o)}
                  >
                    <span className="hb-color-swatch" />
                  </button>
                ))}
                {/* 预置色之外：设置页同款自选色器（色盘 + HEX 输入），写入同一 cardColor 字段 */}
                <CardColorCustomizer presets={f.options ?? []} value={val} onChange={(v) => set(f.key, v)} />
              </>
            ) : f.key === "cardIcon" ? (
              (f.options ?? []).map((o) => (
                <button key={o} type="button" title={o} className={"chip mini hb-icon-chip" + (val === o ? " active" : "")} onClick={() => set(f.key, val === o ? "" : o)}>
                  <span className="material-symbols-outlined">{o}</span>
                </button>
              ))
            ) : (
              (f.key === "itemCategory" && form.itemForm === "mundane"
                ? MUNDANE_CATEGORIES
                : f.options ?? []
              ).map((o) => (
                <button key={o} type="button" className={"chip mini" + (val === o ? " active" : "")} title={tipFor(o)} onClick={() => set(f.key, val === o ? "" : o)}>
                  {o}
                </button>
              ))
            )}
          </div>
          {form.category === "equipment" && f.key === "itemCategory" && !val && (
            <p className="hint">请先选择装备类别；稀有度、物品等级、统计数据与威能等会据此排列。</p>
          )}
        </div>
      );
    }
    if (f.key === "sourceText") {
      return (
        <div key={f.key} className="hb-field hb-body-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">正文</span>
          <div className="hb-md-tools">
            {TOOLS.map((t) => (
              <button key={t.label} type="button" className="hb-md-tool" title={t.label} onClick={() => insert(t)}>
                <span className="material-symbols-outlined">{t.icon}</span>
              </button>
            ))}
          </div>
          <textarea
            ref={bodyRef}
            className="hb-textarea hb-body-textarea"
            value={val}
            rows={16}
            placeholder="在这里写条目正文。支持 Markdown 语法使用。"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => set(f.key, e.target.value)}
          />
          <span className="hint">支持 Markdown 语法使用。上面一排按钮可直接插入标题、列表、表格等格式。</span>
        </div>
      );
    }
    if (f.type === "longtext") {
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <textarea
            className="hb-textarea"
            value={val}
            rows={4}
            placeholder={f.placeholder}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => set(f.key, e.target.value)}
          />
        </div>
      );
    }
    // 物品套装「套装组成」：装备库候选（懒加载官方装备名），搜索过滤后点选/反选
    if (f.key === "setComponents") {
      const sep = f.delimiter ?? "，";
      const parts = val.split(sep).map((t) => t.trim()).filter(Boolean);
      const q = equipQ.trim().toLowerCase();
      const matched = (equipNames ?? []).filter((n) => !q || n.toLowerCase().includes(q)).slice(0, 16);
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}</span>
          <FilledTextField value={val} placeholder={f.placeholder} onInput={(e) => set(f.key, (e.target as HTMLInputElement).value ?? "")} />
          <div className="hb-kw-group">
            <div className="hb-kw-group-head">
              <span className="hb-kw-group-name">装备库候选</span>
              <FilledTextField label="搜索装备" value={equipQ} placeholder="输入装备名关键词" onInput={(e) => setEquipQ((e.target as HTMLInputElement).value ?? "")} />
            </div>
            <div className="hb-ed-chips">
              {equipNames === null ? (
                <span className="hint">装备库加载中…</span>
              ) : matched.length === 0 ? (
                <span className="hint">{q ? "未找到匹配装备" : "候选为空"}</span>
              ) : matched.map((n) => {
                const active = parts.includes(n);
                return (
                  <button key={n} type="button" className={"chip mini" + (active ? " active" : "")} onClick={() => {
                    const next = active ? parts.filter((p) => p !== n) : [...parts, n];
                    set(f.key, next.join(sep));
                  }}>{n}</button>
                );
              })}
            </div>
          </div>
          <span className="hint">保存时生成为 [[物品]] 链接列表；可点选官方装备名或自由输入。</span>
        </div>
      );
    }
    if (f.type === "multichips") {
      const sep = f.delimiter ?? "/";
      const parts = val.split(sep).map((t) => t.trim()).filter(Boolean);
      // 装备「分类组」候选随 类别过滤（武器→刀刃/矛/锤…，法器→法杖/权杖…，护甲→布甲/链甲…）
      const opts = f.key === "group" && form.category === "equipment"
        ? (GROUPS_BY_CATEGORY[form.itemCategory ?? ""] ?? GROUPS)
        : f.options ?? [];
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}{f.required ? " *" : ""}</span>
          <FilledTextField value={val} placeholder={f.placeholder ?? `可点选下面候选，或自由输入；可多选，用 ${sep} 分隔`} onInput={(e) => set(f.key, (e.target as HTMLInputElement).value ?? "")} />
          {f.groups && f.groups.length > 0 ? (
            <div className="hb-kw-groups">
              {f.groups.map((g) => (
                <div key={g.label} className="hb-kw-group">
                  <div className="hb-kw-group-head">
                    <span className="hb-kw-group-name">{g.label}</span>
                    {g.hint && <span className="hint">{g.hint}</span>}
                  </div>
                  <div className="hb-ed-chips">
                    {g.items.map((it) => {
                      const active = parts.includes(it.kw);
                      return (
                        <button
                          key={it.kw}
                          type="button"
                          title={it.desc}
                          className={"chip mini" + (active ? " active" : "")}
                          onClick={() => {
                            const next = active ? parts.filter((p) => p !== it.kw) : [...parts, it.kw];
                            set(f.key, next.join(sep));
                          }}
                        >
                          {it.kw}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : opts.length > 0 ? (
            <div className="hb-ed-chips">
              {opts.map((o) => {
                const active = parts.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    title={tipFor(o)}
                    className={"chip mini" + (active ? " active" : "")}
                    onClick={() => {
                      const next = active ? parts.filter((p) => p !== o) : [...parts, o];
                      set(f.key, next.join(sep));
                    }}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          ) : null}
          <span className="hint">可多选：单击切换勾选，多个值以「{sep}」分隔。悬停候选词可查看其解释（参考万律术语表）。</span>
        </div>
      );
    }
    // 「射程/范围」：模板分组点选 + 数字位独立输入 + 自由输入。
    // 动态型模板（如「远程 + N」「区域N爆发M」）选中后出现专用数字输入框，
    // 输入即组成完整 range；range 文本框仍可自由编辑/改写组合。
    if (f.key === "range") {
      const parsed = parseRange(val);
      const activePick = parsed ? parsed.tpl : rangePick;
      const setN = (i: 1 | 2, v: string) => {
        if (i === 1) setRangeN1(v);
        else setRangeN2(v);
        const t = rangePick ?? activePick;
        if (t) set(f.key, composeRange(t, i === 1 ? v : rangeN1, i === 2 ? v : rangeN2));
      };
      return (
        <div key={f.key} className="hb-field hb-field-full" data-ed-field={f.key}>
          <span className="hb-label">{f.label}{f.required ? " *" : ""}</span>
          {rangePick && !rangePick.fixed ? (
            <span className="hb-range-badge">
              当前模板：{rangePick.label.replace("N", rangeN1 || "<N>").replace("M", rangeN2 || "<M>")}
              <button type="button" className="hb-range-clear" onClick={() => { setRangePick(null); setRangeN1(""); setRangeN2(""); set(f.key, ""); }}>清除模板</button>
            </span>
          ) : activePick && !activePick.fixed ? (
            <span className="hb-range-badge">
              当前值匹配：{activePick.label.replace("N", rangeN1 || "<N>").replace("M", rangeN2 || "<M>")}
            </span>
          ) : null}
          <FilledTextField value={val} placeholder={f.placeholder ?? "如：近战武器 / 远程10 / 近程爆发3 / 区域10爆发2"} onInput={(e) => set(f.key, (e.target as HTMLInputElement).value ?? "")} />
          {(rangePick && !rangePick.fixed) && (
            <div className="hb-range-nums">
              <label>
                <span>{rangePick.n1Label ?? "数字"}</span>
                <FilledTextField type="number" value={rangeN1} onInput={(e) => setN(1, (e.target as HTMLInputElement).value ?? "")} />
              </label>
              {rangePick.n2 && (
                <label>
                  <span>{rangePick.n2Label ?? "数字"}</span>
                  <FilledTextField type="number" value={rangeN2} onInput={(e) => setN(2, (e.target as HTMLInputElement).value ?? "")} />
                </label>
              )}
            </div>
          )}
          <div className="hb-kw-groups">
            {RANGE_TEMPLATES.map((g) => (
              <div key={g.group} className="hb-kw-group">
                <div className="hb-kw-group-head"><span className="hb-kw-group-name">{g.group}</span></div>
                <div className="hb-ed-chips">
                  {g.items.map((it) => {
                    const active = it.fixed ? val.trim() === it.prefix : activePick === it;
                    return (
                      <button
                        key={it.label}
                        type="button"
                        className={"chip mini" + (active ? " active" : "")}
                        onClick={() => {
                          setRangePick(it);
                          if (it.fixed) {
                            setRangeN1(""); setRangeN2("");
                            set(f.key, val.trim() === it.prefix ? "" : it.prefix);
                          } else {
                            set(f.key, composeRange(it, "", ""));
                          }
                        }}
                      >
                        {it.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <span className="hint">点选「+ N / 区域N爆发M」型模板后，在下方数字框填数值即生成射程；亦可直接手动输入任意组合，如「近战触及或远程5」。</span>
        </div>
      );
    }
    return (
      <div key={f.key} className="hb-field" data-ed-field={f.key}>
        <span className="hb-label">{f.label}{f.required ? " *" : ""}</span>
        <FilledTextField value={val} placeholder={f.placeholder} onInput={(e) => set(f.key, (e.target as HTMLInputElement).value ?? "")} />
        {f.key === "itemLevel" && enhExpectedAll && <span className="hint">按这些等级，增强应约为 {enhExpectedAll}</span>}
        {STAT_HINTS[f.key] && <span className="hint">{STAT_HINTS[f.key]}</span>}
        {f.key === "cost" && priceRangeAll.length > 0 && (
          <span className={"hint" + (val.trim() && val.includes("gp") && priceRangeAll.every((p) => !val.includes(String(p))) ? " hb-hint-warn" : "")}>
            {val.trim() && val.includes("gp") && priceRangeAll.every((p) => !val.includes(String(p)))
              ? `提示：当前「${val.trim()}」与按等级的价格（${priceRangeAll.map((p) => p + " gp").join("/")}）不符`
              : priceRangeAll.length === 1
                ? `该等级价格约 ${firstPrice} gp`
                : `按这些等级价格：${levels.map((l) => `L${l}≈${priceForLevel(l)}gp`).join("，")}`}
          </span>
        )}
        {f.key === "cost" && priceRangeAll.length === 0 && <span className="hint">价格填数字 +「gp」，如「1020 gp」</span>}
        {f.key === "weight" && <span className="hint">重量填数字 +「磅」，如「4 磅」</span>}
      </div>
    );
  }

  const poolName = pools.find((p) => p.id === (form.__pool ?? poolId))?.name ?? "";
  // 增强 ↔ 物品等级联动：按物品等级推导应然增强加值（供 itemLevel 字段提示；enh 行的推导/告警在 EquipmentStatTableEditor 内）
  const levels = itemLevels(form.itemLevel ?? "");
  const enhExpectedAll = [...new Set(levels.map(enhancementBonusForLevel))].map((n) => "+" + n).join("/");
  const firstLevel = levels.length ? levels[0] : undefined;
  const firstPrice = firstLevel ? priceForLevel(firstLevel) : undefined;
  const priceRangeAll = levels.map(priceForLevel).filter((n) => n > 0).sort((a, b) => a - b);

  const common = fields.filter((f) => ["name", "nameEn", "source"].includes(f.key));
  const tagField = fields.find((f) => f.key === "tags");
  const extras = fields.filter((f) => !["name", "nameEn", "category", "tags", "source", "sourceText"].includes(f.key));
  const appearance = extras.filter((f) => f.key === "cardColor" || f.key === "cardIcon");
  const extrasPlain = extras.filter((f) => f.key !== "cardColor" && f.key !== "cardIcon");
  const body = fields.find((f) => f.key === "sourceText");
  // 已配置分区的分类（如装备）按右卡片组成部分分区；未配置的回落为默认单区布局
  const sections = CATEGORY_SECTIONS[form.category ?? ""];
  // 主次分明：标 core 的面板常驻展开；其余面板统一收进底部「附加设置」折叠区
  const { coreSections, extraSections } = useMemo(() => {
    if (!sections) return { coreSections: [], extraSections: [] };
    return sections.reduce(
      (acc, sec) => {
        if (sec.core) acc.coreSections.push(sec);
        else acc.extraSections.push(sec);
        return acc;
      },
      { coreSections: [] as HomebrewSection[], extraSections: [] as HomebrewSection[] },
    );
  }, [sections]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  // 引导卡用：魔法形态的类别候选（基础形态用 MUNDANE_CATEGORIES 收窄）
  const itemCatOptions = fieldByKey.get("itemCategory")?.options ?? [];
  const poolField = (
    <div className="hb-field hb-field-full">
      <span className="hb-label">归属包</span>
      <div className="hb-ed-chips">
        {pools.map((p) => (
          <button key={p.id} type="button" className={"chip mini" + ((form.__pool ?? poolId) === p.id ? " active" : "")} onClick={() => set("__pool", p.id)}>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={"hb-editor" + (layout === "double" ? " double" : "")}>
      <div className="hb-ed-head">
        <IconButton title="返回条目列表" onClick={onBack}><span className="material-symbols-outlined">arrow_back</span></IconButton>
        <div className="hb-ed-title">
          <div className="hb-ed-crumb">{poolName}<span className="material-symbols-outlined">chevron_right</span>{isNew ? "新建条目" : "编辑条目"}</div>
          <div className="hb-ed-name">{(form.name ?? "").trim() || "（未命名）"}</div>
        </div>
        <div className="hb-ed-ops">
          {isNew && <OutlinedButton onClick={() => setTmplOpen(true)}>从模板新建</OutlinedButton>}
          <IconButton title="导出为 JSON 单文件" onClick={exportJson}><span className="material-symbols-outlined">download</span></IconButton>
          <IconButton title="从 JSON 单文件导入" onClick={() => importInputRef.current?.click()}><span className="material-symbols-outlined">upload</span></IconButton>
          <TextButton onClick={onBack}>取消</TextButton>
          {isNew && <OutlinedButton onClick={() => save(true)}>保存并继续新建</OutlinedButton>}
          <FilledButton onClick={() => save(false)}>
            <span slot="icon" className="material-symbols-outlined">save</span>
            保存
          </FilledButton>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importJson(f);
            e.target.value = "";
          }}
        />
      </div>

      {tmplOpen && (
        <div className="hb-tmpl-modal">
          <div className="hb-tmpl-modal-inner">
            <div className="hb-tmpl-modal-head">
              <span>选择模板（{CATEGORY_LABELS[form.category ?? ""] ?? "条目"}）</span>
              <IconButton title="关闭" onClick={() => setTmplOpen(false)}><span className="material-symbols-outlined">close</span></IconButton>
            </div>
            <FilledTextField
              value={tmplQuery}
              label="搜索模板"
              onInput={(e) => setTmplQuery((e.target as HTMLInputElement).value ?? "")}
            />
            {tmplEntries === null ? (
              <p className="hint" style={{ padding: "12px 0" }}>加载中…</p>
            ) : tmplFiltered.length === 0 ? (
              <p className="hint" style={{ padding: "12px 0" }}>没有可用的模板。</p>
            ) : (
              <div className="hb-tmpl-list">
                {tmplFiltered.map((e) => (
                  <div key={e.id} className="hb-tmpl-item" onClick={() => applyTemplate(e)}>
                    <div className="hb-tmpl-name">{e.name}{e.nameEn ? ` ${e.nameEn}` : ""}</div>
                    <div className="hb-tmpl-meta">{(CATEGORY_LABELS[e.category] ?? e.category)}{e.source ? ` · ${e.source}` : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {gearOpen && (
        <div className="hb-tmpl-modal">
          <div className="hb-tmpl-modal-inner">
            <div className="hb-tmpl-modal-head">
              <span>从基础名录选择（非魔法装备）</span>
              <IconButton title="关闭" onClick={() => setGearOpen(false)}><span className="material-symbols-outlined">close</span></IconButton>
            </div>
            <FilledTextField
              value={gearQ}
              label="搜索装备名（中/英文）"
              onInput={(e) => setGearQ((e.target as HTMLInputElement).value ?? "")}
            />
            {gearEntries === null ? (
              <p className="hint" style={{ padding: "12px 0" }}>加载中…</p>
            ) : gearFiltered.length === 0 ? (
              <p className="hint" style={{ padding: "12px 0" }}>没有匹配的基础装备。</p>
            ) : (
              <div className="hb-tmpl-list">
                {gearFiltered.map(([group, items]) => (
                  <div key={group} className="hb-gear-group">
                    <div className="hb-gear-group-label">{group}</div>
                    {items.map((g) => (
                      <div key={g.id as string} className="hb-tmpl-item" onClick={() => applyGear(g)}>
                        <div className="hb-tmpl-name">{g.name as string}{g.nameEn ? ` ${g.nameEn}` : ""}</div>
                        <div className="hb-tmpl-meta">
                          {(g.itemCategory as string) ?? ""}
                          {g.cost ? ` · ${g.cost}` : ""}
                          {g.source ? ` · ${g.source}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {err && <div className="hb-err">{err}</div>}
      {fieldErrs.length > 0 && (
        <div className="hb-field-err">
          <span className="hb-field-err-title">尚缺以下必填项：</span>
          {fieldErrs.map((m) => (
            <button
              key={m.key}
              type="button"
              className="hb-field-err-item"
              onClick={() => { goField(m.key); setFieldErrs((prev) => prev.filter((x) => x.key !== m.key)); }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      {tip && <div className="hb-tip">{tip}</div>}
      {isLegacyWiki && (
        <div className="hb-legacy">
          <span className="material-symbols-outlined">history</span>
          <span>这条内容是早期版本的 wikitext 正文，仍按原样渲染。</span>
          <TextButton onClick={toMarkdown}>转换为 Markdown</TextButton>
        </div>
      )}

      <div className="hb-ed-body">
        <div className="hb-ed-form" ref={formRef}>
          {isNew && (
            <section className="hb-ed-card hb-type-card" data-ed-field="category">
              <h4 className="hb-ed-card-title">{form.category ? "私设类型（可随时切换）" : "选择要建立的私设类型"}</h4>
              {!form.category && <p className="hint" style={{ margin: 0 }}>选择类型后进入表单；正文与专属字段将实时预览。</p>}
              <div className="cat-chips hb-ed-chips">
                {CATEGORY_LIST.map((c) => (
                  <button key={c} type="button" className={"chip mini" + (form.category === c ? " active" : "")} onClick={() => pickCategory(c)}>
                    {CATEGORY_LABELS[c] ?? c}
                  </button>
                ))}
              </div>
            </section>
          )}

          {form.category && (
            <>
              {sections ? (
                <>
                  {equipGuide && (
                    <section className="hb-ed-card hb-equip-guide" data-ed-field="itemCategory">
                      <h4 className="hb-ed-card-title">新建装备：先选形态与类别</h4>
                      <p className="hb-ed-section-hint">先选择形态与类别，其余面板（统计数据 / 特性 / 威能 / 正文）将据此展开。</p>
                      <div className="hb-field hb-field-full">
                        <span className="hb-label">形态</span>
                        <div className="hb-ed-chips hb-guide-chips">
                          <button type="button" className={"chip" + (form.itemForm !== "mundane" ? " active" : "")} onClick={() => set("itemForm", "")}>魔法物品</button>
                          <button type="button" className={"chip" + (form.itemForm === "mundane" ? " active" : "")} onClick={() => set("itemForm", "mundane")}>基础装备</button>
                        </div>
                        <span className="hint">{form.itemForm === "mundane" ? "基础（非魔法）装备：含 擅长/伤害/护甲加值 等基础字段，无增强/稀有度/威能。" : "魔法物品：含 稀有度/等级/增强/威能段；基础装备也可稍后从「从基础名录选择」一键带入。"}</span>
                      </div>
                      <div className="hb-field hb-field-full">
                        <span className="hb-label">类别</span>
                        <div className="hb-ed-chips hb-guide-chips">
                          {(form.itemForm === "mundane" ? MUNDANE_CATEGORIES : itemCatOptions).map((o) => (
                            <button key={o} type="button" className={"chip" + (form.itemCategory === o ? " active" : "")} title={ITEM_CATEGORY_TIPS[o]} onClick={() => set("itemCategory", o)}>
                              {o}
                            </button>
                          ))}
                        </div>
                        <span className="hint">选中类别后引导卡收起，左侧面板与右侧卡片统计表都会按该类别自动排列。</span>
                      </div>
                    </section>
                  )}
                  {coreSections.map((sec, si) => {
                    if (equipGuide && si > 0) return null;
                    // 基础形态无威能段：整区隐藏（连「＋ 添加」细条也不给）
                    if (sec.keys[0] === "powerSections" && form.itemForm === "mundane") return null;
                    const optKey = sec.optional ? sec.keys[0] : undefined;
                    const optHas = optKey ? (OPT_SEC_HAS[optKey]?.(form) ?? false) : false;
                    // 可选区块展开态：用户显式开关优先，未干预时按是否有内容自动
                    const optOn = optKey ? (optSecs[optKey] ?? optHas) : true;
                    // 收起态：一条「＋ 添加」细条
                    if (optKey && !optOn) {
                      return (
                        <button key={si} type="button" className="hb-opt-strip" onClick={() => setOptSecs((p) => ({ ...p, [optKey]: true }))}>
                          <span className="material-symbols-outlined">add_circle</span>
                          添加「{sec.title}」
                          <span className="hb-opt-strip-hint">可选 · {sec.optional}</span>
                        </button>
                      );
                    }
                    return (
                      <section key={si} className="hb-ed-card">
                        <h4 className="hb-ed-card-title">
                          {sec.title}
                          {form.category === "equipment" && si === 0 && (
                            <button type="button" className="hb-gear-pick" onClick={() => setGearOpen(true)} title="从官方非魔法装备名录（基础武器/护甲/法器/盾牌/冒险装备）选择并带入字段">
                              <span className="material-symbols-outlined">inventory_2</span>
                              从基础名录选择
                            </button>
                          )}
                          {optKey && (
                            <button
                              type="button"
                              className={"chip mini hb-opt-close" + (armOptSec === optKey ? " armed" : "")}
                              title={armOptSec === optKey ? "再次点击确认：清空内容并关闭此区" : "关闭此可选区" + (optHas ? "（将清空已填内容）" : "")}
                              onClick={() => {
                                if (optHas && armOptSec !== optKey) { setArmOptSec(optKey); return; }
                                set(optKey, "");
                                setOptSecs((p) => ({ ...p, [optKey]: false }));
                                setArmOptSec(null);
                              }}
                            >
                              {armOptSec === optKey ? "确认清空并关闭？" : "关闭"}
                            </button>
                          )}
                        </h4>
                        {sec.hint && <p className="hb-ed-section-hint">{sec.hint}</p>}
                        {si === 0 && poolField}
                        {sec.kind === "equip-stats" ? (
                          <EquipmentStatTableEditor form={form} set={set} />
                        ) : (
                          sec.keys.map((k) => fieldByKey.get(k)).filter((f): f is SheetField => !!f).map(renderField)
                        )}
                      </section>
                    );
                  })}
                  {!equipGuide && extraSections.length > 0 && (
                    <section className="hb-extra-section open">
                      <span className="hb-extra-title">
                        <span className="material-symbols-outlined">tune</span>
                        附加设置
                      </span>
                      <div className="hb-extra-body">
                        <div className="hb-extra-body-inner">
                          {extraSections.map((sec, ei) => (
                            <section key={ei} className="hb-ed-card">
                              <h4 className="hb-ed-card-title">{sec.title}</h4>
                              {sec.hint && <p className="hb-ed-section-hint">{sec.hint}</p>}
                              {sec.kind === "equip-stats" ? (
                                <EquipmentStatTableEditor form={form} set={set} />
                              ) : (
                                sec.keys.map((k) => fieldByKey.get(k)).filter((f): f is SheetField => !!f).map(renderField)
                              )}
                            </section>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}
                </>
              ) : (
              <>
                <section className="hb-ed-card">
                  <h4 className="hb-ed-card-title">基本信息 · {CATEGORY_LABELS[form.category] ?? form.category}</h4>
                  {poolField}
                  {common.map(renderField)}
                  {extrasPlain.length > 0 && (
                    <>
                      <div className="hb-ed-field-sep">该类型的专属字段</div>
                      {extrasPlain.map(renderField)}
                    </>
                  )}
                </section>
                {appearance.length > 0 && (
                  <section className="hb-ed-card">
                    <h4 className="hb-ed-card-title">外观</h4>
                    {appearance.map(renderField)}
                  </section>
                )}
                {tagField && (
                  <section className="hb-ed-card">
                    <h4 className="hb-ed-card-title">标签</h4>
                    <p className="hb-ed-section-hint">用于搜索与归类（逗号分隔），不会显示在卡片上，可留空。</p>
                    {renderField(tagField)}
                  </section>
                )}
              </>
              )}

              {body && !WITHOUT_BODY.has(form.category) && !equipGuide
                && !sections?.some((s) => s.keys.includes("sourceText")) && (
                <section className="hb-ed-card">{renderField(body)}</section>
              )}
            </>
          )}
        </div>

        <div className="hb-ed-preview">
          <div className="hb-ed-preview-head">
            <span className="material-symbols-outlined">visibility</span>
            实时预览
          </div>
          {previewEntry ? (
            <EntryCard entry={previewEntry} frame jump={goField} lookup={lookup} />
          ) : (
            <p className="hint">先在左侧选择私设类型，这里将实时呈现该词条在车卡界面中的最终样子，填入字段即时更新。</p>
          )}
        </div>
      </div>
    </div>
  );
}
