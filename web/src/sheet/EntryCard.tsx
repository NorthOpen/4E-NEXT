import { useMemo, type CSSProperties } from "react";
import type { Entry } from "../data/types";
import { POWER_COLORS, ITEM_COLOR, FEAT_COLOR } from "../lib/colors";
import { CATEGORY_LABELS } from "../data/labels";
import { tokenizeWikiBody, wikiToHtml } from "../lib/wikirender";
import { safeHtml } from "../lib/sanitize";
import { SmartHover } from "./SmartHover";
import { equipFamilyOf, equipmentStatRows, MUNDANE_STAT_ROWS, isMundaneEntry, suitRowFor } from "../lib/homebrewSchema";

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

function PowerCard({ entry, frame, jump }: { entry: Entry; frame?: boolean; jump?: (k: string) => void }) {
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

function ItemCard({ entry, frame, jump, lookup }: { entry: Entry; frame?: boolean; jump?: (k: string) => void; lookup?: (t: string) => Entry | undefined }) {
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
                  <td colSpan={2}><Ghost className="ic-stat-ghost" target={r.key} jump={jump} /></td>
                </tr>
              ) : v ? (
                <tr key={i}><th>{r.label}</th><td>{v}</td></tr>
              ) : null;
            })}
          </tbody>
        </table>
      )}
      {(entry.power || frame) && (
        <div className="ic-power">
          <div className="ic-power-label">威能</div>
          {frame && !entry.power ? (
            <Ghost className="ic-power-frame" target="powerSections" jump={jump} />
          ) : lookup ? (
            <div className="fc-content"><FeatRichText text={entry.power ?? ""} fields={entry.fields} lookup={lookup} /></div>
          ) : (
            <div className="fc-content" dangerouslySetInnerHTML={safeHtml(expandDetails(entry.power ?? "", entry))} />
          )}
        </div>
      )}
      {frame && !entry.details ? (
        <Ghost label="正文详情" className="pc-details" target="sourceText" jump={jump} />
      ) : entry.details ? (
        <div className="pc-details" dangerouslySetInnerHTML={safeHtml(expandDetails(entry.details ?? "", entry))} />
      ) : null}
    </div>
  );
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

function FeatCard({ entry, lookup, frame, jump }: { entry: Entry; lookup?: (t: string) => Entry | undefined; frame?: boolean; jump?: (k: string) => void }) {
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

// 通用词条卡片（种族/职业/典范/天命等）：关键字段 + 详情
const GENERIC_LABELS: [string, string][] = [
  ["abilityOne", "属性"], ["size", "体型"], ["speed", "速度"], ["vision", "视觉"],
  ["role", "职位"], ["powerSource", "威能来源"], ["tierZh", "层级"],
  ["itemLevel", "物品等级"], ["itemCategory", "类别"], ["rarity", "稀有度"],
  ["skill", "技能"], ["keySkill", "关键技能"],
  ["prerequisite", "前提"], ["tier", "层级"], ["ritualLevel", "仪式等级"], ["ritualCategory", "仪式类别"],
  ["level", "等级"],
];

function GenericCard({ entry, frame, jump }: { entry: Entry; frame?: boolean; jump?: (k: string) => void }) {
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
      {rows.length > 0 && (
        <div className="gc-fields">
          {rows.map(([label, val]) => <span key={label} className="gc-field"><b>{label}</b>{val}</span>)}
        </div>
      )}
      {frame && !entry.flavorText ? (
        <Ghost label="风味文本（写入正文）" className="gc-flavor" target="sourceText" jump={jump} />
      ) : entry.flavorText ? (
        <div className="gc-flavor">{entry.flavorText}</div>
      ) : null}
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
export default function EntryCard({ entry, lookup, frame, jump }: { entry: Entry; lookup?: (t: string) => Entry | undefined; frame?: boolean; jump?: (k: string) => void }) {
  if (entry.category === "power") return <PowerCard entry={entry} frame={frame} jump={jump} />;
  if (entry.category === "equipment") return <ItemCard entry={entry} frame={frame} jump={jump} lookup={lookup} />;
  if (entry.category === "feat") return <FeatCard entry={entry} lookup={lookup} frame={frame} jump={jump} />;
  return <GenericCard entry={entry} frame={frame} jump={jump} />;
}
