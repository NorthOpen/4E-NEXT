// 图片缓存层（IndexedDB）：背景图等不随人物卡导出的资源缓存到浏览器本地。
// localStorage 只保存「读取所需的路径（缓存键）」，图片字节存放在 IndexedDB，
// 避免大图撑爆 localStorage 的 5MB 配额。

const DB_NAME = "4enext-image-cache";
const STORE = "images";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB 不可用"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("打开 IndexedDB 失败"));
  });
  return dbPromise;
}

/** 写入图片缓存（data URL）。 */
export async function cachePutImage(key: string, dataUrl: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(dataUrl, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("写入缓存失败"));
  });
}

/** 读取图片缓存；不存在或失败返回 null。 */
export async function cacheGetImage(key: string): Promise<string | null> {
  try {
    const db = await openDb();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as string) ?? null);
      req.onerror = () => reject(req.error ?? new Error("读取缓存失败"));
    });
  } catch {
    return null;
  }
}

/**
 * 清空整个图片缓存库（设置页「清除本机数据」调用）。
 * 先把已打开的连接关掉再 deleteDatabase，否则浏览器会因为「还有连接在用」而阻塞删除。
 * 删除失败不抛错：清缓存是尽力而为，调用方随后还会重新加载页面。
 */
export async function clearImageCache(): Promise<void> {
  try {
    const db = await dbPromise;
    db?.close();
  } catch {
    /* 打开失败就没有连接需要关 */
  }
  dbPromise = null;
  await new Promise<void>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve();
      return;
    }
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/** 删除图片缓存。 */
export async function cacheDeleteImage(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("删除缓存失败"));
    });
  } catch {
    /* 忽略 */
  }
}
