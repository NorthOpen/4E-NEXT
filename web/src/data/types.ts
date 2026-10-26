export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  total: number;
  categories: Record<string, { count: number; file: string }>;
}

export interface SearchEntry {
  id: string;
  name: string;
  nameEn?: string;
  category: string;
  tags: string[];
  origin?: "official" | "user";
  source?: string;
  text: string;
}

export interface LinkRef {
  target: string;
  alias?: string;
}

export interface WikiInfo {
  transclusions: string[];
  links: LinkRef[];
  macros: string[];
  headings: string[];
}

// 威能详情「标签块」：与官方威能卡正文的 <th>标签：</th><td>内容</td> 详情表一一对应。
// indent>0 表示子行（如 次目标/次攻击/次命中），渲染时在标签前补全角缩进。
export interface PowerBlock {
  label: string;
  text: string;
  indent?: number;
}

export interface Entry {
  id: string;
  name: string;
  nameEn?: string;
  category: string;
  tags: string[];
  // 数据层标识：official=官方规范化数据；user=个人资源池（自制）。缺省视为官方。
  origin?: "official" | "user";
  source?: string;
  magazine?: string;
  sourceText: string;
  // 私设条目正文格式：md=Markdown（默认，新建/编辑后写入）；wiki=旧版 wikitext
  bodyFormat?: "md" | "wiki";
  fields: Record<string, string>;
  wiki: WikiInfo;
  // 分类特定字段（英文规范键）
  usage?: string;
  usageZh?: string;
  powerKind?: string;
  grantedBy?: string;
  powerType?: string;
  actionType?: string;
  keywords?: string;
  range?: string;
  level?: string;
  flavorText?: string;
  details?: string;
  // 私设威能的「标签块」详情：非空时优先渲染（等价于官方 details 的 <table class=details>）。
  powerBlocks?: PowerBlock[];
  skill?: string;
  tier?: string;
  tierZh?: string;
  prerequisite?: string;
  benefit?: string;
  itemLevel?: string;
  itemCategory?: string;
  itemSuitable?: string;
  rarity?: string;
  rarityEn?: string;
  // 私设「装备」统计字段（buildEntry 铺平到顶层）
  group?: string;
  /** 冒险装备（gear）：价格原文、铜币整数、重量磅数、是否工具包、工具包内含（只读展示，不参与计价） */
  costCp?: number;
  weightLb?: number;
  kit?: boolean;
  contents?: string[];
  enh?: string;
  enhTarget?: string;
  cost?: string;
  weight?: string;
  critical?: string;
  power?: string;
  ritualLevel?: string;
  keySkill?: string;
  ritualCategory?: string;
  size?: string;
  speed?: string;
  vision?: string;
  abilityOne?: string;
  abilityTwo?: string;
  role?: string;
  roleEn?: string;
  powerSource?: string;
  powerSourceEn?: string;
  hybrid?: string;
  terms?: Record<string, string>;
  [key: string]: unknown;
}
