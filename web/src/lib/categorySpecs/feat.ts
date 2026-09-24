import {
  CATEGORY_FIELDS, CATEGORY_SECTIONS,
  parseFeatRowsJson, serializeFeatTable, parseFeatTable,
} from "../homebrewSchema";
import type { CategorySpec } from "./types";
import { FeatCard } from "../../sheet/EntryCard";

/**
 * 专长 spec：已达标（前提句式 chips / 增益预设 / 等级表 + FeatCard），机械迁入。
 * build：关联威能等级表拼到 benefit 末尾（官方 <table>）；withoutBody（卡片不渲染自由正文）。
 */
export const featSpec: CategorySpec = {
  key: "feat",
  label: "专长",
  fields: CATEGORY_FIELDS.feat,
  sections: CATEGORY_SECTIONS.feat,
  editors: { featRows: "featRows", prerequisite: "featPrereq", benefit: "featBenefit" },
  withoutBody: true,
  build: ({ form }) => {
    const rows = parseFeatRowsJson(form.featRows);
    if (rows.length && form.benefit) {
      return { extras: { benefit: form.benefit.trim() + "\n" + serializeFeatTable(rows) } };
    }
    return {};
  },
  parse: (entry, form) => {
    // benefit 内嵌的等级×威能表 → featRows
    const rows = parseFeatTable((entry as Record<string, unknown>).benefit as string);
    if (rows?.length) form.featRows = JSON.stringify(rows);
  },
  Preview: FeatCard,
};
