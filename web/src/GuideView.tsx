import { useEffect, useRef, useState } from "react";
import BackgroundView from "./BackgroundView";
import ReserveView from "./ReserveView";
import OverviewView from "./OverviewView";
import CharacterSheet from "./sheet/CharacterSheet";
import SavePanel from "./components/SavePanel";
import DrawDialog from "./sheet/DrawDialog";
import { Divider, FilledButton, FilledTonalButton, OutlinedButton, TextButton } from "./components/md";
import { panelMeta } from "./lib/sheetLayout";
import { GUIDE_CHAPTER_LABEL, guideLockedPickers, guideTaskDone, type GuideStep } from "./lib/guide";
import type { Character } from "./sheet/character";
import type { ExportFormat } from "./lib/exportImage";
import type { SavedCard } from "./lib/storage";

// 导引模式页面（新手教程的宿主）。
//
// 结构自上而下三层：
//   · .guide-head  —— 置顶的分段进度条：有多少步就有多少段，点任意一段直接跳步。
//                     吸顶（sticky）是为了「随时展示当前进度」：板块很长时滚到下面也还看得见。
//   · .guide-main  —— 左讲解 / 右舞台（手机端上下堆叠）。
//                     舞台是车卡器**真实的**界面：CharacterSheet 只渲染被拆出来的那几块板块
//                     （onlyPanels，可以一次两块，如「金钱 + 装备」）；
//                     背景 / 储备 / 速览是独立页面，导引给一个入口把用户送过去，
//                     页面上跟着悬浮导引条（App 渲染），写完点「回到导引」继续。
//   · .guide-nav   —— 上一步 / 跳过本步 / 下一步（吸附在视口底部）。
//
// 为什么舞台不另做一套简化 UI：导引里填的每个字都要直接写进人物卡，
// 复用真组件才能保证「教程里的操作」与「正常车卡」永远同源，
// 也才不会出现「教程做得挺好，回到真页面却不会用」的割裂。

interface Props {
  char: Character;
  setChar: React.Dispatch<React.SetStateAction<Character>>;
  /** 当前人物卡下可见的步骤表（由 App 统一计算，进度条与悬浮条共用同一份） */
  steps: GuideStep[];
  /** 当前步骤下标 */
  index: number;
  onIndex: (i: number) => void;
  /** 退出导引页面：进度保留，之后可以回来继续 */
  onExit: () => void;
  /** 结束这次导引：清掉进度记录（人物卡本身留着） */
  onFinish: () => void;
  /** 重新开始：新建一张空白卡，从第一步重走 */
  onRestart: () => void;
  /** 打开 App 的存档 / 导出面板 */
  onOpenSave: () => void;
  /** 存档步骤就地渲染存档面板所需的数据与动作（与 App 的「存档」弹窗共用同一个组件） */
  save: {
    cards: SavedCard[];
    activeId: string;
    onSwitch: (id: string) => void;
    onSaveCard: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onNewCard: () => void;
    onImportFile: (file: File) => void;
    onExportImage: (format: ExportFormat) => Promise<void>;
    onExportJson: () => void;
  };
  isMobile: boolean;
}

/** 舞台标题与图标：让用户始终清楚「现在看的是车卡器的哪一块」 */
function stageMeta(step: GuideStep): { icon: string; title: string } {
  if (step.stage.kind === "panel") {
    const metas = step.stage.panels.map(panelMeta);
    // 多块板块（金钱 + 装备）用「·」连起来，与讲解里说的顺序一致
    return { icon: metas[0].icon, title: metas.map((m) => m.label).join(" · ") };
  }
  if (step.stage.kind === "page") {
    if (step.stage.page === "background") return { icon: "book", title: "背景页" };
    if (step.stage.page === "reserve") return { icon: "inventory_2", title: "储备页" };
    return { icon: "overview", title: "速览页" };
  }
  if (step.stage.card === "save") return { icon: "folder", title: "存档与导出" };
  if (step.stage.card === "finish") return { icon: "check_circle", title: "完成核对" };
  return { icon: "route", title: "导引说明" };
}

/** 输入类元素正在被操作时，方向键/Esc 交给元素自己处理，导引不抢键 */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

export default function GuideView(props: Props) {
  const { char, setChar, steps, index, onIndex, onExit, onFinish, onRestart, onOpenSave, save, isMobile } = props;
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, steps.length - 1));
  const step = steps[safeIndex];
  const stageRef = useRef<HTMLDivElement>(null);
  // 抽卡弹窗开关（只在带 draw 的步骤上可能出现）
  const [drawOpen, setDrawOpen] = useState(false);

  // 换步时把抽卡弹窗收起来：弹窗是上一步的上下文，留着会让人以为它属于新的一步
  useEffect(() => {
    setDrawOpen(false);
  }, [safeIndex]);

  // 换步时回到页顶：讲解才是每一步的主内容，不这么做会停在上一块板块滚动到的位置
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    // html 上有 scroll-behavior: smooth（styles.css），不临时关掉的话
    // 紧接着的高亮定位会落在「还在滚动的路上」，看起来像没生效
    root.style.scrollBehavior = "auto";
    try {
      window.scrollTo(0, 0);
    } catch {
      /* 少数引擎的 scrollTo 只认 (x, y)：失败就只是不滚，不影响使用 */
    }
    root.style.scrollBehavior = prev;
  }, [safeIndex, step?.id]);

  // 高亮本步要点：在舞台里找 [data-guide="..."] 并圈出来。
  // 目标可能还没挂载（板块数据异步渲染 / 手机端折叠），所以逐帧重试；
  // 一直找不到就只是不圈，绝不阻断导引。
  useEffect(() => {
    const root = stageRef.current;
    if (!root || !step) return;
    const clear = () => {
      root.querySelectorAll(".guide-focus").forEach((el) => el.classList.remove("guide-focus"));
    };
    clear();
    const anchor = step.focus;
    if (!anchor) return;
    let raf = 0;
    let tries = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      let el: HTMLElement | null = null;
      try {
        el = root.querySelector<HTMLElement>('[data-guide="' + anchor + '"]');
      } catch {
        return;
      }
      if (el) {
        el.classList.add("guide-focus");
        return;
      }
      if (++tries < 60) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clear();
    };
  }, [step?.id, step?.focus]);

  // 键盘：← / → 翻步，Esc 退出导引页（输入框里打字时不抢键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === "ArrowRight" && safeIndex < steps.length - 1) {
        e.preventDefault();
        onIndex(safeIndex + 1);
      } else if (e.key === "ArrowLeft" && safeIndex > 0) {
        e.preventDefault();
        onIndex(safeIndex - 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [safeIndex, steps.length, onIndex, onExit]);

  if (!step) return null;

  const meta = stageMeta(step);
  const taskDone = guideTaskDone(step, char);
  const last = safeIndex === steps.length - 1;

  // 舞台内容：真实板块 / 真实页面（就地打开）/ 导引自带的说明卡
  let stageBody: React.ReactNode = null;
  if (step.stage.kind === "panel") {
    stageBody = (
      <CharacterSheet
        layout="single"
        // 导引里必须能动手：无论全局处于编辑还是渲染模式，都按编辑模式渲染
        mode="edit"
        char={char}
        setChar={setChar}
        mobile={isMobile}
        // 关键：把板块从车卡页里彻底拆出来，一次只留被讲的这几块（按数组顺序上下排列）
        onlyPanels={step.stage.panels}
        // 导引模式：锁住本步不涉及的「角色信息」选择栏（种族/职阶），避免新手在听到讲解前误点
        lockPickers={guideLockedPickers(step)}
      />
    );
  } else if (step.stage.kind === "page") {
    // 背景 / 储备 / 速览：就地渲染真实页面（进度条不消失，用户也不用在页面之间来回切）。
    // 讲解里会提一句「它平时挂在导航栏的哪一项上」—— 那是为了用户之后自己去得成。
    stageBody =
      step.stage.page === "background" ? (
        <BackgroundView mode="edit" char={char} setChar={setChar} />
      ) : step.stage.page === "reserve" ? (
        <ReserveView layout="single" char={char} setChar={setChar} />
      ) : (
        <OverviewView layout="single" char={char} setChar={setChar} />
      );
  } else if (step.stage.kind === "custom" && step.stage.card === "save") {
    // 存档面板同样直接纳入导引页：与 App 的「存档」弹窗是同一个组件、同一份数据。
    // 这里不再另写说明文字 —— 面板自己会说话，讲解卡里已经把要点讲完了。
    stageBody = (
      <div className="guide-card guide-card-wide">
        <SavePanel {...save} />
      </div>
    );
  } else if (step.stage.kind === "custom" && step.stage.card === "finish") {
    const summary: { label: string; value: string; ok: boolean }[] = [
      { label: "姓名", value: char.name || "（未填）", ok: char.name.trim().length > 0 && char.name !== "未命名角色" },
      { label: "等级", value: String(char.level) + " 级", ok: true },
      { label: "种族", value: char.raceId ? "已选择" : "未选择", ok: !!char.raceId },
      { label: "职业", value: char.classId ? "已选择" : "未选择", ok: !!char.classId },
      { label: "随意威能", value: char.powerSlots.atWill.filter(Boolean).length + " / 2", ok: char.powerSlots.atWill.filter(Boolean).length >= 2 },
      { label: "遭遇威能", value: char.powerSlots.encounter.filter(Boolean).length + " / 1", ok: char.powerSlots.encounter.filter(Boolean).length >= 1 },
      { label: "每日威能", value: char.powerSlots.daily.filter(Boolean).length + " / 1", ok: char.powerSlots.daily.filter(Boolean).length >= 1 },
      { label: "专长", value: char.featSlots.filter(Boolean).length + " / 1", ok: char.featSlots.filter(Boolean).length >= 1 },
    ];
    stageBody = (
      <div className="guide-card">
        <div className="guide-check-list">
          {summary.map((s) => (
            <div key={s.label} className={"guide-check" + (s.ok ? " ok" : "")}>
              <span className="material-symbols-outlined">{s.ok ? "check_circle" : "radio_button_unchecked"}</span>
              <span className="guide-check-label">{s.label}</span>
              <span className="guide-check-value">{s.value}</span>
            </div>
          ))}
        </div>
        <div className="guide-card-actions">
          <FilledButton onClick={onFinish}>完成导引，回到人物页</FilledButton>
          <OutlinedButton onClick={onRestart}>重新开始导引（新建人物卡）</OutlinedButton>
          <TextButton onClick={onOpenSave}>打开存档面板</TextButton>
        </div>
      </div>
    );
  } else {
    stageBody = (
      <div className="guide-card">
        <div className="guide-hero">
          <span className="material-symbols-outlined guide-hero-ic">route</span>
          <div>
            <div className="guide-hero-title">导引已为你新建一张空白人物卡</div>
          </div>
        </div>
        <p className="guide-card-p">规则细则请查阅《玩家手册》第二章：创建角色。</p>
        <div className="guide-card-actions">
          <FilledButton onClick={() => onIndex(safeIndex + 1)}>开始吧</FilledButton>
        </div>
      </div>
    );
  }

  return (
    <div className="guide">
      {/* 置顶分段进度条：段数 = 步数，点哪段跳哪步 */}
      <header className="guide-head">
        <div className="guide-head-row">
          <span className="guide-badge">
            <span className="material-symbols-outlined">route</span>
          </span>
          <div className="guide-head-text">
            <span className="guide-head-title">导引模式</span>
            <span className="guide-head-sub">
              第 {safeIndex + 1} / {steps.length} 步 · {GUIDE_CHAPTER_LABEL[step.chapter]} · {step.title}
            </span>
          </div>
          <TextButton onClick={onExit}>退出导引</TextButton>
        </div>
        <div
          className="guide-bar"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={safeIndex + 1}
          aria-label={"导引进度：第 " + (safeIndex + 1) + " / " + steps.length + " 步"}
        >
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={
                "guide-seg" +
                (i < safeIndex ? " done" : i === safeIndex ? " on" : "") +
                (i > 0 && steps[i - 1].chapter !== s.chapter ? " chapter-start" : "")
              }
              title={"第 " + (i + 1) + " 步 · " + s.title}
              aria-label={"跳转到第 " + (i + 1) + " 步：" + s.title}
              aria-current={i === safeIndex ? "step" : undefined}
              onClick={() => onIndex(i)}
            >
              <span className="guide-seg-fill" />
            </button>
          ))}
        </div>
      </header>

      <div className="guide-main">
        {/* 左：讲解 */}
        <section className="guide-intro" aria-labelledby="guide-step-title">
          <div className="guide-intro-head">
            <span className="guide-step-badge">{safeIndex + 1}</span>
            <div className="guide-intro-headtext">
              <h2 className="guide-intro-title" id="guide-step-title">{step.title}</h2>
              <span className="guide-intro-sub">{GUIDE_CHAPTER_LABEL[step.chapter]} · 共 {steps.length} 步</span>
            </div>
          </div>
          {step.body.map((p, i) => (
            <p key={i} className="guide-intro-p">{p}</p>
          ))}
          {step.tips && step.tips.length > 0 && (
            <ul className="guide-tips">
              {step.tips.map((t, i) => (
                <li key={i}>
                  <span className="material-symbols-outlined guide-tip-ic">lightbulb</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
          {step.task && (
            <>
              <Divider />
              <div className={"guide-task" + (taskDone === true ? " ok" : "")}>
                <span className="material-symbols-outlined">
                  {taskDone === true ? "check_circle" : taskDone === false ? "radio_button_unchecked" : "flag"}
                </span>
                <span className="guide-task-label">本步目标</span>
                <span className="guide-task-text">{step.task}</span>
              </div>
            </>
          )}
          {/* 抽卡挑选：与「本步目标」同一张卡，紧跟在目标下方。
              它只在这一步有用（导引特别提供），所以不做成常驻工具条。 */}
          {step.draw && (
            <FilledTonalButton className="guide-draw-btn" onClick={() => setDrawOpen(true)}>
              <span className="material-symbols-outlined" slot="icon">casino</span>
              抽卡挑选{step.draw === "power" ? "威能" : "专长"}
            </FilledTonalButton>
          )}
        </section>

        {/* 右（手机端为下）：舞台 —— 车卡器真实的板块 / 页面 */}
        <section className="guide-stage" ref={stageRef} aria-label={"导引舞台：" + meta.title}>
          <header className="guide-stage-head">
            <span className="material-symbols-outlined guide-stage-ic">{meta.icon}</span>
            <span className="guide-stage-title">{meta.title}</span>
            {step.stageNote && <span className="guide-stage-note">{step.stageNote}</span>}
          </header>
          {/* key 按步骤走：换一步就是一块干净的板块，不会带着上一步打开的弹窗 */}
          <div className="guide-stage-body" key={step.id}>
            {stageBody}
          </div>
        </section>
      </div>

      <nav className="guide-nav" aria-label="导引步骤导航">
        <OutlinedButton disabled={safeIndex === 0} onClick={() => onIndex(safeIndex - 1)}>上一步</OutlinedButton>
        <span className="guide-nav-spacer" />
        {!last && <TextButton onClick={() => onIndex(safeIndex + 1)}>跳过本步</TextButton>}
        {last ? (
          <FilledButton onClick={onFinish}>完成并返回人物页</FilledButton>
        ) : (
          <FilledButton onClick={() => onIndex(safeIndex + 1)}>下一步</FilledButton>
        )}
      </nav>

      {step.draw && drawOpen && (
        <DrawDialog
          kind={step.draw}
          char={char}
          setChar={setChar}
          onClose={() => setDrawOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * 导引悬浮条：离开导引页之后（去背景页、速览页、存档面板……）依然能看到进度，
 * 并一键跳回导引。这是「分布在不同页面上的导引」不迷路的保险。
 */
export function GuideFloatingBar(props: {
  steps: GuideStep[];
  index: number;
  onOpen: () => void;
  onEnd: () => void;
}) {
  const { steps, index, onOpen, onEnd } = props;
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, steps.length - 1));
  const step = steps[safeIndex];
  if (!step) return null;
  return (
    <div className="guide-float" role="status">
      <span className="material-symbols-outlined guide-float-ic">route</span>
      <div className="guide-float-text">
        <span className="guide-float-title">
          导引中 · 第 {safeIndex + 1} / {steps.length} 步
        </span>
        <span className="guide-float-sub">{step.title}</span>
      </div>
      <div className="guide-float-bar" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s.id} className={"guide-float-seg" + (i < safeIndex ? " done" : i === safeIndex ? " on" : "")} />
        ))}
      </div>
      <div className="guide-float-actions">
        <FilledTonalButton onClick={onOpen}>回到导引</FilledTonalButton>
        <TextButton onClick={onEnd}>结束导引</TextButton>
      </div>
    </div>
  );
}
