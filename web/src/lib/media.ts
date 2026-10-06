// 手机端断点（≤768px）与「有没有悬停能力」的统一入口。
//
// App 外壳（左侧导航轨 ↔ 底部导航）与车卡页（整页长滚动 ↔ 顶部胶囊分组）都要用同一个判断，
// 各写一份 matchMedia 会在横竖屏切换的瞬间出现两处状态不一致，因此收在这里。
//
// 另外两件事也一并放在这里：
//   · useSheetPopovers —— 桌面上靠 :hover 弹出的预览卡片（SmartHover 那一套）在触屏上
//     要么根本不出现，要么被祖先的 overflow 裁掉、或横向超出视口。这类设备要改走底部卡片；
//   · matchMedia 实例按 query 缓存 —— SmartHover 在页面里有近百个实例，
//     每个都自己 new 一个 MediaQueryList 会白白挂上近百个等价监听器。

import { useEffect, useState } from "react";

/** 与 styles.mobile.css 中的手机端断点保持一致 */
export const MOBILE_QUERY = "(max-width: 768px)";

/** 没有悬停能力的输入设备（手机 / 平板）。
    只把桌面浏览器窗口拖窄时 hover 仍是 hover，所以它不会把鼠标用户误判成触屏。 */
export const NO_HOVER_QUERY = "(hover: none)";

/** 该用底部卡片替代悬停浮层的设备：手机版面，或压根没有悬停能力的输入设备。
    媒体查询列表是「或」的关系，任一成立即命中。 */
export const SHEET_POPOVER_QUERY = MOBILE_QUERY + ", " + NO_HOVER_QUERY;

const mqlCache = new Map<string, MediaQueryList>();

function sharedMql(query: string): MediaQueryList {
  let m = mqlCache.get(query);
  if (!m) {
    m = window.matchMedia(query);
    mqlCache.set(query, m);
  }
  return m;
}

/** 订阅一条媒体查询；横竖屏切换 / 窗口缩放 / 输入设备变化时自动跟随。 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(
    () => typeof window !== "undefined" && sharedMql(query).matches
  );

  useEffect(() => {
    const mq = sharedMql(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // 首帧到 effect 挂载之间状态可能已经翻转过，这里补一次同步
    setMatches(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** 是否处于手机版面；横竖屏切换、窗口缩放时自动跟随。 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

/**
 * 当前输入设备有没有悬停能力。
 * 用它区分「鼠标 + 悬停」与「手指 + 触摸」两套交互，比按宽度判断更准：
 * 平板、触屏笔记本都算没有悬停。
 */
export function useNoHover(): boolean {
  return useMediaQuery(NO_HOVER_QUERY);
}

/** 是否该把「悬停浮层」换成「底部卡片」。 */
export function useSheetPopovers(): boolean {
  return useMediaQuery(SHEET_POPOVER_QUERY);
}
