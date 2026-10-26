# Hyalite（vendored）

- 上游：https://github.com/VII-Cae/hyalite--liquid-glass
- 版本：0.5.0
- 许可：MIT（见 LICENSE-hyalite.txt，版权归 VII-Cae）
- 文件：`hyalite.js` 原样引入，只做版本锁定，不修改。

## 为什么引入

LIQUIDGLASS 的边缘折射需要按元素尺寸/圆角生成 SDF 位移图，再挂到
`backdrop-filter: url(#…)`。Hyalite 用 51KB 的单文件实现了这件事，并提供
`Hyalite.watch(root, selector, opts)` / `attach(el)`，不需要包裹 DOM，适合接进
现有的全局皮肤。

## 使用范围

只在 `liquid-glass` 皮肤启用时、且只在**会从内容上方浮起来的表面**上启用：

- `.mob-nav` / `.mob-tabsbar`（内容会从下方滚过）
- `.picker-dialog` / `.crop-dialog` / `md-dialog.sheet-dialog`（背后是车卡内容）

大面板（`.sheet .block`）不启用：它们的背景通常是纯色，折射没有可弯折的内容，
启用只会增加每帧的渲染面。未启用或不支持时，CSS 的 `--hyalite` fallback 仍然是
皮肤自己的材质。

## 浏览器

- Chromium（Chrome / Edge / Electron / 现代 Android WebView）：真实折射。
- Safari / Firefox：`Hyalite.supported()` 为 false，不 attach；CSS 回落到
  `var(--skin-mat-*)` 的材质与边缘。
- 脚本用 `?url` 作为独立 asset 动态加载，不进入主 bundle；CSP 的
  `script-src 'self'` 与 `img-src data:` 已覆盖它生成的 SVG filter 和位移图。
