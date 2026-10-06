import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { platform } from "@platform";
import { initRipple } from "./lib/ripple";
import { initOverlayLock } from "./lib/overlayLock";
import { registerNativeWriteErrorHook } from "./lib/storage";
import "./styles.css";
// 增补样式（私设页 v2、导出分组）独立成文件，避免整份覆盖 styles.css 时被一并丢失
import "./styles.extra.css";
// 速览页样式（紧凑 HUD 版式）同样独立成文件
import "./styles.glance.css";
// 万律速查样式（规则页词条检索与阅读）
import "./styles.rules.css";
// 教学模式（聚光灯分步引导）与设置页「本地数据」板块
import "./styles.tutorial.css";
// 导引模式（车卡流程新手教程）与抽卡辅助挑选
import "./styles.guide.css";
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

// 安卓端：原生写盘失败时的反向入口（详见 lib/storage.ts 里的说明）。
// 三种平台都调用它没有副作用——网页端与桌面端根本不会有原生来调。
registerNativeWriteErrorHook();

// 安卓返回键：系统返回键在 WebView 里默认直接退出应用，
// 而这套界面里所有浮层（底部卡片、选择器、私设编辑器、导引模式…）的关闭动作
// 本来就统一挂在 Escape 上（见各处 keydown 监听）。
// 于是这里把「原生返回键」翻译成一次合成的 Escape，复用同一批关闭逻辑，
// 不为安卓单独造一套导航栈——那会变成第二个真相来源。
// 桌面端与网页端不注册这个钩子，行为一个字节都不变。
if (platform.kind === "android" && typeof window !== "undefined") {
  window.__4ENEXT_ANDROID_BACK__ = () => {
    try {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return true;
    } catch {
      // 合成事件失败时返回 false，让原生侧退回「连按两次退出」的默认行为
      return false;
    }
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
