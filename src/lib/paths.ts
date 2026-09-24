import { join } from "node:path";

export const DATA_DIR = join(process.cwd(), "data");
export const OUT_DIR = join(process.cwd(), "out");
export const RAW_DIR = join(OUT_DIR, "raw");
export const CANONICAL_DIR = join(OUT_DIR, "canonical");
export const CATEGORIES_DIR = join(OUT_DIR, "categories");
export const INDEX_DIR = join(OUT_DIR, "index");
/** 万律书（4e-rules.html）速查词条产物目录 */
export const RULES_DIR = join(OUT_DIR, "rules");
/** 怪物手册（怪物手册 1~3 合订本 xlsx）管线产物根目录 */
export const MONSTERS_DIR = join(OUT_DIR, "monsters");
/** 无损层：逐行原文 + 总表/目录/计数 */
export const MONSTERS_RAW_DIR = join(MONSTERS_DIR, "raw");
/** 分块层：章节与怪物块 */
export const MONSTERS_BLOCKS_DIR = join(MONSTERS_DIR, "blocks");
/** 规范层：每条怪物一个对象 + 溯源哈希 */
export const MONSTERS_CANONICAL_DIR = join(MONSTERS_DIR, "canonical");
/** 派生层：前端可直接加载的扁平数组 */
export const MONSTERS_CATEGORIES_DIR = join(MONSTERS_DIR, "categories");
/** 检索索引 */
export const MONSTERS_INDEX_DIR = join(MONSTERS_DIR, "index");
/** 审计：字段抽取覆盖率与未识别行 */
export const MONSTERS_AUDIT_DIR = join(MONSTERS_DIR, "audit");
/** 展示态：4E Wiki creature 词条（TiddlyWiki tiddler）导出 */
export const MONSTERS_TIDDLERS_DIR = join(MONSTERS_DIR, "tiddlers");
export const RAW_FILE = join(RAW_DIR, "tiddlers-raw.jsonl");
