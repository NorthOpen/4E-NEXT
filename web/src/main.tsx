import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initRipple } from "./lib/ripple";
import { initOverlayLock } from "./lib/overlayLock";
import "./styles.css";
// 增补样式（私设页 v2、导出分组）独立成文件，避免整份覆盖 styles.css 时被一并丢失
import "./styles.extra.css";
// 速览页样式（紧凑 HUD 版式）同样独立成文件
import "./styles.glance.css";
// 万律速查样式（规则页词条检索与阅读）
import "./styles.rules.css";
// 教学模式（聚光灯分步引导）与设置页「本地数据」板块
import "./styles.tutorial.css";
// 手机端版面（底部导航 + 车卡页顶部胶囊分组）：必须最后导入，才能覆盖 styles.css 的手机端规则
import "./styles.mobile.css";

// 正文字体（Chiron Sung）：index.html 里用 rel="preload" 提前取，这里切成真正的样式表。
// 为什么不在标签上写 onload="this.rel='stylesheet'"：那属于内联事件处理器，会被 CSP 的
// script-src 'self' 拦掉（见 web/public/_headers 与 vite.config.ts 里注入的 meta CSP）。
// 桌面端构建会剔除这条 link（字体已内置），查询落空即不做任何事。
const fontPreload = document.querySelector<HTMLLinkElement>("link[data-font-preload]");
if (fontPreload) {
  const fontSheet = document.createElement("link");
  fontSheet.rel = "stylesheet";
  fontSheet.href = fontPreload.href;
  fontSheet.crossOrigin = "anonymous";
  document.head.appendChild(fontSheet);
}

initRipple();
initOverlayLock();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
