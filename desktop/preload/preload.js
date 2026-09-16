// 4E NEXT 桌面外壳（预加载层）
//
// 只做一件事：把主进程的能力以「同步 API」暴露给渲染进程。
//
// 为什么要在预加载层缓存整份数据：
//   应用里 loadCards() / loadSettings() / loadPools() 等读取签名是同步的，
//   一旦改成异步会牵动几十处调用点，网页端也要跟着改——这违反「桌面端不影响网页端」。
//   所以启动时同步取一次快照放进内存，读操作全命中内存，写操作异步回主进程落盘。
//   代价：数据规模以「人物卡 + 私设包」为界（数 MB 级），这正是本应用的实际情况。

const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("app:info") || {};
const snapshot = ipcRenderer.sendSync("storage:snapshot") || {};

const writeErrorListeners = [];
ipcRenderer.on("storage:error", (_event, message) => {
  for (const fn of writeErrorListeners) {
    try {
      fn(String(message));
    } catch {
      /* 单个订阅者出错不影响其他订阅者 */
    }
  }
});

contextBridge.exposeInMainWorld("__4ENEXT_DESKTOP__", {
  version: String(info.version || "0.0.0"),

  storage: {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(snapshot, key) ? snapshot[key] : null;
    },
    setItem(key, value) {
      const k = String(key);
      const v = String(value);
      snapshot[k] = v;
      ipcRenderer.send("storage:set", k, v);
    },
    removeItem(key) {
      const k = String(key);
      delete snapshot[k];
      ipcRenderer.send("storage:remove", k);
    },
    keys() {
      return Object.keys(snapshot);
    },
    usage() {
      let used = 0;
      const keys = Object.keys(snapshot);
      for (const k of keys) used += k.length + String(snapshot[k]).length;
      return { used, total: Number(info.storageTotal) || 0, keys: keys.length };
    },
    onWriteError(cb) {
      if (typeof cb === "function") writeErrorListeners.push(cb);
    },
  },

  saveFile(payload) {
    return ipcRenderer.invoke("file:save", payload);
  },

  http(req) {
    return ipcRenderer.invoke("http:request", req);
  },
});
