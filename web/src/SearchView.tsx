import { useEffect, useMemo, useState } from "react";
import { FilledTextField, FilledTonalButton } from "./components/md";
import { loadSearchIndex, loadCategory } from "./data/loaders";
import type { SearchEntry, Entry } from "./data/types";
import { CATEGORY_LABELS } from "./data/labels";
import { loadMonsters, type MonsterBlock } from "./data/monsters";
import EntryCard from "./sheet/EntryCard";
import MonsterCard from "./components/MonsterCard";
import { addMonster } from "./data/encounter";

const CAT_ORDER = [
  "race", "class", "paragon-path", "epic-destiny", "feat", "power", "equipment",
  "item-set", "ritual", "theme", "domain", "magic-school", "pact", "vice",
  "virtue", "bloodline", "creature", "reference", "dictionary",
];

// 怪物手册来源（927 条）不是维基词条，单独作为一个检索分类挂进词条页。
// 转成 Entry 形态即可完全复用现有的列表与卡片：category 取 "creature"，
// EntryCard 会走「生物数据卡」那条分支，与主持页的怪物块同一套样式与数据。
const MONSTER_CAT = "monster";
const BOOK_LABELS: Record<string, string> = { MM1: "图鉴 1", MM2: "图鉴 2", MM3: "图鉴 3" };

// 分类条顺序：维基 19 类原样，把「怪物」插在【译名字典】之前
// （怪物手册是独立来源、不属于维基分类体系，但排在末位比排在最前更好找）
const CAT_CHIPS: string[] = CAT_ORDER.flatMap((k) => (k === "dictionary" ? [MONSTER_CAT, k] : [k]));
const chipLabel = (k: string): string => (k === MONSTER_CAT ? "怪物" : (CATEGORY_LABELS[k] ?? k));

function monsterToEntry(m: MonsterBlock): Entry {
  const book = BOOK_LABELS[m.book] ?? m.book;
  return {
    id: m.id,
    name: m.name,
    nameEn: m.nameEn,
    category: "creature",
    // tags 不渲染，只参与检索：章节 / 类别 / 种群 / 职能 / 类型 / 界域 / 等级都塞进来，
    // 列表右侧只留书名与等级，保持一行的可读性。
    tags: [
      m.section, book, m.creatureType, m.creatureGroup, m.role, m.rank, m.origin,
      m.level !== undefined ? "LV" + m.level : "",
    ].filter((x): x is string => Boolean(x)),
    origin: "official",
    source: book + (m.level !== undefined ? " · LV" + m.level : ""),
    sourceText: m.creatureText,
    fields: {},
    wiki: { transclusions: [], links: [], macros: [], headings: [] },
  };
}

export default function SearchView() {
  const [cat, setCat] = useState<string>("race");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Entry | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [index, setIndex] = useState<SearchEntry[]>([]);
  // 映射成 Entry 后 level/hp/bloodied 这些就丢了，「加入遭遇」要用原始块，所以另存一份
  const [blocks, setBlocks] = useState<Map<string, MonsterBlock>>(new Map());
  const [justAdded, setJustAdded] = useState("");

  useEffect(() => {
    setDetail(null);
    setJustAdded("");
    if (cat === "all") {
      setEntries([]);
      void loadSearchIndex().then(setIndex).catch(console.error);
    } else if (cat === MONSTER_CAT) {
      // 与主持页共用同一份缓存（data/monsters.ts 里做了单例），来回切不会重复下载
      setIndex([]);
      void loadMonsters()
        .then((list) => {
          setBlocks(new Map(list.map((m) => [m.id, m])));
          setEntries(list.map(monsterToEntry));
        })
        .catch(console.error);
    } else {
      setIndex([]);
      void loadCategory(cat).then(setEntries).catch(console.error);
    }
  }, [cat]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (cat === "all") {
      if (!q) return [];
      return index.filter((e) => e.text.toLowerCase().includes(q)).slice(0, 80);
    }
    if (!q) return entries;
    return entries.filter((e) => (e.name + " " + (e.nameEn ?? "") + " " + e.tags.join(" ") + " " + (e.source ?? "")).toLowerCase().includes(q));
  }, [cat, query, entries, index]);

  async function open(e: Entry | SearchEntry) {
    try {
      if (cat === "all") {
        const list = await loadCategory(e.category);
        setDetail(list.find((x) => x.id === e.id) ?? null);
      } else {
        setDetail(e as Entry);
      }
    } catch (err) {
      console.error(err);
    }
  }

  const catLabel = cat === MONSTER_CAT ? "怪物" : (CATEGORY_LABELS[cat] ?? cat);

  return (
    <div className="search-view">
      <div className="search-row">
        <FilledTextField value={query} label={cat === "all" ? "全局搜索（名称/关键词/出处）" : "搜索" + catLabel} onInput={(e) => setQuery((e.target as any).value ?? "")} />
      </div>
      <div className="cat-chips">
        {CAT_CHIPS.map((k) => (
          <button key={k} type="button" className={cat === k ? "chip active" : "chip"} onClick={() => setCat(k)}>{chipLabel(k)}</button>
        ))}
        <button type="button" className={cat === "all" ? "chip active" : "chip"} onClick={() => setCat("all")}>全部 · 全局搜索</button>
      </div>
      <div className="meta">
        {cat === "all"
          ? (query ? "结果 " + results.length + " 条（全局）" : "输入关键词开始全局搜索（索引共 " + index.length + " 条）")
          : catLabel + " 共 " + entries.length + " 条" + (query ? " · 匹配 " + results.length : "")}
      </div>
      <div className="split">
        <div className="result-list">
          {results.map((r) => (
            <button key={r.id} type="button" className="result-item" onClick={() => open(r)}>
              <span className="result-name">{r.name}{r.nameEn ? " " + r.nameEn : ""}</span>
              <span className="result-cat">{(CATEGORY_LABELS[r.category] ?? r.category)}{r.source ? " · " + r.source : ""}</span>
            </button>
          ))}
        </div>
        <div className="entry-detail">
          {/* 怪物数据本身就是一张完整卡片，直接用 MonsterCard，不再套 GenericCard 外壳。
              详情上方给一个「加入遭遇」：检索与筛选在词条页做，选中后一步落到主持模式的遭遇面板。 */}
          {detail && cat === MONSTER_CAT && (
            <div className="detail-actions">
              <FilledTonalButton
                disabled={!blocks.has(detail.id)}
                onClick={() => {
                  const block = blocks.get(detail.id);
                  if (!block) return;
                  addMonster(block);
                  setJustAdded(detail.id);
                  window.setTimeout(() => setJustAdded(""), 1600);
                }}
              >
                {justAdded === detail.id ? "已加入遭遇 ✓" : "加入遭遇"}
              </FilledTonalButton>
            </div>
          )}
          {detail && (cat === MONSTER_CAT
            ? <MonsterCard text={detail.sourceText} />
            : <EntryCard entry={detail} />)}
        </div>
      </div>
    </div>
  );
}