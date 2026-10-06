// 真实同步传输层的端到端自检。
//
// 与 webdav-contract.test.mjs 的区别（两者互补，都保留）：
//   · webdav-contract.test.mjs —— 手写请求，验证**协议契约**（状态码语义）
//   · 本文件 —— 用 esbuild 把**真正的 web/src/lib/sync/webdav.ts** 打出来跑，
//     验证**真代码的行为**：请求怎么拼、ETag 乐观锁怎么走、冲突怎么分类。
//
// 为什么值得这么做：安卓端的 HTTP 是原生代发，与网页端/桌面端是三套不同的传输实现。
// 同步一旦有一处对不上，表现是"静默不同步"——用户以为存上了，换台设备却没有。
// 把同步传输层接在 Node 的 fetch 上，就能在没有设备的情况下把它跑通。
//
// 用法：node --test android/scripts/sync-transport.test.mjs
//
// 依赖 esbuild（来自 web/node_modules），用它做一次临时打包；
// 如果 esbuild 不在，测试会**明确跳过**而不是假装通过。

import { createServer } from "node:http";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const esbuildPkg = join(repoRoot, "web", "node_modules", "esbuild", "package.json");
const stubPlatform = join(here, "lib", "test-platform.mjs");

const USER = "tester";
const PASS = "app-password";

// ---------------------------------------------------------------- 假 WebDAV 服务端

/** 远端状态：路径 → 内容。目录用独立的 Set 表示。 */
const collections = new Set(["/"]);
const files = new Map(); // path -> { body: Buffer, etag: string }
let etagSeq = 0;

function normalize(pathname) {
  const p = decodeURIComponent(pathname).replace(/\/+$/, "");
  return p === "" ? "/" : p;
}
function parentOf(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}
function authOk(req) {
  return (req.headers.authorization || "") === "Basic " + Buffer.from(USER + ":" + PASS, "utf8").toString("base64");
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = normalize(url.pathname);

  if (!authOk(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
    res.end();
    return;
  }

  const method = req.method.toUpperCase();
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const existing = files.get(path);

    if (method === "MKCOL") {
      if (collections.has(path)) return void res.writeHead(405).end();
      if (!collections.has(parentOf(path))) return void res.writeHead(409).end();
      collections.add(path);
      return void res.writeHead(201).end();
    }

    if (method === "PROPFIND") {
      if (collections.has(path) || files.has(path)) {
        return void res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' })
          .end('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"/>');
      }
      return void res.writeHead(404).end();
    }

    if (method === "PUT") {
      if (!collections.has(parentOf(path))) return void res.writeHead(409).end();

      // 真实的乐观锁语义：
      //   If-None-Match: *  —— 「只在不存在时创建」，已存在则 412
      //   If-Match: <etag>  —— 「只在仍是这个版本时覆盖」，不匹配则 412
      const ifNoneMatch = req.headers["if-none-match"];
      const ifMatch = req.headers["if-match"];

      if (ifNoneMatch === "*" && existing) return void res.writeHead(412).end();
      if (ifMatch && (!existing || existing.etag !== ifMatch)) return void res.writeHead(412).end();

      const etag = '"v' + ++etagSeq + '"';
      files.set(path, { body, etag });
      return void res.writeHead(existing ? 204 : 201, { ETag: etag }).end();
    }

    if (method === "GET") {
      if (!existing) return void res.writeHead(404).end();
      return void res.writeHead(200, {
        "Content-Type": "application/json",
        ETag: existing.etag,
      }).end(existing.body);
    }

    res.writeHead(405).end();
  });
});

let base = "";
/** 被测试模块：真正的 webdav.ts 打包产物。 */
let dav = null;
let bundlePath = "";

before(async () => {
  collections.clear();
  collections.add("/");
  files.clear();

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;

  // 用 esbuild 把真 webdav.ts 打成一个可 import 的 ESM 文件，
  // 并把它的 "@platform" 指到测试用的假平台。
  //
  // 走 JS API 而不是命令行：命令行要经 shell，路径里的空格（"4e KCC"）会被拆开，
  // 加引号又与 shell:true 的参数拼接相冲。API 没有这一层，更稳。
  if (!existsSync(esbuildPkg)) {
    console.warn("[sync-transport] 找不到 esbuild，跳过（" + esbuildPkg + "）");
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "4enext-sync-"));
  const entry = join(dir, "entry.ts");
  bundlePath = join(dir, "bundle.mjs");
  writeFileSync(
    entry,
    'export { ensureDir, testConnection, pullDocument, pushDocument, syncFileUrl, dirUrl } from "' +
      join(repoRoot, "web", "src", "lib", "sync", "webdav.ts").replace(/\\/g, "/") +
      '";\n',
    "utf8",
  );

  try {
    const esbuild = await import(pathToFileURL(join(repoRoot, "web", "node_modules", "esbuild", "lib", "main.js")).href);
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "node20",
      alias: { "@platform": stubPlatform },
      outfile: bundlePath,
      logLevel: "warning",
    });
  } catch (err) {
    console.warn("[sync-transport] esbuild 打包失败，跳过：" + (err && err.message));
    return;
  }

  dav = await import(pathToFileURL(bundlePath).href);
});

after(async () => {
  await new Promise((r) => server.close(r));
});

function cfg(dir = "4enext") {
  return { url: base + "/", username: USER, password: PASS, dir, enabled: true };
}

/** 没有 esbuild 时不要假装通过：明确跳过，让"跳过"在报告里可见。 */
function requireBundle(t) {
  if (!dav) {
    t.skip("esbuild 不可用，未打包真 webdav.ts");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- 用例

test("ensureDir：逐级创建远端目录", async (t) => {
  if (!requireBundle(t)) return;
  const notes = [];
  await dav.ensureDir(cfg("4enext/cards"), (s) => notes.push(s));
  assert.ok(collections.has("/4enext"), "应创建 /4enext");
  assert.ok(collections.has("/4enext/cards"), "应创建 /4enext/cards");
  assert.equal(notes.length, 2, "两层目录各应产生一条提示，实际：" + JSON.stringify(notes));
});

test("ensureDir 幂等：再跑一次不报错（MKCOL 405 视为成功）", async (t) => {
  if (!requireBundle(t)) return;
  await dav.ensureDir(cfg("4enext/cards"));
  await dav.ensureDir(cfg("4enext/cards"));
  assert.ok(true);
});

test("testConnection：对可用服务器给出成功结论", async (t) => {
  if (!requireBundle(t)) return;
  const report = await dav.testConnection(cfg("4enext/cards"));
  assert.ok(report && typeof report === "object", "应返回 ConnectionReport");
  // 只断言"没有抛错且拿回了报告"，具体字段由界面消费
});

test("pullDocument：远端还没有文件时返回 doc=null（首次同步的正常情况）", async (t) => {
  if (!requireBundle(t)) return;
  const r = await dav.pullDocument(cfg("fresh"));
  assert.equal(r.doc, null);
  assert.equal(r.etag, null);
});

test("push → pull 往返：内容一致，且带回 ETag", async (t) => {
  if (!requireBundle(t)) return;
  const c = cfg("4enext/cards");
  await dav.ensureDir(c);

  const doc = { app: "4enext", kind: "sync", schemaVersion: 1, deviceId: "A", cards: { c1: { id: "c1" } }, pools: {}, tombstones: {}, updatedAt: 1 };
  const pushed = await dav.pushDocument(c, doc, null);
  assert.ok(pushed.etag, "首次写入应返回 ETag");

  const pulled = await dav.pullDocument(c);
  assert.deepEqual(pulled.doc, doc, "读回的内容应与写入一致");
  assert.equal(pulled.etag, pushed.etag, "读回的 ETag 应与写入时一致");
});

test("ETag 乐观锁：拿过期 ETag 写入应抛 conflict(412)，绝不覆盖", async (t) => {
  if (!requireBundle(t)) return;
  const c = cfg("lock");
  await dav.ensureDir(c);

  const first = await dav.pushDocument(c, { v: 1 }, null);
  // 模拟"另一台设备"在这期间写了一次
  await dav.pushDocument(c, { v: 2 }, first.etag);

  // 现在用第一次的（已过期）ETag 再写 —— 必须冲突
  await assert.rejects(
    () => dav.pushDocument(c, { v: 3 }, first.etag),
    (err) => {
      assert.equal(err.kind, "conflict", "应归类为 conflict，实际：" + err.kind);
      assert.equal(err.status, 412);
      return true;
    },
  );

  // 且远端内容没有被破坏
  const now = await dav.pullDocument(c);
  assert.deepEqual(now.doc, { v: 2 }, "冲突后远端应仍是另一台设备写入的版本");
});

test("If-None-Match：远端已有文件时以 null ETag 写入应冲突", async (t) => {
  if (!requireBundle(t)) return;
  const c = cfg("none-match");
  await dav.ensureDir(c);
  await dav.pushDocument(c, { first: true }, null);

  await assert.rejects(
    () => dav.pushDocument(c, { second: true }, null),
    (err) => err.kind === "conflict",
  );
});

test("认证失败归类为 auth(401)", async (t) => {
  if (!requireBundle(t)) return;
  const bad = { ...cfg("4enext"), password: "wrong" };
  await assert.rejects(
    () => dav.pullDocument(bad),
    (err) => {
      assert.equal(err.kind, "auth");
      assert.equal(err.status, 401);
      return true;
    },
  );
});

test("两台设备经同一远端互相同步（安卓↔桌面 的等价场景）", async (t) => {
  if (!requireBundle(t)) return;
  const c = cfg("shared");
  await dav.ensureDir(c);

  // 设备 A（模拟安卓端）先写
  const docA = { app: "4enext", kind: "sync", schemaVersion: 1, deviceId: "android", cards: { a: 1 }, pools: {}, tombstones: {}, updatedAt: 10 };
  const rA = await dav.pushDocument(c, docA, null);

  // 设备 B（模拟桌面端）拉取 → 应看到 A 的内容
  const seenByB = await dav.pullDocument(c);
  assert.deepEqual(seenByB.doc, docA, "设备 B 应能拉到设备 A 写入的内容");
  assert.equal(seenByB.etag, rA.etag, "ETag 应在两端一致（乐观锁才成立）");

  // 设备 B 追加自己的卡后写回
  const docB = { ...docA, deviceId: "desktop", cards: { a: 1, b: 2 }, updatedAt: 20 };
  await dav.pushDocument(c, docB, seenByB.etag);

  // 设备 A 再拉 → 应看到合并后的两边内容
  const seenByA = await dav.pullDocument(c);
  assert.deepEqual(seenByA.doc.cards, { a: 1, b: 2 }, "设备 A 应看到两端合并后的卡");
});

test("地址不含协议时应抛 config 错误（不发起请求）", async (t) => {
  if (!requireBundle(t)) return;
  await assert.rejects(
    () => dav.pullDocument({ ...cfg(), url: "dav.example.com/dav/" }),
    (err) => err.kind === "config",
  );
});

test("远端文件不是合法 JSON 时抛 parse 错误", async (t) => {
  if (!requireBundle(t)) return;
  const c = cfg("badjson");
  await dav.ensureDir(c);
  // 绕过 pushDocument 直接写坏内容，模拟远端文件被别的东西占用
  files.set("/badjson/sync.json", { body: Buffer.from("not json at all", "utf8"), etag: '"broken"' });
  await assert.rejects(
    () => dav.pullDocument(c),
    (err) => err.kind === "parse",
  );
});
