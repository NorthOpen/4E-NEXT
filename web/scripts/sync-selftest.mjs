#!/usr/bin/env node
// 同步逻辑自测：合并算法（纯函数）+ 双设备端到端模拟（真实 document.ts 路径）。
//
//   用法：node web/scripts/sync-selftest.mjs
//
// 为什么值得单独留着：同步的失败模式是「用户悄悄丢一张精心车出来的角色卡」，
// 而且只在多设备、多次同步、恰好并发改动时才暴露。这里把那些不变量钉死。
// 不参与构建（web/scripts 不在 web/tsconfig.json 的 include 内）。

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const webSrc = path.join(repoRoot, "web", "src");
const tsc = path.join(repoRoot, "web", "node_modules", "typescript", "bin", "tsc");

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log("  PASS  " + name);
  } catch (e) {
    fail++;
    console.log("  FAIL  " + name + "\n        " + (e && e.message));
  }
}

function compile(outDir, files) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "package.json"), '{ "type": "commonjs" }\n');
  const res = spawnSync(
    process.execPath,
    [
      tsc,
      ...files.map((f) => path.join(webSrc, "lib", f)),
      "--outDir", outDir,
      "--module", "commonjs",
      "--target", "ES2022",
      "--moduleResolution", "node10",
      "--skipLibCheck",
    ],
    // stdio 用 inherit 而不是默认的管道：编译器报错能直接看到，
    // 同时也避开「受限环境下不允许管道 stdio」的限制。
    { stdio: "inherit" },
  );
  if (res.status !== 0) throw new Error("tsc 编译失败，无法运行自测");
  return createRequire(path.join(outDir, "noop.cjs"));
}

// ---------------------------------------------------------------- 合并算法
function unitTests(require) {
  const M = require("./merge.js");

  function card(id, name, updatedAt) { return { id, name, updatedAt, char: { name, level: 1 } }; }
  function pool(id, name, iso) { return { id, name, createdAt: iso, updatedAt: iso, enabled: true, entries: [] }; }
  const HOOKS = {
    card: {
      copy: (rec, now) => {
        const id = rec.id + "-copy";
        return M.makeRecord(id, now, { ...rec.data, id, name: rec.data.name + "（冲突副本）", updatedAt: now });
      },
      nameOf: (d) => d.name,
    },
    pool: {
      copy: (rec, now) => {
        const id = rec.id + "-copy";
        const iso = new Date(now).toISOString();
        return M.makeRecord(id, now, { ...rec.data, id, name: rec.data.name + "（冲突副本）", updatedAt: iso });
      },
      nameOf: (d) => d.name,
    },
  };
  function doc(device, cards, pools, tombstones) {
    const d = M.emptyDocument(device);
    for (const c of cards || []) d.cards[c.id] = M.makeRecord(c.id, c.updatedAt, c);
    for (const p of pools || []) d.pools[p.id] = M.makeRecord(p.id, Date.parse(p.updatedAt), p);
    d.tombstones = tombstones || {};
    return d;
  }

  test("首次同步：本地两条 / 远端空 → 全部推送，无冲突", () => {
    const res = M.mergeDocuments(doc("A", [card("c1", "甲", 1000), card("c2", "乙", 2000)], []), M.emptyDocument("B"), {}, 3000, HOOKS);
    assert.equal(Object.keys(res.merged.cards).length, 2);
    assert.equal(res.stats.cardsPushed, 2);
    assert.equal(res.conflicts.length, 0);
  });
  test("远端新增 → 拉取", () => {
    const before = doc("A", [card("c1", "甲", 1000)], []);
    const res = M.mergeDocuments(doc("A", [card("c1", "甲", 1000)], []), doc("B", [card("c1", "甲", 1000), card("c9", "己", 5000)], []), M.documentToBase(before), 6000, HOOKS);
    assert.deepEqual(Object.keys(res.merged.cards), ["c1", "c9"]);
    assert.equal(res.stats.cardsPulled, 1);
  });
  test("本地改了 / 远端没改 → 推送，不产生冲突", () => {
    const before = doc("A", [card("c1", "甲", 1000)], []);
    const res = M.mergeDocuments(doc("A", [card("c1", "甲改", 2000)], []), doc("B", [card("c1", "甲", 1000)], []), M.documentToBase(before), 3000, HOOKS);
    assert.equal(res.merged.cards.c1.data.name, "甲改");
    assert.equal(res.conflicts.length, 0);
  });
  test("两侧都改同一条 → 保留本地 + 生成冲突副本，一条都不能丢", () => {
    const before = doc("A", [card("c1", "甲", 1000)], []);
    const res = M.mergeDocuments(doc("A", [card("c1", "甲本机", 2000)], []), doc("B", [card("c1", "甲远端", 2500)], []), M.documentToBase(before), 3000, HOOKS);
    assert.equal(Object.keys(res.merged.cards).length, 2);
    assert.equal(res.merged.cards.c1.data.name, "甲本机");
    assert.equal(res.merged.cards["c1-copy"].data.name, "甲远端（冲突副本）");
    assert.equal(res.conflicts.length, 1);
  });
  test("私设包同样走冲突副本逻辑", () => {
    const before = doc("A", [], [pool("p1", "包", "2026-01-01T00:00:00.000Z")]);
    const res = M.mergeDocuments(
      doc("A", [], [pool("p1", "包本机", "2026-01-02T00:00:00.000Z")]),
      doc("B", [], [pool("p1", "包远端", "2026-01-03T00:00:00.000Z")]),
      M.documentToBase(before), 4000, HOOKS);
    assert.equal(res.merged.pools.p1.data.name, "包本机");
    assert.equal(res.merged.pools["p1-copy"].data.name, "包远端（冲突副本）");
  });
  test("合并结果再合并一次 → 幂等", () => {
    const before = doc("A", [card("c1", "甲原始", 1000), card("c2", "乙", 1000)], []);
    const local = doc("A", [card("c1", "甲本机", 2000), card("c2", "乙", 1000)], []);
    const remote = doc("B", [card("c1", "甲远端", 2500), card("c2", "乙", 1000)], []);
    const first = M.mergeDocuments(local, remote, M.documentToBase(before), 3000, HOOKS);
    assert.equal(Object.keys(first.merged.cards).length, 3);
    const second = M.mergeDocuments(first.merged, first.merged, M.documentToBase(first.merged), 9000, HOOKS);
    assert.equal(second.stats.cardsPushed + second.stats.cardsPulled, 0);
    assert.equal(second.conflicts.length, 0);
    assert.equal(Object.keys(second.merged.cards).length, 3);
  });
  test("墓碑合并：两侧各删一条 → 两个墓碑都保留", () => {
    const res = M.mergeDocuments(doc("A", [], [], { "card:a": 2000 }), doc("B", [], [], { "card:b": 1500 }), {}, 3000, HOOKS);
    assert.deepEqual(res.merged.tombstones, { "card:a": 2000, "card:b": 1500 });
  });
  test("删除：本地删掉且有墓碑，对端未改 → 保持删除", () => {
    const before = doc("A", [card("c1", "甲", 1000), card("c2", "乙", 1000)], []);
    const res = M.mergeDocuments(
      doc("A", [card("c2", "乙", 1000)], [], { "card:c1": 2000 }),
      doc("B", [card("c1", "甲", 1000), card("c2", "乙", 1000)], []),
      M.documentToBase(before), 3000, HOOKS);
    assert.equal(res.merged.cards.c1, undefined);
    assert.equal(res.stats.deleted, 1);
  });
  test("删除 vs 编辑：编辑更新则复活，并撤销墓碑", () => {
    const before = doc("A", [card("c1", "甲", 1000), card("c2", "乙", 1000)], []);
    const res = M.mergeDocuments(
      doc("A", [card("c2", "乙", 1000)], [], { "card:c1": 2000 }),
      doc("B", [card("c1", "甲远端改", 5000), card("c2", "乙", 1000)], []),
      M.documentToBase(before), 6000, HOOKS);
    assert.ok(res.merged.cards.c1);
    assert.equal(res.merged.tombstones["card:c1"], undefined);
  });
  test("远端整体缺失本地记录且无墓碑 → 不回删本地（保守）", () => {
    const before = doc("A", [card("c1", "甲", 1000)], []);
    const res = M.mergeDocuments(doc("A", [card("c1", "甲", 1000)], []), M.emptyDocument("B"), M.documentToBase(before), 3000, HOOKS);
    assert.ok(res.merged.cards.c1);
  });
  test("卡片顺序：本地顺序不被远端打乱", () => {
    const res = M.mergeDocuments(doc("A", [card("c3", "丙", 1000), card("c1", "甲", 1000)], []), doc("B", [card("c1", "甲", 1000), card("c9", "己", 1000)], []), {}, 2000, HOOKS);
    assert.deepEqual(Object.keys(res.merged.cards), ["c3", "c1", "c9"]);
  });
  test("内容哈希与键序无关，内容变了哈希必变", () => {
    assert.equal(M.recordHash({ a: 1, b: { c: 2, d: 3 } }), M.recordHash({ b: { d: 3, c: 2 }, a: 1 }));
    assert.notEqual(M.recordHash(card("c1", "甲", 1000)), M.recordHash(card("c1", "乙", 1000)));
  });
  test("checkDocument 挡住非本文档 / 更高版本 / 结构损坏", () => {
    assert.equal(M.checkDocument(null).ok, false);
    assert.equal(M.checkDocument({}).reason, "not-sync");
    assert.equal(M.checkDocument({ app: "4enext", kind: "sync", schemaVersion: 99 }).reason, "too-new");
    assert.equal(M.checkDocument({ app: "4enext", kind: "sync", schemaVersion: 1, cards: 5 }).reason, "malformed");
    assert.equal(M.checkDocument({ app: "4enext", kind: "sync", schemaVersion: 1 }).ok, true);
  });
  test("墓碑过期清理（180 天）", () => {
    const now = 1000 + 181 * 24 * 3600 * 1000;
    assert.deepEqual(M.pruneTombstones({ "card:x": 1000, "card:y": now - 1000 }, now), { "card:y": now - 1000 });
  });
}

// ------------------------------------------------- 双设备端到端（真实代码路径）
function integrationTests(require) {
  const doc = require("./lib/sync/document.js");
  const merge = require("./lib/sync/merge.js");
  const storage = require("./lib/storage.js");
  const userdata = require("./lib/userdata.js");

  class FakeStorage {
    constructor() { this.map = new Map(); }
    get length() { return this.map.size; }
    key(i) { return Array.from(this.map.keys())[i] ?? null; }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
    clear() { this.map.clear(); }
  }

  const dev = {
    A: { store: new FakeStorage(), base: {}, tomb: {}, last: 0, id: "devA" },
    B: { store: new FakeStorage(), base: {}, tomb: {}, last: 0, id: "devB" },
  };
  let remote = null;
  let clock = 1000000;

  function sync(name) {
    const d = dev[name];
    globalThis.localStorage = d.store;
    const local = doc.buildLocalDocument(d.id, d.base, d.tomb, d.last);
    clock += 1000;
    const res = doc.mergeLocalRemote(local, remote ?? merge.emptyDocument(d.id), d.base, clock);
    doc.applyDocument(res.merged);
    remote = res.merged;
    d.base = merge.documentToBase(res.merged);
    d.tomb = res.merged.tombstones;
    d.last = clock;
    return res;
  }
  const use = (name) => { globalThis.localStorage = dev[name].store; };
  const namesOf = (name) => { use(name); return storage.loadCards().map((c) => c.name).sort(); };
  const expectNames = (name, expected) => assert.deepEqual(namesOf(name), [...expected].sort());
  const makeCard = (id, name, t) => ({ id, name, updatedAt: t, char: { name, level: 1 } });
  const makePool = (id, name, iso) => ({ id, name, createdAt: iso, updatedAt: iso, enabled: true, entries: [] });
  function editCard(devName, id, newName, t) {
    use(devName);
    storage.saveCards(storage.loadCards().map((c) => (c.id === id ? { ...c, name: newName, updatedAt: t } : c)));
  }
  function deleteCard(devName, id) {
    use(devName);
    storage.saveCards(storage.loadCards().filter((c) => c.id !== id));
  }

  use("A");
  storage.saveCards([makeCard("c1", "阿拉贡", 1000)]);

  test("A 首次同步 → 远端落盘", () => {
    const res = sync("A");
    assert.equal(remote.cards.c1.data.name, "阿拉贡");
    assert.equal(res.stats.cardsPushed, 1);
  });
  test("B 首次同步 → 拉到 A 的卡，无冲突", () => {
    const res = sync("B");
    expectNames("B", ["阿拉贡"]);
    assert.equal(res.conflicts.length, 0);
  });
  test("各改各的：A 改 c1、B 新增 c2 → 双方最终都拿到，无冲突", () => {
    editCard("A", "c1", "阿拉贡（改）", 2000);
    use("B");
    storage.saveCards([...storage.loadCards(), makeCard("c2", "莱戈拉斯", 2100)]);
    const rA = sync("A");
    sync("B");
    sync("A");
    assert.equal(rA.conflicts.length, 0);
    expectNames("A", ["阿拉贡（改）", "莱戈拉斯"]);
    expectNames("B", ["阿拉贡（改）", "莱戈拉斯"]);
  });
  test("真冲突：A 先同步、B 后改再同步 → 生成冲突副本，两版都在", () => {
    editCard("A", "c1", "阿拉贡-A版", 3000);
    sync("A");
    editCard("B", "c1", "阿拉贡-B版", 3100);
    const resB = sync("B");
    assert.equal(resB.conflicts.length, 1);
    const names = namesOf("B");
    assert.ok(names.includes("阿拉贡-B版"));
    assert.ok(names.some((n) => n.includes("冲突副本")));
    assert.ok(names.some((n) => n.includes("阿拉贡-A版")));
  });
  test("冲突经一轮同步后收敛，双方集合一致", () => {
    sync("A");
    assert.deepEqual(namesOf("A"), namesOf("B"));
    assert.equal(namesOf("A").length, 3);
  });
  test("收敛后再同步 → 幂等", () => {
    const res = sync("A");
    assert.equal(res.stats.cardsPushed + res.stats.cardsPulled, 0);
    assert.equal(res.conflicts.length, 0);
  });
  test("删除跨设备传播，且再同步不会复活", () => {
    deleteCard("A", "c2");
    sync("A");
    sync("B");
    assert.ok(!namesOf("B").includes("莱戈拉斯"));
    sync("A");
    sync("B");
    assert.ok(!namesOf("A").includes("莱戈拉斯"));
    assert.ok(!namesOf("B").includes("莱戈拉斯"));
  });
  test("私设包同步与改名传播（ISO 时间戳解析正确）", () => {
    use("A");
    userdata.replaceAllPools([makePool("p1", "我的私设", "2026-02-01T10:00:00.000Z")]);
    sync("A");
    sync("B");
    use("B");
    assert.equal(userdata.loadPools()[0].name, "我的私设");
    userdata.replaceAllPools(userdata.loadPools().map((p) => ({ ...p, name: "我的私设（B改）", updatedAt: "2026-02-02T10:00:00.000Z" })));
    sync("B");
    sync("A");
    use("A");
    assert.equal(userdata.loadPools()[0].name, "我的私设（B改）");
  });
  test("边界：外观设置与 WebDAV 密码都不进同步文档", () => {
    use("A");
    globalThis.localStorage.setItem("4enext.settings.v1", JSON.stringify({ fontMode: "sans" }));
    globalThis.localStorage.setItem("4enext.webdav.v1", JSON.stringify({ url: "https://x/", password: "secret" }));
    const local = doc.buildLocalDocument(dev.A.id, dev.A.base, dev.A.tomb, dev.A.last);
    assert.equal(Object.keys(local).sort().join(","), "app,cards,deviceId,kind,pools,schemaVersion,tombstones,updatedAt");
    const dumped = JSON.stringify(local);
    assert.ok(!dumped.includes("secret"), "WebDAV 密码绝不能出现在同步文档里");
    assert.ok(!dumped.includes("fontMode"), "外观设置不应出现在同步文档里");
  });
}

// ---------------------------------------------------------------------- 跑
const tmp = mkdtempSync(path.join(tmpdir(), "4enext-sync-selftest-"));
try {
  console.log("\n== 合并算法单测 ==");
  unitTests(compile(path.join(tmp, "unit"), ["sync/types.ts", "sync/merge.ts"]));

  console.log("\n== 双设备端到端模拟（真实 document.ts 代码路径） ==");
  integrationTests(compile(path.join(tmp, "integ"), [
    "sync/types.ts", "sync/merge.ts", "sync/document.ts", "storage.ts", "userdata.ts",
  ]));
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

console.log("\n  合计: " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
