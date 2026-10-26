/**
 * 全局皮肤注册表。
 *
 * 皮肤只改「外观」：颜色令牌、线条、字体与装饰，不碰布局和交互逻辑。
 * 启用后 App 在 <html> 上挂 data-skin="<id>"，所有页面与 portal 浮层共享同一套
 * 颜色令牌；关闭即摘除，原版外观完全不受影响。
 *
 * 皮肤契约：
 *   1. 在 web/src/lab/skins/<id>.css 的 html[data-skin="<id>"] 块里定义 --skin-*
 *      调色板与 --skin-mat-* 材质 token（填充、模糊、描边、阴影、圆角…）；
 *   2. 共享结构（面板、输入框、按钮、导航…）由 html[data-skin] 统一样式驱动，
 *      只消费 token，不写死某个皮肤的颜色或圆角；
 *   3. 只有该皮肤专属的装饰（文字戳、条码、图标）才写在 html[data-skin="<id>"] 下。
 *
 * 可调项由 appearance 描述：支持哪些深浅模式、默认模式、可用字体。设置页的
 * 「实验性外观设置」只渲染当前皮肤声明过的选项，不写死 MARATHON 的界面。
 *
 * 新增皮肤时：这里加一项 + 新建 skins/<id>.css + 在 styles.lab.css 顶部加一行
 * @import，不需要复制几百行结构样式。id 一旦发布不要改名——本地设置按 id 记录选择。
 */
export type SkinId = "marathon" | "liquid-glass";
export type SkinMode = "light" | "dark";

export interface SkinFont {
  id: string;
  label: string;
  /** CSS font-family 值。可以引用 --app-font-*（原版字体）或写自定义字体栈。 */
  family: string;
  /** 网页端是否需要补载原版无衬线体样式表（中文回退或直接使用原版无衬线时）。 */
  needsSansStylesheet?: boolean;
}

export interface SkinAppearance {
  /** 该皮肤支持的模式；只有一个时设置页不显示模式开关。 */
  modes: SkinMode[];
  defaultMode: SkinMode;
  /** 可选的字体；至少一项，第一项由 defaultFont 指定默认。 */
  fonts: SkinFont[];
  defaultFont: string;
}

export interface Skin {
  id: SkinId;
  /** 设置页列表的显示名 */
  name: string;
  /** 迷你预览配色 */
  swatch: { base: string; ink: string; accent: string; signal: string };
  /**
   * 设置页迷你预览的样式。默认 "terminal"（终端小屏）；
   * 半透明材质皮肤用 "glass"（圆角玻璃片 + 高光）。
   */
  preview?: "terminal" | "glass";
  appearance: SkinAppearance;
}

export interface SkinPrefs {
  mode: SkinMode;
  font: string;
}

/** 按皮肤分别记住外观选择；切走再切回时恢复。 */
export type SkinPrefsMap = Partial<Record<SkinId, Partial<SkinPrefs>>>;

export const SKINS: Skin[] = [
  {
    id: "marathon",
    name: "MARATHON",
    swatch: { base: "#070a06", ink: "#e9f2d6", accent: "#d9ff44", signal: "#ff5a1f" },
    appearance: {
      modes: ["dark", "light"],
      defaultMode: "dark",
      fonts: [
        { id: "app-sans", label: "无衬线", family: "var(--app-font-sans)", needsSansStylesheet: true },
        { id: "app-serif", label: "衬线", family: "var(--app-font-serif)" },
        {
          id: "terminal",
          label: "终端体",
          family: '"Bahnschrift", "Arial Narrow", "Impact", var(--app-font-sans)',
          needsSansStylesheet: true,
        },
      ],
      defaultFont: "app-sans",
    },
  },
  {
    id: "liquid-glass",
    name: "LIQUIDGLASS",
    swatch: { base: "#141416", ink: "#f5f5f7", accent: "#a1a1aa", signal: "#48484a" },
    preview: "glass",
    appearance: {
      modes: ["dark", "light"],
      defaultMode: "light",
      fonts: [
        {
          id: "system",
          label: "系统字体",
          family:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        },
        { id: "app-sans", label: "无衬线", family: "var(--app-font-sans)", needsSansStylesheet: true },
        { id: "app-serif", label: "衬线", family: "var(--app-font-serif)" },
      ],
      defaultFont: "system",
    },
  },
];

export const DEFAULT_SKIN: SkinId = "marathon";

export function isSkinId(v: unknown): v is SkinId {
  return typeof v === "string" && SKINS.some((s) => s.id === v);
}

export function getSkin(id: SkinId): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/** 把持久化的（可能过期或不完整的）选择收敛成当前皮肤支持的合法值。 */
export function resolveSkinPrefs(skin: Skin, prefs: Partial<SkinPrefs> | undefined): SkinPrefs {
  const mode = prefs?.mode && skin.appearance.modes.includes(prefs.mode) ? prefs.mode : skin.appearance.defaultMode;
  const font = prefs?.font && skin.appearance.fonts.some((f) => f.id === prefs.font)
    ? prefs.font
    : skin.appearance.defaultFont;
  return { mode, font };
}
