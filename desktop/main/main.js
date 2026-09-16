// 4E NEXT 桌面外壳（Electron 主进程）
//
// 设计原则（与网页端的分工）：
//   · 渲染进程加载的就是网页端同一份构建产物（desktop/renderer），不复制、不魔改 UI 代码。
//   · 桌面端只在「环境能力」上与网页端不同：数据存本地文件、另存为走系统对话框、
//     网络请求走主进程（因此不受 CORS 约束）、自签名证书改为询问用户。
//   · 接缝约定见 web/src/platform/types.ts。

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const RENDERER_DIR = path.join(__dirname, "..", "renderer");
const PRELOAD = path.join(__dirname, "..", "preload", "preload.js");
const APP_URL = "app://4enext/index.html";

// 便携模式：可执行文件同目录放一个 portable.txt，数据就写在程序目录的 data/ 里。
// 免安装绿色版（U 盘、解压即用）理应如此——卸载 = 删文件夹，不往系统里留东西。
// 必须在任何 app.getPath("userData") 之前设置。
try {
  const exeDir = path.dirname(app.getPath("exe"));
  if (fs.existsSync(path.join(exeDir, "portable.txt"))) {
    app.setPath("userData", path.join(exeDir, "data"));
  }
} catch {
  /* 拿不到 exe 路径就用系统默认位置 */
}

// 桌面端数据文件没有浏览器的 5MB 配额；这里给一个磁盘量级的名义上限，
// 只用于设置页的占比展示（真实瓶颈是磁盘，不是这个数）。
const STORAGE_TOTAL = 2 * 1024 * 1024 * 1024;

const SMOKE = process.argv.includes("--smoke");

// ---------------------------------------------------------------- 单实例

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---------------------------------------------------------------- 特权协议
// 必须在 app ready 之前注册。用自定义协议而不是 file://，
// 是因为 file:// 下 fetch() 会被 Chromium 直接拒绝，而应用靠 fetch 读取 data/*.json。

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ---------------------------------------------------------------- 数据文件（localStorage 的桌面替代）

const storeFile = path.join(app.getPath("userData"), "storage.json");
const storeBackup = storeFile + ".bak";
let store = {};
let storeLoaded = false;
let storeDirty = false;
let storeTimer = null;

function loadStore() {
  if (storeLoaded) return;
  storeLoaded = true;
  for (const candidate of [storeFile, storeBackup]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        store = parsed;
        return;
      }
    } catch {
      /* 试下一个候选 */
    }
  }
  store = {};
}

/** 原子落盘：先写 .tmp 再 rename，避免崩溃/断电把数据文件写坏。 */
function flushStore() {
  if (storeTimer) {
    clearTimeout(storeTimer);
    storeTimer = null;
  }
  if (!storeDirty) return;
  storeDirty = false;
  try {
    const tmp = storeFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
    fs.renameSync(tmp, storeFile);
  } catch (err) {
    // 不许静默：渲染进程会把它当成一次「保存失败」提示用户
    broadcastStoreError("写入本地数据文件失败：" + (err && err.message ? err.message : String(err)));
  }
}

function scheduleFlush() {
  storeDirty = true;
  if (storeTimer) return;
  // 编辑时写入很密集（草稿逐键保存），防抖后统一落盘
  storeTimer = setTimeout(flushStore, 250);
}

function broadcastStoreError(message) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("storage:error", message);
  }
}

// ---------------------------------------------------------------- 保存对话框

let lastSaveDir = null;

function filtersFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return [{ name: "PDF 文档", extensions: ["pdf"] }];
  if (ext === ".png") return [{ name: "PNG 图片", extensions: ["png"] }];
  if (ext === ".jpg" || ext === ".jpeg") return [{ name: "JPEG 图片", extensions: ["jpg", "jpeg"] }];
  if (ext === ".d4e") return [{ name: "4E 资源包", extensions: ["d4e"] }];
  return [{ name: "JSON 文件", extensions: ["json"] }];
}

// ---------------------------------------------------------------- 网络请求（主进程直连，不受 CORS 约束）

const trustedHosts = new Set();

async function davRequest(req) {
  const controller = new AbortController();
  const timeoutMs = typeof req.timeoutMs === "number" && req.timeoutMs > 0 ? req.timeoutMs : 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await net.fetch(req.url, {
      method: req.method || "GET",
      headers: req.headers || {},
      body: req.body,
      signal: controller.signal,
      redirect: "follow",
    });
    const headers = {};
    for (const [k, v] of res.headers) headers[k] = v;
    return { status: res.status, ok: res.ok, headers, bodyText: await res.text() };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const friendly = /\babort/i.test(message)
      ? "请求超时（" + Math.round(timeoutMs / 1000) + " 秒）。服务器没有响应，请检查网络或地址。"
      : message;
    return { status: 0, ok: false, headers: {}, bodyText: "", error: friendly };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- 窗口

let mainWindow = null;

function loadWindowState() {
  loadStore();
  const raw = store["__windowState"];
  if (!raw) return { width: 1440, height: 900 };
  try {
    const s = JSON.parse(raw);
    if (s && typeof s.width === "number" && typeof s.height === "number") return s;
  } catch {
    /* 损坏就用默认尺寸 */
  }
  return { width: 1440, height: 900 };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  store["__windowState"] = JSON.stringify(mainWindow.getNormalBounds());
  scheduleFlush();
}

function createWindow() {
  const bounds = loadWindowState();
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#141218",
    title: "4E NEXT",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("resize", saveWindowState);
  mainWindow.on("move", saveWindowState);
  mainWindow.on("close", saveWindowState);

  // 外链一律交给系统浏览器，不在应用窗口里打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("app://")) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  void mainWindow.loadURL(APP_URL);
  return mainWindow;
}

function buildMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        { label: "新建窗口", accelerator: "CmdOrCtrl+N", click: () => createWindow() },
        { type: "separator" },
        { label: "打开数据目录", click: () => void shell.openPath(app.getPath("userData")) },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
        { role: "toggleDevTools", label: "开发者工具" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        { label: "4e Wiki（数据来源）", click: () => void shell.openExternal("https://4e-wiki.netlify.app/") },
        { label: "项目主页", click: () => void shell.openExternal("https://github.com/NorthOpen/4E-NEXT") },
        { type: "separator" },
        {
          label: "关于 4E NEXT",
          click: () => {
            void dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "关于 4E NEXT",
              message: "4E NEXT 桌面版 " + app.getVersion(),
              detail:
                "D&D 4E 中文社区车卡器（离线桌面版）。\n\n" +
                "数据保存在：" + app.getPath("userData") + "\n" +
                "Electron " + process.versions.electron + " / Chromium " + process.versions.chrome,
              buttons: ["好"],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  // 预加载层启动时同步取一次全量数据，此后读操作全在渲染进程内存里完成。
  // 这样应用里 loadCards()/loadSettings() 这些同步签名一个都不用改。
  ipcMain.on("storage:snapshot", (event) => {
    loadStore();
    event.returnValue = store;
  });

  ipcMain.on("app:info", (event) => {
    event.returnValue = { version: app.getVersion(), storageTotal: STORAGE_TOTAL };
  });

  ipcMain.on("storage:set", (_event, key, value) => {
    loadStore();
    store[String(key)] = String(value);
    scheduleFlush();
  });

  ipcMain.on("storage:remove", (_event, key) => {
    loadStore();
    delete store[String(key)];
    scheduleFlush();
  });

  ipcMain.handle("file:save", async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const filename = String(payload && payload.filename ? payload.filename : "未命名");
    const baseDir = lastSaveDir || app.getPath("documents");
    const result = await dialog.showSaveDialog(win, {
      title: "另存为",
      defaultPath: path.join(baseDir, filename),
      filters: filtersFor(filename),
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      if (payload.text !== null && payload.text !== undefined) {
        fs.writeFileSync(result.filePath, payload.text, "utf8");
      } else {
        fs.writeFileSync(result.filePath, Buffer.from(payload.bytes));
      }
      lastSaveDir = path.dirname(result.filePath);
      return { ok: true, path: result.filePath };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      dialog.showErrorBox("保存失败", "无法写入 " + result.filePath + "\n\n" + message);
      return { ok: false, reason: message };
    }
  });

  ipcMain.handle("http:request", async (_event, req) => davRequest(req));
}

// ---------------------------------------------------------------- 生命周期

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", flushStore);
app.on("will-quit", flushStore);

app.whenReady().then(async () => {
  // app:// 直接把 renderer 目录喂给 Chromium；net.fetch 会按扩展名给出 Content-Type，
  // 也支持 asar 内路径与流式大文件（power.json 有 19MB）。
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const target = path.normalize(path.join(RENDERER_DIR, rel));
    if (!target.startsWith(RENDERER_DIR)) {
      return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } });
    }
    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
  });

  // 自签名证书：浏览器里用户只能看到一个「继续访问」的警告页，
  // 桌面端把它变成一次明确的询问——自建 WebDAV（群晖 / Nextcloud）几乎都是自签名。
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode === 0) return callback(-3); // 交给 Chromium 默认校验
    if (trustedHosts.has(request.hostname)) return callback(0);
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      title: "证书不受信任",
      message: request.hostname + " 的安全证书无法验证。",
      detail:
        "自建的 WebDAV 服务器常用自签名证书。\n\n" +
        "只有在你确认这台服务器属于你或你信任的人时，才选择「信任并继续」。\n" +
        "选择后本次运行期间不再对同一主机重复询问。",
      buttons: ["取消", "信任并继续"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice === 1) {
      trustedHosts.add(request.hostname);
      return callback(0);
    }
    return callback(-2);
  });

  // 兜底：万一有代码走了 <a download>，记住上次目录并让系统弹保存框
  session.defaultSession.on("will-download", (_event, item) => {
    const filename = item.getFilename();
    if (lastSaveDir) item.setSavePath(path.join(lastSaveDir, filename));
    item.once("done", (_e, state) => {
      if (state === "completed") lastSaveDir = path.dirname(item.getSavePath());
    });
  });

  registerIpc();
  if (!SMOKE) buildMenu();
  const win = createWindow();

  if (SMOKE) {
    await runSmoke(win);
  } else {
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }
});

// ---------------------------------------------------------------- 冒烟自检
//
// 在真实外壳里跑一遍关键能力。桌面端的坑大多出在「浏览器里能跑、外壳里不行」，
// 所以这一步必须在外壳里做，而不是在浏览器里跑单测。

async function runSmoke(win) {
  const checks = [];
  const add = (name, pass, detail) =>
    checks.push({ name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });
  const wc = win.webContents;

  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("did-finish-load 超时")), 30000);
      wc.once("did-finish-load", () => {
        clearTimeout(t);
        resolve();
      });
      wc.once("did-fail-load", (_e, code, desc, url) => {
        clearTimeout(t);
        reject(new Error("加载失败 " + code + " " + desc + " " + url));
      });
    });
    add("app:// 加载 index.html", true, APP_URL);
  } catch (err) {
    add("app:// 加载 index.html", false, err.message);
    return finish();
  }

  const evaluate = (code) => wc.executeJavaScript(code, true);

  try {
    add("预加载桥已注入", await evaluate("typeof window.__4ENEXT_DESKTOP__ === 'object'"));
    add("应用版本可读", await evaluate("!!window.__4ENEXT_DESKTOP__.version"), await evaluate("window.__4ENEXT_DESKTOP__.version"));

    const storageOk = await evaluate(
      "(function(){var s=window.__4ENEXT_DESKTOP__.storage;s.setItem('__smoke','1');" +
        "var v=s.getItem('__smoke');s.removeItem('__smoke');return v==='1'&&s.getItem('__smoke')===null;})()",
    );
    add("平台存储 写/读/删", storageOk);
    add(
      "存储 keys()/usage()",
      await evaluate(
        "Array.isArray(window.__4ENEXT_DESKTOP__.storage.keys()) && typeof window.__4ENEXT_DESKTOP__.storage.usage().used === 'number'",
      ),
    );

    const manifest = await evaluate("fetch('./data/manifest.json').then(r=>r.status)");
    add("fetch data/manifest.json", manifest === 200, "status=" + manifest);
    const big = await evaluate("fetch('./data/categories/power.json').then(r=>r.text()).then(t=>t.length)");
    add("fetch 19MB power.json", big > 1000000, "len=" + big);
    const spa = await evaluate("fetch('./').then(r=>r.status)");
    add("fetch 根路径回 index.html", spa === 200, "status=" + spa);

    const idb = await evaluate(
      "new Promise(function(res){try{var q=indexedDB.open('__smoke_db',1);" +
        "q.onupgradeneeded=function(){q.result.createObjectStore('s')};" +
        "q.onsuccess=function(){q.result.close();indexedDB.deleteDatabase('__smoke_db');res(true)};" +
        "q.onerror=function(){res(false)}}catch(e){res(false)}})",
    );
    add("IndexedDB 可用", idb);

    const rootHtmlLen = await evaluate("document.getElementById('root').innerHTML.length");
    add("React 已渲染", rootHtmlLen > 100, "root.innerHTML=" + rootHtmlLen + " 字符");

    // 字体本地化：不该再有任何指向外部字体服务的引用，且两支正文字体都要真的注册并加载
    const fontFaces = await evaluate(
      "[...document.fonts].map(function(f){return f.family + ':' + f.status}).join('|')",
    );
    const cdnLinks = await evaluate("document.querySelectorAll('link[href*=zeoseven], link[href*=gstatic]').length");
    add("字体：无外部字体服务引用", cdnLinks === 0, "外部字体 link 数 = " + cdnLinks);
    add("字体：衬线体 Chiron Sung HK VF 已注册", fontFaces.indexOf("Chiron Sung HK VF") >= 0);
    add("字体：无衬线体 Chiron Hei HK VF 已注册", fontFaces.indexOf("Chiron Hei HK VF") >= 0);
    const loadedFaces = (fontFaces.match(/:loaded/g) || []).length;
    add("字体：已加载分片", loadedFaces > 0, loadedFaces + " 个 FontFace 已加载");
    add("Material Symbols 已内置", await evaluate("document.fonts.check('24px \"Material Symbols Outlined\"')"));

    const httpProbe = await runHttpProbe();
    add("主进程 HTTP 自定义方法", httpProbe.ok, httpProbe.detail);

    // 留一张真实截图：字体、布局、MD3 组件这些东西只有看图才算验过
    if (process.env.SMOKE_SHOT) {
      await new Promise((r) => setTimeout(r, 2500));
      const image = await wc.capturePage();
      const png = image.toPNG();
      fs.writeFileSync(process.env.SMOKE_SHOT, png);
      add("界面截图已保存", png.length > 10000, png.length + " 字节");
    }
  } catch (err) {
    add("冒烟检查执行", false, err && err.message ? err.message : String(err));
  }

  return finish();

  function finish() {
    const failed = checks.filter((c) => !c.pass);
    const lines = ["===== 桌面外壳冒烟自检 ====="];
    for (const c of checks) {
      lines.push((c.pass ? "  PASS  " : "  FAIL  ") + c.name + (c.detail ? "   [" + c.detail + "]" : ""));
    }
    lines.push("结果：" + (checks.length - failed.length) + "/" + checks.length + " 通过");
    const report = lines.join("\n");
    console.log("\n" + report);
    // 打包后的 Windows GUI 程序没有控制台，stdout 拿不到；同时写一份文件供 CI / 人工核对
    try {
      const out = process.env.SMOKE_OUT || path.join(process.cwd(), "smoke-report.txt");
      fs.writeFileSync(out, report + "\n", "utf8");
    } catch {
      /* 写不出来也不影响退出码 */
    }
    flushStore();
    app.exit(failed.length ? 1 : 0);
  }
}

/** 起一个本地 HTTP 服务，验证主进程网络层支持 WebDAV 用到的非标准方法。 */
function runHttpProbe() {
  return new Promise((resolve) => {
    const http = require("node:http");
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(req.method);
      res.writeHead(req.method === "MKCOL" ? 201 : 207, { "content-type": "text/plain", ETag: '"smoke"' });
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const base = "http://127.0.0.1:" + port + "/dav";
      const out = [];
      for (const method of ["PROPFIND", "MKCOL", "PUT", "GET"]) {
        const r = await davRequest({ url: base, method, headers: {}, timeoutMs: 5000 });
        out.push(method + "=" + (r.error ? "ERR" : r.status));
      }
      server.close();
      const ok = seen.includes("PROPFIND") && seen.includes("MKCOL") && seen.includes("PUT");
      resolve({ ok, detail: out.join(" ") });
    });
    server.on("error", (e) => resolve({ ok: false, detail: "本地服务器启动失败：" + e.message }));
  });
}
