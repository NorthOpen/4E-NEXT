import { platform } from "@platform";
import { useEffect, useRef, useState } from "react";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import CharacterSheet from "./sheet/CharacterSheet";
import { exportCharacterCard, type ExportFormat } from "./lib/exportImage";
import SearchView from "./SearchView";
import SettingsView from "./SettingsView";
import LearnView from "./LearnView";
import ReserveView from "./ReserveView";
import OverviewView from "./OverviewView";
import BackgroundView from "./BackgroundView";
import DrawView from "./DrawView";
import HomebrewView from "./HomebrewView";
import { loadCards, saveCards, loadActiveId, saveActiveId, safeSetItem, uid, type SavedCard } from "./lib/storage";
import { defaultCharacter, migrateCharacter, type Character } from "./sheet/character";
import { SYNC_APPLIED_EVENT } from "./lib/sync";
import { FilledButton, OutlinedButton, TextButton } from "./components/md";
import SheetDialog from "./components/SheetDialog";
import StorageAlert from "./components/StorageAlert";
import Logo from "./components/Logo";
import TutorialGuide from "./components/TutorialGuide";
import { markTutorialSeen, shouldAutoStartTutorial } from "./lib/tutorial";
import { useIsMobile } from "./lib/media";

// 导出给 lib/tutorial —— 教学步骤要指明「这一步切到哪个页面」。
// type 导入在编译期被抹掉，不会和 App 形成运行时循环依赖。
export type View = "sheet" | "background" | "reserve" | "overview" | "draw" | "search" | "learn" | "homebrew" | "settings";
type Layout = "single" | "double";

// 手机端底部导航（MD3 NavigationBar）：只放建卡/跑团最常用的 4 个顶级目标。
// MD3 规定 NavigationBar 容纳 3–5 项，其余入口（存档 / 抽卡 / 私设 / 词条 / 规则 / 设置）
// 收进「更多」底部面板，避免把底栏塞成密集图标条。
const MOBILE_NAV: { view: View; icon: string; label: string }[] = [
  { view: "sheet", icon: "person", label: "人物" },
  { view: "overview", icon: "overview", label: "速览" },
  { view: "background", icon: "book", label: "背景" },
  { view: "reserve", icon: "inventory_2", label: "储备" },
];

/** 这些页面由「更多」面板承载：命中时把底栏的「更多」标为选中，用户才知道自己在哪 */
const MOBILE_MORE_VIEWS: View[] = ["search", "learn", "homebrew", "settings"];

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
  const isMobile = useIsMobile();
  // 手机端强制单栏：不再提供双栏选项
  const [layoutRaw, setLayoutRaw] = useState<Layout>(() => (platform.storage.getItem("4enext-layout") !== "single" ? "double" : "single"));
  const layout: Layout = isMobile ? "single" : layoutRaw;
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
  const [drawOpen, setDrawOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [exporting, setExporting] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

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

  // 把某张卡的立绘同步进主题显示（activeId 不变的路径：导入/抽卡/清空重抽）
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
    const card: SavedCard = { id: uid(), name: "角色 " + (cards.length + 1), char: defaultCharacter(), updatedAt: Date.now() };
    const next = [...cards, card];
    setCards(next);
    saveCards(next);
    setChar(card.char);
    setActiveId(card.id);
    saveActiveId(card.id);
    setCardOpen(false);
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
    if (renamingId === id) setRenamingId(null);
  }

  // 进入抽卡模式：清空当前存档（保留卡名）
  function enterDrawCleared() {
    setChar(defaultCharacter());
    clearPortrait();
    setCards((p) => {
      const next = p.map((c) => (c.id === activeId ? { ...c, char: defaultCharacter(), updatedAt: Date.now() } : c));
      saveCards(next);
      return next;
    });
    setDrawOpen(false);
    setView("draw");
  }
  // 抽卡完成：写入当前卡并存档，返回人物页
  function finishDraw(c: Character) {
    setCards((p) => {
      const next = p.map((x) => (x.id === activeId ? { ...x, char: c, name: c.name || x.name, updatedAt: Date.now() } : x));
      saveCards(next);
      return next;
    });
    clearPortrait();
    setView("sheet");
  }

  function saveCardNow(id: string) {
    setCards((p) => {
      const next = p.map((c) => (c.id === id ? { ...c, char: id === activeId ? char : c.char, updatedAt: Date.now() } : c));
      saveCards(next);
      return next;
    });
  }

  function confirmRename() {
    const name = renameText.trim();
    if (renamingId && name) {
      setCards((p) => {
        const next = p.map((c) => (c.id === renamingId ? { ...c, name } : c));
        saveCards(next);
        return next;
      });
    }
    setRenamingId(null);
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

  // 导出角色卡：捕获可见角色卡（临时切到渲染模式以获得干净卡片），输出 PNG / JPG / PDF
  async function doExport() {
    const node = captureRef.current;
    if (!node) return;
    const prevMode = mode;
    const prevLayoutRaw = layoutRaw;
    const forceSingle = exportFormat === "pdf";
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
      await exportCharacterCard(node, exportFormat, base, bg);
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

  function runExport() {
    // 若当前不在人物页，先切到人物页等待挂载后再导出
    if (view !== "sheet") {
      setView("sheet");
      setTimeout(() => {
        void doExport();
      }, 500);
    } else {
      void doExport();
    }
  }

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
          <div className="rail-version">v{__APP_VERSION__}B</div>
        </div>
        <div className="side-sep" />
        <button type="button" className={view === "sheet" ? "side-btn active" : "side-btn"} data-tour="nav-sheet" title="人物" onClick={() => setView("sheet")}><span className="material-symbols-outlined">person</span><span className="sb-label">人物</span></button>
        <button type="button" className={view === "background" ? "side-btn active" : "side-btn"} data-tour="nav-background" title="背景" onClick={() => setView("background")}><span className="material-symbols-outlined">book</span><span className="sb-label">背景</span></button>
        <button type="button" className={view === "reserve" ? "side-btn active" : "side-btn"} data-tour="nav-reserve" title="储备" onClick={() => setView("reserve")}><span className="material-symbols-outlined">inventory_2</span><span className="sb-label">储备</span></button>
        <button type="button" className={view === "overview" ? "side-btn active" : "side-btn"} data-tour="nav-overview" title="速览" onClick={() => setView("overview")}><span className="material-symbols-outlined">overview</span><span className="sb-label">速览</span></button>
        <div className="side-sep" />
        <button type="button" className="side-btn" data-tour="nav-save" title="存档" onClick={() => setCardOpen(true)}><span className="material-symbols-outlined">folder</span><span className="sb-label">存档</span></button>
        <button type="button" className={view === "homebrew" ? "side-btn active" : "side-btn"} data-tour="nav-homebrew" title="私设" onClick={() => setView("homebrew")}><span className="material-symbols-outlined">extension</span><span className="sb-label">私设</span></button>
        <button type="button" className={"side-btn" + (view === "draw" ? " active" : "")} data-tour="nav-draw" title="抽卡" onClick={() => setDrawOpen(true)}><span className="material-symbols-outlined">casino</span><span className="sb-label">抽卡</span></button>
        <button type="button" className={view === "search" ? "side-btn active" : "side-btn"} data-tour="nav-search" title="词条" onClick={() => setView("search")}><span className="material-symbols-outlined">search</span><span className="sb-label">词条</span></button>
        <button type="button" className={view === "learn" ? "side-btn active" : "side-btn"} data-tour="nav-learn" title="规则" onClick={() => setView("learn")}><span className="material-symbols-outlined">school</span><span className="sb-label">规则</span></button>
        <button type="button" className={view === "settings" ? "side-btn active" : "side-btn"} data-tour="nav-settings" title="设置" onClick={() => setView("settings")}><span className="material-symbols-outlined">settings</span><span className="sb-label">设置</span></button>
        <div className="rail-spacer" />
        <div className="side-sep" />
        <button type="button" className="side-btn" data-tour="rail-mode" title={mode === "edit" ? "切换到渲染模式" : "切换到编辑模式"} onClick={() => setMode((m) => (m === "edit" ? "render" : "edit"))}><span className="material-symbols-outlined">{mode === "edit" ? "edit" : "lock"}</span><span className="sb-label">{mode === "edit" ? "编辑" : "渲染"}</span></button>
        <button type="button" className={"side-btn side-btn-layout" + (isMobile ? " hidden-mobile" : "")} data-tour="layout-toggle" title={layout === "single" ? "切换到双栏布局" : "切换到单栏布局"} onClick={toggleLayout} disabled={isMobile}><span className="material-symbols-outlined">{layout === "single" ? "view_module" : "view_agenda"}</span><span className="sb-label">{layout === "single" ? "双栏" : "单栏"}</span></button>
      </nav>
      <main className="content">
        <div className="view-anim" key={view}>
          {view === "sheet" && (
            <div ref={captureRef}>
              <CharacterSheet layout={layout} mode={mode} char={char} setChar={setChar} mobile={isMobile} forceAllPanels={exporting} />
            </div>
          )}
          {view === "reserve" && <ReserveView layout={layout} char={char} setChar={setChar} />}
          {view === "background" && <BackgroundView mode={mode} char={char} setChar={setChar} />}
          {view === "draw" && <DrawView char={char} setChar={setChar} onExit={() => setView("sheet")} onFinish={finishDraw} />}
          {view === "overview" && <OverviewView layout={layout} char={char} setChar={setChar} />}
          {view === "search" && <SearchView />}
          {view === "learn" && <LearnView layout={layout} />}
          {view === "homebrew" && <HomebrewView layout={layout} />}
          {view === "settings" && <SettingsView layout={layout} onStartTutorial={startTutorial} />}
        </div>
      </main>
      {/* 手机端底部导航（MD3 NavigationBar）：取代桌面端的左侧导航轨，落在拇指可达区 */}
      {isMobile && (
        <nav className="mob-nav" aria-label="主导航">
          {MOBILE_NAV.map((d) => (
            <button
              key={d.view}
              type="button"
              data-tour={"mob-" + d.view}
              className={"mob-nav-item" + (view === d.view ? " on" : "")}
              aria-current={view === d.view ? "page" : undefined}
              onClick={() => setView(d.view)}
            >
              <span className="mob-nav-ind"><span className="material-symbols-outlined">{d.icon}</span></span>
              <span className="mob-nav-label">{d.label}</span>
            </button>
          ))}
          <button
            type="button"
            data-tour="mob-more"
            className={"mob-nav-item" + (MOBILE_MORE_VIEWS.includes(view) ? " on" : "")}
            aria-current={MOBILE_MORE_VIEWS.includes(view) ? "page" : undefined}
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
            <div className="mob-more-row">
              <span className="mob-more-row-label">编辑 / 渲染</span>
              <div className="md3-seg" role="radiogroup" aria-label="编辑或渲染模式">
                <button type="button" role="radio" aria-checked={mode === "edit"} className={"md3-seg-btn" + (mode === "edit" ? " on" : "")} onClick={() => setMode("edit")}>编辑</button>
                <button type="button" role="radio" aria-checked={mode === "render"} className={"md3-seg-btn" + (mode === "render" ? " on" : "")} onClick={() => setMode("render")}>渲染</button>
              </div>
            </div>
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); setCardOpen(true); }}>
              <span className="material-symbols-outlined mob-more-ic">folder</span>
              <span className="mob-more-text"><span className="mob-more-label">存档</span><span className="mob-more-sub">切换、重命名、导入导出人物卡</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); setDrawOpen(true); }}>
              <span className="material-symbols-outlined mob-more-ic">casino</span>
              <span className="mob-more-text"><span className="mob-more-label">抽卡</span><span className="mob-more-sub">随机快速建卡</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); setView("homebrew"); }}>
              <span className="material-symbols-outlined mob-more-ic">extension</span>
              <span className="mob-more-text"><span className="mob-more-label">私设</span><span className="mob-more-sub">自定义资源包</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); setView("search"); }}>
              <span className="material-symbols-outlined mob-more-ic">search</span>
              <span className="mob-more-text"><span className="mob-more-label">词条</span><span className="mob-more-sub">按名称检索规则词条</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); setView("learn"); }}>
              <span className="material-symbols-outlined mob-more-ic">school</span>
              <span className="mob-more-text"><span className="mob-more-label">规则</span><span className="mob-more-sub">万律速查</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
            <button type="button" className="mob-more-item" onClick={() => { setMobileMore(false); setView("settings"); }}>
              <span className="material-symbols-outlined mob-more-ic">settings</span>
              <span className="mob-more-text"><span className="mob-more-label">设置</span><span className="mob-more-sub">主题、字体与自定义页面板块</span></span>
              <span className="material-symbols-outlined mob-more-arrow">chevron_right</span>
            </button>
          </div>
        </SheetDialog>
      )}
      {cardOpen && (
        <SheetDialog xwide extraClass="sheet-dialog-save" open headline="存档" onClose={() => setCardOpen(false)} actions={
          <>
            <input ref={importRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importSave(f); e.target.value = ""; }} />
            <TextButton onClick={() => importRef.current?.click()}>导入存档</TextButton>
            <TextButton onClick={newCard}>＋ 新建人物卡</TextButton>
          </>
        }>
          <div className="dialog-save-layout">
            <div className="dialog-save-list">
              <div className="preset-list">
                {cards.map((c) => (
                  <div key={c.id} className={c.id === activeId ? "card-row active" : "card-row"}>
                    <div className="card-row-main">
                      {renamingId === c.id ? (
                        <input className="card-rename-input" value={renameText} autoFocus onChange={(e) => setRenameText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); } }} onBlur={() => setRenamingId(null)} />
                      ) : (
                        <button type="button" className="card-row-name" onClick={() => switchCard(c.id)} title="切换到这张卡">
                          <span className="preset-name">{c.name}{c.id === activeId ? "（当前）" : ""}</span>
                          <span className="preset-label">Lv{c.char.level} · {new Date(c.updatedAt).toLocaleString("zh-CN")}</span>
                        </button>
                      )}
                    </div>
                    <div className="card-row-btns">
                      <button type="button" className="crop-btn" onClick={() => saveCardNow(c.id)}>保存</button>
                      <button type="button" className="crop-btn" onClick={() => { setRenamingId(c.id); setRenameText(c.name); }}>重命名</button>
                      {cards.length > 1 && <button type="button" className="crop-btn crop-danger" onClick={() => deleteCard(c.id)}>删除</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="dialog-save-export">
              <div className="dialog-save-export-title">导出</div>
              <p className="dialog-save-export-sub">将当前人物卡导出为图片或 JSON 备份文件。</p>

              <div className="export-groups">
                <div className="export-group">
                  <span className="export-group-label">图片渲染</span>
                  <p className="hint">
                    {exportFormat === "pdf"
                      ? "以渲染模式生成当前人物卡，并按 A4 纸张分页输出为 PDF 文件。"
                      : exportFormat === "jpg"
                        ? "以渲染模式生成当前人物卡，输出为 JPG 图片（有损压缩，文件较小）。"
                        : "以渲染模式生成当前人物卡，输出为 PNG 图片（无损，文件较大）。"}
                  </p>
                  <div className="export-format-row">
                    {([["png", "PNG"], ["jpg", "JPG"], ["pdf", "PDF"]] as const).map(([f, label]) => (
                      <button key={f} type="button" className={"export-format-btn" + (exportFormat === f ? " active" : "")} onClick={() => setExportFormat(f)}>{label}</button>
                    ))}
                  </div>
                  <FilledButton disabled={exporting} onClick={runExport}>{exporting ? "导出中…" : "导出"}</FilledButton>
                </div>

                <div className="export-group">
                  <span className="export-group-label">存档备份</span>
                  <p className="hint">导出为 JSON 文件，可随时重新导入。</p>
                  <OutlinedButton onClick={exportSave}>导出存档</OutlinedButton>
                </div>
              </div>
            </div>
          </div>

        </SheetDialog>
      )}
      {drawOpen && (
        <SheetDialog open headline="抽卡" onClose={() => setDrawOpen(false)} actions={<TextButton onClick={() => setDrawOpen(false)}>取消</TextButton>}>
          <p className="hint">抽卡是一种趣味性的、适合新手的人物卡快速创建方式。注意：进入抽卡后，当前人物卡存档内的全部内容将被清空。请选择：</p>
          <div className="preset-list">
            <button type="button" className="card-row draw-opt" onClick={enterDrawCleared}>
              <span className="preset-name">确定，清空当前存档并进入抽卡</span>
              <span className="preset-label">覆盖当前人物卡的全部内容</span>
            </button>
            <button type="button" className="card-row draw-opt" onClick={() => { newCard(); setDrawOpen(false); setView("draw"); }}>
              <span className="preset-name">创建新存档并进入抽卡</span>
              <span className="preset-label">自动新建一个空白人物卡，原卡不受影响</span>
            </button>
          </div>
        </SheetDialog>
      )}
      {/* 存储写满 / 被禁用时提示「没有保存成功」，并给出止损动作 */}
      <StorageAlert onBackup={exportSave} onInspect={() => setView("homebrew")} />
      {/* 教学模式：首次打开自动播放，之后由设置页手动开启 */}
      <TutorialGuide open={tourOpen} onClose={closeTutorial} onGoToView={setView} isMobile={isMobile} />
    </div>
  );
}

export default function App() {
  return <ThemeProvider><Shell /></ThemeProvider>;
}