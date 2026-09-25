import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import EntryCard from "./EntryCard";
import { useIncremental } from "../lib/incremental";
import { cleanDisplayName, zhName } from "./character";
import type { Entry } from "../data/types";
import { DeepSearchField, matchByName, matchDeep } from "./DeepSearch";
import { featTierOf } from "./candidates";

const TIERS = ["英雄", "典范", "传奇"];
const FEAT_TYPES = ["种族", "职业", "技能", "流派", "通用"];
const SKILL_NAMES = ["运动", "坚韧", "杂技", "隐秘", "盗术", "神秘", "历史", "宗教", "地城", "医疗", "洞察", "自然", "侦查", "唬骗", "交涉", "威吓", "市井"];

// 专长前置条件中的种族/职业名：需作为独立词出现（前后不是中文字符），避免「半精灵」误匹配「精灵」
function containsWord(text: string, word: string): boolean {
  let idx = text.indexOf(word);
  while (idx >= 0) {
    const before = idx > 0 ? text[idx - 1] : "";
    const after = idx + word.length < text.length ? text[idx + word.length] : "";
    const isCn = (ch: string) => ch !== "" && /[\u4e00-\u9fff]/.test(ch);
    if (!isCn(before) && !isCn(after)) return true;
    idx = text.indexOf(word, idx + 1);
  }
  return false;
}

interface Props {
  entries: Entry[];
  loading?: boolean;
  allRaces: Entry[];
  allClasses: Entry[];
  currentLevel: number;
  currentId?: string;
  lookup?: (t: string) => Entry | undefined; // [[威能]] 链接悬浮预览解析
  onSelect: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
}

export default function FeatSlotPicker({ entries, loading, allRaces, allClasses, currentLevel, currentId, lookup, onSelect, onClear, onClose }: Props) {
  const [tier, setTier] = useState<string>(featTierOf(currentLevel)); // 同源实现，见 sheet/candidates.ts
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false); // 全文搜索开关
  // 全量种族/职业名称（含去括号变体名与纯中文名），用于识别专长前置条件里的种族/职业要求
  const knownRaces = useMemo(() => {
    const set = new Set<string>();
    for (const e of allRaces) { set.add(cleanDisplayName(e.name)); set.add(zhName(e.name)); }
    return set;
  }, [allRaces]);
  const knownClasses = useMemo(() => {
    const set = new Set<string>();
    for (const e of allClasses) { set.add(cleanDisplayName(e.name)); set.add(zhName(e.name)); }
    return set;
  }, [allClasses]);

  // 按前置条件/标题自动分类：流派 > 种族 > 职业 > 技能 > 通用
  function featType(f: Entry): string {
    if (f.name.includes("流派")) return "流派";
    const pre = f.prerequisite ?? "";
    for (const n of knownRaces) if (n && containsWord(pre, n)) return "种族";
    for (const n of knownClasses) if (n && containsWord(pre, n)) return "职业";
    if (SKILL_NAMES.some((s) => containsWord(pre, s)) || pre.includes("受训")) return "技能";
    return "通用";
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((f) => {
      if (tier && f.tierZh !== tier) return false;
      if (type && featType(f) !== type) return false;
      if (q && !(deep ? matchDeep(f, q) : matchByName(f, q))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, tier, type, query, deep, knownRaces, knownClasses]);


  const { visible, sentinelRef, done } = useIncremental(filtered, 90);
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">选择专长</span>
          <div className="picker-head-btns">
            {currentId && onClear && <button type="button" className="crop-btn" onClick={() => { onClear(); onClose(); }}>清空槽位</button>}
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="slot-filter-row">
          <span className="sf-label">层级</span>
          <button type="button" className={tier === "" ? "sf-chip active" : "sf-chip"} onClick={() => setTier("")}>全部</button>
          {TIERS.map((t) => (
            <button key={t} type="button" className={tier === t ? "sf-chip active" : "sf-chip"} onClick={() => setTier(t)}>{t}</button>
          ))}
        </div>
        <div className="slot-filter-row">
          <span className="sf-label">类型</span>
          <button type="button" className={type === "" ? "sf-chip active" : "sf-chip"} onClick={() => setType("")}>全部</button>
          {FEAT_TYPES.map((t) => (
            <button key={t} type="button" className={type === t ? "sf-chip active" : "sf-chip"} onClick={() => setType(t)}>{t}</button>
          ))}
          <span className="sf-hint">按前置条件自动归类</span>
        </div>
        <DeepSearchField value={query} deep={deep} onChange={setQuery} onToggleDeep={() => setDeep((d) => !d)} />
        <div className="meta">显示 {filtered.length} 条</div>
        <div className="picker-cards">
          {loading && entries.length === 0 && <p className="hint">正在加载专长数据…</p>}
          {!loading && visible.map((f) => (
            <button key={f.id} type="button" className={f.id === currentId ? "picker-card selected" : "picker-card"} onClick={() => { onSelect(f.id); onClose(); }}>
              <EntryCard entry={f} lookup={lookup} />
            </button>
          ))}
          {!loading && filtered.length === 0 && <p className="hint">无匹配专长。</p>}
          {!done && !loading && <div ref={sentinelRef} className="incremental-sentinel">滚动加载更多…</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}
