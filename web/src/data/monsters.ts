/**
 * 怪物数据（主持模式用）。
 *
 * 数据来自数据管线：out/monsters/categories/monster.json → web/public/data/monsters.json。
 * 单文件 6.8MB，所以**不在应用启动时加载**，而是进入主持模式后按需取一次并缓存；
 * 由 App 负责在首次进入时触发，之后切页面不再重复请求。
 *
 * creatureText 是管线渲染好的 4E Wiki 生物数据块（<div class=creature>…），
 * 前端用现成的 gen-creature-card 样式渲染即可，不必在这里重写一套展示逻辑。
 */
export interface MonsterBlock {
  id: string;
  name: string;
  nameEn?: string;
  /** MM1 / MM2 / MM3 */
  book: string;
  section: string;
  level?: number;
  rank?: string;
  role?: string;
  origin?: string;
  creatureType?: string;
  creatureGroup?: string;
  xp?: number;
  hp?: number;
  /** 重伤阈值（HP 降到它即重伤）；杂兵没有这一项 */
  bloodied?: number;
  ac?: number;
  /** 展示态数据块 HTML（管线渲染，已是最终形态） */
  creatureText: string;
}

/** 三本书的展示名（多处共用，别再各写一份） */
export const BOOK_LABELS: Record<string, string> = { MM1: "图鉴 1", MM2: "图鉴 2", MM3: "图鉴 3" };
export function bookLabel(book: string): string {
  return BOOK_LABELS[book] ?? book;
}

/** 类型去掉括注（精英（头目）→ 精英），筛选用 */
export function baseRank(rank?: string): string {
  return (rank ?? "").replace(/[（(].*$/, "").trim();
}

const BASE = import.meta.env.BASE_URL + "data/";

let cache: MonsterBlock[] | null = null;
let inflight: Promise<MonsterBlock[]> | null = null;

/** 取全部怪物。重复调用复用同一份缓存/同一次请求。 */
export function loadMonsters(): Promise<MonsterBlock[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch(BASE + "monsters.json")
      .then((res) => {
        if (!res.ok) throw new Error("怪物数据加载失败 (" + res.status + ")");
        return res.json() as Promise<MonsterBlock[]>;
      })
      .then((data) => {
        cache = data;
        return data;
      })
      .catch((err) => {
        inflight = null; // 失败不缓存，下次进入可重试
        throw err;
      });
  }
  return inflight;
}

/** 已加载的缓存（没有则返回 null，用于同步判断） */
export function peekMonsters(): MonsterBlock[] | null {
  return cache;
}
