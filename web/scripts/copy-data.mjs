import { cpSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "..", "out");
const dest = join(root, "public", "data");

if (!existsSync(outDir)) {
  console.error("[copy-data] 未找到 out/ 目录，请先运行数据管线（仓库根目录 pnpm pipeline）");
  process.exit(1);
}

mkdirSync(join(dest, "categories"), { recursive: true });

cpSync(join(outDir, "index", "manifest.json"), join(dest, "manifest.json"));
cpSync(join(outDir, "index", "search-index.json"), join(dest, "search-index.json"));
cpSync(join(outDir, "index", "relations.json"), join(dest, "relations.json"));

for (const f of readdirSync(join(outDir, "categories"))) {
  if (f.endsWith(".json") && !f.startsWith("_")) {
    cpSync(join(outDir, "categories", f), join(dest, "categories", f));
  }
}

// 万律书速查词条（可选产物：仓库根目录执行 pnpm rules 后生成）
const rulesFile = join(outDir, "rules", "rules.json");
if (existsSync(rulesFile)) {
  cpSync(rulesFile, join(dest, "rules.json"));
  console.log("[copy-data] rules.json 已同步（万律速查）");
} else {
  console.log("[copy-data] 未找到 out/rules/rules.json，跳过万律速查数据（可执行 pnpm rules 生成）");
}

// 怪物手册（可选产物：仓库根目录执行 pnpm monsters 后生成；来源 xlsx 不随仓库分发）
const monstersDir = join(outDir, "monsters");
const monstersPairs = [
  [join(monstersDir, "categories", "monster.json"), join(dest, "monsters.json")],
  [join(monstersDir, "index", "monsters.json"), join(dest, "monsters-index.json")],
  [join(monstersDir, "index", "manifest.json"), join(dest, "monsters-manifest.json")],
];
let monstersCopied = 0;
for (const [from, to] of monstersPairs) {
  if (existsSync(from)) {
    cpSync(from, to);
    monstersCopied++;
  }
}
console.log(
  monstersCopied > 0
    ? "[copy-data] monsters*.json 已同步（" + monstersCopied + " 个文件，怪物手册）"
    : "[copy-data] 未找到 out/monsters/，跳过怪物数据（可执行 pnpm monsters 生成）"
);

console.log("[copy-data] 数据已同步到 web/public/data/");
