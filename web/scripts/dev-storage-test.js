/* eslint-disable no-console */
// ============================================================================
// 开发自测：制造「保存失败」的两种真实场景，用于验证存储写入护栏与提示 UI。
// 不参与构建（不在 web/src 下，Vite 不会打包，也不会被 tsc 收录）。
//
// 用法：
//   1) pnpm --filter 4enext-web dev 起本地服务，打开页面
//   2) 把本文件内容整份粘贴进 DevTools 控制台回车
//   3) 按提示调用 __4enext.fill() / __4enext.deny()，然后在页面上「让存档变大」触发自动保存
//   4) 测完务必 __4enext.clear() / __4enext.restore() 复原
//
// 关键前提：localStorage 是「按键覆盖」的，用更短的值覆盖同一个键永远会成功。
// 所以灌满之后，把字段改短是触发不了失败的，必须让存档体积增长，例如：
//   · 新建一张人物卡（数组多一项，必增）
//   · 在背景页粘贴一大段文字
//   · 上传立绘（增幅最大）
// ============================================================================

(function () {
  const KEY = "4enext.__devFill";
  const fmt = (n) =>
    n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB";

  /** 统计当前占用（口径与 lib/storage.ts 一致：UTF-16 码元，含 key）。 */
  function used() {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) n += k.length + (localStorage.getItem(k) || "").length;
    }
    return n;
  }

  let denied = false;
  let realLS = null;

  const api = {
    /**
     * 把 localStorage 灌到写不动为止。
     * @param {number} reserveKB 预留余量（KB）。0 = 灌死（任何写入都失败）；
     *                           传 300 之类可造出「快满但还能写」的告警态。
     *
     * 注意：粗暴地 while(true) 每次加固定步长，会留下最多一个步长的余量，
     * 小体积存档（空白人物卡才几 KB）照样写得进去 —— 那样根本触发不了失败。
     * 这里先粗调顶到上限，再用折半步长逼到 256 字符以内。
     */
    fill(reserveKB = 0) {
      if (denied) {
        console.warn("[4enext] 当前处于 deny() 模拟中，先 __4enext.restore()");
        return;
      }
      try {
        localStorage.removeItem(KEY);
      } catch (e) {
        console.error("[4enext] localStorage 不可用：", e && e.name);
        return;
      }
      const before = used();
      let payload = "";
      const put = (s) => localStorage.setItem(KEY, s);

      const COARSE = 512 * 1024;
      for (;;) {
        try {
          put(payload + "x".repeat(COARSE));
          payload += "x".repeat(COARSE);
        } catch {
          break;
        }
      }
      let step = COARSE >> 1;
      while (step >= 256) {
        try {
          put(payload + "x".repeat(step));
          payload += "x".repeat(step);
        } catch {
          step >>= 1;
        }
      }
      if (reserveKB > 0) {
        const keep = Math.max(0, payload.length - reserveKB * 1024);
        payload = payload.slice(0, keep);
        put(payload);
      }

      const after = used();
      const cards = localStorage.getItem("4enext.cards.v1");
      console.log(
        "%c[4enext] 已灌满",
        "color:#b00;font-weight:600",
        "\n  灌入        " + fmt(payload.length),
        "\n  占用        " + fmt(before) + " -> " + fmt(after),
        "\n  预留余量    " + (reserveKB ? reserveKB + " KB" : "无（任何增长都会失败）"),
        "\n  当前存档    " + (cards === null ? "（还没有人物卡）" : fmt(cards.length)),
        "\n\n接下来要让存档「变大」才会触发失败（把同一个键改短永远写得进去）：",
        "\n  · 新建一张人物卡   · 在背景页粘贴一段长文字   · 上传立绘",
        "\n约 400ms 后自动保存，应当弹出「没有保存成功」对话框。测完执行 __4enext.clear() 复原。",
      );
      if (!reserveKB) api.probe();
    },

    /**
     * 自检：确认「存档再变大一点就会失败」。
     * 灌满后调用它，比到页面上瞎点更快知道环境有没有准备好。
     */
    probe() {
      const k = "4enext.cards.v1";
      const cur = localStorage.getItem(k);
      if (cur === null) {
        console.warn("[4enext] 还没有 4enext.cards.v1，先在页面上建一张人物卡再试");
        return null;
      }
      try {
        localStorage.setItem(k, cur + "x".repeat(1024));
        localStorage.setItem(k, cur); // 写得进去，复原
        console.warn("[4enext] ⚠ 存档还能再涨 1KB，余量不足以触发失败 —— 重新执行 __4enext.fill()");
        return false;
      } catch (e) {
        console.log("[4enext] ✅ 存档再涨 1KB 即失败（" + (e && e.name) + "），可以去页面上操作了");
        return true;
      }
    },

    /** 清掉灌入的数据，恢复正常。 */
    clear() {
      try {
        localStorage.removeItem(KEY);
        console.log("[4enext] 已清理，当前占用 " + fmt(used()));
      } catch (e) {
        console.error("[4enext] 清理失败：", e);
      }
    },

    /**
     * 模拟「浏览器不允许保存数据」（无痕模式 / 站点数据被禁用）。
     * 只让写入抛 SecurityError，读取照常，便于单独验证 unavailable 分支。
     */
    deny() {
      if (denied) return console.warn("[4enext] 已处于 deny 状态");
      realLS = window.localStorage;
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          get length() {
            return realLS.length;
          },
          key: (i) => realLS.key(i),
          getItem: (k) => realLS.getItem(k),
          removeItem: (k) => realLS.removeItem(k),
          clear: () => realLS.clear(),
          setItem() {
            throw new DOMException("blocked by __4enext.deny()", "SecurityError");
          },
        },
      });
      denied = true;
      console.log("[4enext] 已模拟「浏览器禁止保存」。改一个字段试试，测完 __4enext.restore()。");
    },

    /** 解除 deny() 模拟。 */
    restore() {
      if (!denied) return console.warn("[4enext] 当前不在 deny 状态");
      delete window.localStorage;
      denied = false;
      realLS = null;
      console.log("[4enext] 已恢复真实 localStorage。");
    },

    /** 打印当前占用明细。 */
    status() {
      const rows = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        rows.push({ 键: k, 大小: fmt(k.length + (localStorage.getItem(k) || "").length) });
      }
      console.table(rows);
      console.log("[4enext] 合计 " + fmt(used()) + "，共 " + localStorage.length + " 项" + (denied ? "（deny 模拟中）" : ""));
    },
  };

  window.__4enext = api;
  console.log(
    "%c[4enext] 存储自测工具已就绪",
    "color:#0b61a4;font-weight:600",
    "\n  __4enext.fill()      灌满，之后任何保存都会失败",
    "\n  __4enext.fill(300)   留 300KB 余量，造「快满」的告警态",
    "\n  __4enext.deny()      模拟无痕模式禁止写入",
    "\n  __4enext.probe()     自检：确认再写入就会失败",
    "\n  __4enext.status()    查看各键占用",
    "\n  __4enext.clear()     清理灌入数据",
    "\n  __4enext.restore()   解除 deny 模拟",
  );
})();
