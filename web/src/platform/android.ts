// 安卓端（WebView 壳）实现。
//
// 形态与 desktop.ts **刻意保持一致**：同样是「原生侧持有整份数据 + 同步读 + 异步写」，
// 同样把 HTTP 挪出渲染进程。差别只在换了原生宿主（Electron 主进程 → 安卓原生 + OkHttp）。
//
// 与网页端的差别同样是那四处，别在这里夹带业务逻辑：
//   · storage —— 应用私有目录里的 storage.json（不是 localStorage：10MiB 上限，
//                而且安卓会在低存储时回收 WebView 的 localStorage，人物卡不能放那儿）
//   · files   —— 系统分享面板（安卓上 <a download> 根本不工作）
//   · http    —— 原生 OkHttp 直连。**这一条是必需品不是优化**：
//                WebDAV 的 PROPFIND 对页面是跨源非简单请求，必然预检，
//                而绝大多数 WebDAV 服务端不返回 Access-Control-Allow-Methods。
//   · fonts   —— 与桌面端一样内置，完全离线

import type { HttpResponse, HttpRequestOptions, Platform, SaveResult } from "./types";

// 作为 @platform 的安卓端解析目标，必须和 index.ts 一样把类型再导出，
// 否则安卓构建下从 @platform 引入类型会解析失败。
export type * from "./types";

interface BridgeStorageUsage {
  used: number;
  total: number;
  keys: number;
}

interface BridgeSaveResult {
  ok: boolean;
  canceled?: boolean;
  reason?: string;
  path?: string;
}

interface BridgeHttpResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  bodyText: string;
  error?: string;
}

/** 原生对象形状。方法名与 AndroidBridge.kt 的 @JavascriptInterface 一一对应。 */
interface AndroidNative {
  version(): string;
  storageGetItem(key: string): string | null;
  storageSetItem(key: string, value: string): void;
  storageRemoveItem(key: string): void;
  storageKeys(): string;
  storageUsage(): string;
  httpRequest(reqJson: string): string;
  saveFile(payloadJson: string): string;
}

/** 由 document-start 注入的 shim 包装出来的、给应用用的那份 API。 */
interface AndroidBridge {
  version: string;
  storage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    keys(): string[];
    usage(): BridgeStorageUsage;
  };
  saveFile(payload: { filename: string; text: string | null; bytes: Uint8Array | null }): Promise<BridgeSaveResult>;
  http(req: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string | null;
    timeoutMs: number;
  }): Promise<BridgeHttpResult>;
}

declare global {
  interface Window {
    /**
     * 原生对象（由 `addJavascriptInterface(bridge, AndroidBridge.JS_NAME)` 注入）。
     *
     * 应用**不直接**用它——它只提供「回调 ID」式的异步原语，直接调会很难用。
     * 真正给应用用的是下面那个 `__4ENEXT_ANDROID__`，由 document-start 注入的 shim 包出来。
     * 这里保留声明是为了让「原生必须提供哪些方法」这件事在类型上有一份可对照的契约。
     */
    __4ENEXT_ANDROID_NATIVE__?: AndroidNative;
    __4ENEXT_ANDROID__?: AndroidBridge;
    /** 原生侧发起、由 shim 实现。返回 true 表示网页端已经消费掉这次返回键。 */
    __4ENEXT_ANDROID_BACK__?: () => boolean;
  }
}

function bridge(): AndroidBridge {
  const b = typeof window !== "undefined" ? window.__4ENEXT_ANDROID__ : undefined;
  if (!b) {
    throw new Error(
      "安卓端桥接未注入（window.__4ENEXT_ANDROID__ 不存在）。请通过 4E NEXT 安卓应用启动，不要直接用浏览器打开安卓构建产物。",
    );
  }
  return b;
}

function toSaveResult(r: BridgeSaveResult): SaveResult {
  if (r.ok) return { ok: true, path: r.path };
  if (r.canceled) return { ok: false, canceled: true };
  return { ok: false, reason: r.reason ?? "导出失败" };
}

export const platform: Platform = {
  kind: "android",
  version: window.__4ENEXT_ANDROID__?.version ?? "0.0.0",
  // 请求由原生 OkHttp 发出，不经过浏览器同源策略。
  // 这一条**不是优化而是必需品**：页面在 https://appassets.androidplatform.net，
  // 对自建 WebDAV 是跨源，而 PROPFIND/MKCOL 是非简单方法、必然触发预检，
  // 多数 WebDAV 服务端默认不返回 Access-Control-Allow-Methods。
  nativeTransport: true,

  fonts: {
    // 与桌面端同形：两支字体都随产物打包（见 vite.config.ts 的 androidAssets()），
    // 切换只靠 html[data-font]，不需要再插 CDN 样式表。
    // 构建时没抓到字体（bundledFonts = false）才退回 CDN。
    sansStylesheet: __ANDROID_FONTS_BUNDLED__
      ? null
      : { href: "https://fontsapi.zeoseven.com/547/main/result.css", crossOrigin: true },
  },

  storage: {
    label: "本地数据文件",
    hint:
      "数据保存在应用私有目录里，不受浏览器 5MB 配额限制，也不会被「清理浏览器数据」清掉。" +
      "卸载应用会一并删除——需要长期保留请用 WebDAV 同步或导出卡片。",
    getItem(key) {
      return bridge().storage.getItem(key);
    },
    setItem(key, value) {
      bridge().storage.setItem(key, value);
    },
    removeItem(key) {
      bridge().storage.removeItem(key);
    },
    keys() {
      return bridge().storage.keys();
    },
    usage() {
      return bridge().storage.usage();
    },
    // onWriteError 在安卓端**不通过这个回调实现**：原生写盘失败是异步的（防抖 400ms），
    // 而推送方向与桌面端相反——不是网页端订阅，而是原生 evaluateJavascript 反向调用
    // window.__4ENEXT_STORAGE_ERROR__（注册见 lib/storage.ts 的 registerNativeWriteErrorHook，
    // 调用方见 NativeStore.broadcastWriteError）。所以这里刻意留空，而不是假装有这个回调。
  },

  files: {
    async saveText(filename, text): Promise<SaveResult> {
      return toSaveResult(await bridge().saveFile({ filename, text, bytes: null }));
    },
    async saveBlob(filename, blob): Promise<SaveResult> {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return toSaveResult(await bridge().saveFile({ filename, text: null, bytes }));
    },
  },

  async http(url, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
    const req = bridge()
      .http({
        url,
        method: opts.method ?? "GET",
        headers: opts.headers ?? {},
        body: opts.body,
        timeoutMs: opts.timeoutMs ?? 30000,
      })
      .then((r) => {
        if (r.error) throw new Error(r.error);
        return r;
      });

    // AbortSignal 无法跨原生桥，这里在渲染进程侧 race，让调用方的超时/取消仍然生效
    const result = opts.signal ? await raceAbort(req, opts.signal) : await req;
    const lower = new Map<string, string>();
    for (const [k, v] of Object.entries(result.headers)) lower.set(k.toLowerCase(), v);
    return {
      status: result.status,
      ok: result.ok,
      headers: {
        get(name: string) {
          return lower.get(name.toLowerCase()) ?? null;
        },
      },
      async text() {
        return result.bodyText;
      },
    };
  },
};

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const e = new Error("请求已取消");
      e.name = "AbortError";
      reject(e);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
