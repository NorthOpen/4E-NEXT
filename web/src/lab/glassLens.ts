/**
 * LIQUIDGLASS · Hyalite 真实透镜。
 *
 * 只在 liquid-glass 皮肤启用时、且只在会从内容上方浮起来的表面（移动底栏/顶栏、
 * 对话框）上挂载。Hyalite 会为每个元素生成 SDF 位移图并写 `--hyalite` /
 * `--hyalite-edge`；不支持 SVG backdrop filter 的浏览器（Safari/Firefox）直接
 * 不挂载，CSS 的 `var(--hyalite, …)` 回落成皮肤自己的材质。
 *
 * 为什么不用在 .sheet .block：大面板背后通常是纯色，折射没有可弯折的内容，
 * 却会让每个面板都变成一个渲染面。真实折射只在「内容从玻璃下经过」时有意义。
 */
import hyaliteUrl from "./vendor/hyalite.js?url";
import type { SkinMode } from "./skins";

interface HyaliteAPI {
  attach(el: Element, opts?: Record<string, unknown>): void;
  detach(el: Element): void;
  watch(root: Element, selector: string, opts?: Record<string, unknown>): { stop(): void };
  supported(): boolean;
  force(v: boolean | null): boolean;
  version: string;
}

declare global {
  interface Window {
    Hyalite?: HyaliteAPI;
  }
}

const DIALOG_DARK = {
  bevel: 32,
  thickness: 48,
  slope: 1.3,
  shape: "squircle",
  blur: 5,
  dispersion: 1.8,
  shade: 0.4,
  rim: 2.1,
  edgeW: 14,
  edge: 0.5,
  light: -140,
  smooth: 1,
  sat: 0.92,
};

const DIALOG_LIGHT = {
  ...DIALOG_DARK,
  blur: 6,
  dispersion: 1.3,
  shade: 0.22,
  rim: 1.6,
  edge: 0.32,
};

const BAR_DARK = {
  bevel: 18,
  thickness: 28,
  slope: 1.2,
  shape: "squircle",
  blur: 6,
  dispersion: 1.6,
  shade: 0.42,
  rim: 2.2,
  edgeW: 12,
  edge: 0.55,
  light: -90,
  smooth: 1,
  sat: 0.95,
};

const BAR_LIGHT = {
  ...BAR_DARK,
  blur: 8,
  dispersion: 1.2,
  shade: 0.24,
  rim: 1.6,
  edge: 0.32,
};

let loading: Promise<HyaliteAPI | null> | null = null;

/** 用独立 asset 加载 Hyalite（只在第一次启用玻璃皮肤时发生）。 */
function loadHyalite(): Promise<HyaliteAPI | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.Hyalite) return Promise.resolve(window.Hyalite);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = hyaliteUrl;
    script.async = true;
    script.onload = () => resolve(window.Hyalite ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * 启动透镜。返回一个同步的清理函数；皮肤关闭、深浅切换或组件卸载时调用。
 * 重复调用是安全的：Hyalite 的 watch 会各自持有自己的 stop。
 */
export async function startGlassLens(mode: SkinMode): Promise<() => void> {
  const api = await loadHyalite();
  if (!api || !api.supported()) return () => {};
  const dark = mode === "dark";
  try {
    const stops = [
      api.watch(
        document.body,
        ".picker-dialog, .crop-dialog, md-dialog.sheet-dialog",
        dark ? DIALOG_DARK : DIALOG_LIGHT,
      ),
      api.watch(document.body, ".mob-nav, .mob-tabsbar", dark ? BAR_DARK : BAR_LIGHT),
    ];
    return () => {
      for (const stop of stops) stop.stop();
    };
  } catch (err) {
    // 滤镜/选择器异常不应影响皮肤本身；CSS fallback 仍然是完整的
    console.error("[glassLens] Hyalite 启动失败", err);
    return () => {};
  }
}
