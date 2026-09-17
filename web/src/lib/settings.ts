import { platform } from "@platform";
import type { BgMode, FontMode } from "../ThemeProvider";
import { COLOR_VARIANTS, DEFAULT_VARIANT, NORD_PRESETS, type SeedMode, type VariantKey } from "../theme";
import { dataUrlSizeBytes, compressDataUrlToBudget } from "./image";
import { safeSetItem } from "./storage";

// 单张图片的存储预算：localStorage 上限约 5MB，需为多张卡片数据留足余量
export const IMAGE_BUDGET = 450 * 1024;    // 压缩后的单图目标（约 450KB）
export const IMAGE_SIZE_HINT = 500 * 1024; // 触发「图片过大」提醒的阈值（约 500KB）

export interface Settings {
  seedMode: SeedMode;
  seedHex: string;
  presetHex: string;
  variant: VariantKey;
  isDark: boolean;
  bgMode: BgMode;
  bgBlur: number;
  bgFeather: number;
  fontMode: FontMode;
}

const SETTINGS_KEY = "4enext.settings.v1";

// 背景图缓存：图片字节存 IndexedDB（lib/imageCache），localStorage 只存「读取所需路径」——
// 即缓存键（BG_CACHE_KEY）或回退用的 data URL。背景不随人物卡导出。
export const BG_CACHE_KEY = "4enext-bg";            // IndexedDB 中的缓存键
export const BG_CACHE_MARK_KEY = "4enext.bgCacheKey.v1"; // localStorage 中存的路径标记

const SETTINGS_DEFAULTS: Settings = {
  seedMode: "preset",
  seedHex: "#5e81ac",
  presetHex: "#5e81ac",
  variant: DEFAULT_VARIANT,
  isDark: false,
  bgMode: "off",
  bgBlur: 2,
  bgFeather: 55,
  fontMode: "serif",
};

/** 读取设置（缺省字段回落默认值）。 */
export function loadSettings(): Settings {
  const out: Settings = { ...SETTINGS_DEFAULTS };
  try {
    const raw = platform.storage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      if (typeof s.seedMode === "string") out.seedMode = s.seedMode as SeedMode;
      if (typeof s.seedHex === "string") out.seedHex = s.seedHex;
      // 预设色已移除（如冰蓝/极夜/雪花）时回落默认，避免旧存档指向不存在的色板
      if (typeof s.presetHex === "string" && NORD_PRESETS.some((p) => p.color === s.presetHex)) out.presetHex = s.presetHex;
      // 取色模式已移除（或旧存档没有该字段）时回落默认，避免指向不存在的方案
      if (COLOR_VARIANTS.some((v) => v.key === s.variant)) out.variant = s.variant as VariantKey;
      if (typeof s.isDark === "boolean") out.isDark = s.isDark;
      if (typeof s.bgMode === "string") out.bgMode = s.bgMode as BgMode;
      if (typeof s.bgBlur === "number") out.bgBlur = s.bgBlur;
      if (typeof s.bgFeather === "number") out.bgFeather = s.bgFeather;
      if (s.fontMode === "sans" || s.fontMode === "serif") out.fontMode = s.fontMode;
    }
  } catch {
    /* 忽略 */
  }
  return out;
}

/** 保存设置；失败返回 false 并广播（外观丢失虽不致命，但同样不该静默）。 */
export function saveSettings(s: Settings): boolean {
  return safeSetItem(SETTINGS_KEY, JSON.stringify(s));
}

/** 读取背景缓存的路径标记（IndexedDB 缓存键或回退 data URL）。 */
export function loadBgCacheMarker(): string | null {
  try {
    return platform.storage.getItem(BG_CACHE_MARK_KEY);
  } catch {
    return null;
  }
}

/** 保存/清除背景缓存路径标记。 */
export function saveBgCacheMarker(path: string | null): void {
  if (path === null) {
    try {
      platform.storage.removeItem(BG_CACHE_MARK_KEY);
    } catch {
      /* 删除失败不影响使用 */
    }
    return;
  }
  safeSetItem(BG_CACHE_MARK_KEY, path);
}

/** 是否触发「图片过大」提醒：文件字节数超过阈值。 */
export function shouldWarnOversize(bytes: number): boolean {
  return bytes > IMAGE_SIZE_HINT;
}

/** 把待存储的图片压缩到预算以内（原图已达标则原样返回）。 */
export async function prepareImageForStore(dataUrl: string): Promise<string> {
  if (dataUrlSizeBytes(dataUrl) <= IMAGE_BUDGET) return dataUrl;
  return compressDataUrlToBudget(dataUrl, IMAGE_BUDGET);
}

export { dataUrlSizeBytes };
