import type { Entry } from "../data/types";
import { CATEGORY_LABELS } from "../data/labels";
import { stripWiki } from "../lib/text";
import { safeHtml } from "../lib/sanitize";

const FIELD_LABELS: [string, string][] = [
  ["usageZh", "使用"], ["actionType", "动作"], ["keywords", "关键词"], ["range", "射程"], ["level", "等级"],
  ["powerType", "威能类型"], ["skill", "技能"], ["tierZh", "层级"], ["itemLevel", "物品等级"],
  ["itemCategory", "类别"], ["rarity", "稀有度"], ["size", "体型"],
  ["speed", "速度"], ["vision", "视觉"], ["abilityOne", "属性1"], ["abilityTwo", "属性2"],
  ["role", "职位"], ["powerSource", "威能来源"], ["ritualLevel", "仪式等级"], ["keySkill", "关键技能"],
  ["ritualCategory", "仪式类别"], ["prerequisite", "前置"], ["benefit", "收益"],
];

function Val({ v }: { v: string }) {
  if (v.includes("<")) return <dd className="entry-val" dangerouslySetInnerHTML={safeHtml(v)} />;
  return <dd className="entry-val">{v}</dd>;
}

export default function EntryDetail({ entry }: { entry: Entry }) {
  const rows: [string, string][] = [];
  for (const [k, label] of FIELD_LABELS) {
    const v = entry[k];
    if (typeof v === "string" && v) rows.push([label, v]);
  }

  return (
    <div className="entry-detail">
      <h2>{entry.name}{entry.nameEn ? " " + entry.nameEn : ""}</h2>
      <div className="entry-meta">
        {CATEGORY_LABELS[entry.category] ?? entry.category}
        {entry.source ? " · " + entry.source : ""}
        {entry.magazine ? " · " + entry.magazine : ""}
      </div>
      {entry.flavorText && <div className="flavor">{entry.flavorText}</div>}
      {rows.length > 0 && (
        <dl className="entry-fields">
          {rows.map(([label, val]) => (
            <div key={label} className="entry-field">
              <dt>{label}</dt>
              <Val v={val} />
            </div>
          ))}
        </dl>
      )}
      {entry.details ? (
        <div className="entry-details" dangerouslySetInnerHTML={safeHtml(entry.details)} />
      ) : (
        <pre className="entry-text">{stripWiki(entry.sourceText).slice(0, 2000)}</pre>
      )}
    </div>
  );
}
