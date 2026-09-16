import { platform } from "@platform";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { seedHexToTheme, themeToCssVars, applyCssVars, imageToSeedHex, type SeedMode } from "./theme";
import { downscaleImage } from "./lib/image";
import { loadSettings, saveSettings, prepareImageForStore, BG_CACHE_KEY, loadBgCacheMarker, saveBgCacheMarker } from "./lib/settings";
import { cachePutImage, cacheGetImage, cacheDeleteImage } from "./lib/imageCache";

export type BgMode = "off" | "portrait" | "custom";
export type FontMode = "serif" | "sans";

interface ThemeContextValue {
  seedMode: SeedMode;
  seedHex: string;
  presetHex: string;
  portraitHex: string;
  bgHex: string;
  isDark: boolean;
  setSeedMode: (m: SeedMode) => void;
  setSeedHex: (h: string) => void;
  setPresetHex: (h: string) => void;
  setDark: (d: boolean) => void;
  portraitOriginal: string | null;
  portraitCropped: string | null;
  setPortrait: (original: string, cropped: string) => Promise<void>;
  applyPortrait: (original: string | null, cropped: string | null) => Promise<void>;
  clearPortrait: () => void;
  bgMode: BgMode;
  bgCustom: string | null;
  setBgMode: (m: BgMode) => void;
  setBgCustom: (url: string | null) => void;
  bgImage: string | null;
  bgBlur: number;
  bgFeather: number;
  setBgBlur: (v: number) => void;
  setBgFeather: (v: number) => void;
  fontMode: FontMode;
  setFontMode: (m: FontMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DEFAULT_SEED = "#5e81ac"; // Nord 冰霜

// 首次渲染前读取一次持久化设置，避免刷新闪回默认主题
const INITIAL_SETTINGS = typeof window !== "undefined" ? loadSettings() : null;

async function extractHexFromUrl(url: string): Promise<string> {
  // 先缩到 512px 内，避免大图 canvas 内存超限
  const small = await downscaleImage(url, 512);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = small;
  });
  return imageToSeedHex(img);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [seedMode, setSeedMode] = useState<SeedMode>(INITIAL_SETTINGS?.seedMode ?? "preset");
  const [seedHex, setSeedHex] = useState(INITIAL_SETTINGS?.seedHex ?? DEFAULT_SEED);
  const [presetHex, setPresetHex] = useState(INITIAL_SETTINGS?.presetHex ?? DEFAULT_SEED);
  const [portraitHex, setPortraitHex] = useState(DEFAULT_SEED);
  const [bgHex, setBgHex] = useState(DEFAULT_SEED);
  const [isDark, setDark] = useState(INITIAL_SETTINGS?.isDark ?? false);
  const [portraitOriginal, setPortraitOriginal] = useState<string | null>(null);
  const [portraitCropped, setPortraitCropped] = useState<string | null>(null);
  const [bgMode, setBgMode] = useState<BgMode>(INITIAL_SETTINGS?.bgMode ?? "off");
  const [bgCustom, setBgCustom] = useState<string | null>(null);
  const [bgBlur, setBgBlur] = useState(INITIAL_SETTINGS?.bgBlur ?? 2);
  const [bgFeather, setBgFeather] = useState(INITIAL_SETTINGS?.bgFeather ?? 55);
  const [fontMode, setFontModeState] = useState<FontMode>(INITIAL_SETTINGS?.fontMode ?? "serif");

  const bgImage = useMemo(() => {
    if (bgMode === "portrait") return portraitOriginal;
    if (bgMode === "custom") return bgCustom;
    return null;
  }, [bgMode, portraitOriginal, bgCustom]);

  useEffect(() => {
    if (!bgImage) return;
    let cancelled = false;
    void extractHexFromUrl(bgImage)
      .then((h) => { if (!cancelled) setBgHex(h); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [bgImage]);

  const activeHex = useMemo(() => {
    if (seedMode === "picker") return seedHex;
    if (seedMode === "portrait") return portraitHex;
    if (seedMode === "background") return bgHex;
    return presetHex;
  }, [seedMode, seedHex, portraitHex, bgHex, presetHex]);

  const theme = useMemo(() => seedHexToTheme(activeHex), [activeHex]);

  useEffect(() => {
    applyCssVars(themeToCssVars(theme, isDark));
    // 原生控件（color 选择器、滚动条等）随明暗切换
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  }, [theme, isDark]);

  // 应用立绘到主题（不写本地存储；立绘随人物卡由 App 同步存档）
  const portraitVersion = useRef(0);
  async function applyPortrait(original: string | null, cropped: string | null) {
    const v = ++portraitVersion.current; // 竞态保护：快速切换卡片时丢弃过期取色结果
    if (!original) {
      setPortraitOriginal(null);
      setPortraitCropped(null);
      setPortraitHex(DEFAULT_SEED);
      return;
    }
    setPortraitOriginal(original);
    setPortraitCropped(cropped);
    try {
      const h = await extractHexFromUrl(original);
      if (portraitVersion.current === v) setPortraitHex(h);
    } catch (e) {
      console.error(e);
    }
  }

  // 上传/裁切确认：压缩后应用（压缩后的立绘随卡存档）
  async function setPortrait(original: string, cropped: string) {
    const [o, c] = await Promise.all([prepareImageForStore(original), prepareImageForStore(cropped)]);
    await applyPortrait(o, c);
  }

  function clearPortrait() {
    applyPortrait(null, null);
  }

  function setFontMode(m: FontMode) {
    setFontModeState(m);
  }

  // 背景自定义图：压缩后写入 IndexedDB 缓存，localStorage 只存「读取路径」（缓存键）；
  // IndexedDB 不可用时回退为直接把 data URL 存进 localStorage（仍只存一份路径）
  function setBgCustomPersist(url: string | null) {
    if (url === null) {
      setBgCustom(null);
      saveBgCacheMarker(null);
      void cacheDeleteImage(BG_CACHE_KEY);
      return;
    }
    void prepareImageForStore(url).then((small) => {
      setBgCustom(small);
      void cachePutImage(BG_CACHE_KEY, small)
        .then(() => saveBgCacheMarker(BG_CACHE_KEY))
        .catch(() => saveBgCacheMarker(small));
    });
  }

  // 字体切换：html[data-font] 驱动 CSS 变量。
  // 网页端：无衬线体是第二张 CDN 样式表，它自带全局 body 字体规则，
  //   切回衬线体时必须移除，否则其规则会持续把 body/卡片字体覆盖为无衬线体。
  // 桌面端：两支字体都随产物内置，platform.fonts.sansStylesheet 为 null，这里什么也不插。
  useEffect(() => {
    document.documentElement.dataset.font = fontMode;
    const existing = document.querySelector('link[data-4enext-font="sans"]');
    const extra = platform.fonts.sansStylesheet;
    if (fontMode === "sans" && extra) {
      if (!existing) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = extra.href;
        if (extra.crossOrigin) link.crossOrigin = "anonymous";
        link.dataset["4enextFont"] = "sans";
        document.head.appendChild(link);
      }
    } else if (existing) {
      existing.remove();
    }
  }, [fontMode]);

  // 非图片设置变化时持久化
  useEffect(() => {
    saveSettings({ seedMode, seedHex, presetHex, isDark, bgMode, bgBlur, bgFeather, fontMode });
  }, [seedMode, seedHex, presetHex, isDark, bgMode, bgBlur, bgFeather, fontMode]);

  // 挂载时从缓存恢复背景：localStorage 里只存路径（缓存键或回退 data URL）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const marker = loadBgCacheMarker();
        if (!marker) return;
        let url: string | null = null;
        if (marker === BG_CACHE_KEY) {
          url = await cacheGetImage(BG_CACHE_KEY);
        } else if (marker.startsWith("data:")) {
          url = marker; // IndexedDB 失败时的回退：data URL 即路径
        }
        // 旧版（4enext.bgCustom.v1 直接存 data URL）一次性迁移到缓存
        if (!url) {
          const legacy = platform.storage.getItem("4enext.bgCustom.v1");
          if (legacy) {
            url = legacy;
            void cachePutImage(BG_CACHE_KEY, legacy).catch(() => {});
            saveBgCacheMarker(BG_CACHE_KEY);
            try { platform.storage.removeItem("4enext.bgCustom.v1"); } catch { /* 忽略 */ }
          }
        }
        if (!cancelled && url) setBgCustom(url);
      } catch {
        /* 忽略 */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: ThemeContextValue = {
    seedMode, seedHex, presetHex, portraitHex, bgHex, isDark,
    setSeedMode, setSeedHex, setPresetHex, setDark,
    portraitOriginal, portraitCropped, setPortrait, applyPortrait, clearPortrait,
    bgMode, bgCustom, setBgMode, setBgCustom: setBgCustomPersist, bgImage,
    bgBlur, bgFeather, setBgBlur, setBgFeather,
    fontMode, setFontMode,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return ctx;
}
