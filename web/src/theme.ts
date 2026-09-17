import {
  Hct,
  argbFromHex,
  hexFromArgb,
  sourceColorFromImage,
  MaterialDynamicColors,
  SchemeExpressive,
  SchemeFruitSalad,
  SchemeTonalSpot,
  SchemeVibrant,
  type DynamicColor,
  type DynamicScheme,
} from "@material/material-color-utilities";

export type SeedMode = "preset" | "picker" | "portrait" | "background";

// Nord 风格预设色板（冰蓝/极夜/雪花与冰霜同为近似偏蓝灰色调，已移除）
export const NORD_PRESETS: { name: string; color: string }[] = [
  { name: "冰霜", color: "#5e81ac" },
  { name: "极光绿", color: "#a3be8c" },
  { name: "极光紫", color: "#b48ead" },
  { name: "极光红", color: "#bf616a" },
  { name: "极光黄", color: "#ebcb8b" },
];

/** 取色模式：Material You 的配色方案变体（color scheme variant）。 */
export type VariantKey = "tonal-spot" | "vibrant" | "expressive" | "fruit-salad";

export interface VariantOption {
  key: VariantKey;
  label: string;
}

// 只保留四种一眼能分辨的模式：彩虹（主色与旧实现几乎一致）、内容与保真
// （两者只在三级色上不同）都不单列，免得用户面对一堆看不出差别的选项。
export const COLOR_VARIANTS: VariantOption[] = [
  { key: "tonal-spot", label: "TonalSpot" },
  { key: "vibrant", label: "Vibrant" },
  { key: "expressive", label: "Expressive" },
  { key: "fruit-salad", label: "FruitSalad" },
];

export const DEFAULT_VARIANT: VariantKey = "tonal-spot";

const SCHEME_CLASSES: Record<VariantKey, new (hct: Hct, isDark: boolean, contrastLevel: number) => DynamicScheme> = {
  "tonal-spot": SchemeTonalSpot,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  "fruit-salad": SchemeFruitSalad,
};

// 角色表 = MaterialDynamicColors 上的 54 个颜色角色（另一个静态成员 contentAccentToneDelta
// 是色调差对，不是颜色，按有无 getArgb 过滤）。surfaceDim/Bright/surfaceContainer*
// 这些过去靠手写 tone 值补的角色，现在由官方角色直接给出。
const ROLE_COLORS = Object.entries(MaterialDynamicColors).filter(
  ([, v]) => typeof (v as DynamicColor | undefined)?.getArgb === "function",
) as [string, DynamicColor][];

function toToken(role: string): string {
  return "--md-sys-color-" + role.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

/** 由种子色生成一套配色方案（明暗 × 取色模式 × 对比度）。 */
export function schemeFromSeed(hex: string, isDark: boolean, variant: VariantKey, contrastLevel = 0): DynamicScheme {
  return new SCHEME_CLASSES[variant](Hct.fromInt(argbFromHex(hex)), isDark, contrastLevel);
}

/** 展开为 --md-sys-color-* 变量表（54 个角色，含 surface 容器系列与 fixed 系列）。 */
export function schemeToCssVars(scheme: DynamicScheme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [role, color] of ROLE_COLORS) vars[toToken(role)] = hexFromArgb(color.getArgb(scheme));
  return vars;
}

// 设置页小色板只画这几个角色：底色、文字色、主/次/三级色的代表色
const PREVIEW_ROLES = [
  "surface",
  "onSurface",
  "outlineVariant",
  "primary",
  "primaryContainer",
  "secondaryContainer",
  "tertiary",
  "tertiaryContainer",
] as const;
export type PreviewColors = Record<(typeof PREVIEW_ROLES)[number], string>;

/** 一次算出四种模式在当前种子与明暗下的预览色，供设置页并排展示（约 1ms）。 */
export function variantPreviews(hex: string, isDark: boolean): Record<VariantKey, PreviewColors> {
  const out = {} as Record<VariantKey, PreviewColors>;
  for (const v of COLOR_VARIANTS) {
    const scheme = schemeFromSeed(hex, isDark, v.key);
    const colors = {} as PreviewColors;
    for (const role of PREVIEW_ROLES) colors[role] = hexFromArgb(MaterialDynamicColors[role].getArgb(scheme));
    out[v.key] = colors;
  }
  return out;
}

export function applyCssVars(vars: Record<string, string>): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

// 从角色立绘图片提取种子色
export async function imageToSeedHex(img: HTMLImageElement): Promise<string> {
  const argb = await sourceColorFromImage(img);
  return hexFromArgb(argb);
}
