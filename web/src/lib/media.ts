// 手机端断点（≤768px）统一入口。
//
// App 外壳（左侧导航轨 ↔ 底部导航）与车卡页（整页长滚动 ↔ 顶部胶囊分组）都要用同一个判断，
// 各写一份 matchMedia 会在横竖屏切换的瞬间出现两处状态不一致，因此收在这里。

import { useEffect, useState } from "react";

/** 与 styles.mobile.css 中的手机端断点保持一致 */
export const MOBILE_QUERY = "(max-width: 768px)";

/** 是否处于手机版面；横竖屏切换、窗口缩放时自动跟随。 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}
