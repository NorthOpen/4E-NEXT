// 网页端实现：行为与接入接缝前逐字节一致（localStorage / a[download] / fetch）。
// 改这里 = 改网页端。桌面端请改 desktop.ts。

import type { HttpResponse, HttpRequestOptions, Platform, SaveResult, StorageUsageReport } from "./types";

/** localStorage 容量估算口径（通用上限约 5MB，按 UTF-16 码元统计）。 */
const LS_MAX = 5 * 1024 * 1024;

/** 触发浏览器下载。延迟释放 objectURL —— 个别浏览器撤销过早会中断下载。 */
function anchorDownload(filename: string, href: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    try {
      a.remove();
    } catch {
      /* 忽略 */
    }
  }, 0);
}

function storageUsage(): StorageUsageReport {
  let used = 0;
  let keys = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      used += k.length + (localStorage.getItem(k) ?? "").length;
      keys++;
    }
  } catch {
    /* ignore */
  }
  return { used, total: LS_MAX, keys };
}

export const platform: Platform = {
  kind: "web",
  version: __APP_VERSION__,

  fonts: {
    // 无衬线体在网页端是第二张 CDN 样式表，由 ThemeProvider 按 fontMode 动态挂载/移除
    sansStylesheet: { href: "https://fontsapi.zeoseven.com/547/main/result.css", crossOrigin: true },
  },

  storage: {
    label: "浏览器缓存",
    hint: "数据存在本浏览器的站点存储里。清理浏览器数据会一并清掉，建议定期导出或用 WebDAV 同步备份。",
    getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      localStorage.setItem(key, value);
    },
    removeItem(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* 删除失败不影响本次使用 */
      }
    },
    keys() {
      const out: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) out.push(k);
        }
      } catch {
        /* ignore */
      }
      return out;
    },
    usage: storageUsage,
  },

  files: {
    async saveText(filename, text): Promise<SaveResult> {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      anchorDownload(filename, url);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true };
    },
    async saveBlob(filename, blob): Promise<SaveResult> {
      const url = URL.createObjectURL(blob);
      anchorDownload(filename, url);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true };
    },
  },

  async http(url, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
    return fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      credentials: "omit",
      cache: opts.cache,
      signal: opts.signal,
      mode: opts.noCors ? "no-cors" : undefined,
    });
  },
};
