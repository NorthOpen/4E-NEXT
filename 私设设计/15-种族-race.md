# 种族（race）私设编辑器设计

> 优先级：**P1** · 状态：**设计锁定，待实现**
> 数据依据：官方 54 条种族（`web/public/data/categories/race.json`）的 classTrait 结构统计
> 架构落位见 [00-CategorySpec-统一架构设计.md](file:///J:/4E-NEXT/私设设计/00-CategorySpec-统一架构设计.md) 第四节；**本文件为种族唯一详细方案**，实施顺序见该文第五节。

## 〇、根本结构（54 条官方种族实测）

车卡消费种族条目**不读字段，只读文本结构**（`parseRaceAutofill` / `raceTraitHtml` / `parseRaceTraitLines` / `splitRaceLore` 全是正则读文本）。所以编辑器的任务 = 把「可规范的部分」做成结构化字段，把「难以规范的叙事」留给自由正文块，保存时按官方格式拼装。

classTrait 块（45/54 条目有）的固定骨架：

| 位置 | 内容 | 出现数 | 处理方式 |
| --- | --- | --- | --- |
| 头部槽 1 | `''平均身高：''129cm-145cm/4'3"-4'9"` | 45 | 字段 `avgHeight` |
| 头部槽 2 | `''平均体重：''73kg-100kg/160-220 lb` | 45 | 字段 `avgWeight` |
| 头部槽 3 | `''属性调整：''+2{{!!race-abilityone}}；+2{{!!race-abilitytwo}}` | 46 | `abilityOne` / `abilityTwo`（成绩固定 +2） |
| 头部槽 4 | `''体型：''{{!!race-size}}` | 45 | `size` |
| 头部槽 5 | `''速度：''{{!!race-speed}}` | 45 | `speed` |
| 头部槽 6 | `''视觉：''{{!!race-vision}}` | 44 | `vision` |
| 头部槽 7 | `''语言：''通用语，矮人语` | 45 | `languages`（自由自输入 + 约定提示） |
| 头部槽 8 | `''技能奖励：''+2地城，+2坚韧` | 44 | `skillBonus`（自由输入 + 技能名 chips） |
| 数组 1 | 特性行 `''名称：''正文`（含「替代「XX」」10 条、含「选择」34 条） | — | `RaceTraitEditor` |
| 单行 | `{{起始威能名}}` | — | `startingPower` |
| 数组 2 | lore 分节 `!! 标题` + 正文（外貌特征 ×40 / 态度和信仰 ×23 …） | 49 | 正文块列表 |
| 数组 3 | 辅助威能小节 `!! XX辅助威能` → `!!! 威能名` + `{{威能名}}` + 描述 | 22 | 正文块（标题含「辅助威能」即特化渲染） |

**三条车卡消费契约（改编辑器时不可违背）**：

1. 头部 8 槽**顺序固定且必须排在特性行之前** —— 车卡「简洁」模式按位置切分头部与实用特性。
2. 特性行正文里的 `[[威能名]]` 会被自动授予进威能面板（`raceGrantedPowerEntries`）；`替代「XX」` 被识别为替换关系（`raceAltForBase`）。
3. 语言 / 技能奖励是**正则消费**：技能必须写成 `+N技能名` 且名称命中技能表（别名表仅「贼活→盗术」）；语言靠「任选两种」「A或B」才留空槽给玩家自选 —— 因此这两项**保留自由自输入**，但必须给格式提示。

## 一、卡片结构（右侧预览）

**预览 = 车卡「种族特性」板块的完整外层同构**（不新增卡片头）：

```
section.block
  block-head       ← h3「种族特性」+ [亚种 chip（仅该条目确有亚种关系时）] + 详细/简洁 chip
  pf-entry-title   ← 种族名（选中亚种时为亚种名）
  race-detail
    race-trait     ← 逐条特性行；详细模式下 `X 替代 Y` 呈现 sr-tag 互斥 chip
    race-lore      ← lore-fold 折叠小节；辅助威能小节 = lore-powers 标题 + 折叠威能条目
```

- **删除**现预览多出的两块：`rc-head`（卡片头：名称/自制徽章/「种族」meta）与 `rc-fields`（属性/体型/速度/视觉/技能/语言字段条）—— 车卡面板两者都没有。名字由 `pf-entry-title` 承载，因此搜索页与悬浮卡同样不丢信息。
- 未收录威能与车卡一致：无按钮、标题纯文本。
- 「选择此威能」按钮在预览中做**局部可切换态**（视觉与车卡一致，点击不写车卡数据）。
- 空态 `Ghost` 指向新字段 key（`raceTraits` / `loreSections` / `avgHeight` …），不再指向 `sourceText`。

## 二、数据模型

| 字段 | 类型 | 变化 |
| --- | --- | --- |
| name / nameEn / source | 文本 | 不变 |
| **avgHeight 平均身高** | text | **新增** |
| **avgWeight 平均体重** | text | **新增** |
| abilityOne / abilityTwo 出生奖励属性 | select ×2（SIX_ABILITIES） | 不变 |
| size 体型 | select（RACIAL_SIZES） | 不变 |
| speed 速度 | multichips（SPEEDS） | 不变 |
| vision 视觉 | multichips（VISIONS） | 不变 |
| **skillBonus 技能奖励** | text + 技能名 chips | 由旧 `skill`(multichips) 演进 |
| **languages 语言** | text（保留自由自输入）+ 约定提示 | 新增 |
| **raceTraits 种族特性** | longtext JSON `RaceTraitRow[] = { name, body, replaces? }` | 取代 `levelSections` |
| **startingPower 起始威能** | text | 新增 |
| **loreSections 正文块** | longtext JSON `RaceLoreBlock[] = { title?, body }` | **取代 `sourceText`** |
| cardColor / cardIcon 外观 | — | **不参与 race**（已决策，见六-1） |

`fields` 侧（`{{!!}}` 宏）：build 派生 `race-size / race-speed / race-vision / race-abilityone / race-abilitytwo` 五键。

## 三、设计要点

### 3.1 编辑面板（左侧，自上而下）

1. **基本信息 · 种族**：name / nameEn / source
2. **种族数据**（8 个固定槽，顺序即官方顺序）：平均身高 → 平均体重 → 属性调整（两个 select）→ 体型 → 速度 → 视觉 → 语言 → 技能奖励
3. **种族特性**：`RaceTraitEditor`（名称 + 正文 + 可选「替代」+ 增删 / 上移下移），提示「正文内写 `[[威能名]]`，保存后车卡会自动授予该威能」
4. **起始威能**：`startingPower`
5. **正文**：可增删的正文块列表（见 3.2）
6. **标签**

### 3.2 「正文」面板 = 可增删的正文块列表

**保留**正文面板作为「自由输入难以规范内容」的工具性，只改变它的存在方式：从一个大文本框 → 可增删、可分节的块列表。

- 每块 = 标题 + 正文 textarea + ↑ / ↓ / ✕
- 标题预置 chip：种族背景 / 外貌特征 / 态度和信仰 / 团体 / 角色扮演 / 辅助威能（也可自由输入）
- **留空标题 = 无标题自由块**，完全等价旧正文面板的功能（原样输出）
- 底部「＋ 添加正文块」
- **块序规则**：只有首块允许无标题（车卡 `splitRaceLore` 会把第一个 `!! ` 之前的文本归入「种族背景」引言）；非首位的无标题块在 build 时并入前一块，避免出现「写了却没显示」的错觉。
- 「辅助威能」块给专属结构提示：`!!! 中文名 English` + `{{中文名 English}}` + 描述段 —— 只有这个结构车卡才会渲染出可悬浮、带「选择此威能」的威能条目。

## 四、解析方式

### 4.1 build（保存）

拼装顺序：**classTrait 块 → `@@` → `{{起始威能}}` → 按序各正文块**。

```text
@@.classTrait """
''平均身高：''129cm-145cm/4'3"-4'9"
''平均体重：''73kg-100kg/160-220 lb
''属性调整：''+2{{!!race-abilityone}}；+2{{!!race-abilitytwo}}
''体型：''{{!!race-size}}
''速度：''{{!!race-speed}}
''视觉：''{{!!race-vision}}
''语言：''通用语，矮人语
''技能奖励：''+2地城，+2坚韧
''铁胃：''…（特性行，可多条，按编辑器顺序）
"""
@@
{{矮人恢复力 Dwarven Resilience}}
!! 外貌特征 Physical Qualities
…（正文块）
```

- 头部槽行按**有值字段选择性写入**；classTrait 块**无条件拼装**（只填了头部字段的种族也必须在车卡上可见）。
- 属性调整修正为官方形态 `+2{{!!race-abilityone}}；+2{{!!race-abilitytwo}}`（单属性时 `+2{{!!race-abilityone}}`）。
- 特性行的 `replaces` 若未出现在正文中，自动补「替代「XX」」语义。
- 正文块：有标题 → `!! 标题` + 正文；首块无标题 → 直接写正文。
- 保存态才裁剪空行 / 过滤空块；编辑态必须 keepEmpty（否则刚「＋ 添加」出来的空行会被立刻剔除，表现为按钮无反应）。

### 4.2 parse（反解回表单）

- classTrait 头部 8 行 → 8 个字段。`RACE_HEADERS` 由 6 项扩到 **8 项**（补「平均身高」「平均体重」），否则官方种族文本里这两行会被 `parseRaceTraitLines` 误读成特性行。
- 特性行 → `raceTraits`；块后 `{{威能名}}` → `startingPower`；剩余正文按 `!! ` 切为 `loreSections`。
- 回填时剥离 `@@.indent` / 独立 `@@` 行，避免裸露标记出现在文本框里。

### 4.3 老存档迁移

| 旧形态 | 迁移 |
| --- | --- |
| 无 classTrait + `!! N级：` 分节 | `parseLevelSections` → `raceTraits`（标题=特性名，body=正文） |
| 无 classTrait + 纯文本 | 单条无标题 `loreSections` |
| 有 classTrait 的 sourceText | 按 `!! ` 切为 `loreSections` |
| 旧 `skill` 字段 | 值并入 `skillBonus` |

### 4.4 辅助威能独立分区（本轮追加）

「XX辅助威能」小节结构固定为 `!! 标题` + 引言 + （`!!! 威能名` + 描述 + `{{威能名}}`）× N，车卡据此渲染可悬浮、带「选择此威能」的条目标题 —— 这是自由正文块做不到的，因此**不把它当正文块的普通标题**，改为独立结构化字段：

- 新字段 `raceAuxPowers`（`RaceAuxGroup = { title, intro, powers: { name, body }[] }`），新增 `RaceAuxEditor` 与 `CATEGORY_SECTIONS.race` 的独立「辅助威能」分区；`RaceLoreEditor` 的标题 chips 去掉「辅助威能」。
- build：`serializeRaceAux` 拼在小节末尾（官方中该小节也是最后一个 `!!` 小节）；**只有标题无引言/条目时不输出**，否则每个种族都会凭空多一个空小节。
- parse：从 `loreSections` 里把标题命中「辅助威能 / 种族威能」的块抽出为 `raceAuxPowers`，其余按序留在 `loreSections`（兼容已存的老数据）。

### 4.5 「填了没用 / 选了没用」三处修复（本轮追加）

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| 种族特性只填正文、不填特性名 → 预览整体消失 | 车卡 `parseRaceTraitLines` 靠 `''名称：''正文` 定位，无名则该行不渲染 | build 兜底占位名「未命名特性」+ 保存前校验拦截（红条 + 定位） |
| 体型 / 速度 / 视觉 选了预览无变化 | 这三项是车卡自动回填项，`raceTraitHtml` 会剔除对应行（车卡上它们在「角色信息」「移动力」面板） | 预览卡片保持 1:1 不动，改在卡片**外**加 `hb-ed-map` 映射说明框，列出当前值与去向 |
| 起始威能填了毫无反应、车卡也不授予 | 原实现只写块后的 `{{威能名}}` transclusion 行，而 `wikiToHtml` 会剥掉 `{{}}`、`raceGrantedPowerEntries` 只认特性正文里的 `[[ ]]` | 改为官方写法：在 classTrait **内**追加一行 `''短名：''你具有[[威能全名]]威能。`（`{{威能名}}` 行保留以求文本一致）。**已提及则不追加**——矮人「矮人恢复力」本身就是含 `[[ ]]` 的特性行；半精灵「成功诀窍」是「半精灵威能选择」的二选一子项，追加会把互斥选项变成默认授予 |
| 辅助威能混在正文块标题 chips 里 | 见 4.4 | 拆为独立分区 |

## 五、实现清单

1. [x] 属性调整格式修正 + 新增 `avgHeight` / `avgWeight` 字段 + `RACE_HEADERS` 扩到 8 项
2. [x] `loreSections` 全链路：字段 + `CATEGORY_SECTIONS` 把「正文」的 keys 由 `sourceText` 改为 `loreSections` + `RaceLoreEditor` + build/parse + 老存档迁移 + keepEmpty
3. [x] `WikiBody` + `enBreak` 由 `CharacterSheet.tsx` 私有函数搬到 `web/src/sheet/WikiBody.tsx` 导出；悬浮卡内容用 `pop: (e: Entry) => ReactNode` 参数注入（规避 `WikiBody ↔ EntryCard` 循环依赖）；CharacterSheet / EntryCard 各自改 import
4. [x] RaceCard 预览对齐车卡外层（`section.block` / `block-head` / `pf-entry-title` / 详细·简洁 chip），删除 `rc-head` 与 `rc-fields`；特性行 `X 替代 Y` 静态 sr-tag；辅助威能「选择此威能」局部可切换态
5. [x] 车卡侧配套：`compactRaceTraits` 改为按**显式头部槽行集合**剔除（现依赖「技能」行位置 —— 私设种族不填技能奖励时会失效）；`Ghost` target 与「正文」section hint 同步
6. [x] 验证：`npx tsc --noEmit`（cwd=`web`）通过；dev server 编译正常；官方矮人条目 `draftToForm → buildEntry → draftToForm` 往返幂等、RaceCard 服务端渲染结构与车卡逐项一致（`race-trait-line` / `race-trait-row` / `race-trait-opts` / `lore-fold` / `lore-powers` / `lore-powers-toggle` 类名全对齐）；老存档两条迁移分支（`!! N级` 分节 / 纯文本 + 旧 `skill`）回填正确；浏览器实测编辑器分区齐全、`＋ 添加正文块` 生效、控制台无报错
7. [x] 见 4.4 / 4.5：辅助威能拆为独立分区（字段 + 编辑器 + build/parse + 老数据抽出）；无名特性行兜底与保存校验；预览卡片外加 `hb-ed-map` 车卡映射说明框；起始威能改为在 classTrait 内写官方格式的 `[[威能全名]]` 特性行（已提及不追加）。浏览器实测：分区顺序为 基本信息/种族数据/种族特性/正文/辅助威能/起始威能/标签；体型 chips、速度 chips 触发说明框更新；无名特性行渲染为「未命名特性」；`＋ 添加威能` 使行数 +1 且预览出现 `lore-powers` 块与「选择此威能」；「正文」卡片 chips 已无「辅助威能」；控制台无 error。往返核对：矮人 classTrait 的 `[[矮人恢复力 Dwarven Resilience]]` 行数不增、半精灵不注入、新建种族 `draftToForm → buildEntry` 幂等（`IDEMPOTENT=true`）

## 六、已决策与待办

1. **外观区（已决策 · 不做）**：race **隐藏** `cardColor` / `cardIcon` —— 车卡种族面板没有卡片头，配色/图标对种族本来就没有作用，所以不做。`CATEGORY_SECTIONS.race` 去掉「外观」行。
2. **亚种（本轮不做）**：车卡能识别手写亚种结构（`<<< 属于[[X]]的亚种 <<<` + `!! XX增益` + 增益内 `替代「XX」`），编辑器不提供创作辅助。本轮任务先不做，之后作为独立任务设计（它与基础种族共享 `RaceTraitEditor` 的 `replaces` 能力）。
3. **正文块合并规则（已决策）**：非首位无标题块自动并入前块。