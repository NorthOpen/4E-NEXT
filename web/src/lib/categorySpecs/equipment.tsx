import {
  CATEGORY_FIELDS, CATEGORY_SECTIONS,
  parseItemPowerSections, serializeItemPowerSections, parseItemProperties,
  serializeEquipmentDetails, parseItemPowerSectionsHtml, parseItemPropertiesHtml,
  enhTargetOf, enhAppliesTo, enhBonusOf, normalizeEnhTarget,
  GROUPS_BY_CATEGORY, residualEquipmentText, isMundaneEntry,
  renderBody,
} from "../homebrewSchema";
import { itemLevels, enhancementBonusForLevel } from "../levelprices";
import type { CategorySpec, BuildResult, PreviewProps } from "./types";
import {
  ItemCard, GenericCard, MundaneItemSlot, MundaneItemPicker, AdventureItemRow,
} from "../../sheet/EntryCard";

/**
 * 装备 spec：已达标（三形态 + 统计表 + ItemCard），机械迁入。
 * build：物品威能段 → entry.power；增强算法（对象 + 加值）；分类组补写 itemSuitable；details 纯派生（特性段 + 正文）。
 * Preview：按形态分发 —— 冒险装备（adv-line + 详情卡）/ 基础物品（装备栏 + 选择面板）/ 魔法物品（ItemCard）。
 */
function EquipmentPreview({ entry, frame, jump, lookup, optionalOn }: PreviewProps) {
  // 冒险装备：与官方 gear 条目一致（generic-card + adv-line），无风味文本/特性，仅正文
  if (entry.itemCategory === "冒险装备" || entry.itemForm === "adventure") {
    return (
      <div className="hb-mundane-preview">
        <div className="hb-mundane-col">
          <div className="hb-mundane-col-label">装备栏</div>
          <AdventureItemRow entry={entry} />
        </div>
        <div className="hb-mundane-col">
          <div className="hb-mundane-col-label">详情卡</div>
          <GenericCard entry={entry} frame={frame} jump={jump} flavor={false} />
        </div>
      </div>
    );
  }
  // 基础（非魔法）装备：车卡上以 装备栏紧凑块 / 选择面板卡片 两种形态呈现，双栏同显
  if (isMundaneEntry(entry) && ["武器", "护甲", "法器", "盾牌"].includes(entry.itemCategory ?? "")) {
    return (
      <div className="hb-mundane-preview">
        <div className="hb-mundane-col">
          <div className="hb-mundane-col-label">装备栏</div>
          <MundaneItemSlot entry={entry} />
        </div>
        <div className="hb-mundane-col">
          <div className="hb-mundane-col-label">选择面板</div>
          <MundaneItemPicker entry={entry} />
        </div>
      </div>
    );
  }
  return <ItemCard entry={entry} frame={frame} jump={jump} lookup={lookup} optionalOn={optionalOn} />;
}

export const equipmentSpec: CategorySpec = {
  key: "equipment",
  label: "装备",
  fields: CATEGORY_FIELDS.equipment,
  sections: CATEGORY_SECTIONS.equipment,
  editors: { powerSections: "powerSections", properties: "properties" },
  build: ({ form, extras, sourceText, bodyFormat }) => {
    const out: BuildResult = {};
    // 物品威能段 → entry.power（官方 bg-item 格式，供 ItemCard 专属威能区块渲染）
    const secs = parseItemPowerSections(form.powerSections);
    if (secs.length) out.extras = { power: serializeItemPowerSections(secs) };
    // 增强算法：对象 = 类别默认+覆盖（有默认的类别才落字段）；加值 = 等级推导+覆盖
    if (form.itemForm !== "mundane") {
      const eh: Record<string, string> = {};
      const target = enhTargetOf(form.itemCategory, form.enhTarget);
      if (target) eh.enhTarget = target;
      if (enhAppliesTo(form.itemCategory) || target) {
        const bonus = enhBonusOf(form.itemLevel ?? "", extras.enh);
        if (bonus) eh.enh = bonus;
      }
      out.extras = { ...(out.extras ?? {}), ...eh };
    }
    // 武器/法器/护甲：分类组即官方 itemSuitable（同 token 空间），补写以对齐 ItemSlotPicker 槽位过滤
    if (extras.group && !extras.itemSuitable && GROUPS_BY_CATEGORY[form.itemCategory ?? ""]) {
      out.extras = { ...(out.extras ?? {}), itemSuitable: extras.group };
    }
    // details 纯派生：仅 特性段 + 正文（增强/重击/甲类 是统计表行的权威标量，不重复写入）
    const props = form.itemCategory === "冒险装备" ? [] : parseItemProperties(form.properties);
    const bodyHtml = sourceText ? renderBody(sourceText, bodyFormat, extras) : "";
    out.details = serializeEquipmentDetails({ props, bodyHtml });
    return out;
  },
  parse: (entry, form) => {
    // 基础形态兜底：无 itemForm 标记的旧条目，按基础字段自明判定（isMundaneEntry），保证回填后仍显示基础形态
    if (!form.itemForm && isMundaneEntry(entry)) form.itemForm = "mundane";
    const full = (entry.power as string) || (entry.details as string) || "";
    const secs = parseItemPowerSectionsHtml(full);
    if (secs.length) form.powerSections = JSON.stringify(secs);
    const props = parseItemPropertiesHtml(full);
    if (props.length) form.properties = JSON.stringify(props);
    const statOf = (label: string) => {
      const m = full.match(new RegExp(`<b>\\s*${label}\\s*：\\s*</b>\\s*([^<]*)`));
      return m && m[1] ? m[1].trim() : "";
    };
    if (!form.critical) form.critical = statOf("重击");
    // 增强算法回填：官方 details「增强：」行是对象文本（加值由等级推导）→ 进 enhTarget 而非 enh
    const lvls = itemLevels(form.itemLevel ?? "");
    const derivedBonuses = lvls.length ? [...new Set(lvls.map(enhancementBonusForLevel))] : [];
    const derivedStr = derivedBonuses.map((b) => "+" + b).join("/");
    if (form.enh && derivedStr && form.enh.trim() === derivedStr) {
      form.enh = "";
    } else if (form.enh && !/^\s*[+−-]?\d+(\.\d+)?\s*$/.test(form.enh)) {
      if (!form.enhTarget) form.enhTarget = normalizeEnhTarget(form.enh);
      form.enh = "";
    }
    const enhLine = statOf("增强");
    if (!form.enhTarget && enhLine) form.enhTarget = normalizeEnhTarget(enhLine);
    // 武器/法器/护甲：官方 itemSuitable 与分类组同 token 空间 → 映射进「分类组」
    if (!form.group && form.itemSuitable && GROUPS_BY_CATEGORY[form.itemCategory ?? ""]) form.group = form.itemSuitable;
    // 残余头部行 → 正文（官方条目导入不丢内容）；自制条目 details 由 特性段+正文 派生，跳过避免正文重复
    if (entry.origin !== "user") {
      if (/^\s*<<item-format>>\s*$/.test(form.sourceText)) form.sourceText = "";
      const residual = residualEquipmentText(full);
      if (residual) form.sourceText = [form.sourceText.trim(), residual].filter(Boolean).join("\n\n");
    }
  },
  Preview: EquipmentPreview,
};
