import { useEffect, useState } from "react";
import { loadCategory, loadRelations } from "./data/loaders";
import type { Entry } from "./data/types";
import { setFeatSlot, clearFeatSlot, type Character } from "./sheet/character";
import PowerSlotPicker from "./sheet/PowerSlotPicker";
import ItemSlotPicker from "./sheet/ItemSlotPicker";
import EntryCard from "./sheet/EntryCard";

interface Props {
  layout: "single" | "double";
  char: Character;
  setChar: (c: Character) => void;
}

export default function ReserveView({ layout, char, setChar }: Props) {
  const [powers, setPowers] = useState<Entry[]>([]);
  const [items, setItems] = useState<Entry[]>([]);
  const [races, setRaces] = useState<Entry[]>([]);
  const [classes, setClasses] = useState<Entry[]>([]);
  const [relations, setRelations] = useState<{ powerByGrantedBy: Record<string, string[]> }>({ powerByGrantedBy: {} });
  const [slotPicker, setSlotPicker] = useState<null | { kind: "power" | "item"; index: number }>(null);

  useEffect(() => {
    // 数据全量读取（loaders 缓存共享，仅请求一次）
    void loadCategory("race").then(setRaces).catch(console.error);
    void loadCategory("class").then(setClasses).catch(console.error);
    void loadCategory("power").then(setPowers).catch(console.error);
    void loadCategory("equipment").then(setItems).catch(console.error);
    void loadRelations().then(setRelations).catch(console.error);
  }, []);

  function openPower(index: number) {
    setSlotPicker({ kind: "power", index });
  }

  function openItem(index: number) {
    setSlotPicker({ kind: "item", index });
  }

  const powerOf = (id: string) => powers.find((p) => p.id === id);
  const itemOf = (id: string) => items.find((x) => x.id === id);
  const raceEntry = races.find((r) => r.id === char.raceId);
  const classEntry = classes.find((c) => c.id === char.classId);
  const classEntry2 = classes.find((c) => c.id === char.classId2);

  const powerCard = (id: string | undefined, i: number, open: () => void, clear: () => void) => {
    if (!id) {
      return (
        <button key={i} type="button" className="slot-empty reserve-slot-card" onClick={open}>
          <span className="material-symbols-outlined">add</span>
          <span>选择威能</span>
        </button>
      );
    }
    const p = powerOf(id);
    return (
      <div key={i} className="slot-filled reserve-slot-card">
        {p ? <EntryCard entry={p} /> : <div className="reserve-loading">威能数据加载中…</div>}
        <button type="button" className="crop-btn reserve-x" title="移出法术书" onClick={(e) => { e.stopPropagation(); clear(); }}>✕</button>
      </div>
    );
  };

  const itemCard = (id: string | undefined, i: number, open: () => void, clear: () => void) => {
    if (!id) {
      return (
        <button key={i} type="button" className="slot-empty reserve-slot-card" onClick={open}>
          <span className="material-symbols-outlined">add</span>
          <span>选择物品</span>
        </button>
      );
    }
    const it = itemOf(id);
    return (
      <div key={i} className="slot-filled reserve-slot-card">
        {it ? <EntryCard entry={it} /> : <div className="reserve-loading">装备数据加载中…</div>}
        <button type="button" className="crop-btn reserve-x" title="移出背包" onClick={(e) => { e.stopPropagation(); clear(); }}>✕</button>
      </div>
    );
  };

  return (
    <div className="reserve">
      <div className={"reserve-panels" + (layout === "double" ? " double" : "")}>
        <section className="block reserve-panel">
          <div className="block-head">
            <h3 className="block-title">法术书</h3>
            <span className="sg-count">（{char.spellbook.filter(Boolean).length}/{char.spellbook.length}）</span>
            <button type="button" className="sg-step" title="减少槽位" onClick={() => setChar({ ...char, spellbook: char.spellbook.slice(0, -1) })}>−</button>
            <button type="button" className="sg-step" title="增加槽位" onClick={() => setChar({ ...char, spellbook: [...char.spellbook, ""] })}>＋</button>
          </div>
          <div className="power-grid reserve-grid">
            {char.spellbook.map((id, i) => powerCard(id, i, () => openPower(i), () => setChar({ ...char, spellbook: clearFeatSlot(char.spellbook, i) })))}
          </div>
          {char.spellbook.length === 0 && <p className="hint">尚无槽位，点击 ＋ 增加。</p>}
        </section>

        <section className="block reserve-panel">
          <div className="block-head">
            <h3 className="block-title">背包</h3>
            <span className="sg-count">（{char.backpack.filter(Boolean).length}/{char.backpack.length}）</span>
            <button type="button" className="sg-step" title="减少槽位" onClick={() => setChar({ ...char, backpack: char.backpack.slice(0, -1) })}>−</button>
            <button type="button" className="sg-step" title="增加槽位" onClick={() => setChar({ ...char, backpack: [...char.backpack, ""] })}>＋</button>
          </div>
          <div className="power-grid reserve-grid">
            {char.backpack.map((id, i) => itemCard(id, i, () => openItem(i), () => setChar({ ...char, backpack: clearFeatSlot(char.backpack, i) })))}
          </div>
          {char.backpack.length === 0 && <p className="hint">尚无槽位，点击 ＋ 增加。</p>}
        </section>
      </div>

      {slotPicker?.kind === "power" && (
        <PowerSlotPicker
          entries={powers}
          relations={relations}
          classEntry={classEntry}
          classEntry2={classEntry2}
          raceEntry={raceEntry}
          category="daily"
          currentLevel={char.level}
          currentId={char.spellbook[slotPicker.index] || undefined}
          onSelect={(id) => setChar({ ...char, spellbook: setFeatSlot(char.spellbook, slotPicker.index, id) })}
          onClear={() => setChar({ ...char, spellbook: clearFeatSlot(char.spellbook, slotPicker.index) })}
          onClose={() => setSlotPicker(null)}
        />
      )}
      {slotPicker?.kind === "item" && (
        <ItemSlotPicker
          entries={items}
          slotName="背包"
          currentLevel={char.level}
          currentId={char.backpack[slotPicker.index] || undefined}
          onSelect={(id) => setChar({ ...char, backpack: setFeatSlot(char.backpack, slotPicker.index, id) })}
          onClear={() => setChar({ ...char, backpack: clearFeatSlot(char.backpack, slotPicker.index) })}
          onClose={() => setSlotPicker(null)}
        />
      )}
    </div>
  );
}
