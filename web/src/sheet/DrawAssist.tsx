import { useEffect, useMemo, useState } from "react";
import EntryCard from "./EntryCard";
import { OutlinedButton, TextButton } from "../components/md";
import { DRAW_HAND_SIZE, DRAW_REROLLS, dealHand, shuffle } from "../lib/drawpick";
import type { Entry } from "../data/types";

// 「抽卡」挑选面板：威能 / 专长选择器里的第二种挑选方式。
//
// 与自己挑选共用同一个候选池（筛选条件、搜索、来源限制全部照旧生效），
// 区别只在「怎么从池子里拿一张」：这里一次发 3 张，随机抽取，可重抽 2 次。
// 抽到的卡与自己挑的完全等效 —— 选定后同样写进用户点开的那个槽位。

interface Props {
  /** 候选池：调用方已经按类别 / 等级 / 来源 / 搜索过滤好的结果 */
  pool: Entry[];
  /** 槽位当前已有的条目（发牌时排除掉） */
  currentId?: string;
  /** 选中一张卡 */
  onPick: (id: string) => void;
  /** [[词条]] 链接的悬浮预览解析 */
  lookup?: (t: string) => Entry | undefined;
  /** 面板标题里的补充说明，如「随意威能 · 1级」 */
  label?: string;
  /**
   * 跳过当前目标（抽卡弹窗用来「这个槽位不想抽/抽不出来」时换下一个）。
   * 不给就不显示这个按钮 —— 单纯发牌的面板不需要它。
   */
  onSkip?: () => void;
}

export default function DrawAssist({ pool, currentId, onPick, lookup, label, onSkip }: Props) {
  const [hand, setHand] = useState<Entry[]>([]);
  const [rerolls, setRerolls] = useState(DRAW_REROLLS);
  // 发牌轮次：只用来给卡片换 key，让重抽时重新播放入场动画
  const [deal, setDeal] = useState(0);

  // 池子内容变了（换了类别 / 等级 / 搜索词）就重新发一手：
  // 用 id 串当依赖，避免每次渲染都因为新数组身份而重发。
  const poolKey = useMemo(() => pool.map((e) => e.id).join("|"), [pool]);
  useEffect(() => {
    setHand(dealHand(pool, currentId));
    setRerolls(DRAW_REROLLS);
    setDeal((d) => d + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey, currentId]);

  function reroll() {
    if (rerolls <= 0) return;
    // 重抽在同池但不含当前手的牌里发：连抽两次同一张会让人以为按钮没生效
    const held = new Set(hand.map((e) => e.id));
    const fresh = pool.filter((e) => !held.has(e.id) && e.id !== currentId);
    const next = fresh.length >= DRAW_HAND_SIZE ? dealHand(fresh, currentId) : shuffle(pool.filter((e) => e.id !== currentId)).slice(0, DRAW_HAND_SIZE);
    setHand(next);
    setRerolls((r) => r - 1);
    setDeal((d) => d + 1);
  }

  return (
    <div className="draw-assist">
      <div className="draw-assist-head">
        <span className="da-title">抽卡挑选{label ? " · " + label : ""}</span>
        <span className="da-count">
          共 {pool.length} 张候选 · 每次发 {DRAW_HAND_SIZE} 张 · 剩余重抽 {rerolls} 次
        </span>
      </div>

      <div className="draw-cards">
        {hand.map((e, i) => (
          <button
            key={e.id + "-" + deal}
            type="button"
            className="draw-card"
            style={{ animationDelay: i * 90 + "ms" }}
            onClick={() => onPick(e.id)}
            title="选这张"
          >
            <EntryCard entry={e} lookup={lookup} />
          </button>
        ))}
      </div>
      {hand.length === 0 && <p className="hint">这个槽位在当前条件下没有可抽的条目，跳过它继续下一个即可。</p>}

      <div className="draw-assist-nav">
        <OutlinedButton disabled={rerolls <= 0 || pool.length === 0} onClick={reroll}>
          重抽（{rerolls}）
        </OutlinedButton>
        {onSkip && (
          <TextButton onClick={onSkip} title="这个槽位不抽了，直接进入下一个空位">
            跳过这个槽位
          </TextButton>
        )}
      </div>
    </div>
  );
}
