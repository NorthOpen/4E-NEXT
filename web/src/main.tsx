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
// 手机端版面（底部导航 + 车卡页顶部胶囊分组）：必须最后导入，才能覆盖 styles.css 的手机端规则
import "./styles.mobile.css";

initRipple();
initOverlayLock();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
