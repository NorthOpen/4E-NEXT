// 4E NEXT 桌面外壳（Electron 主进程）
//
// 设计原则（与网页端的分工）：
//   · 渲染进程加载的就是网页端同一份构建产物（desktop/renderer），不复制、不魔改 UI 代码。
//   · 桌面端只在「环境能力」上与网页端不同：数据存本地文件、另存为走系统对话框、
//     网络请求走主进程（因此不受 CORS 约束）、自签名证书改为询问用户。
//   · 接缝约定见 web/src/platform/types.ts。

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, safeStorage, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const RENDERER_DIR = path.join(__dirname, "..", "renderer");
const PRELOAD = path.join(__dirname, "..", "preload", "preload.js");
const APP_URL = "app://4enext/index.html";

/**
 * 内容安全策略（桌面端）。
 * 与 web/public/_headers、vite.config.ts 里注入的 meta 是同一份，仅多了 app: 协议。
 * script-src 'self' 是重点：词条正文里的内联事件处理器（onerror= 之类）即便混进 DOM 也不会执行，
 * 这是渲染层 lib/sanitize.ts 之外的第二道防线。
 */
const CSP = [
  "default-src 'self' app:",
  "script-src 'self' app:",
  "style-src 'self' 'unsafe-inline' https://fontsapi.zeoseven.com",
  "font-src 'self' app: data: https://fontsapi.zeoseven.com",
  "img-src 'self' app: data: blob: https:",
  "connect-src 'self' app: https: http:",
  "media-src 'self' app: data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

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

// ---------------------------------------------------------------- 凭据落盘加密
//
// storage.json 里躺着两条敏感数据：WebDAV 应用密码（4enext.webdav.v1）与
// AI 接口的 API Key（4enext.ai.v1）。明文放在应用数据目录里，任何能读到这个文件的人
// （同机其它账户、备份、被云同步的 AppData）都能直接拿去用。这里用 Electron 的 safeStorage
// （Windows = DPAPI，macOS = 钥匙串，Linux = libsecret）把它们换成密文：
//   · 落盘   password / apiKey → passwordEnc / apiKeyEnc（base64 密文）
//   · 读盘   passwordEnc / apiKeyEnc → password / apiKey
// 渲染进程拿到的仍是明文，存储接缝的契约不变，业务逻辑一行都不用改。
// 代价：密文与当前系统账户绑定，把 storage.json（或绿色版整个目录）拷到另一台机器后
//       凭据需要去设置里重填一次——这是"不把凭据明文写盘"应付的代价。
// safeStorage 不可用（部分 Linux 桌面没装 keyring）时自动退回明文，功能不受影响。

const WEBDAV_KEY = "4enext.webdav.v1";
const AI_KEY = "4enext.ai.v1";

/**
 * 需要加密落盘的字段：[存储键, 明文字段, 密文字段]。
 * apiKeys 是「每个供应商一把 Key」的表（对象），helper 会先 JSON 化再加密。
 */
const SECRET_FIELDS = [
  [WEBDAV_KEY, "password", "passwordEnc"],
  [AI_KEY, "apiKey", "apiKeyEnc"],
  [AI_KEY, "apiKeys", "apiKeysEnc"],
];

function secretAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function decryptSecrets() {
  if (!secretAvailable()) return;
  for (const [storeKey, field, encField] of SECRET_FIELDS) {
    const raw = store[storeKey];
    if (typeof raw !== "string") continue;
    try {
      const cfg = JSON.parse(raw);
      if (cfg && typeof cfg[encField] === "string" && !cfg[field]) {
        const plain = safeStorage.decryptString(Buffer.from(cfg[encField], "base64"));
        // 字段可能是字符串（密码），也可能是对象（分供应商的 Key 表）：能解析成 JSON 就还原成对象
        try {
          cfg[field] = JSON.parse(plain);
        } catch {
          cfg[field] = plain;
        }
        delete cfg[encField];
        store[storeKey] = JSON.stringify(cfg);
      }
    } catch {
      // 解不开（换了机器 / 换了系统账户）就当没设过，让用户去设置里重填，别把文件写坏
    }
  }
}

/** 单个字段加密后的 JSON 文本；解析不了或字段为空时原样返回 */
function encryptSecretField(raw, field, encField) {
  if (typeof raw !== "string") return raw;
  try {
    const cfg = JSON.parse(raw);
    const v = cfg ? cfg[field] : undefined;
    if (v !== undefined && v !== null && v !== "") {
      const text = typeof v === "string" ? v : JSON.stringify(v);
      // 空表（还没存过任何 Key）不必加密，保持可读
      if (text && text !== "{}" && text !== "[]") {
        cfg[encField] = safeStorage.encryptString(text).toString("base64");
        delete cfg[field];
        return JSON.stringify(cfg);
      }
    }
  } catch {
    /* 解析不了就原样写出，交由渲染进程自己兜底 */
  }
  return raw;
}

/** 落盘前的序列化：把两条凭据换成密文，其余数据原样 */
function serializedStore() {
  if (!secretAvailable()) return JSON.stringify(store);
  const out = { ...store };
  for (const [storeKey, field, encField] of SECRET_FIELDS) {
    out[storeKey] = encryptSecretField(out[storeKey], field, encField);
  }
  return JSON.stringify(out);
}

function loadStore() {
  if (storeLoaded) return;
  storeLoaded = true;
  for (const candidate of [storeFile, storeBackup]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        store = parsed;
        decryptSecrets();
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
    fs.writeFileSync(tmp, serializedStore(), "utf8");
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

/** 主机名 → 已信任证书的指纹。只认指纹一致的证书，换证书必须重新确认 */
const trustedHosts = new Map();

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

// ---------------------------------------------------------------- IPC 请求授权
//
// http:request 是「渲染进程让主进程代发请求」的通道，桌面端靠它绕开 CORS；
// 但它同时也是一条 SSRF 通道：一旦渲染进程里跑起来注入的脚本（例如导入了带脚本的私设包），
// 就能拿它去探测内网网段、路由器、本机服务。所以这里加两道闸：
//   ① 只接受应用自身页面（app://）发来的请求；
//   ② 目标 origin 必须是用户在设置里亲手填的地址（WebDAV 服务器，或 AI 接口的 Base URL）
//      —— 设置是逐键保存的，所以正常同步与正常调用永远命中白名单，不会有任何打扰；
//      其余地址（内网/本机/任意公网）一律弹窗询问，同一 origin 每次运行只问一次。
//      注意：AI 的接口地址必须**落到存储里**才会被放行（见 lib/ai/config.ts 与 AiView 的地址固化），
//      否则用户每次连接测试都会撞上询问弹窗。

/**
 * 本机 / 内网地址。
 *
 * 用途见 configuredOrigins：AI 接口地址只预授权公网地址。
 * 本地模型（127.0.0.1 的 Ollama / LM Studio）与内网中转站都属于这一类 ——
 * 它们仍是合法用法，只是要走一次询问弹窗。
 */
function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true; // IPv6 ULA / link-local
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * 主进程自持的"已授权 origin"：取用户在设置里填的 WebDAV 地址与 AI 接口地址。
 *
 * 两者的待遇刻意不同：
 *   · WebDAV —— 一律预授权（自建服务器常在内网，"每次开应用都弹窗"会直接毁掉同步体验，
 *     这是当初就定下的取舍）。
 *   · AI 接口 —— 只预授权公网地址。理由：AI 配置本身也是一份可写的存储，
 *     被注入的脚本理论上能先把它改成内网地址再发请求，从而"自授权"绕过这道闸门。
 *     内网/本机地址（本地模型、内网中转站）仍然可用，只是每次运行要走一次询问弹窗。
 */
function configuredOrigins() {
  const out = new Set();
  try {
    loadStore();
    for (const key of [WEBDAV_KEY, AI_KEY]) {
      const raw = store[key];
      if (typeof raw !== "string") continue;
      const cfg = JSON.parse(raw);
      const url = cfg && (cfg.url || cfg.baseUrl);
      if (typeof url !== "string" || !url.trim()) continue;
      const parsed = new URL(url.trim());
      if (key === AI_KEY && isPrivateHost(parsed.hostname)) continue;
      out.add(parsed.origin);
    }
  } catch {
    /* 配置缺失或损坏 → 视为没有授权目标，走询问流程 */
  }
  return out;
}

/** 本次运行中用户点过「允许」的 origin */
const allowedOrigins = new Set();

function originAllowed(origin) {
  if (configuredOrigins().has(origin)) return true;
  if (allowedOrigins.has(origin)) return true;
  const choice = dialog.showMessageBoxSync({
    type: "warning",
    title: "允许访问这个地址吗",
    message: "4E NEXT 想要访问 " + origin + "。",
    detail:
      "这不是你在设置里填过的地址（WebDAV 服务器 / AI 接口）。\n\n" +
      "正常情况下，同步与 AI 调用只会访问你自己配置的那台服务器。出现这个提示，可能是：\n" +
      "· 你正在测试一台新服务器（允许即可）；\n" +
      "· 某个私设包/同步数据里带了脚本，正在借应用探测你的内网。\n\n" +
      "不确定来源时请选择「取消」。允许后本次运行期间不再重复询问。",
    buttons: ["取消", "允许"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (choice === 1) {
    allowedOrigins.add(origin);
    return true;
  }
  return false;
}

/** 只信任应用自己的页面：app:// 的主框架 */
function isAppFrame(event) {
  try {
    const frame = event.senderFrame;
    if (frame && frame !== frame.top) return false;
    const url = frame && frame.url ? frame.url : event.sender.getURL();
    return typeof url === "string" && url.startsWith("app://");
  } catch {
    return false;
  }
}

function blockedRequest(error) {
  return { status: 0, ok: false, headers: {}, bodyText: "", error };
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

  ipcMain.handle("http:request", async (event, req) => {
    if (!isAppFrame(event)) return blockedRequest("请求来源不是 4E NEXT 自身的页面，已拒绝。");
    let url;
    try {
      url = new URL(String(req && req.url));
    } catch {
      return blockedRequest("请求地址无效。");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return blockedRequest("只允许 http / https 请求。");
    }
    if (!originAllowed(url.origin)) {
      return blockedRequest("已拒绝访问 " + url.origin + "（未获授权，可能是数据里带的脚本在探测内网）。");
    }
    return davRequest(req);
  });
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
    // 必须以 RENDERER_DIR + 分隔符开头：只比前缀的话，同级的 renderer-xxx 目录也会被放行
    if (target !== RENDERER_DIR && !target.startsWith(RENDERER_DIR + path.sep)) {
      return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } });
    }
    try {
      const res = await net.fetch(pathToFileURL(target).toString());
      // 只有 HTML 需要挂安全响应头；其余是数据/字体/图片，挂了也没意义。
      // 这份 CSP 与 web/public/_headers、vite.config.ts 注入的 meta 三份一致，
      // 只多放行 app:（页面自身就跑在这个协议上）——改一处记得同步另两处。
      if (/\.html?$/i.test(target)) {
        return new Response(await res.text(), {
          status: res.status,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "Content-Security-Policy": CSP,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return res;
    } catch {
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
  });

  // 自签名证书：浏览器里用户只能看到一个「继续访问」的警告页，
  // 桌面端把它变成一次明确的询问——自建 WebDAV（群晖 / Nextcloud）几乎都是自签名。
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode === 0) return callback(-3); // 交给 Chromium 默认校验
    const fingerprint =
      request.certificate && request.certificate.fingerprint ? String(request.certificate.fingerprint) : "";
    const known = trustedHosts.get(request.hostname);
    // 关键：指纹一致才免问。只按主机名放行的做法，会让"本次运行内被换成另一张证书"悄悄通过，
    // 而自建 WebDAV 的用户对"证书不受信任"这个弹窗早就见惯了，很容易点过去。
    if (known !== undefined && known !== "" && known === fingerprint) return callback(0);
    const changed = known !== undefined && known !== fingerprint;
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      title: "证书不受信任",
      message: request.hostname + " 的安全证书无法验证。",
      detail:
        "自建的 WebDAV 服务器常用自签名证书。\n\n" +
        (changed
          ? "注意：这次的证书与本次运行中你先前信任的那张**不是同一张**，可能有人在中间替换。\n\n"
          : "") +
        "只有在你确认这台服务器属于你或你信任的人时，才选择「信任并继续」。\n" +
        "选择后本次运行期间，该主机只有出示同一张证书时才会免问。",
      buttons: ["取消", "信任并继续"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice === 1) {
      trustedHosts.set(request.hostname, fingerprint);
      return callback(0);
    }
    return callback(-2);
  });

  // 兜底：万一有代码走了 <a download>，记住上次目录并让系统弹保存框
  // 兜底路径（万一有代码走了 <a download>）：仍然弹系统保存框，不再按上次目录静默落盘。
  // 静默落盘意味着一个被入侵的 WebDAV 服务端/私设包可以把文件直接写进你上次保存的位置。
  session.defaultSession.on("will-download", (_event, item) => {
    const filename = item.getFilename();
    const baseDir = lastSaveDir || app.getPath("documents");
    const picked = dialog.showSaveDialogSync({
      title: "另存为",
      defaultPath: path.join(baseDir, filename),
      filters: filtersFor(filename),
    });
    if (!picked) {
      item.cancel();
      return;
    }
    item.setSavePath(picked);
    lastSaveDir = path.dirname(picked);
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
