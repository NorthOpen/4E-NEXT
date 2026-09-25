import { useEffect, useMemo, useState } from "react";
import { loadCategory } from "../data/loaders";
import type { Entry } from "../data/types";
import { classPowerIds } from "./candidates";
import PickList from "./PickList";

interface Props {
  classEntry?: Entry;
  relations: { powerByGrantedBy: Record<string, string[]> };
  selected: Set<string>;
  onToggle: (id: string) => void;
}

function lvl(e: Entry): number {
  return parseInt(String(e.level ?? "0"), 10) || 0;
}

function groupPowers(powers: Entry[]): { header: string; items: Entry[] }[] {
  const defs = [
    { header: "随意攻击", match: (p: Entry) => p.usage === "at-will" && p.powerKind === "attack" },
    { header: "遭遇攻击", match: (p: Entry) => p.usage === "encounter" && p.powerKind === "attack" },
    { header: "每日攻击", match: (p: Entry) => p.usage === "daily" && p.powerKind === "attack" },
    { header: "辅助威能", match: (p: Entry) => p.powerKind === "utility" },
    { header: "特性", match: (p: Entry) => p.powerKind === "feature" },
    { header: "种族威能", match: (p: Entry) => p.powerKind === "racial" },
    { header: "其他", match: () => true },
  ];
  const sorted = [...powers].sort((a, b) => lvl(a) - lvl(b));
  return defs.map((d) => ({ header: d.header, items: sorted.filter(d.match) })).filter((g) => g.items.length > 0);
}

export default function PowerPicker({ classEntry, relations, selected, onToggle }: Props) {
  const [all, setAll] = useState<Entry[]>([]);

  useEffect(() => {
    if (!classEntry) return;
    void loadCategory("power").then(setAll).catch(console.error);
  }, [classEntry]);

  const powers = useMemo(() => {
    if (all.length === 0) return [];
    const ids = classPowerIds([classEntry], relations); // 同源实现，见 sheet/candidates.ts
    if (!ids) return [];
    return all.filter((p) => ids.has(p.id));
  }, [classEntry, all, relations]);

  const groups = useMemo(() => groupPowers(powers), [powers]);

  if (!classEntry) return <p className="hint">请先选择职业。</p>;

  return (
    <div>
      {groups.map((g) => (
        <div key={g.header}>
          <div className="group-head">{g.header}（{g.items.length}）</div>
          <PickList entries={g.items} selected={selected} onToggle={onToggle} renderSub={(e) => "L" + lvl(e) + " · " + (e.usageZh ?? "") + " · " + (e.actionType ?? "")} />
        </div>
      ))}
    </div>
  );
}
