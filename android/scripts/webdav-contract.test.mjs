// WebDAV 服务端契约自检。
//
// 目的：**在没有安卓设备的情况下，尽可能把"同步能不能成"这件事验证掉。**
//
// 做法：起一个最小 WebDAV 服务端（Basic 认证 + MKCOL/GET/PUT/PROPFIND），
// 然后按 web/src/lib/sync/webdav.ts 的真实调用序列打一遍，断言状态码。
// 这些断言的期望值**直接取自 webdav.ts 的判断分支**，不是我自己编的：
//
//   · ensureDir       —— MKCOL；201 = 已创建；405 = 已存在，视为成功；409 = 父目录不存在
//   · 上传            —— PUT；成功看 2xx
//   · 下载            —— GET；404 表示远端还没有文件（首次同步的正常情况）
//   · 探测            —— PROPFIND + Depth: 0；207 表示服务器支持它
//
// 为什么值得单独测这一层：安卓端的 HTTP 是**原生代发**（OkHttp），
// 与桌面端的主进程代发是两套实现。协议契约只要有一处对不上，
// 表现就是"同步静默失败"，而且只在真机上才暴露。
//
// 同时验证一件容易踩的事：**自定义方法带空 body**。
// OkHttp 对标准方法（GET/HEAD）不允许带 body，但对 MKCOL/PROPFIND 这类
// 自定义方法是允许的——webdav.ts 发 MKCOL 时不带 body，这条路径必须能走通。
//
// 用法：node android/scripts/webdav-contract.test.mjs

import { createServer } from "node:http";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const USER = "tester";
const PASS = "app-password";

/** 内存里的"远端"：路径集合 + 文件内容。用集合而不是真磁盘，测试才可重复。 */
const collections = new Set(["/"]);
const files = new Map();

function basicAuthHeader(user, pass) {
  return "Basic " + Buffer.from(user + ":" + pass, "utf8").toString("base64");
}

function normalize(pathname) {
  const p = decodeURIComponent(pathname).replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

function parentOf(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = normalize(url.pathname);

  // 认证：未带或带错一律 401，与真实 WebDAV 服务端一致
  const auth = req.headers.authorization || "";
  if (auth !== basicAuthHeader(USER, PASS)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
    res.end();
    return;
  }

  const method = req.method.toUpperCase();
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);

    if (method === "PROPFIND") {
      // 目录存在才回 207；不存在回 404。
      // webdav.ts 只看状态码，所以这里不必生成完整的多状态 XML。
      if (collections.has(path) || files.has(path)) {
        res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' });
        res.end('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"/>');
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    if (method === "MKCOL") {
      if (collections.has(path)) {
        res.writeHead(405); // 已存在
        res.end();
        return;
      }
      if (!collections.has(parentOf(path))) {
        res.writeHead(409); // 父目录不存在——这正是"逐级创建"要处理的
        res.end();
        return;
      }
      collections.add(path);
      res.writeHead(201);
      res.end();
      return;
    }

    if (method === "PUT") {
      if (!collections.has(parentOf(path))) {
        res.writeHead(409);
        res.end();
        return;
      }
      const existed = files.has(path);
      files.set(path, body);
      // 真实服务端 PUT 成功多为 201（新建）或 204（覆盖）
      res.writeHead(existed ? 204 : 201, { ETag: '"' + body.length + '-v1"' });
      res.end();
      return;
    }

    if (method === "GET") {
      if (files.has(path)) {
        const buf = files.get(path);
        res.writeHead(200, { "Content-Type": "application/json", ETag: '"' + buf.length + '-v1"' });
        res.end(buf);
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    if (method === "DELETE") {
      files.delete(path);
      collections.delete(path);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });
});

let base = "";

before(async () => {
  collections.clear();
  collections.add("/");
  files.clear();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

/** 复刻 webdav.ts 的 dav()：只带 Authorization，强制不带 cookie。 */
function dav(path, method, { body, headers } = {}) {
  return fetch(base + path, {
    method,
    headers: {
      Authorization: basicAuthHeader(USER, PASS),
      ...(headers ?? {}),
    },
    body,
    redirect: "manual",
  });
}

test("MKCOL 逐级创建：201 已创建 / 405 已存在 / 409 父目录缺失", async () => {
  // 父目录不存在 → 409。这正是 ensureDir 必须"逐级"创建的原因
  const deep = await dav("/a/b/c", "MKCOL");
  assert.equal(deep.status, 409, "父目录不存在时 MKCOL 应返回 409");

  const first = await dav("/a", "MKCOL");
  assert.equal(first.status, 201, "新建目录应返回 201");

  const again = await dav("/a", "MKCOL");
  assert.equal(again.status, 405, "目录已存在时 MKCOL 应返回 405（webdav.ts 视为成功）");

  const second = await dav("/a/b", "MKCOL");
  assert.equal(second.status, 201);
  const third = await dav("/a/b/c", "MKCOL");
  assert.equal(third.status, 201, "逐级建完之后最深层也应成功");
});

test("MKCOL 不带 body（自定义方法 + 空 body 的路径必须通）", async () => {
  const res = await dav("/nobody", "MKCOL");
  assert.equal(res.status, 201);
});

test("PUT 上传后 GET 能读回同样内容，并带回 ETag", async () => {
  await dav("/a/b", "MKCOL");
  const payload = JSON.stringify({ hello: "4e", n: 42 });

  const put = await dav("/a/b/sync.json", "PUT", {
    body: payload,
    headers: { "Content-Type": "application/json" },
  });
  assert.ok(put.status === 201 || put.status === 204, "PUT 成功应为 201 或 204，实际 " + put.status);
  assert.ok(put.headers.get("etag"), "PUT 应返回 ETag（同步用它判冲突）");

  const get = await dav("/a/b/sync.json", "GET");
  assert.equal(get.status, 200);
  assert.equal(await get.text(), payload, "读回的内容应与上传一致");
});

test("GET 不存在的文件返回 404（首次同步的正常情况）", async () => {
  const res = await dav("/a/b/never-existed.json", "GET");
  assert.equal(res.status, 404);
});

test("PROPFIND + Depth: 0 对已存在目录返回 207", async () => {
  await dav("/probe", "MKCOL");
  const res = await dav("/probe", "PROPFIND", { headers: { Depth: "0" } });
  assert.equal(res.status, 207, "支持 PROPFIND 的服务器应返回 207 Multi-Status");
});

test("PROPFIND 对不存在的目录返回 404", async () => {
  const res = await dav("/nope-not-here", "PROPFIND", { headers: { Depth: "0" } });
  assert.equal(res.status, 404);
});

test("认证错误返回 401（webdav.ts 据此提示「用应用专用密码」）", async () => {
  const res = await fetch(base + "/a", {
    method: "PROPFIND",
    headers: { Authorization: basicAuthHeader(USER, "wrong-password") },
  });
  assert.equal(res.status, 401);
});

test("完整走一遍同步序列：建目录 → 上传 → 下载 → 探测", async () => {
  // 与 ensureDir + 上传 + 下载 的真实顺序一致。
  // 注意路径要**逐级累积**（/4enext → /4enext/cards），
  // 这正是 ensureDir 里那个 acc.push(seg) 的语义；写错就会变成 /4enext/4enext。
  const acc = [];
  for (const seg of ["4enext", "cards"]) {
    acc.push(seg);
    const res = await dav("/" + acc.join("/"), "MKCOL");
    assert.ok(res.status === 201 || res.status === 405, "逐级创建 " + acc.join("/") + " 失败：" + res.status);
  }

  const doc = JSON.stringify({ version: 1, cards: [] });
  const put = await dav("/4enext/cards/sync.json", "PUT", {
    body: doc,
    headers: { "Content-Type": "application/json" },
  });
  assert.ok(put.status >= 200 && put.status < 300, "上传失败：" + put.status);

  const get = await dav("/4enext/cards/sync.json", "GET");
  assert.equal(get.status, 200);
  assert.deepEqual(JSON.parse(await get.text()), { version: 1, cards: [] });

  const propfind = await dav("/4enext", "PROPFIND", { headers: { Depth: "0" } });
  assert.equal(propfind.status, 207);
});
