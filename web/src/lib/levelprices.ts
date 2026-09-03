// 4e 官方魔法物品价格表（按物品等级，单位 gp）
export const LEVEL_PRICE: number[] = [
  360, 520, 680, 840, 1000,          // L1-5
  1800, 2600, 3400, 4200, 5000,      // L6-10
  9000, 13000, 17000, 21000, 25000,  // L11-15
  45000, 65000, 85000, 105000, 125000, // L16-20
  225000, 325000, 425000, 525000, 625000, // L21-25
  1125000, 1625000, 2125000, 2625000, 3125000, // L26-30
];

export function priceForLevel(level: number): number {
  if (level < 1 || level > 30) return 0;
  return LEVEL_PRICE[level - 1];
}

// 解析装备条目的多等级列表（如 "2 7 12 17 22 27"），返回等级数组
export function itemLevels(itemLevel?: string): number[] {
  if (!itemLevel) return [];
  return String(itemLevel).split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n) && n >= 1 && n <= 30);
}

// 魔法物品增强加值按物品等级区间推导（万律书：例如 14 级版本是 +3、29 级版本是 +6）
export function enhancementBonusForLevel(level: number): number {
  if (level <= 5) return 1;
  if (level <= 10) return 2;
  if (level <= 15) return 3;
  if (level <= 20) return 4;
  if (level <= 25) return 5;
  return 6;
}