import { useEffect, useMemo, useState } from "react";
import SheetDialog from "./SheetDialog";
import { FilledTextField, IconButton, TextButton } from "./md";
import { addMonster } from "../data/encounter";
import { loadMonsters, peekMonsters, bookLabel, baseRank, type MonsterBlock } from "../data/monsters";

/**
 * 添加怪物（二级弹窗）。
 *
 * 主持页是工作台，选择动作不该挤在页面里——检索与筛选收进这个弹窗：
 *   · 上方一行搜索框（名称 / 英文 / 章节）+ 一次加入几只的步进器
 *   · 下方若干组筛选 chip（图鉴 / 等级 / 职能 / 类型 / 界域），组内多选
 *   · 结果列表点一条即进场，可连续添加；选完关掉弹窗继续跑团
 *
 * 控件与速览页共用同一套语言：筛选 chip 用 .gm-pill（与 .gl-chip 同配方），
 * 数量步进器用 .gl-stepper + .gl-icon-btn + .gl-plain-num，结果行的「加入」用 .gl-item-enh。
 * 筛选项由数据自身推导（按出现次数排序），来源更新后不会留下过期的死选项。
 */

const BANDS: { key: string; label: string; min: number; max: number }[] = [
  { key: "1-5", label: "1–5 级", min: 1, max: 5 },
  { key: "6-10", label: "6–10 级", min: 6, max: 10 },
  { key: "11-15", label: "11–15 级", min: 11, max: 15 },
  { key: "16-20", label: "16–20 级", min: 16, max: 20 },
  { key: "21-25", label: "21–25 级", min: 21, max: 25 },
  { key: "26+", label: "26 级以上", min: 26, max: Infinity },
];

const MAX_SHOWN = 60;
const MAX_COUNT = 12;

/** 从数据里抽出某个字段的取值，按出现次数降序 */
function facet(list: MonsterBlock[], pick: (m: MonsterBlock) => string | undefined): string[] {
  const count = new Map<string, number>();
  for (const m of list) {
    const v = pick(m);
    if (v) count.set(v, (count.get(v) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([k]) => k);
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={"gm-pill" + (on ? " on" : "")} aria-pressed={on} onClick={onClick}>
      {on && <span className="material-symbols-outlined">check</span>}
      {label}
    </button>
  );
}

export default function MonsterPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [lib, setLib] = useState<MonsterBlock[] | null>(() => peekMonsters());
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [books, setBooks] = useState<string[]>([]);
  const [bands, setBands] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [ranks, setRanks] = useState<string[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [justAdded, setJustAdded] = useState("");
  // 一次加几只：4E 一场遭遇常有四五个杂兵，一只一只点最浪费手速
  const [count, setCount] = useState(1);

  // 首次打开时才拉怪物库（6.8MB），关掉不重拉
  useEffect(() => {
    if (!open || lib) return;
    loadMonsters().then(setLib).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, lib]);

  const rolesAll = useMemo(() => (lib ? facet(lib, (m) => m.role) : []), [lib]);
  const ranksAll = useMemo(() => (lib ? facet(lib, (m) => baseRank(m.rank)) : []), [lib]);
  const originsAll = useMemo(() => (lib ? facet(lib, (m) => m.origin) : []), [lib]);

  const results = useMemo(() => {
    if (!lib) return [];
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return lib.filter((m) => {
      if (books.length > 0 && !books.includes(m.book)) return false;
      if (bands.length > 0) {
        const lv = m.level;
        if (lv === undefined) return false;
        if (!bands.some((b) => {
          const band = BANDS.find((x) => x.key === b);
          return band ? lv >= band.min && lv <= band.max : false;
        })) return false;
      }
      if (roles.length > 0 && !roles.includes(m.role ?? "")) return false;
      if (ranks.length > 0 && !ranks.includes(baseRank(m.rank))) return false;
      if (origins.length > 0 && !origins.includes(m.origin ?? "")) return false;
      if (terms.length === 0) return true;
      const h = [m.name, m.nameEn, m.section, m.creatureType, m.creatureGroup, m.level !== undefined ? "lv" + m.level : ""]
        .filter(Boolean).join(" ").toLowerCase();
      return terms.every((t) => h.includes(t));
    });
  }, [lib, query, books, bands, roles, ranks, origins]);

  const filtersOn = books.length + bands.length + roles.length + ranks.length + origins.length;

  function clearAll() {
    setBooks([]); setBands([]); setRoles([]); setRanks([]); setOrigins([]); setQuery("");
  }

  return (
    <SheetDialog
      open={open}
      headline="添加怪物"
      sub={lib ? "共 " + lib.length + " 条" : "加载中…"}
      onClose={onClose}
      actions={
        <TextButton disabled={filtersOn === 0 && query === ""} onClick={clearAll}>清除筛选</TextButton>
      }
    >
      <div className="mp">
        <div className="mp-top">
          <div className="mp-search">
            <FilledTextField
              value={query}
              label="搜索怪物（名称 / 英文 / 章节）"
              onInput={(e) => setQuery((e.target as unknown as { value: string }).value ?? "")}
            />
          </div>
          <div className="gl-stepper mp-qty" role="group" aria-label="一次加入的数量">
            <IconButton className="gl-icon-btn" aria-label="少一只" disabled={count <= 1} onClick={() => setCount((c) => Math.max(1, c - 1))}>
              <span className="material-symbols-outlined">remove</span>
            </IconButton>
            <span className="gl-plain-num mp-qty-num" title="点「加入」时一次放上场几只（自动排 A / B / C）">×{count}</span>
            <IconButton className="gl-icon-btn" aria-label="多一只" disabled={count >= MAX_COUNT} onClick={() => setCount((c) => Math.min(MAX_COUNT, c + 1))}>
              <span className="material-symbols-outlined">add</span>
            </IconButton>
          </div>
        </div>

        {error && <p className="mp-error">{error}</p>}
        {!lib && !error && <p className="mp-hint">正在加载怪物数据…</p>}

        {lib && (
          <div className="mp-facets">
            <div className="mp-row">
              <span className="mp-row-label">图鉴</span>
              <span className="mp-row-chips">
                {["MM1", "MM2", "MM3"].map((k) => (
                  <Chip key={k} label={bookLabel(k)} on={books.includes(k)} onClick={() => setBooks(toggle(books, k))} />
                ))}
              </span>
            </div>
            <div className="mp-row">
              <span className="mp-row-label">等级</span>
              <span className="mp-row-chips">
                {BANDS.map((b) => (
                  <Chip key={b.key} label={b.label} on={bands.includes(b.key)} onClick={() => setBands(toggle(bands, b.key))} />
                ))}
              </span>
            </div>
            <div className="mp-row">
              <span className="mp-row-label">职能</span>
              <span className="mp-row-chips">
                {rolesAll.map((r) => (
                  <Chip key={r} label={r} on={roles.includes(r)} onClick={() => setRoles(toggle(roles, r))} />
                ))}
              </span>
            </div>
            <div className="mp-row">
              <span className="mp-row-label">类型</span>
              <span className="mp-row-chips">
                {ranksAll.map((r) => (
                  <Chip key={r} label={r} on={ranks.includes(r)} onClick={() => setRanks(toggle(ranks, r))} />
                ))}
              </span>
            </div>
            <div className="mp-row">
              <span className="mp-row-label">界域</span>
              <span className="mp-row-chips">
                {originsAll.map((o) => (
                  <Chip key={o} label={o} on={origins.includes(o)} onClick={() => setOrigins(toggle(origins, o))} />
                ))}
              </span>
            </div>
          </div>
        )}

        {lib && (
          <div className="mp-count">
            匹配 <b>{results.length}</b> 条
            {filtersOn > 0 ? " · 已启用 " + filtersOn + " 个筛选" : ""}
            {results.length > MAX_SHOWN ? " · 下列前 " + MAX_SHOWN + " 条，可用筛选收窄" : ""}
          </div>
        )}

        <div className="mp-list">
          {results.slice(0, MAX_SHOWN).map((m) => (
            <button
              key={m.id}
              type="button"
              className="mp-item"
              onClick={() => {
                addMonster(m, count);
                setJustAdded(m.id);
                window.setTimeout(() => setJustAdded(""), 1400);
              }}
            >
              <span className="mp-item-name">{m.name}{m.nameEn ? " " + m.nameEn : ""}</span>
              <span className="gl-chip-sub mp-meta">
                {[m.level !== undefined ? "LV" + m.level : "", m.rank ?? "", m.role ?? "", bookLabel(m.book), m.section]
                  .filter(Boolean).join(" · ")}
              </span>
              <span className={"gl-item-enh" + (justAdded === m.id ? " on" : "")}>
                {justAdded === m.id ? "已加入" : count > 1 ? "加入 ×" + count : "加入"}
              </span>
            </button>
          ))}
          {lib && results.length === 0 && <p className="mp-hint">没有匹配的怪物，换个关键词或放宽筛选。</p>}
        </div>
      </div>
    </SheetDialog>
  );
}
