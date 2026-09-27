// 抽卡（威能挑选的辅助模式）：发牌逻辑。
//
// 历史上的「抽卡模式」是一整套随机建卡向导；重构后，随机建卡的位置由
// 导引模式（lib/guide.ts）接手，而「抽卡」这个趣味机制被保留下来，
// 转成威能/专长挑选时的一种辅助手段：在候选池里随机发几张卡，
// 选一张即可，选不出来还能重抽。技术路径换了，玩法没有丢。

import type { Entry } from "../data/types";

/** 一次发几张牌 */
export const DRAW_HAND_SIZE = 3;
/** 每手牌可重抽的次数 */
export const DRAW_REROLLS = 2;

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 从候选池里发一手牌。
 * 排除掉槽位当前已有的那一条（换威能时再抽到原来那张没有意义），
 * 池子不够就发几张算几张。
 */
export function dealHand(pool: Entry[], currentId: string | undefined, size = DRAW_HAND_SIZE): Entry[] {
  const usable = currentId ? pool.filter((e) => e.id !== currentId) : pool;
  return shuffle(usable).slice(0, size);
}
