import { useMemo, useState } from "react";
import { useIncremental } from "../lib/incremental";
import { createPortal } from "react-dom";
import EntryCard from "./EntryCard";
import { POWER_CATEGORIES, powerCategory, type PowerCategoryKey } from "../lib/colors";
import { classPowerIds, racePowerIds } from "./candidates";
import type { Entry } from "../data/types";
import { DeepSearchField, matchByName, matchDeep } from "./DeepSearch";

const LEVEL_MODES = [
  { key: "current", label: "当前及以下" },
  { key: "range", label: "指定等级" },
  { key: "all", label: "全部等级" },
] as const;

interface Props {
  entries: Entry[];
  loading?: boolean;
  relations: { powerByGrantedBy: Record<string, string[]> };
  classEntry?: Entry;
  classEntry2?: Entry;
  raceEntry?: Entry;
  category: PowerCategoryKey;
  currentLevel: number;
  fixedLevel?: number; // 指定该空位应填充的威能等级（由升级表推导）；提供时强制只显示该等级
  currentId?: string;
  onSelect: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
}

function lv(e: Entry): number {
  return parseInt(String(e.level ?? "0"), 10) || 0;
}

export default function PowerSlotPicker({ entries, loading, relations, classEntry, classEntry2, raceEntry, category, currentLevel, fixedLevel, currentId, onSelect, onClear, onClose }: Props) {
  const [cat, setCat] = useState<PowerCategoryKey>(category);
  // 空位等级已由升级表推导时，锁定「指定等级」模式并固定为该等级
  const [minLevel, setMinLevel] = useState(fixedLevel ?? Math.max(1, currentLevel));
  const [maxLevel, setMaxLevel] = useState(fixedLevel ?? Math.max(1, currentLevel));
  const [levelMode, setLevelMode] = useState<"current" | "range" | "all">(fixedLevel !== undefined ? "range" : "current");
  const [sourceMode, setSourceMode] = useState<"default" | "class" | "race" | "all">("default");
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false); // 全文搜索开关

  const conf = POWER_CATEGORIES.find((c) => c.key === cat);

  // 来源集合走 sheet/candidates 的同源实现（AI 车卡也用这一份，避免两边规则分叉）
  // 混职：合并两个职业（含基础职业名/全名/id 的授予表）
  const classIds = useMemo(() => classPowerIds([classEntry, classEntry2], relations), [classEntry, classEntry2, relations]);

  const raceIds = useMemo(() => racePowerIds(raceEntry, relations), [raceEntry, relations]);

  const hasSourceFilter = !!classIds || !!raceIds;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((p) => {
        if (powerCategory(p.usage, p.powerKind) !== cat) return false;
        const level = lv(p);
        if (levelMode === "current" && level > currentLevel) return false;
        if (levelMode === "range" && (level < minLevel || level > maxLevel)) return false;
        if (sourceMode !== "all") {
          const inClass = classIds ? classIds.has(p.id) : false;
          const inRace = raceIds ? raceIds.has(p.id) : false;
          if (sourceMode === "class" && !inClass) return false;
          if (sourceMode === "race" && !inRace) return false;
          if (sourceMode === "default") {
            const wantClass = !!classIds;
            const wantRace = !!raceIds;
            if (wantClass && wantRace && !inClass && !inRace) return false;
            if (wantClass && !wantRace && !inClass) return false;
            if (!wantClass && wantRace && !inRace) return false;
          }
        }
        if (q && !(deep ? matchDeep(p, q) : matchByName(p, q))) return false;
        return true;
      })
      .sort((a, b) => lv(a) - lv(b));
  }, [entries, cat, levelMode, minLevel, maxLevel, currentLevel, sourceMode, classIds, raceIds, query, deep]);


  const { visible, sentinelRef, done } = useIncremental(filtered, 90);
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">选择{fixedLevel !== undefined ? fixedLevel + "级" : ""}{conf?.label ?? "威能"}</span>
          <div className="picker-head-btns">
            {currentId && onClear && <button type="button" className="crop-btn" onClick={() => { onClear(); onClose(); }}>清空槽位</button>}
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="slot-filter">
          <div className="slot-filter-row">
            <span className="sf-label">类别</span>
            {POWER_CATEGORIES.map((c) => (
              <button key={c.key} type="button" className={cat === c.key ? "sf-chip active" : "sf-chip"} onClick={() => setCat(c.key)}>{c.label}</button>
            ))}
          </div>
          <div className="slot-filter-row">
            <span className="sf-label">来源</span>
            {hasSourceFilter && (
              <button type="button" className={sourceMode === "default" ? "sf-chip active" : "sf-chip"} onClick={() => setSourceMode("default")}>
                {classIds && raceIds ? "职业+种族（默认）" : classIds ? "本职业（默认）" : "种族威能（默认）"}
              </button>
            )}
            {classIds && <button type="button" className={sourceMode === "class" ? "sf-chip active" : "sf-chip"} onClick={() => setSourceMode("class")}>仅职业</button>}
            {raceIds && <button type="button" className={sourceMode === "race" ? "sf-chip active" : "sf-chip"} onClick={() => setSourceMode("race")}>仅种族</button>}
            <button type="button" className={sourceMode === "all" ? "sf-chip active" : "sf-chip"} onClick={() => setSourceMode("all")}>全部</button>
            {!hasSourceFilter && <span className="sf-hint">未选择职业/种族</span>}
          </div>
          <div className="slot-filter-row">
            <span className="sf-label">等级</span>
            {fixedLevel !== undefined ? (
              <span className="sf-chip active">{fixedLevel}级</span>
            ) : (
              <>
            {LEVEL_MODES.map((m) => (
              <button key={m.key} type="button" className={levelMode === m.key ? "sf-chip active" : "sf-chip"} onClick={() => setLevelMode(m.key)}>{m.label}</button>
            ))}
            {levelMode === "range" && (
              <span className="sf-range">
                <input type="number" min={1} max={30} value={minLevel} onChange={(e) => setMinLevel(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
                <span>—</span>
                <input type="number" min={1} max={30} value={maxLevel} onChange={(e) => setMaxLevel(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
              </span>
            )}
              </>
            )}
          </div>
        </div>
        <DeepSearchField value={query} deep={deep} onChange={setQuery} onToggleDeep={() => setDeep((d) => !d)} />
        <div className="meta">显示 {filtered.length} 条</div>
        <div className="picker-cards">
          {loading && entries.length === 0 && <p className="hint">正在加载威能数据…</p>}
          {!loading && visible.map((p) => (
            <button key={p.id} type="button" className={p.id === currentId ? "picker-card selected" : "picker-card"} onClick={() => { onSelect(p.id); onClose(); }}>
              <EntryCard entry={p} />
            </button>
          ))}
          {!loading && filtered.length === 0 && <p className="hint">无匹配威能。</p>}
          {!done && !loading && <div ref={sentinelRef} className="incremental-sentinel">滚动加载更多…</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}
