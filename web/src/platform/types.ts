// 平台能力接缝（Platform Capability Seam）
//
// 目的：网页端与桌面端共用同一份应用源码，只有「和运行环境打交道的四件事」分开实现：
//   1. storage —— 键值持久化（网页 = localStorage，桌面 = 应用数据目录里的文件）
//   2. files   —— 另存为（网页 = a[download]，桌面 = 系统保存对话框）
//   3. http    —— 跨域请求（网页 = fetch + CORS，桌面 = 主进程直连，不需要服务端开 CORS）
//   4. 环境标识
//
// 约束（改动前请先读）：
//   · 这里只放「环境能力」，不放业务逻辑。业务代码通过 @platform 取用。
//   · 两个实现都必须满足 Platform 接口（见 _impls.ts，typecheck 会同时校验两份）。
//   · **存储契约**：storage 只负责「键值放在哪里」，不改变「存什么」。
//     值的格式（SavedCard / HomebrewPool / 同步文档）必须两端逐字节一致，
//     否则网页版与桌面版之间通过 WebDAV 同步的链路会断掉。

/** 与浏览器 Response 对齐的最小响应面；webdav.ts 只用到这 4 个成员。 */
export interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 超时毫秒数；桌面端由主进程实现，网页端由调用方自行 Abort */
  timeoutMs?: number;
  /** 取消信号；网页端直接透传给 fetch，桌面端在渲染进程侧 race */
  signal?: AbortSignal;
  /** 浏览器 CORS 探针用（mode: "no-cors"）；桌面端忽略 */
  noCors?: boolean;
  cache?: RequestCache;
}

export interface StorageUsageReport {
  /** 已用（UTF-16 码元，与网页端口径一致） */
  used: number;
  /** 容量上限；桌面端为磁盘可用量级的估值，不是浏览器的 5MB */
  total: number;
  keys: number;
}

export interface PlatformStorage {
  getItem(key: string): string | null;
  /** 写入失败必须抛错（由 lib/storage 的 safeSetItem 归类并广播） */
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
  usage(): StorageUsageReport;
  /**
   * 异步写入失败通知（桌面端写盘失败时才会用到；网页端没有这种失败形态）。
   * 返回取消订阅函数。
   */
  onWriteError?(cb: (message: string) => void): () => void;
  /** 存储位置的用户可读描述，用于设置页文案 */
  readonly label: string;
  /** 一句话说明这份数据存在哪、会不会被清 */
  readonly hint: string;
}

export type SaveResult =
  | { ok: true; path?: string }
  | { ok: false; canceled: true }
  | { ok: false; canceled?: false; reason: string };

export interface PlatformFiles {
  /** 另存文本文件（.json / .d4e）。filename 已含扩展名。 */
  saveText(filename: string, text: string): Promise<SaveResult>;
  /** 另存二进制（PNG / JPG / PDF）。 */
  saveBlob(filename: string, blob: Blob): Promise<SaveResult>;
}

/**
 * 字体来源。
 *
 * 网页端：靠 CDN 的 unicode-range 分片惰性加载，只有页面真正用到的字才下载。
 * 桌面端：字体已随构建产物打包（desktop/assets/fonts），离线可用，不需要任何外部请求。
 */
export interface PlatformFonts {
  /**
   * 需要「按需」加载的补充字体样式表（无衬线体那张）。
   * null = 字体已内置，不需要额外加载。
   */
  readonly sansStylesheet: { href: string; crossOrigin: boolean } | null;
}

export interface Platform {
  /** "web" = 浏览器；"desktop" = Electron 外壳 */
  readonly kind: "web" | "desktop";
  /** 应用版本号（与 __APP_VERSION__ 同源） */
  readonly version: string;
  readonly storage: PlatformStorage;
  readonly files: PlatformFiles;
  readonly fonts: PlatformFonts;
  http(url: string, opts?: HttpRequestOptions): Promise<HttpResponse>;
}
