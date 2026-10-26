/**
 * 标准购物：按等级给出「标准起始装备总值」（gp）。
 *
 * 口径 = D&D 4E《地下城主指南》「以更高等级开始」的角色起始装备总价值
 * （也就是社区常说的「标准购物表」）。表里是**总额**，不是每次升级的增量。
 *
 * 只在这一处维护：若你们的团用另一套口径，改这个数组即可，UI 与金钱计算都会跟着变。
 * index 即等级（1~30），index 0 占位。
 */
const STANDARD_WEALTH_GP: number[] = [
  0,
  100, // 1
  780, // 2
  1750, // 3
  3050, // 4
  4700, // 5
  6800, // 6
  9350, // 7
  12400, // 8
  15950, // 9
  20000, // 10
  25000, // 11
  31000, // 12
  39000, // 13
  49000, // 14
  62000, // 15
  78000, // 16
  98000, // 17
  125000, // 18
  160000, // 19
  205000, // 20
  260000, // 21
  330000, // 22
  420000, // 23
  530000, // 24
  670000, // 25
  850000, // 26
  1075000, // 27
  1360000, // 28
  1720000, // 29
  2175000, // 30
];

export const STANDARD_SHOPPING_MIN_LEVEL = 1;
export const STANDARD_SHOPPING_MAX_LEVEL = 30;

/** 该等级的标准起始装备总值（gp）。等级越界时收敛到 1~30。 */
export function standardWealthGp(level: number): number {
  const lv = Math.max(STANDARD_SHOPPING_MIN_LEVEL, Math.min(STANDARD_SHOPPING_MAX_LEVEL, Math.round(level || 1)));
  return STANDARD_WEALTH_GP[lv] ?? 0;
}
