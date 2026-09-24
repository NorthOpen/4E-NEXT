import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Entry } from "../data/types";
import { POWER_COLORS, ITEM_COLOR, FEAT_COLOR } from "../lib/colors";
import { CATEGORY_LABELS } from "../data/labels";
import { tokenizeWikiBody, wikiToHtml, raceTraitHtml, raceBodyHtml, parseRaceTraitLines, splitRaceLore, splitAuxPowers, RACE_HEADER_NAMES } from "../lib/wikirender";
import { safeHtml } from "../lib/sanitize";
import { SmartHover } from "./SmartHover";
import { WikiBody } from "./WikiBody";
import { equipFamilyOf, equipmentStatRows, MUNDANE_STAT_ROWS, isMundaneEntry, suitRowFor, parseItemPropertiesHtml } from "../lib/homebrewSchema";

// 展开 details 中的 {{!!字段}} 引用、[[链接]] 与宏
function expandDetails(html: string, entry: Entry): string {
  return html
    .replace(/<<[^>]+>>/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\{\{!!([^}]+)\}\}/g, (_m, name: string) => String(entry.fields[name] ?? ""));
}

function powerColor(entry: Entry): string {
  // 特殊类型威能（种族/职业/特性类）沿用每日色（与人物页 special 归类一致）
  if (entry.powerKind === "special") return POWER_COLORS.daily;
  // 其余按再生频率上色（官方辅助威能同样带 随意/遭遇/每日 频率）
  if (entry.usage === "at-will") return POWER_COLORS.atWill;
  if (entry.usage === "encounter") return POWER_COLORS.encounter;
  if (entry.usage === "daily") return POWER_COLORS.daily;
  return POWER_COLORS.utility; // 未知/未填频率：兜底黑色
}

// 预览空态板块框架：内容未填时，以虚线框 + 淡色标注呈现该板块应有的结构；
// 填入真实内容后框架被真实内容替换。frame 预览下可点击，跳转到左侧对应填写框。
function Ghost({
  label,
  className,
  target,
  jump,
}: {
  label?: string;
  className?: string;
  /** 点击后要聚焦的左侧表单字段 key（sourceText=正文等） */
  target?: string;
  jump?: (k: string) => void;
}) {
  const clickable = !!target && !!jump;
  return (
    <div
      className={"frame-ghost" + (className ? " " + className : "")}
      data-ph={label ?? ""}
      data-cta={clickable ? "前往填写" : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => jump(target) : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          jump(target);
        }
      } : undefined}
    />
  );
}

// 威能「标签块」详情：渲染成与官方 <table class=details> 一致的行；indent>0 的子行标签前补全角缩进
function renderPowerBlocks(entry: Entry) {
  const rows = (entry.powerBlocks ?? []).map((b, i) => {
    const pad = (b.indent ?? 0) > 0 ? "\u00A0\u00A0" : "";
    if (!b.label.trim()) {
      if (!b.text.trim()) return null;
      return (
        <tr key={i}><td colSpan={2}>{b.text}</td></tr>
      );
    }
    return (
      <tr key={i}><th>{pad}{b.label}：</th><td>{b.text}</td></tr>
    );
  }).filter(Boolean);
  if (!rows.length) return null;
  return (
    <table className="details"><tbody>{rows}</tbody></table>
  );
}

export function PowerCard({ entry, frame, jump }: { entry: Entry; frame?: boolean; jump?: (k: string) => void }) {
  const color = entry.fields.cardColor || powerColor(entry);
  const kwEmpty = !entry.usageZh && !entry.keywords && !entry.actionType && !entry.range;
  const hasBlocks = !!entry.powerBlocks?.length;
  return (
    <div className="power-card" style={{ "--pc": color } as CSSProperties}>
      <div className="pc-head">
        <span className="pc-left">
          {entry.fields.cardIcon && <span className="material-symbols-outlined head-icon">{entry.fields.cardIcon}</span>}
          <span className="pc-name">{entry.name}{entry.nameEn ? " " + entry.nameEn : ""}</span>
          {entry.origin === "user" && <span className="origin-badge">自制</span>}
        </span>
        <span className="pc-meta">{`${entry.grantedBy ?? ""}${entry.powerType ?? ""}`.trim()}{entry.level ? " " + entry.level : ""}</span>
      </div>
      {frame && !entry.flavorText ? (
        <Ghost label="风味文本（威能数据）" className="pc-flavor" target="flavorText" jump={jump} />
      ) : entry.flavorText ? (
        <div className="pc-flavor">{entry.flavorText}</div>
      ) : null}
      <div className="pc-keywords">
        {frame && kwEmpty ? (
          <Ghost label="再生频率 · 关键词 / 动作 · 射程" className="kw-frame" target="usageZh" jump={jump} />
        ) : (
          <>
            <div>{entry.usageZh}{entry.keywords ? " ✦ " + entry.keywords : ""}</div>
            <div>{entry.actionType}{entry.range ? " ✦ " + entry.range : ""}</div>
          </>
        )}
      </div>
      {frame && !entry.details && !hasBlocks ? (
        <Ghost label="威能详情（标签块）" className="pc-details" target="powerBlocks" jump={jump} />
      ) : hasBlocks ? (
        <div className="pc-details">{renderPowerBlocks(entry)}</div>
      ) : entry.details ? (
        <div className="pc-details" dangerouslySetInnerHTML={safeHtml(entry.details)} />
      ) : null}
    </div>
  );
}

// 物品统计数据表行：由「装备格式族」FAMILY_STAT_ROWS 决定（分类组/增强/价格/重量/重击/甲类·AC），
// 与左侧「统计数据」面板逐行对齐（单一权威：增强/重击/甲类 不再写入 details，此表为唯一展示位置）。
type IcStatRow = { key: string; label: string };

export function ItemCard({ entry, frame, jump, lookup, optionalOn }: {
  entry: Entry; frame?: boolean; jump?: (k: string) => void; lookup?: (t: string) => Entry | undefined;
  // 私设编辑：左栏可选区块（物品特性/物品威能/正文）的展开态；未添加的区块在预览中不显示空态框
  optionalOn?: Partial<Record<string, boolean>>;
}) {
  const mundane = isMundaneEntry(entry);
  const fam = equipFamilyOf(entry.itemCategory);
  // 基础（非魔法）形态：按类别显示基础专属统计行（擅长/伤害/护甲加值/检定…）；魔法形态走族行
  const statRows: IcStatRow[] = mundane
    ? (MUNDANE_STAT_ROWS[entry.itemCategory ?? ""] ?? [])
    : equipmentStatRows(fam, !!entry.enh);
  // 「适合」行：武器/法器/护甲 由分类组承载；其余类别（臂部=盾位/奇物=纹身…）有值时显示
  const suit = mundane ? null : suitRowFor(entry.itemCategory, !!entry.itemSuitable);
  if (suit) statRows.push(suit);
  // 增强行单元格 = 加值 + 对象合并展示（如「+3（攻击骰和伤害骰）」；对象单存时原样显示，如官方「AC」）
  const statCell = (r: IcStatRow): string | undefined => {
    const v = entry[r.key] as string | undefined;
    if (r.key !== "enh") return v;
    const t = entry.enhTarget as string | undefined;
    if (v && t) return `${v}（${t}）`;
    return v || t;
  };
  const anyStats = statRows.some((r) => statCell(r));
  const cardColor = entry.fields.cardColor || ITEM_COLOR;
  const meta = mundane
    ? [entry.itemCategory, entry.subCategory].filter(Boolean).join(" · ")
    : [entry.itemCategory, entry.rarity, entry.itemLevel ? "L" + entry.itemLevel : ""].filter(Boolean).join(" · ");
  return (
    <div className="item-card" style={{ "--ic": cardColor } as CSSProperties}>
      <div className="ic-head">
        {entry.fields.cardIcon && <span className="material-symbols-outlined ic-icon">{entry.fields.cardIcon}</span>}
        <span className="ic-name">{entry.name}{entry.nameEn ? " " + entry.nameEn : ""}</span>
        {entry.origin === "user" && <span className="origin-badge">自制</span>}
        <span className="ic-meta">{meta}</span>
      </div>
      {frame && !entry.flavorText ? (
        <Ghost label="风味文本（装备数据）" className="ic-flavor" target="flavorText" jump={jump} />
      ) : entry.flavorText ? (
        <div className="ic-flavor">{entry.flavorText}</div>
      ) : null}
      {(anyStats || frame) && (
        <table className="ic-stats">
          <tbody>
            {statRows.map((r, i) => {
              const v = statCell(r);
              return frame && !v ? (
                <tr key={i} className="ic-stat-ghost-row">
                  <td colSpan={2}><Ghost label={r.label} className="ic-stat-ghost" target={r.key} jump={jump} /></td>
                </tr>
              ) : v ? (
                <tr key={i}><th>{r.label}</th><td>{v}</td></tr>
              ) : null;
            })}
          </tbody>
        </table>
      )}
      {frame && !entry.details ? (
        (optionalOn?.sourceText ?? true) ? (
          <Ghost label="正文详情" className="pc-details" target="sourceText" jump={jump} />
        ) : null
      ) : entry.details ? (
        <div className="pc-details" dangerouslySetInnerHTML={safeHtml(expandDetails(entry.details ?? "", entry))} />
      ) : null}
      {/* 特性/正文在威能之前（官方卡顺序：统计表 → 特性段 → 威能段） */}
      {(entry.power || (frame && (optionalOn?.powerSections ?? true))) && (
        <div className="ic-power">
          <div className="ic-power-label">威能</div>
          {frame && !entry.power ? (
            <Ghost label="威能（装备数据）" className="ic-power-frame" target="powerSections" jump={jump} />
          ) : lookup ? (
            <div className="fc-content"><FeatRichText text={entry.power ?? ""} fields={entry.fields} lookup={lookup} /></div>
          ) : (
            <div className="fc-content" dangerouslySetInnerHTML={safeHtml(expandDetails(entry.power ?? "", entry))} />
          )}
        </div>
      )}
    </div>
  );
}

// 基础装备（非魔法）预览：车卡上以「装备栏」紧凑块（base-item）或「选择面板」卡片（base-picker-card）两种形态呈现。
// 与 PowerCard/ItemCard 同级，供私设编辑实时预览在两种形态间切换，符合所见即所得。

const entryStr = (e: Entry, k: string): string => (typeof e[k] === "string" ? (e[k] as string).trim() : "");

/** 特性段纯文本：details 中的「特性」bg-item 段 → 以「，」连接的平铺特性文本（武器/盾牌短特性行用） */
function mundaneTraits(entry: Entry): string {
  const props = parseItemPropertiesHtml(entry.details ?? "");
  const lines = props
    .flatMap((s) => s.lines)
    .map((l) => l.replace(/[*_`~]/g, "").trim())
    .filter(Boolean);
  return lines.join("，");
}

/** 装备栏里的基础件：对应车卡选择完毕后的 base-item 紧凑块（CharacterSheet BaseItemBlock） */
export function MundaneItemSlot({ entry }: { entry: Entry }) {
  const cat = entry.itemCategory;
  // 车卡基础件名称 = 中英文连写（官方「匕首 Dagger」，与 BaseItemBlock 一致）
  const name = [entry.name, entry.nameEn].filter(Boolean).join(" ") || "—";
  const traits = mundaneTraits(entry);
  const dice = (v: string, suffix = "") => (v ? "+" + v.replace(/^\+/, "") + suffix : "—");
  let body: ReactNode;
  if (cat === "武器") {
    body = (
      <>
        <span className="bi-name">{name}</span>
        <span className="bi-dice">{entryStr(entry, "damage") || "—"}</span>
        <span className="bi-traits">{traits || entryStr(entry, "subCategory") || "—"}</span>
        {traits && (
          <span className="base-pop">
            {traits.split(/[，,、]/).map((l, i) => <span key={i} className="base-pop-line">{l.trim()}</span>)}
          </span>
        )}
      </>
    );
  } else if (cat === "护甲") {
    body = (
      <>
        <span className="bi-name">{name}</span>
        <span className="bi-dice">{dice(entryStr(entry, "armorBonus"))}</span>
        <span className="bi-traits">{entryStr(entry, "minEnhancement") ? "最小增强 +" + entryStr(entry, "minEnhancement") : (entryStr(entry, "subCategory") || entryStr(entry, "baseType") || "—")}</span>
      </>
    );
  } else if (cat === "盾牌") {
    body = (
      <>
        <span className="bi-name">{name}</span>
        <span className="bi-dice">{dice(entryStr(entry, "shieldBonus"), " AC")}</span>
        <span className="bi-traits">{traits || entryStr(entry, "subCategory") || "—"}</span>
      </>
    );
  } else if (cat === "法器") {
    body = (
      <>
        <span className="bi-name">{name}</span>
        <span className="bi-dice">—</span>
        <span className="bi-traits">{entryStr(entry, "subCategory") ? entryStr(entry, "subCategory") + "法器" : "法器"}</span>
      </>
    );
  } else {
    body = (
      <>
        <span className="bi-name">{name}</span>
        <span className="bi-dice">—</span>
        <span className="bi-traits">{entryStr(entry, "subCategory") || cat || "—"}</span>
      </>
    );
  }
  return <div className="base-item">{body}</div>;
}

/** 冒险装备栏行：对应车卡装备面板中 adv-line 的编辑态（adv-pick 按钮 + 价格输入框） */
export function AdventureItemRow({ entry }: { entry: Entry }) {
  const name = entryStr(entry, "name");
  const cost = typeof entry.cost === "string" ? entry.cost.trim() : String(entry.cost ?? "");
  return (
    <div className="adv-line">
      <span className="adv-pick" title="点击从冒险装备名录选择">
        {name ? <span className="adv-name">{name}</span> : <span className="adv-name adv-placeholder">＋ 选择冒险装备</span>}
        {name && <span className="slot-x" title="清空">✕</span>}
      </span>
      <input className="lang-input adv-cost-input" min={0} readOnly type="number" value={cost || ""} placeholder="gp" />
    </div>
  );
}

/** 基础件选择面板卡片：对应车卡「选择基础武器/护甲」弹窗里的 base-picker-card（武器为四行扩展布局） */
export function MundaneItemPicker({ entry }: { entry: Entry }) {
  const cat = entry.itemCategory;
  const name = entry.name || entry.nameEn || "";
  // 非武器卡片（护甲/盾牌/法器）在车卡选择面板中显示中英文连写名称（BasePickerDialog 同款）
  const fullName = [entry.name, entry.nameEn].filter(Boolean).join(" ") || "—";
  const traits = mundaneTraits(entry);
  const dice = (v: string, suffix = "") => (v ? "+" + v.replace(/^\+/, "") + suffix : "—");
  let body: ReactNode;
  if (cat === "武器") {
    body = (
      <>
        <span className="wk-row1">
          <span className="bi-name">{name}</span>
          <span className="wk-range">{entry.range && entry.range !== "—" ? "射程 " + entry.range : ""}</span>
        </span>
        <span className="wk-en">{entry.nameEn ?? ""}</span>
        <span className="wk-row2">
          <span className="bi-dice">{entryStr(entry, "damage") || "—"}</span>
          <span className="wk-prof">{entryStr(entry, "proficiency") || "—"}</span>
        </span>
        <span className="wk-row3">
          <span className="bi-traits">{traits || ""}</span>
          <span className="wk-group">{entryStr(entry, "group") || ""}</span>
        </span>
      </>
    );
  } else if (cat === "护甲") {
    body = (
      <>
        <span className="bi-name">{fullName}</span>
        <span className="bi-dice">{dice(entryStr(entry, "armorBonus"))}</span>
        <span className="bi-traits">{entryStr(entry, "minEnhancement") ? "最小增强 +" + entryStr(entry, "minEnhancement") : (entryStr(entry, "subCategory") || entryStr(entry, "baseType") || "")}</span>
      </>
    );
  } else if (cat === "盾牌") {
    body = (
      <>
        <span className="bi-name">{fullName}</span>
        <span className="bi-dice">{dice(entryStr(entry, "shieldBonus"), " AC")}</span>
        <span className="bi-traits">{traits || entryStr(entry, "subCategory") || ""}</span>
      </>
    );
  } else {
    body = (
      <>
        <span className="bi-name">{fullName}</span>
        <span className="bi-dice">{entryStr(entry, "cost") || "—"}</span>
        <span className="bi-traits">{entryStr(entry, "subCategory") ? entryStr(entry, "subCategory") + "法器" : "法器"}</span>
      </>
    );
  }
  return <div className="picker-card base-picker-card">{body}</div>;
}

// 专长文本中的 [[链接]]：resolve 到词条时转为悬浮预览卡片（portal 固定定位，避免被卡片 overflow 裁剪）
function FeatRichText({ text, fields, lookup }: { text: string; fields: Record<string, string>; lookup: (t: string) => Entry | undefined }) {
  const tokens = useMemo(() => tokenizeWikiBody(text, fields), [text, fields]);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "link") {
          const e = lookup(t.target);
          if (!e) return <span key={i} className="wiki-ref-plain">{t.alias}</span>;
          return (
            <SmartHover key={i} className="wiki-ref" popClass="wiki-ref-pop" portal pop={<EntryCard entry={e} />}>
              {t.alias}
            </SmartHover>
          );
        }
        if (t.kind === "html") return <div key={i} className="wiki-html" dangerouslySetInnerHTML={safeHtml(t.html)} />;
        return <span key={i} dangerouslySetInnerHTML={safeHtml(t.html)} />;
      })}
    </>
  );
}

function FeatBlock({ label, text, entry, lookup, frame, target, jump }: { label: string; text: string; entry: Entry; lookup?: (t: string) => Entry | undefined; frame?: boolean; target?: string; jump?: (k: string) => void }) {
  return (
    <div className="fc-block">
      <div className="fc-label">{label}</div>
      <div className="fc-content">
        {frame && !text ? (
          <Ghost className="fc-content-frame" target={target} jump={jump} />
        ) : lookup ? (
          <FeatRichText text={text} fields={entry.fields} lookup={lookup} />
        ) : (
          <span dangerouslySetInnerHTML={safeHtml(expandDetails(text, entry))} />
        )}
      </div>
    </div>
  );
}

export function FeatCard({ entry, lookup, frame, jump }: { entry: Entry; lookup?: (t: string) => Entry | undefined; frame?: boolean; jump?: (k: string) => void }) {
  const special = entry.fields.special;
  return (
    <div className="feat-card" style={{ "--fc": (entry.fields.cardColor || FEAT_COLOR) } as CSSProperties}>
      <div className="fc-head">
        <span className="fc-left">
          {entry.fields.cardIcon && <span className="material-symbols-outlined head-icon">{entry.fields.cardIcon}</span>}
          <span className="fc-name">{entry.name}{entry.nameEn ? " " + entry.nameEn : ""}</span>
          {entry.origin === "user" && <span className="origin-badge">自制</span>}
        </span>
        <span className="fc-meta">
          {entry.tierZh}
          {entry.featType ? " · " + entry.featType : ""}
          {entry.source ? " · " + entry.source : ""}
        </span>
      </div>
      {(entry.prerequisite || frame) && <FeatBlock label="前提" text={entry.prerequisite ?? ""} entry={entry} lookup={lookup} frame={frame} target="prerequisite" jump={jump} />}
      {(entry.benefit || frame) && <FeatBlock label="增益" text={entry.benefit ?? ""} entry={entry} lookup={lookup} frame={frame} target="benefit" jump={jump} />}
      {(special || frame) && <FeatBlock label="特殊" text={special ?? ""} entry={entry} lookup={lookup} frame={frame} target="special" jump={jump} />}
    </div>
  );
}

// 私设种族预览：与车卡「种族特性」板块**外层同构**（section.block → block-head → pf-entry-title → race-detail）。
// 详情结构：classTrait 块 → 结构化特性行（「X 替代 Y」静态 sr-tag）+ lore 折叠小节（辅助威能小节 = 标题 + 折叠威能条目）。
// 旧存档（无 classTrait 块，!! N级：分节 / 纯文本）回退 splitRaceSections 渲染。
// 轻量分节：按「!! N级：标题」或「!! 标题」拆节，保留正文原始 wiki 标记
// （不能复用 parseLevelSections——它会把 [[威能]] 剥成纯文本，导致预览无法标蓝悬浮）
function splitRaceSections(src: string): { level: string; title: string; body: string }[] {
  const out: { level: string; title: string; body: string }[] = [];
  let cur: { level: string; title: string; body: string } | null = null;
  const lines = src.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    let m = /^!!\s+([0-9]+)\s*级\s*[:：]?\s*(.*)$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { level: m[1] + "级", title: m[2].trim(), body: "" };
      continue;
    }
    m = /^!!\s+(.*)$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { level: "", title: m[1].trim(), body: "" };
      continue;
    }
    if (cur) cur.body += raw + "\n";
    else if (raw.trim()) {
      cur = { level: "", title: "", body: raw + "\n" };
      out.push(cur);
    }
  }
  if (cur) out.push(cur);
  return out.filter((s) => s.level || s.title || s.body.trim());
}

// 互斥 chip 上的特性名（车卡 chineseName 同规则：去掉名称尾部的英文）
function raceChipName(s: string): string {
  const i = s.search(/[A-Za-z]/);
  return i < 0 ? s.trim() : s.slice(0, i).trim();
}

// 辅助威能条目：预览中「选择此威能」按钮做局部可切换态（视觉与车卡一致，点击不写车卡数据）
function PreviewAuxPower({ title, body, fields, lookup }: {
  title: string;
  body?: string;
  fields: Record<string, string>;
  lookup: (t: string) => Entry | undefined;
}) {
  const [on, setOn] = useState(false);
  const power = title ? lookup(title) : undefined;
  return (
    <details className="lore-fold">
      <summary>
        {power && (
          <button
            type="button"
            className={"lore-powers-toggle" + (on ? " on" : "")}
            onClick={(e) => { e.stopPropagation(); setOn((p) => !p); }}
            title={on ? "取消选择，从威能面板移除（预览不写入车卡）" : "选择此威能，填入对应的威能框（预览不写入车卡）"}
          >
            {on ? "取消选择" : "选择此威能"}
          </button>
        )}
        {power ? (
          <SmartHover className="lore-fold-title lore-powers-hover" popClass="wiki-ref-pop" portal pop={<EntryCard entry={power} />}>{title}</SmartHover>
        ) : (
          <span className="lore-fold-title">{title}</span>
        )}
        <span className="material-symbols-outlined lore-fold-ic">expand_more</span>
      </summary>
      {body ? <div className="class-features"><WikiBody body={body} fields={fields} lookup={lookup} portal /></div> : null}
    </details>
  );
}

export function RaceCard({ entry, lookup, frame, jump }: { entry: Entry; lookup?: (t: string) => Entry | undefined; frame?: boolean; jump?: (k: string) => void }) {
  const src = entry.sourceText ?? "";
  const resolve = lookup ?? (() => undefined);
  const [detail, setDetail] = useState(true);
  const hasClassTrait = /@@\.classTrait\s+"""/.test(src);
  const traitLines = useMemo(() => {
    if (!hasClassTrait) return [];
    const body = raceTraitHtml(src);
    return body ? parseRaceTraitLines(body) : [];
  }, [hasClassTrait, src]);
  const loreSections = useMemo(() => {
    if (!hasClassTrait) return [];
    const body = raceBodyHtml(src);
    return body ? splitRaceLore(body) : [];
  }, [hasClassTrait, src]);
  // 旧存档（无 classTrait 块）回退：!! N级：分节
  const sections = useMemo(() => (hasClassTrait ? [] : splitRaceSections(src)), [hasClassTrait, src]);
  // 基础种族内部的可替代特性：被替代特性名 → 替代特性行（车卡同规则：替代行并入基础行，展示为互斥 chip）
  const altForBase = useMemo(() => {
    const map = new Map<string, (typeof traitLines)[number]>();
    for (const t of traitLines) if (t.replaces && t.replaces !== t.name) map.set(t.replaces, t);
    return map;
  }, [traitLines]);
  // 简洁模式：剔除 8 个自动头部槽行，仅保留实用特性（与车卡 compactRaceTraits 同规则）
  const shownTraits = useMemo(
    () => (detail ? traitLines : traitLines.filter((t) => !RACE_HEADER_NAMES.has(t.name.trim()))),
    [detail, traitLines],
  );
  // 车卡「种族特性」标题栏只显示中文名（pf-entry-title 用 raceEntry.name），预览保持一致
  const name = entry.name;
  return (
    <section className="block">
      <div className="block-head">
        <h3 className="block-title">种族特性</h3>
        <div className="race-head-actions">
          <button type="button" className="mode-chip" onClick={() => setDetail((p) => !p)}>
            <span className="material-symbols-outlined mode-chip-ic">{detail ? "density_small" : "density_large"}</span>
            {detail ? "简洁" : "详细"}
          </button>
        </div>
      </div>
      <div className="pf-entry-title">{name}</div>
      <div className="race-detail">
        {hasClassTrait ? (
          <>
            {shownTraits.length > 0 && (
              <div className="race-trait">
                {shownTraits.map((t, i) => {
                  const alt = altForBase.get(t.name);
                  // 替代行本身不独立展示（并入其基础特性的互斥切换）
                  if (t.replaces && altForBase.has(t.replaces)) return null;
                  if (!alt) {
                    return (
                      <div key={i} className="race-trait-line">
                        <WikiBody body={`''${t.name}：''${t.body}`} fields={entry.fields} lookup={resolve} pop={(e) => <EntryCard entry={e} />} portal />
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="race-trait-line sr-replaceable">
                      <div className="race-trait-row">
                        {detail && (
                          <div className="race-trait-opts">
                            <button type="button" className="sr-tag active" title={`当前为原始特性「${raceChipName(t.name)}」`}>
                              <span className="material-symbols-outlined sr-ic">swap_horiz</span>
                              {raceChipName(t.name)}
                            </button>
                            <button type="button" className="sr-tag" title={`车卡上可切换为「${raceChipName(alt.name)}」替代（预览为静态展示）`}>
                              <span className="material-symbols-outlined sr-ic">swap_horiz</span>
                              {raceChipName(alt.name)}
                            </button>
                          </div>
                        )}
                        <div className="race-trait-content">
                          <WikiBody body={`''${t.name}：''${t.body}`} fields={entry.fields} lookup={resolve} pop={(e) => <EntryCard entry={e} />} portal />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {detail && loreSections.length > 0 && (
              <div className="race-lore">
                {loreSections.map((sec, i) => {
                  // 辅助威能小节：标题不折叠，仅各威能的描述文本折叠（标题可能为「XX辅助威能」或「XX种族威能」）
                  if (sec.title && (sec.title.includes("辅助威能") || sec.title.includes("种族威能"))) {
                    const aux = splitAuxPowers(sec.body);
                    return (
                      <div key={i} className="lore-powers">
                        <div className="lore-powers-title">{sec.title}</div>
                        {aux.intro && (
                          <details className="lore-fold">
                            <summary>
                              <span className="lore-fold-title">简介</span>
                              <span className="material-symbols-outlined lore-fold-ic">expand_more</span>
                            </summary>
                            <div className="class-features"><WikiBody body={aux.intro} fields={entry.fields} lookup={resolve} pop={(e) => <EntryCard entry={e} />} portal /></div>
                          </details>
                        )}
                        {aux.powers.map((p, j) => (
                          <PreviewAuxPower key={j} title={p.title} body={p.body} fields={entry.fields} lookup={resolve} />
                        ))}
                      </div>
                    );
                  }
                  return (
                    <details key={i} className="lore-fold">
                      <summary>
                        <span className="lore-fold-title">{sec.title ?? "种族背景"}</span>
                        <span className="material-symbols-outlined lore-fold-ic">expand_more</span>
                      </summary>
                      <div className="class-features"><WikiBody body={sec.body} fields={entry.fields} lookup={resolve} pop={(e) => <EntryCard entry={e} />} portal /></div>
                    </details>
                  );
                })}
              </div>
            )}
            {!traitLines.length && !loreSections.length && frame && (
              <Ghost label="种族特性" className="race-trait-content" target="raceTraits" jump={jump} />
            )}
          </>
        ) : sections.length > 0 ? (
          sections.map((s, i) => {
            const head = s.level ? (s.title ? `${s.level}：${s.title}` : s.level) : s.title;
            const body = s.body.trim();
            return (
              <div key={i} className="race-trait-line">
                <div className="race-trait-content">
                  {body ? (
                    <WikiBody body={`${head ? `''${head}：''` : ""}${body}`} fields={entry.fields} lookup={resolve} pop={(e) => <EntryCard entry={e} />} portal />
                  ) : head ? (
                    <b>{head}</b>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : frame && !src ? (
          <Ghost label="种族特性" className="race-trait-content" target="raceTraits" jump={jump} />
        ) : src ? (
          <div className="race-trait-line"><div className="race-trait-content"><WikiBody body={src} fields={entry.fields} lookup={resolve} pop={(e) => <EntryCard entry={e} />} portal /></div></div>
        ) : null}
      </div>
    </section>
  );
}

// 通用词条卡片（种族/职业/典范/天命等）：关键字段 + 详情
const GENERIC_LABELS: [string, string][] = [
  ["abilityOne", "属性"], ["size", "体型"], ["speed", "速度"], ["vision", "视觉"],
  ["role", "职位"], ["powerSource", "威能来源"], ["tierZh", "层级"],
  ["itemLevel", "物品等级"], ["itemCategory", "类别"], ["rarity", "稀有度"],
  ["skill", "技能"], ["keySkill", "关键技能"],
  ["prerequisite", "前提"], ["tier", "层级"], ["ritualLevel", "仪式等级"], ["ritualCategory", "仪式类别"],
  ["level", "等级"],
];

export function GenericCard({ entry, frame, jump, flavorTarget = "sourceText", flavor = true }: {
  entry: Entry; frame?: boolean; jump?: (k: string) => void; flavorTarget?: string; flavor?: boolean;
}) {
  // 冒险装备(gear)等基础条目可能没有 fields 对象，统一兜底为空
  const f = entry.fields ?? {};
  const rows: [string, string][] = [];
  for (const [k, label] of GENERIC_LABELS) {
    if (k === "abilityOne") {
      if (entry.abilityOne) rows.push([label, entry.abilityOne + (entry.abilityTwo ? " / " + entry.abilityTwo : "")]);
      continue;
    }
    const v = entry[k];
    if (typeof v === "string" && v) rows.push([label, v]);
  }
  return (
    <div className="generic-card" style={{ "--gc": (f.cardColor || "var(--md-sys-color-primary)") } as CSSProperties}>
      <div className="gc-head">
        <span className="gc-left">
          {f.cardIcon && <span className="material-symbols-outlined head-icon">{f.cardIcon}</span>}
          <span className="gc-name">{entry.name}{entry.nameEn ? " " + entry.nameEn : ""}</span>
          {entry.origin === "user" && <span className="origin-badge">自制</span>}
        </span>
        <span className="gc-meta">{CATEGORY_LABELS[entry.category] ?? entry.category}{entry.source ? " · " + entry.source : ""}</span>
      </div>
      {/* 风味文本紧跟抬头（官方卡片顺序：名称 → 风味引子 → 数据行 → 正文）；
          占位文案随落点变化：类别有独立「风味文本」字段时指向该字段，否则按惯例写在正文里 */}
      {flavor && (frame && !entry.flavorText ? (
        <Ghost label={flavorTarget === "flavorText" ? "风味文本" : "风味文本（写入正文）"} className="gc-flavor" target={flavorTarget} jump={jump} />
      ) : entry.flavorText ? (
        <div className="gc-flavor">{entry.flavorText}</div>
      ) : null)}
      {rows.length > 0 && (
        <div className="gc-fields">
          {rows.map(([label, val]) => <span key={label} className="gc-field"><b>{label}</b>{val}</span>)}
        </div>
      )}
      {entry.details ? (
        <div className={"pc-details" + (entry.category === "creature" ? " gen-creature-card" : "")} dangerouslySetInnerHTML={safeHtml(entry.details)} />
      ) : entry.sourceText ? (
        // sourceText 含不少原生 HTML（如生物 <div class=creature>…），需经 wikiToHtml 渲染，
        // 直接 stripWiki 会把 HTML 标签当成可见代码显示出来。
        <div className="pc-details gen-creature-card" dangerouslySetInnerHTML={safeHtml(wikiToHtml(entry.sourceText, f))} />
      ) : frame ? (
        <Ghost label="正文详情" className="pc-details" target="sourceText" jump={jump} />
      ) : null}
    </div>
  );
}

// lookup 提供时，专长卡片正文中的 [[威能]] 等链接转为悬浮预览卡片（角色卡与选择专长界面共用）
export default function EntryCard({ entry, lookup, frame, jump, optionalOn }: {
  entry: Entry; lookup?: (t: string) => Entry | undefined; frame?: boolean; jump?: (k: string) => void;
  optionalOn?: Partial<Record<string, boolean>>;
}) {
  if (entry.category === "power") return <PowerCard entry={entry} frame={frame} jump={jump} />;
  // 冒险装备与官方 gear 条目保持一致（generic-card + adv-line），无论私设(category=equipment)还是官方(category=gear)；
  // 非战斗用条目无风味文本/特性，仅正文
  if (entry.itemCategory === "冒险装备") return <GenericCard entry={entry} frame={frame} jump={jump} flavor={false} />;
  if (entry.category === "equipment") return <ItemCard entry={entry} frame={frame} jump={jump} lookup={lookup} optionalOn={optionalOn} />;
  if (entry.category === "feat") return <FeatCard entry={entry} lookup={lookup} frame={frame} jump={jump} />;
  if (entry.category === "race") return <RaceCard entry={entry} lookup={lookup} frame={frame} jump={jump} />;
  return <GenericCard entry={entry} frame={frame} jump={jump} />;
}
