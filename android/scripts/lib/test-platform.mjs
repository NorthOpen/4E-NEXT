// 给「真 webdav.ts 跑在 Node 里」用的假平台。
//
// 为什么需要一个假平台：`web/src/lib/sync/webdav.ts` 只通过 `@platform` 拿 HTTP 能力，
// 其余都是纯逻辑。把它接到 Node 的 fetch 上，就能在没有浏览器、没有设备的情况下
// **跑真正的同步传输层代码**，而不是另写一份模仿它的测试替身。
//
// 这一点很重要：如果测试用的是"我重写一遍的请求逻辑"，那验证的只是我的理解；
// 这里跑的是**真代码**，验证的是真实行为。
//
// `nativeTransport: true` 是刻意的：安卓端与桌面端都是原生代发，
// 设成 true 才能覆盖到那几条"不是跨域问题"的分支。

const LS_MAX = 5 * 1024 * 1024;

export const platform = {
  kind: "android",
  version: "0.3.4-test",
  nativeTransport: true,

  fonts: { sansStylesheet: null },

  storage: {
    label: "测试用",
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    keys: () => [],
    usage: () => ({ used: 0, total: LS_MAX, keys: 0 }),
  },

  files: {
    async saveText() {
      return { ok: true };
    },
    async saveBlob() {
      return { ok: true };
    },
  },

  /** 与 web/src/platform/android.ts 的 http() 同形：把 HttpResponse 的 4 个成员凑齐。 */
  async http(url, opts = {}) {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      redirect: "manual",
      signal: opts.signal,
    });
    const lower = new Map();
    res.headers.forEach((v, k) => lower.set(k.toLowerCase(), v));
    const bodyText = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      headers: {
        get(name) {
          return lower.get(name.toLowerCase()) ?? null;
        },
      },
      async text() {
        return bodyText;
      },
    };
  },
};
