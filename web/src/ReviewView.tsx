// 主持页 · 审阅：把存档里的**复数张**人物卡同时摊开，逐张过一遍。
//
// 与「打开一张卡来改」不同，审阅回答的是城主开团前/跑团中反复要问的三个问题：
//   1. 这几个人各自是什么水平？（名册一眼扫过：等级 / 种族 / 职业 / 当前生命）
//   2. 这一张具体怎么写的？（详情面板整张渲染人物卡，排版与玩家看到的完全一致）
//   3. 打起来时缺什么？（切「速览」，用的是与玩家速览页同一块数值面板）
//
// 三条硬约束：
//   · **只读**。审阅不改存档 —— 所以这里传下去的 setChar 是一个会弹提示的空实现：
//     点得动、看得见、写不进去，城主不会因为手滑把玩家的卡改了（见下面 readOnly）。
//     要改某张卡，走存档弹窗切到那张卡再改，路径唯一。
//   · **一次只看一张，但随时能换**。名册常驻在左侧，详情面板从不空着。
//   · **选择跟着走**。选过哪几张卡记在本机（localStorage），刷新、切页回来还在。
//
// 组件语言与怪物追踪页、速览页同一套（.gl-shell / .gl-bar / .gl-* / .md3-seg）：
// 城主在「怪物」「审阅」两页之间来回切时，看到的是同一个界面。

import { platform } from "@platform";
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { FilledButton, Checkbox, TextButton } from "./components/md";
import SheetDialog from "./components/SheetDialog";
import OverviewView from "./OverviewView";
import CharacterSheet from "./sheet/CharacterSheet";
import { useCardMeta } from "./overview/derive";
import { safeSetItem, type SavedCard } from "./lib/storage";
import type { Character } from "./sheet/character";

const SEL_KEY = "4enext.review.selected";

/** 审阅的三块版面：名册（左列表 + 右详情）/ 速览（网格对照）/ 卡片（网格通读）。 */
type Board = "roster" | "glance" | "cards";
/** 名册模式下详情面板渲染哪一种：速览面板 / 完整人物卡。 */
type Detail = "glance" | "sheet";

const BOARDS: { key: Board; label: string }[] = [
  { key: "roster", label: "名册" },
  { key: "glance", label: "速览" },
  { key: "cards", label: "卡片" },
];

const DETAILS: { key: Detail; label: string }[] = [
  { key: "glance", label: "速览面板" },
  { key: "sheet", label: "完整人物卡" },
];

/** 读回上次选中的卡 id。存的是「按存档顺序排列」的数组，不是点击顺序 —— 名册排列要可预期。 */
function loadSelection(): string[] {
  try {
    const raw = platform.storage.getItem(SEL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveSelection(ids: string[]) {
  safeSetItem(SEL_KEY, JSON.stringify(ids));
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN");
  } catch {
    return "";
  }
}

/** 当前生命：只在玩家在速览页动过血（hpNow.max 有覆盖值）时才有意义，否则交给速览面板算自动上限。 */
function hpOf(c: Character): number | undefined {
  return c.hpNow?.max;
}

export default function ReviewView({
  cards,
  activeId,
  onOpenCard,
}: {
  /** 存档里的全部人物卡（App 持有；编辑会实时反映到这里） */
  cards: SavedCard[];
  /** 当前正在编辑的那张卡：名册上标出来，好在审阅时知道「改的是哪一张」 */
  activeId: string;
  /** 打开某张卡去编辑：切回玩家模式并把这张卡设为当前存档（App 提供） */
  onOpenCard: (id: string) => void;
}) {
  const [selIds, setSelIds] = useState<string[]>(() => loadSelection());
  const [board, setBoard] = useState<Board>("roster");
  const [detail, setDetail] = useState<Detail>("glance");
  const [currentId, setCurrentId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  // 存档删过卡之后，选中的 id 里会留下找不到的：一律按现存卡过滤，不用等用户去清理
  const selected = useMemo(() => cards.filter((c) => selIds.includes(c.id)), [cards, selIds]);
  // 详情面板当前那张：记的那张还在就用它，否则退回第一张（详情面板从不空着）
  const current: SavedCard | null = selected.find((c) => c.id === currentId) ?? selected[0] ?? null;

  const allSelected = cards.length > 0 && selected.length === cards.length;

  function commit(next: string[]) {
    const ordered = cards.filter((c) => next.includes(c.id)).map((c) => c.id);
    setSelIds(ordered);
    saveSelection(ordered);
  }

  function toggle(id: string) {
    commit(selIds.includes(id) ? selIds.filter((x) => x !== id) : [...selIds, id]);
  }

  /**
   * 只读阀门：速览面板与人物卡上的控件都是「点一下写回存档」的，审阅页传下去的必须是这个。
   * 弹一次提示而不是静默丢弃 —— 城主点了扣血按钮却没反应，比明说「这里不写回」糟得多。
   * useCallback 是必要的：卡片网格里每张卡都拿着这个函数，引用一变十几张卡会全部重渲染。
   */
  const readOnly: Dispatch<SetStateAction<Character>> = useCallback(() => {
    setHint("请注意：只读模式");
  }, []);

  return (
    <div className="gm-view rv-view">
      <div className="gl-shell gm-shell">
        <div className="gl-bar">
          <div className="gl-bar-id">
            <div className="gl-bar-line">
              <h2 className="gl-bar-name gm-h2">审阅</h2>
              <span className="gl-chip-sub">
                {selected.length}/{cards.length} 张
                {activeId && selected.some((c) => c.id === activeId) ? " · 含当前卡" : ""}
              </span>
            </div>
          </div>
          <div className="gm-bar-acts">
            {selected.length > 0 && (
              <div className="md3-seg" role="radiogroup" aria-label="审阅版面">
                {BOARDS.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    role="radio"
                    aria-checked={board === b.key}
                    className={"md3-seg-btn" + (board === b.key ? " on" : "")}
                    onClick={() => setBoard(b.key)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
            <FilledButton className="gl-md-btn" onClick={() => setPickerOpen(true)}>
              <span slot="icon" className="material-symbols-outlined">library_books</span>
              选择人物卡
            </FilledButton>
          </div>
        </div>

        {selected.length === 0 ? (
          <div className="gm-empty">
            <span className="material-symbols-outlined gm-empty-ic">fact_check</span>
            <h3>还没有选中要审阅的卡</h3>
            <FilledButton className="gl-md-btn" onClick={() => setPickerOpen(true)}>
              <span slot="icon" className="material-symbols-outlined">library_books</span>
              从存档里选
            </FilledButton>
            <p className="gm-empty-tip">
              审阅会把选中的卡并排摆在一起：可以逐张查看完整人物卡，也可以切成速览对照数值。这一页是只读的，任何操作都不会写回存档。
            </p>
          </div>
        ) : board === "roster" ? (
          <div className="gc">
            <div className="gc-roster" role="list" aria-label="所选人物卡">
              {selected.map((c) => (
                <ReviewRow
                  key={c.id}
                  card={c}
                  on={c.id === current?.id}
                  isCurrent={c.id === activeId}
                  onClick={() => setCurrentId(c.id)}
                />
              ))}
            </div>
            <div className="gc-detail">
              {current && (
                <>
                  <div className="rv-head">
                    <span className="rv-head-name">{current.name}</span>
                    <span className="gl-chip-sub">Lv{current.char.level}</span>
                    {current.id === activeId && <span className="gl-item-slot">当前卡</span>}
                    <span className="rv-head-sub">更新于 {fmtTime(current.updatedAt)}</span>
                    <div className="md3-seg" role="radiogroup" aria-label="详情渲染方式">
                      {DETAILS.map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          role="radio"
                          aria-checked={detail === d.key}
                          className={"md3-seg-btn" + (detail === d.key ? " on" : "")}
                          onClick={() => setDetail(d.key)}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                    {/* 审阅是只读的，改卡要回到玩家侧：这里给一条明确的去路，别让城主自己找 */}
                    <TextButton
                      className="rv-open"
                      title="切到玩家模式，把这张卡设为当前存档后打开人物页"
                      onClick={() => onOpenCard(current.id)}
                    >
                      {current.id === activeId ? "去编辑" : "打开这张卡"}
                    </TextButton>
                  </div>
                  <div className="rv-body">
                    {detail === "glance" ? (
                      <GlanceCard key={current.id} char={current.char} setChar={readOnly} />
                    ) : (
                      <div className="rv-sheet" key={current.id}>
                        <CharacterSheet layout="single" mode="render" char={current.char} setChar={readOnly} />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className={"rv-board" + (board === "cards" ? " rv-board-sheet" : "")}>
            {selected.map((c) => (
              <section key={c.id} className="rv-cell">
                <div className="rv-head">
                  <button
                    type="button"
                    className="rv-cell-name"
                    title="只看这一张（回到名册）"
                    onClick={() => {
                      setCurrentId(c.id);
                      setBoard("roster");
                    }}
                  >
                    {c.name}
                  </button>
                  {c.id === activeId && <span className="gl-item-slot">当前卡</span>}
                </div>
                <div className="rv-cell-body">
                  {board === "glance" ? (
                    <GlanceCard char={c.char} setChar={readOnly} />
                  ) : (
                    <div className="rv-sheet">
                      <CharacterSheet layout="single" mode="render" char={c.char} setChar={readOnly} />
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* 选择弹窗：存档里的全部卡，勾选即加入审阅 */}
      {pickerOpen && (
        <SheetDialog
          open
          headline="选择要审阅的人物卡"
          sub={selected.length > 0 ? "已选 " + selected.length + " 张" : "可多选"}
          onClose={() => setPickerOpen(false)}
          actions={
            <>
              <TextButton onClick={() => commit(allSelected ? [] : cards.map((c) => c.id))}>
                {allSelected ? "全部取消" : "全选"}
              </TextButton>
              <TextButton onClick={() => commit(activeId ? [activeId] : [])} disabled={!activeId}>
                只留当前卡
              </TextButton>
            </>
          }
        >
          <div className="rv-pick">
            {cards.map((c) => {
              const on = selIds.includes(c.id);
              return (
                <CardPickRow
                  key={c.id}
                  card={c}
                  on={on}
                  isCurrent={c.id === activeId}
                  onToggle={() => toggle(c.id)}
                />
              );
            })}
            <p className="hint">审阅是只读的：这一页只把卡摊开来看，任何操作都不会写回存档。</p>
          </div>
        </SheetDialog>
      )}

      {hint && (
        <div className="d4e-snackbar" role="status">
          <span className="d4e-snackbar-text">{hint}</span>
          <TextButton onClick={() => setHint(null)}>知道了</TextButton>
        </div>
      )}
    </div>
  );
}

/** 名册一行：名字 + 身份 + 当前生命（玩家在速览页记过血才显示，否则不编一个数出来） */
function ReviewRow({
  card,
  on,
  isCurrent,
  onClick,
}: {
  card: SavedCard;
  on: boolean;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const c = card.char;
  const meta = useCardMeta(c);
  const hp = hpOf(c);
  const identity = [meta.race, meta.cls].filter(Boolean).join(" · ");
  return (
    <button type="button" className={"gr" + (on ? " on" : "")} aria-current={on || undefined} onClick={onClick}>
      <span className="gr-top">
        <span className="gr-name">{card.name}</span>
        {isCurrent && <span className="gl-item-slot">当前</span>}
        <span className="gl-item-slot">LV{c.level}</span>
      </span>
      <span className="gr-bot">
        <span className="gr-meta">{identity || fmtTime(card.updatedAt)}</span>
        {hp !== undefined && (
          <span className="gr-hp">
            {hp}
            <em> hp</em>
          </span>
        )}
      </span>
    </button>
  );
}

/** 选择弹窗里的一行：勾选框 + 名字 + 身份与更新时间 */
function CardPickRow({
  card,
  on,
  isCurrent,
  onToggle,
}: {
  card: SavedCard;
  on: boolean;
  isCurrent: boolean;
  onToggle: () => void;
}) {
  const c = card.char;
  const meta = useCardMeta(c);
  const identity = [meta.race, meta.cls].filter(Boolean).join(" · ");
  return (
    <label className={"rv-pick-row" + (on ? " on" : "")}>
      <Checkbox checked={on} onChange={onToggle} aria-label={"审阅：" + card.name} />
      <span className="rv-pick-text">
        <span className="rv-pick-name">
          {card.name}
          {isCurrent && <span className="gl-item-slot">当前卡</span>}
        </span>
        <span className="rv-pick-sub">
          Lv{c.level}
          {identity ? " · " + identity : ""}
          {" · " + fmtTime(card.updatedAt)}
        </span>
      </span>
    </label>
  );
}

/**
 * 一张卡的速览面板（速览页本体）。
 * 调用点带 key：换卡时整块重建，免得上一张卡的临时输入留在 DOM 里。
 */
function GlanceCard({ char, setChar }: { char: Character; setChar: Dispatch<SetStateAction<Character>> }) {
  return <OverviewView layout="single" char={char} setChar={setChar} />;
}
