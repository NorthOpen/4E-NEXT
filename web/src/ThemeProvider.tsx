import { platform } from "@platform";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_VARIANT, applyCssVars, imageToSeedHex, schemeFromSeed, schemeToCssVars, type SeedMode, type VariantKey } from "./theme";
import { DEFAULT_SKIN, getSkin, resolveSkinPrefs, type SkinId, type SkinMode, type SkinPrefsMap } from "./lab/skins";
import { downscaleImage } from "./lib/image";
import { loadSettings, saveSettings, prepareImageForStore, BG_CACHE_KEY, loadBgCacheMarker, saveBgCacheMarker, type LabMode } from "./lib/settings";
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
  /** 当前生效的种子色（按 seedMode 从预设/自选/立绘/背景中选出） */
  activeHex: string;
  variant: VariantKey;
  setSeedMode: (m: SeedMode) => void;
  setSeedHex: (h: string) => void;
  setPresetHex: (h: string) => void;
  setDark: (d: boolean) => void;
  setVariant: (v: VariantKey) => void;
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
  /** 实验性动效（与实验性皮肤互斥） */
  labFx: boolean;
  /** 实验性全局皮肤（与实验性动效互斥） */
  labSkin: boolean;
  /** 当前选中的皮肤；关闭皮肤后仍记住，下次开启直接恢复 */
  skinId: SkinId;
  /** 当前皮肤实际生效的深浅模式与字体 */
  skinMode: SkinMode;
  skinFontId: string;
  skinFontFamily: string;
  setLabFx: (on: boolean) => void;
  setLabSkin: (on: boolean) => void;
  setSkinId: (id: SkinId) => void;
  setSkinMode: (mode: SkinMode) => void;
  setSkinFont: (fontId: string) => void;
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
  const [variant, setVariant] = useState<VariantKey>(INITIAL_SETTINGS?.variant ?? DEFAULT_VARIANT);
  const [portraitOriginal, setPortraitOriginal] = useState<string | null>(null);
  const [portraitCropped, setPortraitCropped] = useState<string | null>(null);
  const [bgMode, setBgMode] = useState<BgMode>(INITIAL_SETTINGS?.bgMode ?? "off");
  const [bgCustom, setBgCustom] = useState<string | null>(null);
  const [bgBlur, setBgBlur] = useState(INITIAL_SETTINGS?.bgBlur ?? 2);
  const [bgFeather, setBgFeather] = useState(INITIAL_SETTINGS?.bgFeather ?? 55);
  const [fontMode, setFontModeState] = useState<FontMode>(INITIAL_SETTINGS?.fontMode ?? "serif");
  // 实验室两项功能共用一个模式：开关本身由 labFx / labSkin 派生，天然互斥
  const [labMode, setLabMode] = useState<LabMode>(INITIAL_SETTINGS?.labMode ?? "off");
  const [skinId, setSkinIdState] = useState<SkinId>(INITIAL_SETTINGS?.skinId ?? DEFAULT_SKIN);
  // 每种皮肤各存一份外观选择；这里只存用户实际改过的字段，缺省值由注册表提供
  const [skinPrefs, setSkinPrefs] = useState<SkinPrefsMap>(INITIAL_SETTINGS?.skinPrefs ?? {});

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

  const scheme = useMemo(() => schemeFromSeed(activeHex, isDark, variant), [activeHex, isDark, variant]);

  useEffect(() => {
    applyCssVars(schemeToCssVars(scheme));
    // 原生控件（color 选择器、滚动条等）随明暗切换
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    // 明暗标记：CSS 里据此切换少数「非 MD3 token」的官方配色（如冒险装备表格的双色隔行）
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    // 安卓壳：系统栏图标的明暗只能由原生设置，把当前主题告诉它。
    // 网页端与桌面端没有这个对象，可选链直接跳过，行为一个字节都不变。
    window.__4ENEXT_ANDROID__?.setDarkTheme(isDark);
  }, [scheme, isDark]);

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

  // 实验室：两个开关写入同一个模式，因此开启任一都会自动关闭另一个
  const labFx = labMode === "fx";
  const labSkin = labMode === "skin";
  function setLabFx(on: boolean) {
    setLabMode(on ? "fx" : "off");
  }
  function setLabSkin(on: boolean) {
    setLabMode(on ? "skin" : "off");
  }
  function setSkinId(id: SkinId) {
    setSkinIdState(id);
  }

  // 当前皮肤的可调项：持久化值可能过期（皮肤下架/改选项），这里统一收敛到合法值
  const activeSkin = getSkin(skinId);
  const skinChoice = resolveSkinPrefs(activeSkin, skinPrefs[skinId]);
  const skinMode = skinChoice.mode;
  const skinFontId = skinChoice.font;
  const skinFont = activeSkin.appearance.fonts.find((f) => f.id === skinFontId) ?? activeSkin.appearance.fonts[0];
  const skinFontFamily = skinFont.family;

  function setSkinMode(mode: SkinMode) {
    if (!activeSkin.appearance.modes.includes(mode)) return;
    setSkinPrefs((p) => ({ ...p, [skinId]: { ...p[skinId], mode } }));
  }

  function setSkinFont(fontId: string) {
    if (!activeSkin.appearance.fonts.some((f) => f.id === fontId)) return;
    setSkinPrefs((p) => ({ ...p, [skinId]: { ...p[skinId], font: fontId } }));
  }

  // 动效只靠 html 属性驱动（styles.lab.css），不开动效时属性不存在，样式零影响。
  // 放在 layout effect 里：首帧提交前就写好，避免页面先按原版绘制、下一帧才跳成动效版。
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (labMode === "fx") root.dataset.labFx = "on";
    else delete root.dataset.labFx;
  }, [labMode]);

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
  // 全局皮肤：字体选项可以直接引用原版无衬线体，即使原版正处于衬线模式，也要把这张
  //   样式表补上，否则皮肤的「原版无衬线」会悄悄退化成系统字体。
  useEffect(() => {
    // 皮肤开启时字体由皮肤自己的外观设置决定；移除原版 data-font，避免
    // html[data-font="sans"] 的按钮/输入框规则和皮肤的字体选择互相打架。
    // --app-font-plain 仍然跟随用户原本选择的衬线/无衬线模式，供皮肤字体选项引用。
    const root = document.documentElement;
    if (labMode === "skin") {
      delete root.dataset.font;
      const follows = fontMode === "sans" ? "var(--app-font-sans)" : "var(--app-font-serif)";
      root.style.setProperty("--app-font-plain", follows);
      root.style.setProperty("--app-font-brand", follows);
    } else {
      root.dataset.font = fontMode;
      root.style.removeProperty("--app-font-plain");
      root.style.removeProperty("--app-font-brand");
    }
    const existing = document.querySelector('link[data-4enext-font="sans"]');
    const extra = platform.fonts.sansStylesheet;
    const needsSans = fontMode === "sans" || (labMode === "skin" && skinFont.needsSansStylesheet === true);
    if (needsSans && extra) {
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
  }, [fontMode, labMode, skinFont]);

  // 非图片设置变化时持久化
  useEffect(() => {
    saveSettings({ seedMode, seedHex, presetHex, variant, isDark, bgMode, bgBlur, bgFeather, fontMode, labMode, skinId, skinPrefs });
  }, [seedMode, seedHex, presetHex, variant, isDark, bgMode, bgBlur, bgFeather, fontMode, labMode, skinId, skinPrefs]);

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
    seedMode, seedHex, presetHex, portraitHex, bgHex, isDark, activeHex, variant,
    setSeedMode, setSeedHex, setPresetHex, setDark, setVariant,
    portraitOriginal, portraitCropped, setPortrait, applyPortrait, clearPortrait,
    bgMode, bgCustom, setBgMode, setBgCustom: setBgCustomPersist, bgImage,
    bgBlur, bgFeather, setBgBlur, setBgFeather,
    fontMode, setFontMode,
    labFx, labSkin, skinId, skinMode, skinFontId, skinFontFamily,
    setLabFx, setLabSkin, setSkinId, setSkinMode, setSkinFont,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return ctx;
}
