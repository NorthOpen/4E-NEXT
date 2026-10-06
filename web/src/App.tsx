import { platform } from "@platform";
import { useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import CharacterSheet from "./sheet/CharacterSheet";
import { exportCharacterCard, type ExportFormat } from "./lib/exportImage";
import SearchView from "./SearchView";
import SettingsView from "./SettingsView";
import LearnView from "./LearnView";
import AiView from "./AiView";
import ReserveView from "./ReserveView";
import OverviewView from "./OverviewView";
import BackgroundView from "./BackgroundView";
import GuideView, { GuideFloatingBar } from "./GuideView";
import HomebrewView from "./HomebrewView";
import GmView from "./GmView";
import StoryView from "./StoryView";
import ReviewView from "./ReviewView";
import GmAiView from "./GmAiView";
import { loadCards, saveCards, loadActiveId, saveActiveId, safeSetItem, uid, type SavedCard } from "./lib/storage";
import { defaultCharacter, migrateCharacter, type Character } from "./sheet/character";
import { GUIDE_CARD_NAME, GUIDE_STEPS, guideStepIndex, guideSteps as guideStepsFor, loadGuideRun, saveGuideRun, type GuideRun } from "./lib/guide";
import { SYNC_APPLIED_EVENT } from "./lib/sync";
import { FilledButton, TextButton } from "./components/md";
import SheetDialog from "./components/SheetDialog";
import SavePanel from "./components/SavePanel";
import StorageAlert from "./components/StorageAlert";
import Logo from "./components/Logo";
import TutorialGuide from "./components/TutorialGuide";
import { markTutorialSeen, shouldAutoStartTutorial } from "./lib/tutorial";
import { useIsMobile } from "./lib/media";

// 导出给 lib/tutorial —— 教学步骤要指明「这一步切到哪个页面」。
// type 导入在编译期被抹掉，不会和 App 形成运行时循环依赖。
export type View = "sheet" | "background" | "reserve" | "overview" | "guide" | "search" | "learn" | "ai" | "homebrew" | "settings";
type Layout = "single" | "double";

// 手机端底部导航（MD3 NavigationBar）：只放建卡/跑团最常用的 4 个顶级目标。
// MD3 规定 NavigationBar 容纳 3–5 项，其余入口（存档 / 导引 / 私设 / 词条 / 规则 / 设置）
// 收进「更多」底部面板，避免把底栏塞成密集图标条。
const MOBILE_NAV: { view: View; icon: string; label: string }[] = [
  { view: "sheet", icon: "person", label: "人物" },
  { view: "overview", icon: "overview", label: "速览" },
  { view: "background", icon: "book", label: "背景" },
  { view: "reserve", icon: "inventory_2", label: "储备" },
];

// 桌面导轨组 1：与手机底栏是同一批功能，只是顺序按导轨原样（人物 / 背景 / 储备 / 速览）。
// data-tour 由 "nav-" + view 拼出，与教学引导依赖的锚点一一对应。
const PLAYER_PRIMARY: { view: View; icon: string; label: string }[] = [
  { view: "sheet", icon: "person", label: "人物" },
  { view: "background", icon: "book", label: "背景" },
  { view: "reserve", icon: "inventory_2", label: "储备" },
  { view: "overview", icon: "overview", label: "速览" },
];

// 主持模式的主功能：**占据玩家侧那四个功能的位置**，切换模式时整组换掉。
// 「怪物」是战斗时的追踪台，「故事」是团内线索/想法的白板；「审阅」把存档里的卡摊开来看。
// 主持侧的「AI」不列在这里：它顶替的是导轨下方玩家组里那个 AI 按钮
// （见 openAiPage —— 同一个按钮在两种模式下指向各自那一页，不在导轨里再占一个位置）。
// 以后加先攻追踪等，往这里加一项即可。
const GM_NAV: { view: string; icon: string; label: string }[] = [
  { view: "monsters", icon: "menu_book", label: "怪物" },
  { view: "story", icon: "account_tree", label: "故事" },
  { view: "review", icon: "fact_check", label: "审阅" },
];

/** 这些页面由「更多」面板承载：命中时把底栏的「更多」标为选中，用户才知道自己在哪 */
const MOBILE_MORE_VIEWS: View[] = ["search", "learn", "ai", "homebrew", "settings"];

// S 曲线羽化：多段渐停近似缓动，底部渐隐更自然
function featherMask(feather: number): string {
  const start = Math.max(0, 100 - feather);
  const b = feather;
  const stops = [
    "black 0%",
    "black " + start + "%",
    "rgba(0, 0, 0, 0.82) " + (start + b * 0.15) + "%",
    "rgba(0, 0, 0, 0.5) " + (start + b * 0.35) + "%",
    "rgba(0, 0, 0, 0.2) " + (start + b * 0.6) + "%",
    "transparent 100%",
  ];
  return "linear-gradient(to bottom, " + stops.join(", ") + ")";
}

function Shell() {
  const { bgImage, bgBlur, bgFeather, portraitOriginal, portraitCropped, applyPortrait, clearPortrait } = useTheme();
  const [view, setView] = useState<View>("sheet");
  // 应用级模式：player = 车卡器（现有全部功能），gm = 主持模式。
  // 主持模式刻意不复用 view —— 进主持后绝大部分玩家功能都不适用，
  // 导轨整体换成主持侧的内容，退出时才回到原来那套页面。
  const [appMode, setAppMode] = useState<"player" | "gm">("player");
  // 主持模式内的当前页（目前只有「怪物」）。用 string 而非字面量联合：
  // GM_NAV 与 MOBILE_NAV 共用一个 map，联合类型会让比较处处需要断言。
  const [gmPage, setGmPage] = useState("monsters");
  // 主持侧「AI」不是一个导轨项，而是顶替导轨下方那颗 AI 按钮的宿主页：
  // 为 true 时主持区渲染主持侧 AI 页，点主持组里任一页会把它关掉（回到那一页）。
  const [gmAiOpen, setGmAiOpen] = useState(false);
  const isMobile = useIsMobile();
  // 手机端强制单栏：不再提供双栏选项
  const [layoutRaw, setLayoutRaw] = useState<Layout>(() => (platform.storage.getItem("4enext-layout") !== "single" ? "double" : "single"));
  const layout: Layout = isMobile ? "single" : layoutRaw;
  // 主持模式只在桌面开放：手机端用不了（没有导轨、两块控制台也放不下），
  // 所以一旦落到手机端就退回玩家侧，避免停在一个用不了的页面上。
  // 主持侧 AI 的标记一并收掉，免得切回桌面时又冒出那一页。
  useEffect(() => {
    if (isMobile && appMode === "gm") {
      setAppMode("player");
      setGmAiOpen(false);
    }
  }, [isMobile, appMode]);
  const [mode, setMode] = useState<"edit" | "render">("edit");
  // 手机端「更多」底部面板（承载底栏放不下的入口）
  const [mobileMore, setMobileMore] = useState(false);
  // 教学模式（聚光灯分步引导）。是否该自动播放由 lib/tutorial 判定，
  // 判据在那边模块加载时就取好了快照 —— 必须早于下面 cards 的初始写入。
  const [tourOpen, setTourOpen] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  // 手机端断点由 useIsMobile 统一监听（横竖屏切换 / 窗口缩放）
  const [cards, setCards] = useState<SavedCard[]>(() => {
    const loaded = loadCards().map((card) => ({ ...card, char: migrateCharacter(card.char) }));
    if (loaded.length > 0) return loaded;
    const first: SavedCard = { id: uid(), name: "角色 1", char: defaultCharacter(), updatedAt: Date.now() };
    saveCards([first]);
    return [first];
  });
  const [activeId, setActiveId] = useState<string>(() => loadActiveId() ?? cards[0]?.id ?? "");
  const [char, setChar] = useState<Character>(() => cards.find((c) => c.id === activeId)?.char ?? defaultCharacter());
  const [cardOpen, setCardOpen] = useState(false);
  // ===== 导引模式（新手教程）=====
  // 进度绑在一张「导引专用人物卡」上（lib/guide）：卡片内容由上面的自动存档负责，
  // 这里只记 cardId + 当前步骤，因此中途去别的页面、关掉浏览器再回来都能续上。
  const [guideRun, setGuideRun] = useState<GuideRun | null>(() => loadGuideRun());
  const [guideEntryOpen, setGuideEntryOpen] = useState(false);
  const [guideEndOpen, setGuideEndOpen] = useState(false);
  // 导引那张卡还存不存在：被用户在存档里删掉时，进行中的导引一并作废
  const guideCard = guideRun ? cards.find((c) => c.id === guideRun.cardId) : undefined;
  // 当前卡下可见的步骤表（级别相关的步骤随等级增减，见 lib/guide 的 when）
  const guideSteps = useMemo(() => guideStepsFor(char), [char]);
  const guideIndex = guideStepIndex(guideSteps, guideRun?.stepId);
  const [exporting, setExporting] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  // 同步把远端数据合并进本机后，紧接着的这次 setChar 是「外部数据驱动」而不是用户编辑：
  // 用它抑制一轮自动保存，否则会把 updatedAt 顶成「刚刚改过」，让下次同步平白多推一遍。
  const skipAutoSave = useRef(false);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // 自动保存：char 变更防抖写回当前卡
  useEffect(() => {
    if (skipAutoSave.current) {
      skipAutoSave.current = false;
      return;
    }
    const t = setTimeout(() => {
      setCards((p) => {
        const next = p.map((c) => (c.id === activeId ? { ...c, char, updatedAt: Date.now() } : c));
        saveCards(next);
        return next;
      });
    }, 400);
    return () => clearTimeout(t);
  }, [char, activeId]);

  // 首次打开自动播放教学模式。延后一拍再开：首屏要把导航渲染出来，
  // 教学的高亮块才量得到位置（找不到锚点时它会退化成居中卡片，但那样就白讲了）。
  useEffect(() => {
    if (!shouldAutoStartTutorial()) return;
    const t = setTimeout(() => {
      // 这 600ms 里用户要是已经自己点去别的页面了，就别再把他拽回教学
      if (viewRef.current === "sheet") setTourOpen(true);
    }, 600);
    return () => clearTimeout(t);
  }, []);

  // 同步发生在设置页，但作用范围是整个应用：合并写回本机后要重载卡片列表，
  // 并把当前打开的那张卡换成最新内容——否则内存里的 char 还是旧的，
  // 用户接着编辑就会把刚拉下来的改动覆盖掉。
  useEffect(() => {
    function onApplied() {
      const loaded = loadCards().map((card) => ({ ...card, char: migrateCharacter(card.char) }));
      setCards(loaded);
      const keep = loaded.some((c) => c.id === activeIdRef.current) ? activeIdRef.current : loaded[0]?.id ?? "";
      setActiveId(keep);
      const active = loaded.find((c) => c.id === keep);
      if (active) {
        skipAutoSave.current = true;
        setChar(active.char);
      }
    }
    window.addEventListener(SYNC_APPLIED_EVENT, onApplied);
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, onApplied);
  }, []);

  // 立绘跟随卡片：切换/新建/删除卡片时，把该卡的立绘同步进主题显示
  useEffect(() => {
    const c = cards.find((x) => x.id === activeId);
    if (!c || !c.char.portraitOriginal) {
      clearPortrait();
      return;
    }
    void applyPortrait(c.char.portraitOriginal, c.char.portraitCropped ?? null);
    // 仅依赖 activeId：cards 变化不应反向触发（避免与下方写回 effect 形成环）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // 一次性迁移：旧版全局立绘（4enext.portraitOriginal.v1 等）迁移到当前卡片
  const portraitMigrated = useRef(false);
  useEffect(() => {
    if (portraitMigrated.current) return;
    portraitMigrated.current = true;
    try {
      const oldOrig = platform.storage.getItem("4enext.portraitOriginal.v1");
      const oldCrop = platform.storage.getItem("4enext.portraitCropped.v1");
      if (oldOrig) {
        const c = cards.find((x) => x.id === activeId);
        if (c && !c.char.portraitOriginal) {
          void applyPortrait(oldOrig, oldCrop ?? null);
        }
        platform.storage.removeItem("4enext.portraitOriginal.v1");
        platform.storage.removeItem("4enext.portraitCropped.v1");
      }
    } catch {
      /* 忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题立绘变化（上传/裁切确认）时写回当前卡片，随卡存档；首次挂载跳过
  const portraitInitialized = useRef(false);
  useEffect(() => {
    if (!portraitInitialized.current) {
      portraitInitialized.current = true;
      return;
    }
    if (!activeId) return;
    setChar((prev) => ({ ...prev, portraitOriginal, portraitCropped }));
    setCards((prev) => {
      const next = prev.map((x) => (x.id === activeId ? { ...x, char: { ...x.char, portraitOriginal, portraitCropped }, updatedAt: Date.now() } : x));
      saveCards(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portraitOriginal, portraitCropped]);

  // 把某张卡的立绘同步进主题显示（activeId 不变的路径：导入/新建人物卡/清空）
  function syncPortraitFromChar(c: Character) {
    if (c.portraitOriginal) {
      void applyPortrait(c.portraitOriginal, c.portraitCropped ?? null);
    } else {
      clearPortrait();
    }
  }

  // 教学模式：自动播放与设置页手动开启走同一条路径。
  // 无论看完、跳过还是中途退出都会记下「已看过」—— 每次打开都弹一遍比少讲一次烦人得多。
  // 结束时回到人物页，用户落地就能直接开始车卡。
  function startTutorial() {
    setView("sheet");
    setTourOpen(true);
  }

  function closeTutorial() {
    setTourOpen(false);
    markTutorialSeen();
    setView("sheet");
  }

  function toggleLayout() {
    const next: Layout = layoutRaw === "single" ? "double" : "single";
    setLayoutRaw(next);
    // 走统一写入口：存储被禁用时（无痕模式）原来这里会直接抛错，把整个点击处理打断
    safeSetItem("4enext-layout", next);
  }

  function switchCard(id: string) {
    const target = cards.find((c) => c.id === id);
    if (!target) return;
    setChar(target.char);
    setActiveId(id);
    saveActiveId(id);
    setCardOpen(false);
  }

  function newCard() {
    addCardWith(defaultCharacter());
    setCardOpen(false);
  }

  /**
   * 用给定内容新建一张人物卡并切过去（存档页「新建人物卡」与 AI 页「从零建卡」共用）。
   * AI 页会先把「目标等级的空白卡」准备好再调这里，所以切过去之后 AI 的落子就直接写进这张新卡。
   */
  function addCardWith(c: Character) {
    const card: SavedCard = { id: uid(), name: "角色 " + (cards.length + 1), char: c, updatedAt: Date.now() };
    const next = [...cards, card];
    setCards(next);
    saveCards(next);
    setChar(c);
    setActiveId(card.id);
    saveActiveId(card.id);
  }

  function deleteCard(id: string) {
    if (cards.length <= 1) return;
    const rest = cards.filter((c) => c.id !== id);
    setCards(rest);
    saveCards(rest);
    if (activeId === id) {
      const next = rest[0];
      setChar(next.char);
      setActiveId(next.id);
      saveActiveId(next.id);
    }
  }

  /**
   * 打开导引入口面板。导航栏的「导引」在**没有**进行中的导引时才开这里；
   * 设置页的入口则总是开它 —— 已经有进度时用户还需要「重新开始」这个选项。
   */
  function openGuideEntry() {
    setGuideEntryOpen(true);
  }

  /**
   * 开始（或重新开始）导引：强制新建一张空白人物卡并在其上操作。
   * 这是需求里写死的：导引绝不动用户已有的存档，全部操作都落在这张新卡上。
   * 上一轮导引如果还没被填过任何内容（连名字都没改），顺手删掉，免得反复重开时攒出一串空卡。
   */
  function startGuide() {
    const prev = guideRun ? cards.find((c) => c.id === guideRun.cardId) : undefined;
    const untouched = prev && !prev.char.raceId && !prev.char.classId && prev.char.name === "未命名角色";
    const rest = untouched ? cards.filter((c) => c.id !== prev!.id) : cards;
    const card: SavedCard = { id: uid(), name: GUIDE_CARD_NAME, char: defaultCharacter(), updatedAt: Date.now() };
    const next = [...rest, card];
    setCards(next);
    saveCards(next);
    setChar(card.char);
    setActiveId(card.id);
    saveActiveId(card.id);
    clearPortrait();
    setGuideRun({ cardId: card.id, stepId: GUIDE_STEPS[0].id, startedAt: Date.now() });
    setGuideEntryOpen(false);
    setMode("edit");
    setAppMode("player");
    setView("guide");
  }

  /**
   * 点导航栏的「导引」：有进行中的导引就直接回去继续（进度与卡片都是现成的），
   * 没有才开入口面板问用户要不要新建一张卡。
   */
  function openGuide() {
    if (guideRun && guideCard) {
      if (activeId !== guideCard.id) {
        setChar(guideCard.char);
        setActiveId(guideCard.id);
        saveActiveId(guideCard.id);
      }
      setAppMode("player");
      setView("guide");
      return;
    }
    openGuideEntry();
  }

  /** 结束这次导引：只清进度，人物卡留在存档里（用户可能还想继续编辑它） */
  function finishGuide() {
    setGuideRun(null);
    setGuideEndOpen(false);
    setMode("edit");
    setView("sheet");
  }

  // 导引进度落盘：任何一步变化都写回本机。刷新、切页面、关掉浏览器再回来都能接着走。
  useEffect(() => {
    saveGuideRun(guideRun);
  }, [guideRun]);

  // 导引那张卡被删掉（或本机数据被清）时，这次导引作废并离开导引页 ——
  // 进度指向一张不存在的卡时，导引页没有可操作的落点，留着只会让用户困惑。
  useEffect(() => {
    if (guideRun && !guideCard) {
      setGuideRun(null);
      setView((v) => (v === "guide" ? "sheet" : v));
    }
  }, [guideRun, guideCard]);

  function saveCardNow(id: string) {
    setCards((p) => {
      const next = p.map((c) => (c.id === id ? { ...c, char: id === activeId ? char : c.char, updatedAt: Date.now() } : c));
      saveCards(next);
      return next;
    });
  }

  /** 重命名某张卡（存档面板用；改名只动卡名，不动内容） */
  function renameCard(id: string, name: string) {
    setCards((p) => {
      const next = p.map((c) => (c.id === id ? { ...c, name } : c));
      saveCards(next);
      return next;
    });
  }

  // 导出存档：单文件 JSON，包含 人物/储备/速览/背景 四页内容
  function exportSave() {
    const data = {
      app: "4enext",
      format: 1,
      exportedAt: new Date().toISOString(),
      pages: {
        character: char,
        reserve: { spellbook: char.spellbook ?? [], backpack: char.backpack ?? [] },
        overview: {},
        background: char.creation ?? {},
      },
    };
    const filename = (char.name || "角色").replace(/[\\/:*?"<>|]/g, "_") + ".json";
    void platform.files.saveText(filename, JSON.stringify(data, null, 2));
  }

  // 导入存档：解析并覆盖当前卡片（校验格式）
  function importSave(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const c = data && (data.pages && data.pages.character) ? migrateCharacter(data.pages.character) : null;
        if (!c || data.app !== "4enext") throw new Error("bad");
        setChar(c);
        syncPortraitFromChar(c);
        setCards((p) => {
          const next = p.map((x) => (x.id === activeId ? { ...x, char: c, name: c.name || x.name, updatedAt: Date.now() } : x));
          saveCards(next);
          return next;
        });
      } catch {
        window.alert("导入失败：文件格式不正确（请使用本应用的导出文件）。");
      }
    };
    reader.readAsText(file);
  }

  // 导出角色卡：捕获可见角色卡（临时切到渲染模式以获得干净卡片），输出 PNG / JPG / PDF。
  // format 由调用方（存档面板）给出，exporting 仍由 App 持有 —— 导出期间要 forceAllPanels 铺开全部板块。
  async function doExport(format: ExportFormat) {
    const node = captureRef.current;
    if (!node) return;
    const prevMode = mode;
    const prevLayoutRaw = layoutRaw;
    const forceSingle = format === "pdf";
    setMode("render");
    // PDF 分页需要单栏布局，便于按面板不跨页排版
    if (forceSingle) setLayoutRaw("single");
    setExporting(true);
    try {
      // 等待渲染模式 / 单栏布局重渲染完成
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await new Promise((r) => setTimeout(r, 250));
      // 图片格式：左右两侧留白（PDF 由 A4 页边距提供留白）
      if (!forceSingle) node.style.padding = "0 48px";
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const base = (char.name || "角色").replace(/[\\/:*?"<>|]/g, "_");
      const bg = getComputedStyle(document.body).backgroundColor;
      await exportCharacterCard(node, format, base, bg);
    } catch (e) {
      console.error(e);
      window.alert("导出失败，请重试。");
    } finally {
      node.style.padding = "";
      if (forceSingle) setLayoutRaw(prevLayoutRaw);
      setMode(prevMode);
      setExporting(false);
    }
  }

  /** 存档面板的「导出」：若当前不在人物页（例如正停在导引里），先切过去等它挂载完再导出 */
  async function exportCardImage(format: ExportFormat) {
    if (viewRef.current !== "sheet") {
      setView("sheet");
      await new Promise((r) => setTimeout(r, 500));
    }
    await doExport(format);
  }

  /** 组 2 里的玩家页面入口：主持模式下点开会先切回玩家模式，否则页面会被主持页挡着看不见 */
  function openPlayerPage(v: View) {
    setAppMode("player");
    setView(v);
  }

  /**
   * 导轨上那颗 AI 按钮：同一个按钮，两种模式各指向自己那一页。
   *   · 玩家模式 → AI 车卡（车卡器的 AI）
   *   · 主持模式 → 主持侧 AI（只接出顶栏的连接配置与输入），不再把人踢回玩家页
   * 主持组里因此不需要再摆一个 AI 入口 —— 那样同一个功能会有两个按钮。
   */
  function openAiPage() {
    if (appMode === "gm") {
      setGmAiOpen(true);
      return;
    }
    openPlayerPage("ai");
  }

  /** AI 按钮的选中态：两种模式各认自己那一页 */
  const aiActive = appMode === "gm" ? gmAiOpen : view === "ai";

  /** 玩家侧页面的选中态：主持模式下组 2 的按钮不该显示为选中 */
  const isActive = (v: View): boolean => appMode === "player" && view === v;

  const bgStyle = bgImage
    ? {
        backgroundImage: "url(" + bgImage + ")",
        filter: "blur(" + bgBlur + "px) saturate(1.05)",
        WebkitMaskImage: featherMask(bgFeather),
        maskImage: featherMask(bgFeather),
      }
    : undefined;

  return (
    <div className="app">
      {bgImage && <div className="bg-layer" style={bgStyle} />}
      <nav className="side-bar">
        <div className="app-brand">
          <div className="app-logo" title="4E NEXT"><Logo /></div>
          <div className="rail-version">v{__APP_VERSION__}</div>
        </div>
        {/* 只有这一块滚动：品牌区留在 .rail-scroll 外面，所以不会被卷走 */}
        <div className="rail-scroll">
        <div className="side-sep" />
        {/* 组 1：四个主功能 —— 随「玩家 / 主持」整组切换 */}
        {appMode === "player"
          ? PLAYER_PRIMARY.map((d) => (
              <button key={d.view} type="button" className={isActive(d.view) ? "side-btn active" : "side-btn"} data-tour={"nav-" + d.view} title={d.label} onClick={() => setView(d.view)}><span className="material-symbols-outlined">{d.icon}</span><span className="sb-label">{d.label}</span></button>
            ))
          : GM_NAV.map((d) => (
              <button key={d.view} type="button" className={gmPage === d.view && !gmAiOpen ? "side-btn active" : "side-btn"} data-tour={"nav-" + d.view} title={d.label} onClick={() => { setGmAiOpen(false); setGmPage(d.view); }}><span className="material-symbols-outlined">{d.icon}</span><span className="sb-label">{d.label}</span></button>
            ))}
        <div className="side-sep" />
        <button type="button" className="side-btn" data-tour="nav-save" title="存档" onClick={() => setCardOpen(true)}><span className="material-symbols-outlined">folder</span><span className="sb-label">存档</span></button>
        <button type="button" className={isActive("homebrew") ? "side-btn active" : "side-btn"} data-tour="nav-homebrew" title="私设" onClick={() => openPlayerPage("homebrew")}><span className="material-symbols-outlined">extension</span><span className="sb-label">私设</span></button>
        {/* 导引是**玩家模式独占**的新手教程：主持模式面向的是已经会车卡的人，
            这里整颗按钮收起来，省得主持侧也冒出一个用不上的入口。
            有进行中的导引时按钮上点一个小圆点（.sb-run-dot），提示「还没走完」。 */}
        {appMode === "player" && (
          <button type="button" className={"side-btn" + (view === "guide" ? " active" : "")} data-tour="nav-guide" title="导引：车卡流程的新手教程" onClick={openGuide}>
            <span className="material-symbols-outlined">route</span>
            <span className="sb-label">导引</span>
            {guideRun && guideCard ? <span className="sb-run-dot" aria-hidden="true" /> : null}
          </button>
        )}
        <button type="button" className={isActive("search") ? "side-btn active" : "side-btn"} data-tour="nav-search" title="词条" onClick={() => openPlayerPage("search")}><span className="material-symbols-outlined">search</span><span className="sb-label">词条</span></button>
        <button type="button" className={isActive("learn") ? "side-btn active" : "side-btn"} data-tour="nav-learn" title="规则" onClick={() => openPlayerPage("learn")}><span className="material-symbols-outlined">school</span><span className="sb-label">规则</span></button>
        <button type="button" className={aiActive ? "side-btn active" : "side-btn"} data-tour="nav-ai" title={appMode === "gm" ? "AI（主持）" : "AI 车卡"} onClick={openAiPage}><span className="material-symbols-outlined">auto_awesome</span><span className="sb-label">AI</span></button>
        <button type="button" className={isActive("settings") ? "side-btn active" : "side-btn"} data-tour="nav-settings" title="设置" onClick={() => openPlayerPage("settings")}><span className="material-symbols-outlined">settings</span><span className="sb-label">设置</span></button>
        <div className="rail-spacer" />
        <div className="side-sep" />
        {/* 主持 / 玩家 切换：与下面的编辑 / 渲染同级，所以放在它上面。
            标签显示「当前模式」（与编辑 / 渲染同一约定），主持模式下整颗高亮。 */}
        <button type="button" className={"side-btn side-btn-gm" + (appMode === "gm" ? " active" : "")} data-tour="rail-gm" title={appMode === "gm" ? "当前：主持模式，点击切回玩家模式" : "当前：玩家模式，点击切换到主持模式"} aria-pressed={appMode === "gm"} onClick={() => setAppMode((m) => { if (m === "gm") setGmAiOpen(false); return m === "gm" ? "player" : "gm"; })}><span className="material-symbols-outlined">{appMode === "gm" ? "castle" : "person"}</span><span className="sb-label">{appMode === "gm" ? "主持" : "玩家"}</span></button>
        {/* 编辑 / 渲染只作用于人物卡，主持模式下收起 */}
        {appMode === "player" && (
        <button type="button" className="side-btn" data-tour="rail-mode" title={mode === "edit" ? "切换到渲染模式" : "切换到编辑模式"} onClick={() => setMode((m) => (m === "edit" ? "render" : "edit"))}><span className="material-symbols-outlined">{mode === "edit" ? "edit" : "lock"}</span><span className="sb-label">{mode === "edit" ? "编辑" : "渲染"}</span></button>
        )}
        {/* 单栏 / 双栏两种模式都保留：主持页的怪物数据块网格同样按它排 */}
        <button type="button" className={"side-btn side-btn-layout" + (isMobile ? " hidden-mobile" : "")} data-tour="layout-toggle" title={layout === "single" ? "切换到双栏布局" : "切换到单栏布局"} onClick={toggleLayout} disabled={isMobile}><span className="material-symbols-outlined">{layout === "single" ? "view_module" : "view_agenda"}</span><span className="sb-label">{layout === "single" ? "双栏" : "单栏"}</span></button>
        </div>
      </nav>
      <main className="content">
        {appMode === "gm" ? (
          <div className="view-anim" key={gmAiOpen ? "gm-ai" : "gm-" + gmPage}>
            {gmAiOpen ? (
              <GmAiView />
            ) : (
              <>
                {gmPage === "monsters" && <GmView layout={layout} />}
                {gmPage === "story" && <StoryView />}
                {/* 审阅：把存档里的卡摊开来看（只读）。cards 直接吃 App 这一份，
                    所以玩家侧刚改完的卡切过来就是最新的 */}
                {gmPage === "review" && (
                  <ReviewView
                    cards={cards}
                    activeId={activeId}
                    onOpenCard={(id) => {
                      // 与存档弹窗的「切换到这张卡」同一套（切 id、存 id、同步立绘），
                      // 再切回玩家模式落到人物页 —— 审阅是只读的，改卡要回那边去改
                      switchCard(id);
                      setAppMode("player");
                      setView("sheet");
                    }}
                  />
                )}
              </>
            )}
          </div>
        ) : (
        <div className="view-anim" key={view}>
          {view === "sheet" && (
            <div ref={captureRef}>
              <CharacterSheet layout={layout} mode={mode} char={char} setChar={setChar} mobile={isMobile} forceAllPanels={exporting} />
            </div>
          )}
          {view === "reserve" && <ReserveView layout={layout} char={char} setChar={setChar} />}
          {view === "background" && <BackgroundView mode={mode} char={char} setChar={setChar} />}
          {view === "guide" && guideRun && guideCard && (
            <GuideView
              char={char}
              setChar={setChar}
              steps={guideSteps}
              index={guideIndex}
              onIndex={(i) => setGuideRun((r) => (r ? { ...r, stepId: guideSteps[i]?.id ?? r.stepId } : r))}
              onExit={() => setView("sheet")}
              onFinish={finishGuide}
              onRestart={startGuide}
              onOpenSave={() => setCardOpen(true)}
              // 存档步骤就地渲染的正是这个面板：与「存档」弹窗共用同一个组件与同一份数据
              save={{
                cards,
                activeId,
                onSwitch: switchCard,
                onSaveCard: saveCardNow,
                onRename: renameCard,
                onDelete: deleteCard,
                onNewCard: newCard,
                onImportFile: importSave,
                onExportImage: exportCardImage,
                onExportJson: exportSave,
              }}
              isMobile={isMobile}
            />
          )}
          {view === "overview" && <OverviewView layout={layout} char={char} setChar={setChar} />}
          {view === "search" && <SearchView />}
          {view === "learn" && <LearnView layout={layout} />}
          {view === "ai" && (
            <AiView layout={layout} char={char} setChar={setChar} onNewCard={addCardWith} />
          )}
          {view === "homebrew" && <HomebrewView layout={layout} />}
          {view === "settings" && <SettingsView layout={layout} onStartTutorial={startTutorial} onStartGuide={openGuideEntry} />}
        </div>
        )}
      </main>
      {/* 手机端底部导航（MD3 NavigationBar）：取代桌面端的左侧导航轨，落在拇指可达区 */}
      {isMobile && (
        <nav className="mob-nav" aria-label="主导航">
          {/* 与桌面导轨同一套逻辑：四个主功能随「玩家 / 主持」整组切换 */}
          {(appMode === "gm" ? GM_NAV : MOBILE_NAV).map((d) => {
            const on = appMode === "gm" ? gmPage === d.view : view === d.view;
            return (
              <button
                key={d.view}
                type="button"
                data-tour={"mob-" + d.view}
                className={"mob-nav-item" + (on ? " on" : "")}
                aria-current={on ? "page" : undefined}
                onClick={() => (appMode === "gm" ? (setGmAiOpen(false), setGmPage(d.view)) : setView(d.view as View))}
              >
                <span className="mob-nav-ind"><span className="material-symbols-outlined">{d.icon}</span></span>
                <span className="mob-nav-label">{d.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            data-tour="mob-more"
              className={"mob-nav-item" + (MOBILE_MORE_VIEWS.includes(view) && !gmAiOpen ? " on" : "")}
            aria-current={MOBILE_MORE_VIEWS.includes(view) && !gmAiOpen ? "page" : undefined}
            onClick={() => setMobileMore(true)}
          >
            <span className="mob-nav-ind"><span className="material-symbols-outlined">more_horiz</span></span>
            <span className="mob-nav-label">更多</span>
          </button>
        </nav>
      )}
      {/* 「更多」底部面板：底栏放不下的入口，以及从左侧导轨搬来的「编辑 / 渲染」切换 */}
      {mobileMore && (
        <SheetDialog open headline="更多" onClose={() => setMobileMore(false)}>
          <div className="mob-more">
            {/* 主持模式只在桌面开放，所以手机端的「更多」里连切换入口都不给；
                剩下的这一行是编辑 / 渲染（只作用于人物卡） */}
            {!isMobile && (
              <div className="mob-more-row">
                <span className="mob-more-row-label">玩家 / 主持</span>
                <div className="md3-seg" role="radiogroup" aria-label="玩家或主持模式">
                  <button type="button" role="radio" aria-checked={appMode === "player"} className={"md3-seg-btn" + (appMode === "player" ? " on" : "")} onClick={() => setAppMode("player")}>玩家</button>
                  <button type="button" role="radio" aria-checked={appMode === "gm"} className={"md3-seg-btn" + (appMode === "gm" ? " on" : "")} onClick={() => setAppMode("gm")}>主持</button>
                </div>
              </div>
            )}
            {appMode === "player" && (
            <div className="mob-more-row">
              <span className="mob-more-row-label">编辑 / 渲染</span>
              <div className="md3-seg" role="radiogroup" aria-label="编辑或渲染模式">
                <button type="button" role="radio" aria-checked={mode === "edit"} className={"md3-seg-btn" + (mode === "edit" ? " on" : "")} onClick={() => setMode("edit")}>编辑</button>
                <button type="button" role="radio" aria-checked={mode === "render"} className={"md3-seg-btn" + (mode === "render" ? " on" : "")} onClick={() => setMode("render")}>渲染</button>
              </div>
            </div>
            )}
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); setCardOpen(true); }}>
              <span className="material-symbols-outlined mob-more-ic">folder</span>
              <span className="mob-more-text"><span className="mob-more-label">存档</span><span className="mob-more-sub">切换、重命名、导入导出人物卡</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
            {/* 导引与其它玩家功能一样只在玩家模式出现（主持模式面向已会车卡的人） */}
            {appMode === "player" && (
              <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); openGuide(); }}>
                <span className="material-symbols-outlined mob-more-ic">route</span>
                <span className="mob-more-text"><span className="mob-more-label">导引</span><span className="mob-more-sub">新手教程：一步步带你车卡</span></span>
                <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
              </button>
            )}
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); openPlayerPage("homebrew"); }}>
              <span className="material-symbols-outlined mob-more-ic">extension</span>
              <span className="mob-more-text"><span className="mob-more-label">私设</span><span className="mob-more-sub">自定义资源包</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); openPlayerPage("search"); }}>
              <span className="material-symbols-outlined mob-more-ic">search</span>
              <span className="mob-more-text"><span className="mob-more-label">词条</span><span className="mob-more-sub">按名称检索规则词条</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); openPlayerPage("learn"); }}>
              <span className="material-symbols-outlined mob-more-ic">school</span>
              <span className="mob-more-text"><span className="mob-more-label">规则</span><span className="mob-more-sub">万律速查</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); openAiPage(); }}>
              <span className="material-symbols-outlined mob-more-ic">auto_awesome</span>
              <span className="mob-more-text"><span className="mob-more-label">AI</span><span className="mob-more-sub">用自己的接口帮你选</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); openPlayerPage("settings"); }}>
              <span className="material-symbols-outlined mob-more-ic">settings</span>
              <span className="mob-more-text"><span className="mob-more-label">设置</span><span className="mob-more-sub">主题、字体与自定义人物板块</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
          </div>
        </SheetDialog>
      )}
      {cardOpen && (
        <SheetDialog xwide extraClass="sheet-dialog-save" open headline="存档" onClose={() => setCardOpen(false)}>
          {/* 存档面板抽成了独立组件：导引模式的「存档」步骤要把同一份面板就地嵌进导引页 */}
          <SavePanel
            cards={cards}
            activeId={activeId}
            onSwitch={switchCard}
            onSaveCard={saveCardNow}
            onRename={renameCard}
            onDelete={deleteCard}
            onNewCard={newCard}
            onImportFile={importSave}
            onExportImage={exportCardImage}
            onExportJson={exportSave}
          />
        </SheetDialog>
      )}
      {/* 导引入口：抽卡重构后的「导引」是一次完整的新手教程，只能由用户主动进入，
          并且**强制新建一张空白人物卡**（导引全程在这张卡上操作，不碰已有存档）。
          有进行中的导引时（从设置页进来）额外给出「继续」这一条路。 */}
      {guideEntryOpen && (
        <SheetDialog open headline="导引" onClose={() => setGuideEntryOpen(false)} actions={<TextButton onClick={() => setGuideEntryOpen(false)}>取消</TextButton>}>
          <p className="hint">
            导引模式是一个分布式车卡教学。导引必须在一张新建的空白人物卡上进行。
          </p>
          <div className="preset-list">
            {guideRun && guideCard && (
              <button type="button" className="card-row draw-opt" onClick={() => { setGuideEntryOpen(false); openGuide(); }}>
                <span className="preset-name">继续上次导引</span>
                <span className="preset-label">
                  第 {guideIndex + 1} / {guideSteps.length} 步 · {guideSteps[guideIndex]?.title ?? ""}
                </span>
              </button>
            )}
            <button type="button" className="card-row draw-opt" onClick={startGuide}>
              <span className="preset-name">{guideRun ? "重新开始导引（新建一张人物卡）" : "开始导引（新建一张人物卡）"}</span>
              <span className="preset-label">自动新建一个空白人物卡并在其上操作</span>
            </button>
          </div>
        </SheetDialog>
      )}
      {/* 结束导引：只结束教程，人物卡保留在存档里 */}
      {guideEndOpen && (
        <SheetDialog
          open
          headline="结束这次导引"
          onClose={() => setGuideEndOpen(false)}
          actions={
            <>
              <TextButton onClick={() => setGuideEndOpen(false)}>继续导引</TextButton>
              <FilledButton onClick={finishGuide}>结束导引</FilledButton>
            </>
          }
        >
          <p className="hint">
            这将彻底结束导引模式，已经完成的与填写的内容不会删除，导引人物会留存于存档。
          </p>
        </SheetDialog>
      )}
      {/* 存储写满 / 被禁用时提示「没有保存成功」，并给出止损动作 */}
      <StorageAlert onBackup={exportSave} onInspect={() => setView("homebrew")} />
      {/* 导引悬浮条：离开导引页（去背景/速览/存档……）之后依然「随时展示当前进度」，
          并一键跳回导引。主持模式是另一套工作流，那里不跟（导引本身就是玩家模式独占功能）。 */}
      {appMode === "player" && guideRun && guideCard && view !== "guide" && (
        <GuideFloatingBar
          steps={guideSteps}
          index={guideIndex}
          onOpen={() => setView("guide")}
          onEnd={() => setGuideEndOpen(true)}
        />
      )}
      {/* 教学模式：首次打开自动播放，之后由设置页手动开启 */}
      <TutorialGuide open={tourOpen} onClose={closeTutorial} onGoToView={setView} isMobile={isMobile} />
    </div>
  );
}

export default function App() {
  return <ThemeProvider><Shell /></ThemeProvider>;
}