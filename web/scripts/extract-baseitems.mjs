// 从 wiki 提取基础武器/护甲表与武器特性定义 → 生成 web/src/lib/baseitems-data.ts
import fs from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rawPath = join(here, "..", "..", "out", "raw", "tiddlers-raw.jsonl");
const outPath = join(here, "..", "src", "lib", "baseitems-data.ts");

const raws = fs.readFileSync(rawPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const wep = raws.find((t) => t.title === "武器");
const arm = raws.find((t) => t.title === "护甲");
if (!wep || !arm) { console.error("缺少武器/护甲参考页"); process.exit(1); }

function strip(html) {
  return html.replace(/<br[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\^\^[^\^]*\^\^/g, "").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}

// 行内单元格：多行（<br> 副手端）取主端
function cell(td) {
  return td.split("\n")[0].replace(/\s+$/, "").trim();
}

// 擅长加值：解析 "+N"（如 +2/+3），"—"/空则 0
function parseProf(s) {
  const m = String(s).match(/\+(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// 检定/速度减值：解析 "-N"；"—"/空则为 0
function parseSorP(s) {
  const m = String(s).match(/(-\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseTables(html) {
  const out = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = tableRe.exec(html))) {
    const body = m[1];
    const capM = body.match(/<caption[^>]*>([\s\S]*?)<\/caption>/);
    const rows = [...body.matchAll(/<tr(?: [^>]*)?>([\s\S]*?)<\/tr>/g)];
    const groups = [];
    let cur = null;
    for (const rm of rows) {
      const rawTds = [...rm[1].matchAll(/<td(?: [^>]*)?>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
      if (rawTds.length < 7) continue;
      const tds = rawTds.map(strip);
      const isTitle = tds[0].includes("（轻甲）") || tds[0].includes("（重甲）");
      if (isTitle) {
        // 护甲组标题行：开启新组；标题行本身可能是基础护甲条目（第二格为 +N）
        cur = { name: tds[0], entry: tds, rows: [] };
        groups.push(cur);
        continue;
      }
      if (!tds[0] || /^(武器|护甲加值)/.test(tds[0])) continue;
      if (cur) cur.rows.push(tds);
      else groups.push({ name: "", entry: null, rows: [tds] });
    }
    if (groups.length) out.push({ caption: capM ? strip(capM[1]) : "", groups });
  }
  return out;
}

const weapons = [];
const secRe = /!! (.+?)\n([\s\S]*?)(?=!! |\n! |$)/g;
let sm;
while ((sm = secRe.exec(wep.text))) {
  if (!sm[1].includes("武器")) continue;
  const tables = parseTables(sm[2]);
  for (const t of tables) {
    const isDouble = t.caption === "双头武器" || sm[1] === "双头武器";
    for (const g of t.groups) {
      for (const r of g.rows) {
        const priceM = String(cell(r[4])).match(/\d+/);
        const name = cell(r[0]).split("—")[0].replace(/\s+$/, "").trim();
        if (!name) continue;
        weapons.push({
          name,
          prof: parseProf(cell(r[1])),
          dice: cell(r[2]) || "",
          range: cell(r[3]) || "",
          traits: [...new Set(r[6].split(/[，,\s]+/).filter(Boolean))].join("，"),
          category: isDouble ? "双头武器" : sm[1] + "·" + t.caption,
          group: cell(r[7]).split(/\s+/)[0] || "",
          price: priceM ? parseInt(priceM[0], 10) : 0,
        });
      }
    }
  }
}

const armors = [];
for (const t of parseTables(arm.text)) {
  for (const g of t.groups) {
    if (!/（(轻甲|重甲)）/.test(g.name)) continue;
    const cat = g.name.includes("重甲") ? "重甲" : "轻甲";
    const rows = [];
    // 标题行自身若是基础护甲条目（第二格为 +N），先入组
    if (g.entry && /^\+/.test(String(g.entry[1]))) rows.push(g.entry);
    rows.push(...g.rows);
    for (const r of rows) {
      const acM = String(r[1]).match(/\+(\d+)/);
      // 新表（9列：检定 r[2]/速度 r[3]/特性 r[6]）与旧表（8列：检定 r[3]/速度 r[4]/特殊 r[7]）列序不同
      const special = String(r.length >= 9 ? r[6] : r[7] || "").trim();
      const enhM = String(r[2]).match(/\+(\d+)/);
      const check = parseSorP(r.length >= 9 ? r[2] : r[3]);
      const speed = parseSorP(r.length >= 9 ? r[3] : r[4]);
      // 新表（9列：价格在 r[4]）与旧表（8列：价格在 r[5]）列序不同
      const priceM = String((r.length >= 9 ? r[4] : r[5]) || "").match(/\d+/);
      armors.push({
        name: r[0].replace(/ Armor$/i, "").replace(/（(轻甲|重甲)）/g, "").replace(/ \(light\)$/i, "").replace(/ \(heavy\)$/i, "").trim(),
        ac: acM ? parseInt(acM[1], 10) : 0,
        category: cat,
        masterwork: !!enhM,
        minEnhance: enhM ? parseInt(enhM[1], 10) : 0,
        check,
        speed,
        special,
        price: priceM ? parseInt(priceM[0], 10) : 0,
      });
    }
  }
}

const defs = {};
const defSec = wep.text.match(/! 武器特性 Weapon Properties[\s\S]*?"""([\s\S]*?)"""/);
if (defSec) {
  const re = /''([^'']+?)：''([\s\S]*?)(?=''[^'']+?：''|"""|$)/g;
  let dm;
  while ((dm = re.exec(defSec[1]))) {
    const name = dm[1].replace(/\s+[A-Za-z][A-Za-z \-]*$/, "").trim();
    defs[name] = dm[2].replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  }
}
if (defs["装填"]) { defs["自由装填"] = defs["装填"]; defs["次要装填"] = defs["装填"]; }

console.log("weapons:", weapons.length, "| armors:", armors.length, "| property defs:", Object.keys(defs).length);

const lines = [
  "// 自动生成：基础物品数据（来源：wiki「武器」「护甲」参考页），请勿手改，重新运行 scripts/extract-baseitems.mjs 生成",
  "import type { BaseWeapon, BaseArmor } from \"./baseitems\";",
  "",
  "export const BASE_WEAPONS: BaseWeapon[] = [",
  ...weapons.map((w) => "  { name: " + JSON.stringify(w.name) + ", prof: " + (w.prof ?? 0) + ", dice: " + JSON.stringify(w.dice) + ", range: " + JSON.stringify(w.range ?? "") + ", traits: " + JSON.stringify(w.traits) + ", category: " + JSON.stringify(w.category) + ", group: " + JSON.stringify(w.group) + ", price: " + (w.price ?? 0) + " },"),
  "];",
  "",
  "export const BASE_ARMORS: BaseArmor[] = [",
  ...armors.map((a) => "  { name: " + JSON.stringify(a.name) + ", ac: " + a.ac + ", category: " + JSON.stringify(a.category) + ", masterwork: " + !!a.masterwork + ", minEnhance: " + (a.minEnhance ?? 0) + ", check: " + (a.check ?? 0) + ", speed: " + (a.speed ?? 0) + ", special: " + JSON.stringify(a.special ?? "") + ", price: " + (a.price ?? 0) + " },"),
  "];",
  "",
  "// 武器特性完整定义（来源：wiki「武器」页）",
  "export const PROPERTY_DEFS: Record<string, string> = {",
  ...Object.entries(defs).map(([k, v]) => "  " + JSON.stringify(k) + ": " + JSON.stringify(v) + ","),
  "};",
].join("\n");

fs.writeFileSync(outPath, lines + "\n");
console.log("written:", outPath);
