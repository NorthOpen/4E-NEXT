// 自定义弹层（.picker-overlay / .crop-overlay / .tour-root）打开期间锁定页面滚动，
// 与原生 <dialog>.showModal() 的模态行为保持一致（md-dialog 由浏览器原生处理，无需此逻辑）。
// 通过 MutationObserver 计数当前打开的弹层数量，最后一个关闭时恢复滚动。
// 教学模式（.tour-root）也走这条路径：它同样要求「背后那一页不许动」，
// 光斑位置按打开那一刻算好，背景一滚就对不上了。
const OVERLAY_SELECTOR = ".picker-overlay, .crop-overlay, .tour-root";

let locks = 0;

function apply(): void {
  const html = document.documentElement;
  if (locks > 0) {
    html.style.overflow = "hidden";
    html.style.scrollbarGutter = "stable"; // 隐藏滚动条时保持版心不跳动
  } else {
    html.style.overflow = "";
    html.style.scrollbarGutter = "";
  }
}

export function initOverlayLock(): void {
  const observer = new MutationObserver((mutations) => {
    // 仅关注节点增删（忽略属性/文本变化，避免高频无效查询）
    if (!mutations.some((m) => m.addedNodes.length > 0 || m.removedNodes.length > 0)) return;
    const count = document.querySelectorAll(OVERLAY_SELECTOR).length;
    if (count === locks) return;
    locks = count;
    apply();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
