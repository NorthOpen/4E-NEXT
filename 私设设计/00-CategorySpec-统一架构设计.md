# 私设编辑系统 · Category Spec 统一架构设计

> 状态：**设计评审稿**（先做全类设计，确认接口覆盖 19 类差异后再实现）
> 分支：`feat/homebrew-category-spec`
> 目标：为 19 类私设建立「每类自包含 spec」架构，让每类的**编辑内容**与**实时预览样式**正确差异化；以 race 为首个重构实例验证接口，其余类别按同一接口逐个设计实现。

---

## 一、问题与目标

### 1.1 现状问题

per-type 逻辑散落在 4 处大 if-chain，彼此引用同一份 `CATEGORY_FIELDS` / `CATEGORY_SECTIONS` 却未封装为统一单元：

| # | 位置 | 职责 |
| --- | --- | --- |
| ① | [buildEntry](file:///J:/4E-NEXT/web/src/lib/homebrewSchema.ts#L2142-L2284) | 保存：按类别派生 `sourceText` / `details` / `extras` |
| ② | [draftToForm](file:///J:/4E-NEXT/web/src/lib/homebrewSchema.ts#L2286-L2424) | 回填：编辑既有条目时按类别反解表单 |
| ③ | [renderField](file:///J:/4E-NEXT/web/src/homebrew/EntryEditor.tsx#L1487-L1721) | 表单：专用编辑器按 `f.key` 分发 |
| ④ | [EntryCard](file:///J:/4E-NEXT/web/src/sheet/EntryCard.tsx#L542-L554) | 预览：按 `entry.category` 分发卡片 |

连带问题：

1. **race 结构错配**：race 被路由到 `LevelSectionsEditor`（`!! N级：` 结构），但种族特性**不分级**，官方用 `@@.classTrait """…"""` 块 → 车卡无法结构化消费，回退原始文本，亚种替换 / 特性行交互失效。
2. **13 类预览回退 GenericCard**：仅 power / equipment / feat 三类的预览卡与车卡界面一致；class / theme / item-set / ritual / creature 等类的编辑区已是结构化输入，预览却只显示字段条 + 原始正文，与车卡面板形态脱节。
3. **正文区规则隐式**：`WITHOUT_BODY`、`POWER_REF_CATEGORIES`、EntryEditor 里「sections 无 sourceText 时补正文区」三段逻辑分散，新增类别容易踩坑。

### 1.2 目标

- **每类收敛为一个自包含 spec 模块**（`fields` / `sections` / `editors` / `build` / `parse` / `Preview`），类别实现互不干扰。
- **Shell 只查表**：`buildEntry` / `draftToForm` / `EntryEditor.renderField` / `EntryCard` 全部改为查 spec，未登记类别走通用兜底（行为不变）。
- **新增类别 = 新增一个 spec 模块**，不改 Shell、不碰其他类别。
- **先做全类设计、分批实现**：本设计覆盖全部 19 类的目标 spec；实现先落骨架 + race 实例，其余类别各作为独立任务逐个实现，避免「机械迁移冻结现状」。

---

## 二、CategorySpec 统一接口

### 2.1 类型定义（新建 `web/src/lib/categorySpecs/types.ts`）

```ts
import type { ReactNode } from "react";
import type { Entry } from "../../data/types";
import type { SheetField, HomebrewSection } from "../homebrewSchema";

/** 专用字段编辑器（fieldKey → 组件）；未登记的字段走 Shell 默认渲染（text/select/multichips/tags/textarea） */
export interface FieldEditorProps {
  value: string;                    // form 中的值（结构化字段为 JSON 字符串）
  onChange: (v: string) => void;    // 写回 form
  category: string;                 // 当前类别（供编辑器按类别差异化，如 levelSections 的模板）
}
export type FieldEditor = (props: FieldEditorProps) => ReactNode;

/** 预览卡统一 props（frame 空态框 / jump 跳左栏 / lookup 威能悬浮 / optionalOn 可选区块） */
export interface PreviewProps {
  entry: Entry;
  frame?: boolean;
  jump?: (k: string) => void;
  lookup?: (t: string) => Entry | undefined;
  optionalOn?: Partial<Record<string, boolean>>;
}
export type Preview = (props: PreviewProps) => ReactNode;

/** build 钩子上下文：extras 已含全部非空专属标量；sourceText 为当前正文（可改写） */
export interface BuildCtx {
  cat: string;
  form: Record<string, string>;
  extras: Record<string, string>;
  sourceText: string;
  bodyFormat: "md" | "wiki";
}
/** build 钩子返回：覆盖 sourceText / 派生 details / 追加 extras */
export interface BuildResult {
  sourceText?: string;
  details?: string;
  extras?: Record<string, string>;
}
export type BuildHook = (ctx: BuildCtx) => BuildResult;

/** parse 钩子：编辑既有条目时回填 form（结构化反向解析 + 旧数据迁移） */
export type ParseHook = (entry: Entry, form: Record<string, string>) => void;

/** 每类一个自包含 spec */
export interface CategorySpec {
  key: string;
  label: string;
  fields: SheetField[];                  // 专属字段（不含 COMMON / APPEARANCE）
  sections: HomebrewSection[];           // 表单分区
  editors?: Record<string, FieldEditor>; // 专用编辑器（单字段渲染控件）
  withoutBody?: boolean;                 // 隐藏正文 sourceText 区
  build?: BuildHook;                     // 结构化派生（可缺省 → 通用实现）
  parse?: ParseHook;                     // 反向回填（可缺省 → 无）
  Preview: Preview;                      // 预览卡（可缺省 → GenericCard）
}
```

### 2.2 注册表与兜底

```ts
// web/src/lib/categorySpecs/index.ts
export const CATEGORY_SPECS: Record<string, CategorySpec> = { /* 每类一个模块 */ };
export function specFor(cat: string): CategorySpec {
  return CATEGORY_SPECS[cat] ?? genericSpec(cat);
}
```

`genericSpec(cat)`：`fields=[]`、`sections=genericSections(label)`、`Preview=GenericCard`、无 `build/parse`、`withoutBody=false` → **与现状通用行为完全一致**。未登记的 15 类（含 vice / virtue / reference / creature 等）在骨架阶段自动落入兜底，行为零变化。

### 2.3 Shell 查表改造（行为不动，只搬家）

| Shell 点 | 改造方式 |
| --- | --- |
| `buildEntry` | 收集 `extras` 与 `sourceText` 后调用 `spec.build?.({...})`；`spec.build` 返回 `{sourceText, details, extras}`。无 `spec.build` 时走通用：`!withoutBody && sourceText → details`（保留 power 的标签块特殊派生）。 |
| `draftToForm` | 通用回填后调用 `spec.parse?.(entry, form)`。 |
| `EntryEditor.renderField` | 先查 `spec.editors?.[f.key]`，命中即渲染；否则走现有默认渲染链。`powerType / usageZh / actionType` 的 chip 渲染、feat 的 `prerequisite` 句式 chips 与 `benefit` 预设条、race 的 `raceTraits` 新编辑器全部迁入对应 spec 的 editors。 |
| `EntryCard` | `const spec = specFor(entry.category); return <spec.Preview entry frame jump lookup optionalOn />`。装备三形态（`MundaneItemSlot/Picker`、`AdventureItemRow`）由 equipment spec 的 Preview 内部按 `entry.itemForm` / `isMundaneEntry` 分发，EntryEditor 预览区统一渲染 `<specFor(cat).Preview>`。 |
| `fieldsFor` | `COMMON + spec.fields + APPEARANCE_FIELDS`；`POWER_REF_CATEGORIES` / `WITHOUT_BODY` 常量随各 spec 的 `sections` / `withoutBody` 消解。 |

**跨字段联动保留在 Shell**：装备的形态切换与统计行显隐（`equipGuide`、`MUNDANE_FIELDS` 按 `form.itemForm/itemCategory` 过滤）属于多字段联动，不塞进单字段编辑器；`spec.editors` 只接管「单字段的渲染控件」。

### 2.4 正文区规则（显式化）

1. `spec.sections` 含 `sourceText` 键 → 正文区在指定位置渲染。
2. 否则按现状自动补正文区，除非 `spec.withoutBody === true`（feat / power / dictionary）。
3. powerRef 类（class / theme / paragon-path / epic-destiny 等）：正文区**仍显示**（lore 需手写），但 `levelSections` 非空时结构化结果覆盖 `sourceText`。
4. race 的正文已升级为结构化块列表（`loreSections`）：**`spec.sections` 显式声明 `loreSections` 时不再自动补 `sourceText` 正文区**，避免出现两个正文入口。

---

## 三、19 类逐一 spec 设计

> 「现状」= 今日代码行为；「目标」= 本架构落地后的行为。绿色 ✅ = 已达标、机械迁入即可；黄色 ⚠️ = 需重构/新增。

### 3.1 总览

| # | key | 标签 | 专用编辑器 | 结构化 build/parse | 现状预览 | 目标预览 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | power | 威能 | ✅ PowerBlockEditor + 频率/类型/动作 chips | ✅ | ✅ PowerCard | PowerCard（不变） |
| 2 | equipment | 装备 | ✅ 威能段/特性段 + 统计表 | ✅ 三形态 + 增强算法 | ✅ ItemCard | ItemCard + 三形态统一入口 |
| 3 | feat | 专长 | ✅ 前提 chips / 增益预设 / 等级表 | ✅ | ✅ FeatCard | FeatCard（不变） |
| 4 | race | 种族 | ✅ RaceTraitEditor + 新建 RaceLoreEditor | ✅ classTrait 拼装/反解 | ⚠️ RaceCard（自带卡片头/字段条、渲染器与车卡不同） | RaceCard = 车卡「种族特性」板块外层同构 |
| 5 | class | 职业 | ✅ LevelSectionsEditor | ✅ | ⚠️ GenericCard | ClassCard（车卡职业能力面板） |
| 6 | paragon-path | 典范之道 | ✅ LevelSectionsEditor（四槽位模板） | ✅ | ⚠️ GenericCard | LevelSectionsCard |
| 7 | epic-destiny | 传奇天命 | ✅ LevelSectionsEditor（四槽位模板） | ✅ | ⚠️ GenericCard | LevelSectionsCard |
| 8 | theme | 主题 | ✅ LevelSectionsEditor（三段式模板） | ✅ | ⚠️ GenericCard | ThemeCard（ThemeChapters 同构） |
| 9 | domain | 领域 | ✅ LevelSectionsEditor（三节模板） | ✅ | ⚠️ GenericCard | LevelSectionsCard |
| 10 | magic-school | 魔法学派 | ✅ LevelSectionsEditor（六节模板） | ✅ | ⚠️ GenericCard | LevelSectionsCard |
| 11 | pact | 契约 | ✅ LevelSectionsEditor（骨架模板） | ✅ | ⚠️ GenericCard | LevelSectionsCard |
| 12 | bloodline | 血统 | ✅ LevelSectionsEditor（四槽位模板） | ✅ | ⚠️ GenericCard | LevelSectionsCard |
| 13 | item-set | 物品套装 | ✅ SetBonusEditor | ✅ | ⚠️ GenericCard | ItemSetCard |
| 14 | ritual | 仪式 | —（默认控件） | ✅ 头部六行字段化 | ⚠️ GenericCard | RitualCard |
| 15 | creature | 生物 | ✅ CreatureBlockEditor | ✅ | ✅ GenericCard（gen-creature-card） | CreatureCard（封装） |
| 16 | dictionary | 译名字典 | ✅ TermsPairsEditor | ✅ | ⚠️ GenericCard | DictionaryCard |
| 17 | vice | 败德 | — | — | ✅ GenericCard | GenericCard（不变） |
| 18 | virtue | 美德 | — | — | ✅ GenericCard | GenericCard（不变） |
| 19 | reference | 术语 | — | — | ✅ GenericCard | GenericCard（不变） |

### 3.2 已达标三类（机械迁入，不重构）

**power**：`fields` / `sections` / `editors`（`powerType`、`usageZh`、`actionType` chips + `powerBlocks`）照搬；`build` = 派生 `usage/powerKind` + `serializePowerBlocks → details`；`parse` = `usageZh/powerType/grantedBy` 反推 + `parsePowerDetails → powerBlocks` + 宏占位清理；`Preview = PowerCard`。

**equipment**：`fields`（27 个）/ `sections`（含 `kind:"equip-stats"` 与 optional 区块）照搬；`editors` = `powerSections` + `properties`；`build` = 三形态 + 增强算法 + `serializeEquipmentDetails → details` + `power → entry.power`；`parse` = 反解 `powerSections/properties`、`enhTarget` 归位、`itemForm` 兜底、官方残余头部行回填正文；`Preview` = 内部按 `isMundaneEntry` / `itemForm === "adventure"` 分发 `MundaneItemSlot/Picker`、`AdventureItemRow+GenericCard`、`ItemCard`。

**feat**：`fields` / `sections` 照搬；`editors` = `prerequisite` 句式 chips、`benefit` 预设条、`featRows`（FeatTableEditor）；`build` = benefit 末尾拼等级表；`parse` = 反解 `featRows`；`withoutBody = true`；`Preview = FeatCard`。

### 3.3 需重构/新增的类别要点

**race（详见第四节，首个完整实例）**：脱离 LevelSectionsEditor，改为 8 个固定头部槽（新增平均身高/平均体重）+ 结构化种族特性 + classTrait 拼装 + 可增删正文块列表（loreSections）+ 车卡外层同构预览。全文见 [15-种族-race.md](file:///J:/4E-NEXT/私设设计/15-种族-race.md)。

**class**：字段/区块/编辑器维持现状（`LevelSectionsEditor` + 职业数据）。预览由 GenericCard 升级为 **ClassCard**：复用 [wikirender.ts](file:///J:/4E-NEXT/web/src/lib/wikirender.ts) 的 `classTraitHtml` / `classFeaturesHtml` / `splitClassLore` + 车卡职业能力面板 CSS（`ClassFeatureBlock` 同构），正文 `[[威能]]` 走 `FeatRichText` 悬浮。目标：编辑职业时预览 = 车卡「职业能力」板块。

**paragon-path / epic-destiny**：字段/编辑器维持。预览升级为 **LevelSectionsCard**：`!! N级：标题` 分节渲染（复用 race 重构后的分节组件），含前提条与 `[[威能]]` 悬浮。

**theme / domain / magic-school / pact / bloodline（powerRef 五类）**：字段/区块/编辑器维持（各自 `LEVELSECTION_TEMPLATES` 骨架）。预览升级：通用 **LevelSectionsCard**；theme 单独升级为 **ThemeCard**（复用车卡 `ThemeChapters` 组件：lore 折叠 / 机制展开 / 起始·额外·可选三威能列表）。

**item-set**：字段/编辑器维持（`SetBonusEditor` + `setComponents` 链接多选）。预览升级为 **ItemSetCard**：lore 折叠 + 组成 `[[物品]]` 链接 + 件数增益块，复用 `splitThemeSections` 与 `FeatRichText`。

**ritual**：字段/区块维持。预览升级为 **RitualCard**：`div.ritualinfo` 头部六行（等级/类别/时间/花费/市场价/关键技能）+ 效果正文，复用 `serializeRitualInfo` 同构渲染。

**creature**：字段/区块/编辑器维持。预览 = **CreatureCard**（封装现有 GenericCard 的 `gen-creature-card` 分支，仅显式归属 spec，行为不变）。

**dictionary**：字段/编辑器维持。预览升级为 **DictionaryCard**：英文 → 中文词条对照表（复用 `parseTerms` 语义）。

**vice / virtue / reference**：无专属字段，直接落入 `genericSpec` 兜底，无需 spec 模块（或仅登记一个壳引用 GenericCard）。

---

## 四、race 首个完整实例设计

> 详细方案见 [15-种族-race.md](file:///J:/4E-NEXT/私设设计/15-种族-race.md)（该文件已按当前计划整体覆盖）。此处只记架构落点与不可违背的契约。

### 4.1 落点：字段 / 编辑器 / build / parse / 预览

- `CATEGORY_FIELDS.race`（12 键）：`avgHeight` `avgWeight`（**新增**）/ `abilityOne` `abilityTwo` / `size` `speed` `vision` / `skillBonus` `languages` / `raceTraits`（JSON）/ `startingPower` / `loreSections`（JSON，**取代 `sourceText`**）。
- `CATEGORY_SECTIONS.race`：基本信息 · 种族 / 种族数据（**8 个固定槽**）/ 种族特性 / 起始威能 / 正文（正文块列表）/ 标签 —— 不再出现 `sourceText`，并**去掉「外观」行**（已决策，见第六节 6）。
- `editors`：`raceTraits → RaceTraitEditor`、`loreSections → RaceLoreEditor`。
- `build`：`@@.classTrait` 块（**无条件拼装**；8 个头部槽行按有值字段选择性写入，顺序固定）→ `@@` → `{{起始威能}}` → 按序各正文块；`fields` 派生 `race-size/speed/vision/abilityone/abilitytwo` 五键。属性调整修正为官方形态 `+2{{!!race-abilityone}}；+2{{!!race-abilitytwo}}`。
- `parse`：8 个头部槽行 → 8 个字段（`RACE_HEADERS` 必须含「平均身高」「平均体重」，否则官方文本里这两行会被误读成特性行）→ 特性行 → 起始威能 → 剩余正文按 `!! ` 切为 `loreSections`；老存档（`!! N级` 分节 / 纯文本 / 旧 `skill` 字段）按 15- 的迁移表处理。
- `Preview = RaceCard`：**完整复刻车卡「种族特性」板块外层**（`section.block` + `block-head`（含详细/简洁 chip）+ `pf-entry-title` + 条件亚种 chip），**不再自带卡片头与字段条**。

### 4.2 三条车卡消费契约（不可违背）

1. 头部 8 槽顺序固定且必须排在特性行之前 —— 车卡「简洁」模式按位置切分头部与实用特性。
2. 特性行正文里的 `[[威能名]]` 会被自动授予进威能面板；`替代「XX」` 被识别为替换关系。
3. 语言 / 技能奖励为正则消费：技能须 `+N技能名` 且命中技能表；语言靠「任选两种」「A或B」留空槽 —— 这两项**保留自由自输入**，但必须给格式提示与技能名 chips。

### 4.3 共享渲染器（本节决策）

车卡 `WikiBody` + `enBreak` 由 `CharacterSheet.tsx` 私有函数**搬到** `web/src/sheet/WikiBody.tsx` 导出；预览侧统一改用它（弃用 `FeatRichText` 的等价私有实现）。悬浮卡内容以 `pop: (e: Entry) => ReactNode` 参数注入，规避 `WikiBody ↔ EntryCard` 循环依赖。这是「预览 = 车卡」在渲染层面的唯一保证；后续 ClassCard / ThemeCard / ItemSetCard 直接复用。

### 4.4 正文块列表（取代「一个大文本框」）

「正文」面板**保留**（它是自由输入难以规范内容的唯一工具），但改为**可增删的块列表**：每块 = 标题（预置 chip + 自由输入，留空 = 无标题自由块）+ 正文 textarea + 上移 / 下移 / 删除，底部「＋ 添加正文块」。

- 块序规则：只有首块允许无标题（车卡把第一个 `!! ` 之前的文本归入「种族背景」引言）；非首位无标题块在 build 时并入前一块。
- 标题含「辅助威能」的块给专属结构提示（`!!! 中文名 English` + `{{中文名 English}}` + 描述段），否则车卡不会渲染出可悬浮、带「选择此威能」的威能条目。
- 编辑态一律 keepEmpty（保留空行与原始空白），保存态才裁剪过滤 —— 否则「＋ 添加」出来的空行会被立刻剔除，表现为按钮无反应。

---

## 五、实施顺序与验证

1. ~~骨架~~ **✅ 已完成**：`web/src/lib/categorySpecs/`（types + index/genericSpec + entryBuild）落地；`fieldsFor` / `buildEntry` / `draftToForm` / `renderField` / `EntryCard` 已改为查表，未登记类别走兜底；power / equipment / feat 三份现状逻辑已机械迁入（行为零变化）。
2. **race 实例（进行中）**：首版（字段重构 + RaceTraitEditor + classTrait 拼装/反解 + RaceCard 重写 + 老存档迁移）**已完成**；本轮按 [15-种族-race.md](file:///J:/4E-NEXT/私设设计/15-种族-race.md) 第五节的 6 步清单**补充**：① 属性调整格式修正 + 平均身高/体重槽（`RACE_HEADERS` 扩到 8 项）→ ② `loreSections` 正文块列表全链路 → ③ `WikiBody` / `enBreak` 搬到 `sheet/WikiBody.tsx` → ④ RaceCard 预览对齐车卡外层（删 `rc-head` / `rc-fields`）→ ⑤ 车卡侧配套（`compactRaceTraits` 改显式头部槽行集合、Ghost/hint 同步）→ ⑥ 验证。每步以「预览与车卡并排比对」为验收标准。
3. **验证**：`web` 目录 `npx tsc --noEmit`；`pnpm --filter 4enext-web dev` 起服务（端口 5174；注意包名是 `4enext-web`，不是 `dnd4e-kcc-web`）。**逐项比对法**：把 `web/public/data/categories/race.json` 的官方矮人条目经编辑器「上传 JSON」导入，与车卡并排核对特性行 / 替代 chip / lore 折叠 / 辅助威能（**比对前不要保存**，否则会存成私设条目）。
4. **其余类别逐个**：class → paragon-path/epic-destiny → powerRef 五类 → item-set / ritual / dictionary → creature 封装，每类作为独立任务，按第三节目标设计实现（每类：字段确认 → 预览卡升级 → 验证）。所有预览的正文渲染统一改用共享 `WikiBody`（见 4.3）。

---

## 六、风险与开放问题

1. **race classTrait 兼容性**：老 race 存档的散装 `!! 特性名` 分节（无 classTrait 块）→ 迁移为 `raceTraits`（`!! N级` 前缀形态）或单条无标题 `loreSections`（纯文本形态）；无 classTrait 块时 RaceCard 保留现有分节渲染为 fallback。
2. **官方种族字段名**：`race-size` 等 `fields` 键需对照 `web/public/data/categories/race.json` 实测确认（已确认存在，无 skill/语言键）。
3. **ClassCard / ThemeCard 复用度**：**已决策**（见 4.3）—— 把车卡 `WikiBody` + `enBreak` 搬到 `sheet/WikiBody.tsx` 导出、悬浮卡内容用 `pop` 参数注入；该项在 race 实例落地时一并完成，后续各类预览直接复用，不再各自复制等价逻辑。
4. **装备 Preview 统一入口**：`MundaneItemSlot/Picker`、`AdventureItemRow` 挂在 EntryEditor 预览区的硬编码逻辑移入 equipment spec 的 Preview 后，`optionalOn` / `jump` 传参需对齐。
5. **骨架阶段不迁移**：除 power/equipment/feat 外的 15 类在骨架阶段保持现状（兜底），其 spec 在后续任务中逐个实现 —— 保证「每类方案独立设计」不被一次性机械迁移冻结。
6. **race 外观区与亚种（已决策）**：race **隐藏** `cardColor` / `cardIcon`（车卡种族面板无卡片头，配色本就无作用，不做）；**亚种本轮不做**，之后作为独立任务设计（编辑器暂不提供亚种创作辅助）。
