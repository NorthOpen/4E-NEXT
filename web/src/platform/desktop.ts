// 桌面端（Electron）实现。环境能力全部经 preload 暴露的 window.__4ENEXT_DESKTOP__ 转发。
//
// 桌面端与网页端的差别只有这四处，别在这里夹带业务逻辑：
//   · storage —— 应用数据目录里的 JSON 文件（不受浏览器 5MB 配额限制，也不会被"清理浏览器数据"清掉）
//   · files   —— 系统保存对话框，记住上次目录
//   · http    —— 主进程直连，不受 CORS 约束（README 里那段"请自行配置跨域"对桌面端不再成立）
//
// 注意：storage 只换"放在哪里"，值仍是同样的 JSON 字符串。

import type { HttpResponse, HttpRequestOptions, Platform, SaveResult } from "./types";

// 作为 @platform 的桌面端解析目标，必须和 index.ts 一样把类型再导出，
// 否则桌面构建下从 @platform 引入类型会解析失败。
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

interface DesktopBridge {
  version: string;
  storage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    keys(): string[];
    usage(): BridgeStorageUsage;
    onWriteError(cb: (message: string) => void): void;
  };
  saveFile(payload: { filename: string; text: string | null; bytes: Uint8Array | null }): Promise<BridgeSaveResult>;
  http(req: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
  }): Promise<BridgeHttpResult>;
}

declare global {
  interface Window {
    __4ENEXT_DESKTOP__?: DesktopBridge;
  }
}

function bridge(): DesktopBridge {
  const b = typeof window !== "undefined" ? window.__4ENEXT_DESKTOP__ : undefined;
  if (!b) {
    throw new Error("桌面端桥接未注入（window.__4ENEXT_DESKTOP__ 不存在）。请通过 4E NEXT 桌面应用启动，不要直接用浏览器打开桌面构建产物。");
  }
  return b;
}

function toSaveResult(r: BridgeSaveResult): SaveResult {
  if (r.ok) return { ok: true, path: r.path };
  if (r.canceled) return { ok: false, canceled: true };
  return { ok: false, reason: r.reason ?? "保存失败" };
}

export const platform: Platform = {
  kind: "desktop",
  version: window.__4ENEXT_DESKTOP__?.version ?? "0.0.0",

  fonts: {
    // 衬线/无衬线两支字体都随渲染产物打包（desktop/assets/fonts/chiron.css），
    // 切换只靠 html[data-font] 的 CSS 变量，不需要再插 CDN 样式表。
    // 仅当构建时没抓到字体（bundledFonts = false）才退回 CDN。
    sansStylesheet: __DESKTOP_FONTS_BUNDLED__
      ? null
      : { href: "https://fontsapi.zeoseven.com/547/main/result.css", crossOrigin: true },
  },

  storage: {
    label: "本地数据文件",
    hint: "数据保存在系统的应用数据目录里，不受浏览器 5MB 配额限制，也不会被「清理浏览器数据」清掉。卸载应用不会自动删除它。",
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
    onWriteError(cb) {
      bridge().storage.onWriteError(cb);
      return () => {
        /* 预加载层只保留一个订阅者，应用生命周期内不取消 */
      };
    },
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

    // AbortSignal 无法跨 IPC，这里在渲染进程侧 race，让调用方的超时/取消仍然生效
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
