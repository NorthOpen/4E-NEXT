import type { ReactNode } from "react";
import type { Entry } from "../../data/types";
import type { SheetField, HomebrewSection } from "../homebrewSchema";

/**
 * Category Spec 统一接口：每类私设自包含一个 spec 模块。
 * 未登记的类别走 genericSpec 兜底（行为与现状通用实现一致）。
 */

/** 专用字段编辑器 props：value/onChange 由 Shell 注入（form[f.key] 与 set(f.key, v)），category 供按类别差异化 */
export interface FieldEditorProps {
  value: string;
  onChange: (v: string) => void;
  category: string;
}

/** 预览卡统一 props（frame 空态框 / jump 跳左栏 / lookup 威能悬浮 / optionalOn 可选区块） */
export interface PreviewProps {
  entry: Entry;
  frame?: boolean;
  jump?: (k: string) => void;
  lookup?: (t: string) => Entry | undefined;
  optionalOn?: Partial<Record<string, boolean>>;
}
export type Preview = (props: PreviewProps) => ReactNode;

/** build 钩子上下文：extras 已含全部非空专属标量；sourceText 为当前正文（可改写） */
export interface BuildCtx {
  cat: string;
  form: Record<string, string>;
  extras: Record<string, string>;
  sourceText: string;
  bodyFormat: "md" | "wiki";
}

/** build 钩子返回：覆盖 sourceText / 派生 details / 追加 extras */
export interface BuildResult {
  sourceText?: string;
  details?: string;
  extras?: Record<string, string>;
}
export type BuildHook = (ctx: BuildCtx) => BuildResult;

/** parse 钩子：编辑既有条目时回填 form（结构化反向解析 + 旧数据迁移） */
export type ParseHook = (entry: Entry, form: Record<string, string>) => void;

/** 种族特性行（form.raceTraits 的 JSON 条目） */
export interface RaceTraitRow {
  name: string;
  body: string;
  replaces?: string;
}

/** 种族正文块（form.loreSections 的 JSON 条目）：title 为空 = 无标题自由块（首块作为「种族背景」引言） */
export interface RaceLoreBlock {
  title: string;
  body: string;
}

/** 辅助威能条目（form.raceAuxPowers 的 JSON 内层）：驱动 `!!! 威能名` + 描述 + `{{威能名}}` 三行结构 */
export interface RaceAuxPower {
  name: string;
  body: string;
}

/** 种族辅助威能小节（form.raceAuxPowers 的 JSON）：一个标题 + 可选引言 + 若干威能条目 */
export interface RaceAuxGroup {
  title: string;
  intro: string;
  powers: RaceAuxPower[];
}

/**
 * 每类一个自包含 spec：
 * - fields / sections：专属字段与表单分区（不含 COMMON / APPEARANCE，Shell 自动追加）
 * - editors：fieldKey → editorKey（editorKey 为 EntryEditor 内 EDITOR_COMPONENTS 的键）
 * - withoutBody：隐藏正文 sourceText 区
 * - build / parse：结构化派生与反向回填（缺省 → 通用实现）
 * - Preview：预览卡（缺省 → GenericCard）
 */
export interface CategorySpec {
  key: string;
  label: string;
  fields: SheetField[];
  sections: HomebrewSection[];
  editors?: Record<string, string>;
  withoutBody?: boolean;
  build?: BuildHook;
  parse?: ParseHook;
  Preview: Preview;
}
