# 全局皮肤（Skin）实现约定

## 概念

皮肤是**整个应用的全局外观替换**，不是车卡页专属样式。启用后 App 在 `<html>` 上挂
`data-skin="<id>"`，所有页面、导航壳以及 portal 到 `body` 的对话框共享同一套颜色、
形状与字体令牌；关闭即摘除属性，原版外观完全恢复。

皮肤只改外观，不改布局与交互逻辑。车卡页仍然是结构最完整的参考页面，但皮肤本身不
绑定 `view === "sheet"`。

当前两套皮肤：`marathon`（显示名 MARATHON）与 `liquid-glass`（显示名 LIQUIDGLASS）。
两者各自定义完整的调色板与材质 token，互不继承 —— LIQUIDGLASS 不引用 MARATHON 的任何色值。

| id | 显示名 | 模式 | 列表预览 | 文件 |
|---|---|---|---|---|
| `marathon` | MARATHON | 深 / 浅 | `terminal` | `skins/marathon.css` |
| `liquid-glass` | LIQUIDGLASS | 深 / 浅 | `glass` | `skins/liquid-glass.css` |

## 覆盖范围

共享结构层目前覆盖车卡页、导航壳、对话框与浮层；设置页、速览、规则页等其余页面
只通过 MD3 色板与形状 token 继承颜色和圆角，不套用材质（填充、模糊、阴影）。
MD3 组件（如 `md-filled-text-field`）的底色画在 shadow DOM 里，共享层在宿主上重写
`--md-filled-field-*` / `--md-outlined-field-*`，让它们跟着皮肤走。

LIQUIDGLASS 另外把 `--skin-container-*` 调成半透明，于是所有使用 MD3 container 色的表面
（金钱块、设置页板块、表头）都会透出背景；设置页仍不套 blur。如果之后要给全站加
材质，在共享层补通用 `.block` / `.card` 规则即可。

## 数据与开关

- 注册表：`web/src/lab/skins.ts`
  - `SkinId`：皮肤 id 的联合类型。
  - `SKINS`：设置页列表用的元数据（名称、迷你预览配色、可调项）。
  - `preview`：设置页迷你预览的款式，`"terminal"`（默认，终端小屏）或
    `"glass"`（圆角玻璃片 + 高光）。
  - `appearance`：该皮肤支持的深浅模式、默认模式、字体列表、默认字体。
  - `DEFAULT_SKIN`、`isSkinId()`、`getSkin()`、`resolveSkinPrefs()`。
- 设置：`web/src/lib/settings.ts`
  - `labMode: "off" | "fx" | "skin"` 控制实验室两项功能互斥。
  - `skinId` 记住上次选中的皮肤；关闭皮肤后仍保留。
  - `skinPrefs` 按皮肤分别保存深浅模式与字体，切走再切回时恢复。
  - 旧字段 `sheetSkin` 只在读取时做一次迁移，之后写回 `skinId`。
- 应用：`web/src/App.tsx`
  - `labSkin &&` 时写入 `data-skin="<id>"`、`data-skin-mode="light|dark"`，并把
    当前字体写到 `<html>` 的内联 `--skin-font-family`。
  - 使用 `useLayoutEffect`，首帧绘制前完成，避免闪一帧原版配色。
- 设置页：
  - 皮肤关闭时显示原版「外观设置」「背景」。
  - 皮肤开启时隐藏这两个板块，显示「实验性外观设置」；控件由当前皮肤的
    `appearance` 生成，不写死 MARATHON 的选项。

## 样式分层

皮肤样式分四层（第 4 层可选）：

- `web/src/lab/skins/<id>.css`：每种皮肤一个文件，定义调色板与材质（第 1、2 层）；
- `web/src/styles.lab.css`：共享结构层与 MARATHON 的装饰（第 3、4 层），文件顶部
  用 `@import` 统一导入所有皮肤文件。

### 1. 调色板层（每种皮肤一份）

```css
html[data-skin="marathon"] {
  --skin-void: #040603;
  --skin-bg: #050704;
  --skin-surface: #070a05;
  /* ... */
  --skin-corner-xs: 0px;
}
```

这一层只定义 token，不写组件选择器。新增皮肤时复制这一层、换色值即可。
支持多种模式的皮肤，再写一个 `[data-skin-mode="<mode>"]` 的覆盖块，例如
`html[data-skin="marathon"][data-skin-mode="light"] { ... }`。

### 2. 材质层（每种皮肤一份）

决定「表面质感」的一组 token：填充、模糊、叠纹、描边、分隔线、阴影、辉光与圆角。
MARATHON 把它们全部映射回不透明面板和 0 圆角，所以视觉与引入材质层之前完全一致；
换皮肤时只改这一组，共享结构层不用动。

```css
html[data-skin="marathon"] {
  --skin-mat-fill: var(--skin-panel);       /* 面板填充，可半透明 */
  --skin-mat-filter: none;                  /* 面板 backdrop-filter */
  --skin-mat-chrome: var(--skin-bg);        /* 导航壳填充 */
  --skin-mat-chrome-filter: none;
  --skin-mat-float-fill: var(--skin-panel); /* 对话框/浮层填充 */
  --skin-mat-float-filter: none;
  --skin-mat-wash: ...;                     /* 面板叠纹（扫描线/高光渐变） */
  --skin-mat-border: 1px solid var(--skin-line);
  --skin-mat-edge: 2px solid var(--skin-accent-dim);
  --skin-mat-divider: 1px dashed var(--skin-line);
  --skin-mat-field-container: var(--skin-container-highest); /* MD3 填充字段底色 */
  --skin-mat-title-color: var(--skin-accent);
  --skin-mat-label-color: var(--skin-accent);
  --skin-mat-value-color: var(--skin-accent);
  --skin-mat-rim: ...;                      /* 阴影 + 内描边 */
  --skin-mat-glow-title: ...;
  --skin-corner-m: 0px;                     /* 形状也归这一层 */
}
```

半透明皮肤（玻璃、亚克力）把 `--skin-mat-fill` 写成带 alpha 的颜色、把
`--skin-mat-filter` 写成 `blur(24px) saturate(180%)` 即可；共享层已经为面板、
导航壳、浮层分别补好 `-webkit-backdrop-filter` 与 `backdrop-filter`。

标题、标签、数值的颜色也归这一层：`--skin-mat-title-color` / `-label-color` /
`-value-color`。MARATHON 三者都等于 `--skin-accent`；玻璃皮肤改成墨色与弱化色，
避免整页文字都吃同一个强调色。

MD3 组件的内部样式画在 shadow DOM 里，皮肤选择器进不去。共享层已经在宿主上重写
`--md-filled-field-container-color`、`--md-outlined-field-outline-color` 等组件
token；新增皮肤只要提供 `--skin-mat-field-container`、`--skin-mat-field-outline`
就能一起变。

### 3. 共享结构层（所有皮肤共用）

```css
html[data-skin] body {
  --md-sys-color-primary: var(--skin-primary);
  /* ... 把 --skin-* 映射到 MD3 角色 ... */
}

html[data-skin] .sheet .block {
  background-color: var(--skin-mat-fill);
  border-radius: var(--skin-corner-m);
  backdrop-filter: var(--skin-mat-filter);
  /* ... 只消费材质 token，不写死色值和圆角 ... */
}
```

共享层不出现具体色值，只消费 `--skin-*` 与 `--skin-mat-*`；半透明、模糊、圆角、
分隔线都从材质层取值。新增皮肤不需要复制这些选择器。

### 4. 皮肤专属装饰（可选）

条码、`//` 标题前缀、`UESC // RUNNER DOSSIER`、`TAU CETI IV` 之类的品牌文字，写在
`html[data-skin="<id>"]` 下。另一种皮肤如果没有这些元素，就不会继承它们。

半透明材质也可以用皮肤专属的伪元素做边缘镜面：LIQUIDGLASS 的 `--glass-ring` 配合
`.sheet .block::before` / 对话框的 `::before`，用 `mask-composite` 只保留 1px 环。
这类选择器与变量必须挂在 `html[data-skin="<id>"]` 下，旧内核不支持时自动退回
`--skin-mat-rim` 的 inset 高光。

## 字体契约

`appearance.fonts` 是字符串 id + 显示名 + CSS font-family：

```ts
fonts: [
  { id: "app-sans", label: "无衬线", family: "var(--app-font-sans)", needsSansStylesheet: true },
  { id: "app-serif", label: "衬线", family: "var(--app-font-serif)" },
  { id: "terminal", label: "终端体", family: '"Bahnschrift", var(--app-font-sans)', needsSansStylesheet: true },
]
```

- 原版字体通过 `--app-font-sans`、`--app-font-serif` 引用；`--app-font-plain` 会跟随
  用户原版的「衬线 / 无衬线」模式。
- 皮肤也可以写任意自定义字体栈。若需要新的 webfont，在该皮肤的 CSS 里补
  `@font-face`（或后续接入的字体样式表）。
- `needsSansStylesheet: true` 表示网页端即使原版处于衬线模式，也要补载原版无衬线
  字体样式表（用于直接使用无衬线，或作为中文回退）。
- 设置页在字体列表 > 1 时显示分段选择；当前皮肤的默认字体由 `defaultFont` 决定。
  MARATHON 默认 `app-sans`，即原版无衬线体。
- 字距与标题字重也走皮肤 token：`--skin-track-scale`（默认 1；终端风保留宽字距，
  玻璃类皮肤设 0 即可整体收紧）、`--skin-title-weight`（MARATHON 为 700）。

## 材质与背景的硬约束

- **材质要自足，不能靠彩色背景。** iOS 的玻璃在纯色底上也成立：先把高光边、内阴影、
  纵向渐变与投影做出来，环境层只是可选增强。LIQUIDGLASS 把 `--skin-mat-ambient` /
  `--skin-mat-canvas` 设为 none，靠 `--skin-mat-wash`、`--skin-mat-rim` 与皮肤专属的
  `--glass-ring`（边缘镜面环）立起来，深色和浅色都在纯色底上验收。
- **导出只带捕获子树里的背景。** 角色卡导出用 html-to-image 序列化 `captureRef`
  子树，`backdrop-filter` 只对子树内的背景采样。实测：背景在 `body` 上时，导出图里
  的玻璃退化成平灰；背景在 `.sheet` 上时模糊能保留。因此需要环境层的皮肤要么把
  背景放进 `.sheet`，要么在导出期间给 `<html>` 挂 `data-exporting` 并回退成不透明
  填充。LIQUIDGLASS 的环境层是 none，导出背景为 body 底色，面板材质自身仍完整渲染。
- **`backdrop-filter: url(#filter)` 需要真正的位移图。** 用 SDF 生成的 R/G 位移图
  （见下面的 Hyalite）时，Chromium 会真实弯折背景；拿 `feTurbulence` 当位移图只会
  得到噪点。Safari / Firefox 不支持 URL 型 backdrop filter，必须写两行回落。
- **模糊只给浮起来的表面。** 导航壳、顶栏、对话框、浮层用 `backdrop-filter`；
  内容面板用半透明填充 + 亮边即可。整页卡片都开模糊会让安卓 WebView 滚动掉帧。
- **`backdrop-filter` 会创建包含块。** 容器内的 `position: fixed` 浮层会改以该
  容器为基准定位；现有弹窗基本已 portal 到 body，新增浮层时要留意。
- 半透明皮肤要单独检查正文对比度（4.5:1）与浅色模式，必要时在半透明层里加
  一层底色或模糊遮罩。

## 可选运行时：Hyalite 透镜

LIQUIDGLASS 的浮层（对话框、移动底栏/顶栏）会动态加载 vendored 的
[Hyalite](https://github.com/VII-Cae/hyalite--liquid-glass)（MIT，v0.5.0，51KB），
按元素尺寸与圆角生成 SDF 位移图，通过 `backdrop-filter: url(#…)` 做真实边缘折射。

- 启动：`App.tsx` 的 effect → `lab/glassLens.ts`，用 `?url` 作为独立 asset 动态
  加载，非玻璃皮肤不产生任何开销。
- 挂载范围：`.picker-dialog`、`.crop-dialog`、`md-dialog.sheet-dialog`、
  `.mob-nav`、`.mob-tabsbar`。**不要挂到 `.sheet .block`**：纯色背景下没有可折的
  内容，实测只会变成厚灰板 + 脏边。
- 回落：脚本未加载或 `Hyalite.supported()` 为 false 时，CSS 的
  `var(--hyalite, …)` / `var(--hyalite-edge, …)` 自动回到皮肤自己的材质。
- 许可：`web/src/lab/vendor/LICENSE-hyalite.txt`；上游版本与使用范围见同目录
  `README.md`。升级时整文件替换，不要改 vendored 源码。

## 新增皮肤清单

1. 在 `SkinId` 联合类型里加 id（如 `"noir"`），并在 `SKINS` 里加一项元数据。
2. 在 `appearance` 里声明 `modes`、`defaultMode`、`fonts`、`defaultFont`；
   半透明材质皮肤再设 `preview: "glass"`（默认 `"terminal"`）。
3. 新建 `web/src/lab/skins/noir.css`，在里面写 `html[data-skin="noir"] { ... }`；如果
   支持浅色模式，再补 `html[data-skin="noir"][data-skin-mode="light"] { ... }`，并在
   `styles.lab.css` 顶部加一行 `@import "./lab/skins/noir.css";`。新皮肤必须写全自己那份
   token，不要依赖其它皮肤的值。
4. 至少定义下列 token（共享结构依赖它们）：
   - 背景/面板：`--skin-void`、`--skin-bg`、`--skin-surface`、`--skin-surface-variant`、
     `--skin-bright`、`--skin-container-lowest/low/base/high/highest`、
     `--skin-panel/panel-2/panel-3`
   - 文本：`--skin-ink`、`--skin-muted`、`--skin-on-surface-variant`
   - 线条：`--skin-line`、`--skin-line-soft`、`--skin-outline`、`--skin-outline-variant`
   - MD3 角色：`--skin-primary/on-primary/primary-container/on-primary-container`，
     secondary / tertiary / error 四组，`--skin-inverse-primary`
   - 强调：`--skin-accent`、`--skin-accent-fill`、`--skin-accent-dim`、`--skin-signal`、
     `--skin-on-accent`、`--skin-on-accent-muted`
   - 遮罩：`--skin-scrim`
   - 字体：`--skin-font-family`（默认值），共享层自动派生 body/display/mono；需要
     分角色字体时再单独覆盖 `--skin-font-body/display/mono`
   - 形状：`--skin-corner-xs/s/m/l/xl`、`--skin-corner-pill`（胶囊圆角）
   - 排版：`--skin-track-scale`、`--skin-title-weight`
   - 材质：`--skin-mat-fill/fill-2/fill-3`、`--skin-mat-filter`、`--skin-mat-chrome`、
     `--skin-mat-chrome-filter`、`--skin-mat-float-fill`、`--skin-mat-float-filter`、
     `--skin-mat-field`、`--skin-mat-border`、`--skin-mat-edge`、`--skin-mat-topbar-edge`、
     `--skin-mat-divider`、`--skin-mat-card-head-line`、`--skin-mat-on-accent-line`、
     `--skin-mat-field-container`、`--skin-mat-field-outline`、`--skin-mat-mini-top`、
     `--skin-mat-ability-top`、`--skin-mat-render-edge`、`--skin-mat-float-border-color`、
     `--skin-mat-title-color`、`--skin-mat-label-color`、`--skin-mat-value-color`、
     `--skin-mat-wash`、`--skin-mat-wash-strong`、
     `--skin-mat-wash-dialog`、`--skin-mat-wash-dialog-size`、`--skin-mat-ambient`、
     `--skin-mat-canvas`、`--skin-mat-canvas-size`、`--skin-mat-rim`、`--skin-mat-pop-rim`、
     `--skin-mat-float-rim`、`--skin-mat-portrait-rim`、`--skin-mat-glow-title`、
     `--skin-mat-glow-value`、`--skin-mat-glow-active`、`--skin-mat-glow-rail`
   - 色彩模式：`--skin-color-scheme`（`dark` / `light`）
5. 若皮肤有独特的品牌装饰，再写 `html[data-skin="noir"] ...` 的少量选择器。
6. 检查对比度（正文 4.5:1、UI 边界 3:1）和手机端布局；浅色模式要单独检查。
   半透明皮肤另按「材质与背景的硬约束」检查导出与滚动性能。
7. 不要改布局尺寸、交互逻辑或 `CharacterSheet` 的结构；皮肤应只通过 token 与
   CSS 选择器接入。

## 兼容性规则

- **id 是持久化契约**：一旦发布不要改名，用户本地设置按 id 记录。下架皮肤时保留
  `isSkinId()` 的回落逻辑，旧 id 自动落到 `DEFAULT_SKIN`。
- **皮肤之间不共享值**：新皮肤必须自带完整的调色板与材质 token，不能引用另一个
  皮肤定义的值；共享的只有共享结构层里的 token 名和语义。
- 新增字段优先走 `--skin-*` token，而不是在共享层写死某个皮肤的颜色。
- 皮肤专属样式必须挂在 `html[data-skin="<id>"]` 下，避免影响其它皮肤。
- 全局皮肤不依赖具体页面；如果某个页面需要专属适配，优先复用共享 token，
  再在共享层加通用选择器，而不是只给 `data-skin` 写页面分支。
- 调色板与材质已经按皮肤拆分到 `web/src/lab/skins/<id>.css`；新增皮肤只加文件与
  `@import`，共享结构层保持不变。
