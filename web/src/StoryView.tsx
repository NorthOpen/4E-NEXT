import { useEffect, useRef, useState } from "react";
import { FilledButton, FilledTonalButton, IconButton, TextButton } from "./components/md";
import StoryNodeEditor from "./components/StoryNodeEditor";
import { HexColorPicker } from "react-colorful";
import {
  ARROW_STYLES, DEFAULT_H, DEFAULT_W, MAX_K, MIN_K, PEN_INKS, STORY_KINDS, addEdge, addNode, addStroke,
  clamp, clearStory, dismissStoryUndo, isPenInk, isTokenColor, moveNode, removeEdge, setEdgeStyle,
  removeStroke, resizeNode, setView, storySnapshot, textOn, toggleLock, undoStory, updateNode, useStory,
  type ArrowStyle, type StoryNode,
} from "./data/story";

/**
 * 主持页 · 故事白板。
 *
 * 团里的「谁欠谁一个人情」「下个场景要放那座钟楼」这类东西天然是空间性的：
 * 一块一块写下来、用箭头连出因果与先后，比线性笔记好认得多。所以这里是一张白板：
 *   · 方块（想法 / 事件 / 人物 / 线索）大小可自由拉伸，右下角就是把手；
 *   · 名称栏点一下展开下拉栏（换类型 / 删除，只画图标）；改名、配色、图标走右侧铅笔的编辑弹窗 ——
 *     名称不再是常驻输入框，随手记的时候不用先跟光标打交道；
 *   · 名称栏右侧两枚常驻开关：锁（图标自身表达状态，不加底色）与编辑；
 *     锁定后不能被拖动或拉伸，摆好版的板子不会手滑碰歪；
 *   · 拖动空白处平移，滚轮缩放（0.3~2.5），右下角有缩放控件与「适合视图」；
 *   · 「连线」模式下点两个方块得到一条从前者指向后者的箭头，点箭头即删除；
 *   · 内容与视图位置都落在 localStorage，刷新/重开还在，破坏性操作给一次撤销。
 *
 * 组件语言与速览页、怪物追踪页一致（gl-shell / gl-bar / gl-md-btn / md3-seg / md-menu / Snackbar）。
 */

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "node"; id: string; sx: number; sy: number; nx: number; ny: number }
  | { kind: "resize"; id: string; sx: number; sy: number; w0: number; h0: number }
  | { kind: "draw" }
  | null;

/** 画笔线宽（世界坐标，跟着画布一起缩放）；太细了缩到一半就看不见 */
const PEN_W = 3;
/** 落笔采样：世界坐标里间距小于 3px 的点直接丢，一笔才不会存上千个点 */
const PEN_MIN_GAP2 = 9;

function ptsToStr(pts: number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push(pts[i] + "," + pts[i + 1]);
  return out.join(" ");
}

/** 笔迹的着色：基础色走类（深浅模式各一档），自选色走行内 stroke */
function inkProps(color: string | undefined): { className: string; stroke?: string } {
  if (isPenInk(color)) return { className: "wb-stroke " + color };
  if (color) return { className: "wb-stroke", stroke: color };
  return { className: "wb-stroke" };
}

/**
 * 箭头形制的小样：直接把这一档实际画出来的样子画进按钮里，而不是拿一个抽象图标去代表它。
 * 方框是 44×18 的示意线段，端点用纯 path / circle 画，不引 marker，省掉一层引用。
 */
function ArrowPreview({ style }: { style: ArrowStyle }) {
  return (
    <svg className="wb-style-prev" viewBox="0 0 44 18" width="44" height="18" aria-hidden="true" focusable="false">
      <line className={"pv-line" + (style === "none" ? " dashed" : "")} x1="4" y1="9" x2="40" y2="9" />
      {(style === "single" || style === "double") && <path className="pv-head" d="M33.5 3.5 L41 9 L33.5 14.5 z" />}
      {(style === "reverse" || style === "double") && <path className="pv-head" d="M10.5 3.5 L3 9 L10.5 14.5 z" />}
      {style === "dot" && <circle className="pv-head" cx="36.5" cy="9" r="3.4" />}
    </svg>
  );
}

export default function StoryView() {
  const st = useStory();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [penMode, setPenMode] = useState(false);
  // 新连线用哪种箭头形制
  const [arrow, setArrow] = useState<ArrowStyle>("single");
  // 画笔墨色：基础色键或自选 HEX；自选那枚点开是色盘 + HEX 输入
  const [ink, setInk] = useState("ink-black");
  const [inkPicker, setInkPicker] = useState(false);
  const [inkHex, setInkHex] = useState("");
  // 正在画的那一笔：ref 存权威点列（抬笔时落库），state 只负责渲染
  const draftRef = useRef<number[]>([]);
  const [draft, setDraft] = useState<number[]>([]);
  const [editFor, setEditFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!st.undo) return;
    const timer = window.setTimeout(dismissStoryUndo, 8000);
    return () => window.clearTimeout(timer);
  }, [st.undo]);

  // 滚轮缩放：React 的 onWheel 是被动监听，preventDefault 拦不住页面滚动，所以原生挂一次
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      // 这个监听只挂一次，闭包里的 st 会永远停在首帧 —— 视图变换必须现取
      const cur = storySnapshot().view;
      const k = clamp(cur.k * Math.exp(-e.deltaY * 0.0015), MIN_K, MAX_K);
      setView({ k, x: px - (px - cur.x) * (k / cur.k), y: py - (py - cur.y) * (k / cur.k) });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Esc 依次退出：连线起点 → 连线模式
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (linkFrom) setLinkFrom(null);
      else if (linkMode) setLinkMode(false);
      else if (penMode) setPenMode(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linkMode, linkFrom, penMode]);

  /** 屏幕坐标 → 世界坐标（落笔用；连线靠方块本身，不需要这个） */
  function toWorld(clientX: number, clientY: number) {
    const el = wrapRef.current;
    const rect = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      x: (clientX - rect.left - st.view.x) / st.view.k,
      y: (clientY - rect.top - st.view.y) / st.view.k,
    };
  }

  function bgDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.button !== 1) return;
    // 画笔优先：按住拖动就是落笔（方块上的小按钮仍然照常点击，不会被画到）
    if (penMode) {
      if (e.button !== 0 || isInteractive(e.target)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = toWorld(e.clientX, e.clientY);
      draftRef.current = [p.x, p.y];
      setDraft([p.x, p.y]);
      dragRef.current = { kind: "draw" };
      return;
    }
    // 指针捕获会把后续的 click 重定位到画布自身，所以平移绝不能从按钮/输入框/缩放控件上开始 ——
    // 否则「添加块」「缩放」这些画布内的按钮会点了没反应（空板时的「添加块」就是被这个吃掉的）。
    if (isInteractive(e.target)) return;
    if (linkMode) { setLinkFrom(null); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: st.view.x, vy: st.view.y };
    setPanning(true);
  }

  function nodeDown(e: React.PointerEvent<HTMLDivElement>, n: StoryNode) {
    // 画笔模式下不拦事件：让它在方块上方也能落笔（围着某块画圈是最常见的用法）
    if (penMode) return;
    e.stopPropagation();                       // 别让空白区把它当成平移
    if (linkMode || n.locked || e.button !== 0) return;
    if (isInteractive(e.target)) return;   // 输入框、按钮、拉伸把手各有各的行为
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind: "node", id: n.id, sx: e.clientX, sy: e.clientY, nx: n.x, ny: n.y };
    setDragging(n.id);
  }

  function resizeDown(e: React.PointerEvent<HTMLSpanElement>, n: StoryNode) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind: "resize", id: n.id, sx: e.clientX, sy: e.clientY, w0: n.w, h0: n.h };
    setDragging(n.id);
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const k = st.view.k;
    if (d.kind === "draw") {
      const p = toWorld(e.clientX, e.clientY);
      const arr = draftRef.current;
      const n = arr.length;
      if (n >= 2) {
        const dx = p.x - arr[n - 2];
        const dy = p.y - arr[n - 1];
        if (dx * dx + dy * dy < PEN_MIN_GAP2) return;   // 太密的点丢掉
      }
      arr.push(p.x, p.y);
      setDraft(arr.slice());
      return;
    }
    if (d.kind === "pan") setView({ k, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) });
    else if (d.kind === "node") moveNode(d.id, d.nx + (e.clientX - d.sx) / k, d.ny + (e.clientY - d.sy) / k);
    else resizeNode(d.id, d.w0 + (e.clientX - d.sx) / k, d.h0 + (e.clientY - d.sy) / k);
  }

  function up() {
    const d = dragRef.current;
    if (d?.kind === "draw") {
      addStroke(draftRef.current, PEN_W, ink);   // 抬笔才落库：一笔一次提交
      draftRef.current = [];
      setDraft([]);
    }
    dragRef.current = null;
    setPanning(false);
    setDragging(null);
  }

  function addBlock() {
    const el = wrapRef.current;
    const n = st.nodes.length;
    // 落在当前视野中央，再错开一点，连点几下也不会叠成一摞
    const wx = el ? (el.clientWidth / 2 - st.view.x) / st.view.k : 0;
    const wy = el ? (el.clientHeight / 2 - st.view.y) / st.view.k : 0;
    const id = addNode("idea", wx - DEFAULT_W / 2 + (n % 5) * 26 - 52, wy - DEFAULT_H / 2 + (n % 5) * 26 - 52);
    setEditFor(id);             // 新块直接把编辑弹窗打开：先起名字、挑颜色图标，再摆位置
  }

  function zoomAt(px: number, py: number, factor: number) {
    const k = clamp(st.view.k * factor, MIN_K, MAX_K);
    setView({ k, x: px - (px - st.view.x) * (k / st.view.k), y: py - (py - st.view.y) * (k / st.view.k) });
  }

  function zoomCenter(factor: number) {
    const el = wrapRef.current;
    zoomAt(el ? el.clientWidth / 2 : 0, el ? el.clientHeight / 2 : 0, factor);
  }

  /** 把整张板缩到刚好放得下（DM 拖散了以后一键找回） */
  function fit() {
    const el = wrapRef.current;
    if (!el || (st.nodes.length === 0 && st.strokes.length === 0)) return;
    // 逐点扫而不是 Math.min(...arr)：笔迹可能有上万个点，展开成参数会爆栈
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const see = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const n of st.nodes) { see(n.x, n.y); see(n.x + n.w, n.y + n.h); }
    for (const s of st.strokes) for (let i = 0; i + 1 < s.pts.length; i += 2) see(s.pts[i], s.pts[i + 1]);
    const pad = 48;
    const k = clamp(
      Math.min((el.clientWidth - pad * 2) / Math.max(1, maxX - minX), (el.clientHeight - pad * 2) / Math.max(1, maxY - minY)),
      MIN_K,
      1.2,
    );
    setView({
      k,
      x: (el.clientWidth - (maxX - minX) * k) / 2 - minX * k,
      y: (el.clientHeight - (maxY - minY) * k) / 2 - minY * k,
    });
  }

  function clearAll() {
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 6000);
      return;
    }
    clearStory();
    setConfirmClear(false);
    setLinkFrom(null);
  }

  function pickNode(id: string) {
    if (!linkMode) return;
    if (!linkFrom) { setLinkFrom(id); return; }
    if (linkFrom !== id) addEdge(linkFrom, id, arrow);
    setLinkFrom(null);
  }

  const byId = new Map(st.nodes.map((n) => [n.id, n]));
  const editNode = editFor ? byId.get(editFor) ?? null : null;

  return (
    <div className="gm-view">
      <div className="gl-shell gm-shell">
        <div className="gl-bar">
          <div className="gl-bar-id">
            <div className="gl-bar-line">
              <h2 className="gl-bar-name gm-h2">故事</h2>
              <span className="gl-state gl-state-ok">
                {st.nodes.length} 块 · {st.edges.length} 条连线{st.strokes.length > 0 ? " · " + st.strokes.length + " 笔" : ""}
              </span>
            </div>
          </div>
          <div className="gm-bar-acts">
            <FilledButton className="gl-md-btn" onClick={addBlock}>
              <span slot="icon" className="material-symbols-outlined">add</span>
              添加块
            </FilledButton>
            <FilledTonalButton
              className={"gl-md-btn wb-linkbtn" + (linkMode ? " on" : "")}
              disabled={st.nodes.length < 2}
              aria-pressed={linkMode}
              title={linkMode ? "连线中：依次点两个方块连起来（Esc 退出）" : "打开连线模式"}
              onClick={() => { setLinkMode((v) => !v); setLinkFrom(null); setPenMode(false); }}
            >
              <span slot="icon" className="material-symbols-outlined">conversion_path</span>
              {linkMode ? "连线中…" : "连线"}
            </FilledTonalButton>
            {/* 箭头形制：连线模式下才出现，选中后新建的连线都用它 */}
            {linkMode && (
              <div className="wb-arrowset" role="group" aria-label="连线箭头形制">
                {ARROW_STYLES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={"wb-style" + (arrow === s.key ? " on" : "")}
                    aria-pressed={arrow === s.key}
                    aria-label={s.label}
                    title={s.label + "（点既有的连线即套用这一档）"}
                    onClick={() => setArrow(s.key)}
                  >
                    <ArrowPreview style={s.key} />
                  </button>
                ))}
              </div>
            )}
            <FilledTonalButton
              className={"gl-md-btn wb-linkbtn" + (penMode ? " on" : "")}
              aria-pressed={penMode}
              title={penMode ? "画笔中：在画布上按住拖动即可随手画（Esc 退出）" : "打开画笔，随手涂画"}
              onClick={() => { setPenMode((v) => !v); setLinkMode(false); setLinkFrom(null); }}
            >
              <span slot="icon" className="material-symbols-outlined">draw</span>
              {penMode ? "画笔中…" : "画笔"}
            </FilledTonalButton>
            {/* 墨色：三个基础色 + 一枚自选（色盘点开是色盘 + HEX 输入） */}
            {penMode && (
              <div className="wb-ink" role="group" aria-label="画笔颜色">
                {PEN_INKS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={"wb-ink-dot " + c.key + (ink === c.key ? " on" : "")}
                    aria-pressed={ink === c.key}
                    aria-label={c.label}
                    title={"画笔：" + c.label}
                    onClick={() => { setInk(c.key); setInkPicker(false); }}
                  />
                ))}
                <button
                  type="button"
                  className={"wb-ink-dot custom" + (isPenInk(ink) ? "" : " on")}
                  style={isPenInk(ink) ? undefined : { background: ink }}
                  aria-pressed={!isPenInk(ink)}
                  aria-label="自选画笔颜色"
                  aria-expanded={inkPicker}
                  title={inkPicker ? "收起选色器" : "自选画笔颜色"}
                  onClick={() => setInkPicker((v) => !v)}
                />
                {inkPicker && (
                  <div className="wb-ink-pop">
                    <HexColorPicker
                      color={/^#[0-9a-fA-F]{6}$/.test(inkHex) ? inkHex : isPenInk(ink) ? "#1a73e8" : ink}
                      onChange={(c) => { setInkHex(c); setInk(c.toLowerCase()); }}
                    />
                    <input
                      className="hex-input"
                      value={inkHex}
                      placeholder="#RRGGBB"
                      aria-label="画笔颜色 HEX 值"
                      onChange={(e) => {
                        setInkHex(e.target.value);
                        const v = e.target.value.trim();
                        if (/^#[0-9a-fA-F]{6}$/.test(v)) setInk(v.toLowerCase());
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            <TextButton className="gm-tbtn" disabled={st.nodes.length === 0 && st.strokes.length === 0} onClick={fit}>适合视图</TextButton>
            {(st.nodes.length > 0 || st.strokes.length > 0) && (
              <TextButton className="gm-tbtn gm-danger" onClick={clearAll}>{confirmClear ? "确认清空？" : "清空"}</TextButton>
            )}
          </div>
        </div>

        <div
          ref={wrapRef}
          className={"wb" + (panning ? " panning" : "") + (linkMode ? " linking" : "") + (penMode ? " pen" : "")}
          style={{
            backgroundSize: (24 * st.view.k) + "px " + (24 * st.view.k) + "px",
            backgroundPosition: st.view.x + "px " + st.view.y + "px",
          }}
          onPointerDown={bgDown}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <div className="wb-world" style={{ transform: "translate(" + st.view.x + "px," + st.view.y + "px) scale(" + st.view.k + ")" }}>
            <svg className="wb-edges">
              <defs>
                {/* orient="auto-start-reverse"：同一个箭头标记既能当终点，也能在起点反向使用（双向箭头） */}
                <marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="wb-arrow" />
                </marker>
                <marker id="wb-dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <circle cx="5" cy="5" r="4" className="wb-arrow" />
                </marker>
              </defs>
              {st.edges.map((e) => {
                const a = byId.get(e.from);
                const b = byId.get(e.to);
                if (!a || !b) return null;
                const g = edgeGeometry(a, b);
                const style = e.style ?? "single";
                return (
                  <line
                    key={e.id}
                    className={"wb-edge" + (style === "none" ? " dashed" : "")}
                    x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
                    markerEnd={style === "single" || style === "double" ? "url(#wb-arrow)" : style === "dot" ? "url(#wb-dot)" : undefined}
                    /* 反向档：箭头挂在起点。marker 带 orient="auto-start-reverse"，当起点用时自动朝外，不用再做一个反向头像 */
                    markerStart={style === "double" || style === "reverse" ? "url(#wb-arrow)" : undefined}
                    /* 连线模式下点线＝套用当前选中的形制（正在连线时点它多半是想改样式，而不是删掉重连） */
                    onClick={() => (linkMode ? setEdgeStyle(e.id, arrow) : removeEdge(e.id))}
                  >
                    <title>{linkMode ? "点击套用当前形制" : "点击删除这条连线"}</title>
                  </line>
                );
              })}
              {/* 自由笔迹：画在方块之下，点一下即擦掉 */}
              {st.strokes.map((s) => (
                <polyline
                  key={s.id}
                  {...inkProps(s.color)}
                  points={ptsToStr(s.pts)}
                  strokeWidth={s.w}
                  onClick={() => removeStroke(s.id)}
                >
                  <title>点击擦掉这一笔</title>
                </polyline>
              ))}
              {draft.length >= 4 && (
                <polyline
                  {...inkProps(ink)}
                  className={inkProps(ink).className + " draft"}
                  points={ptsToStr(draft)}
                  strokeWidth={PEN_W}
                />
              )}
            </svg>

            {st.nodes.map((n) => {
              const kind = STORY_KINDS.find((k) => k.key === n.kind) ?? STORY_KINDS[0];
              // 颜色与图标优先用方块自己的覆盖值，没覆盖就跟着类型预设
              const color = n.color ?? kind.color;
              const icon = n.icon ?? kind.icon;
              // 语义色走 c-* 类（跟着主题变），自选 HEX 走行内变量（写死的值，不随主题）
              const token = isTokenColor(color);
              const skin = token
                ? {}
                : ({ "--k-bg": color, "--k-fg": textOn(color) } as Record<string, string>);
              return (
                <div
                  key={n.id}
                  className={
                    "wb-node k-" + n.kind + (token ? " c-" + color : "")
                    + (linkFrom === n.id ? " sel" : "")
                    + (dragging === n.id ? " dragging" : "")
                    + (n.locked ? " locked" : "")
                  }
                  style={{ left: n.x, top: n.y, width: n.w, height: n.h, ...skin }}
                  onPointerDown={(e) => nodeDown(e, n)}
                  onClick={() => pickNode(n.id)}
                >
                  <div className="wb-node-head">
                    {/* 名称栏是静态标签（整条就是拖动把手）；改名、类型、颜色、图标都在铅笔弹窗里 */}
                    <span className="wb-node-name" title={n.title || kind.label}>
                      <span className="material-symbols-outlined">{icon}</span>
                      <span className="wb-node-nametext">{n.title || kind.label}</span>
                    </span>
                    {/* 锁与编辑都是常驻小开关。锁的状态由图标本身表达（lock / lock_open），不加底色 */}
                    <button
                      type="button"
                      className={"wb-node-act" + (n.locked ? " on" : "")}
                      aria-pressed={n.locked}
                      title={n.locked ? "已锁定：不能拖动或改大小（点击解锁）" : "锁定位置与大小"}
                      onClick={() => toggleLock(n.id)}
                    >
                      <span className="material-symbols-outlined">{n.locked ? "lock" : "lock_open"}</span>
                    </button>
                    <button
                      type="button"
                      className="wb-node-act"
                      title="编辑：名字 / 类型 / 颜色 / 图标"
                      onClick={() => setEditFor(n.id)}
                    >
                      <span className="material-symbols-outlined">edit</span>
                    </button>
                  </div>
                  <textarea
                    className="wb-node-text"
                    value={n.text}
                    placeholder="随手记两笔…"
                    aria-label="方块内容"
                    onChange={(e) => updateNode(n.id, { text: e.target.value })}
                  />
                  {!n.locked && (
                    <span
                      className="wb-node-resize"
                      title="拖动改大小"
                      onPointerDown={(e) => resizeDown(e, n)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {st.nodes.length === 0 && st.strokes.length === 0 && (
            <div className="wb-empty">
              <span className="material-symbols-outlined gm-empty-ic">dashboard_customize</span>
              <h3>白板还是空的</h3>
              <FilledButton className="gl-md-btn" onClick={addBlock}>
                <span slot="icon" className="material-symbols-outlined">add</span>
                添加块
              </FilledButton>
            </div>
          )}

          <div className="wb-zoom">
            <IconButton className="gl-icon-btn" title="缩小" onClick={() => zoomCenter(1 / 1.25)}>
              <span className="material-symbols-outlined">remove</span>
            </IconButton>
            <span className="wb-zoom-num" title="当前缩放">{Math.round(st.view.k * 100)}%</span>
            <IconButton className="gl-icon-btn" title="放大" onClick={() => zoomCenter(1.25)}>
              <span className="material-symbols-outlined">add</span>
            </IconButton>
            <IconButton className="gl-icon-btn" title="回到原点（100%）" onClick={() => setView({ x: 0, y: 0, k: 1 })}>
              <span className="material-symbols-outlined">my_location</span>
            </IconButton>
          </div>
        </div>
      </div>

      {editNode && <StoryNodeEditor node={editNode} open onClose={() => setEditFor(null)} />}

      {st.undo && (
        <div className="d4e-snackbar" key={st.undo.stamp} role="status">
          <span className="d4e-snackbar-text">{st.undo.text}</span>
          <TextButton onClick={undoStory}>撤销</TextButton>
        </div>
      )}
    </div>
  );
}

/**
 * 事件目标是不是「画布上的交互元件」。md-* 组件的事件目标是被重定位后的宿主元素
 * （shadow DOM 里那个真正的 <button> 拿不到），所以按 MD- 前缀识别。
 */
function isInteractive(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.tagName.startsWith("MD-")) return true;
  return !!el.closest("button, input, textarea, select, a, .wb-zoom, .wb-node-resize");
}

/**
 * 连线几何：从 a 中心射向 b 中心，两端各裁到各自的矩形边界（外留 6px 给箭头），
 * 于是箭头正好停在方块边缘而不是插进方块里 —— 方块尺寸可改，所以每块按自己的 w/h 算。
 */
function edgeGeometry(a: StoryNode, b: StoryNode) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const t1 = exitDist(ux, uy, a.w, a.h);
  const t2 = exitDist(-ux, -uy, b.w, b.h);
  return { x1: ax + ux * t1, y1: ay + uy * t1, x2: bx - ux * t2, y2: by - uy * t2 };
}

/** 从矩形中心沿 (ux,uy) 射出，到边界还要走多远 */
function exitDist(ux: number, uy: number, w: number, h: number): number {
  const tx = ux === 0 ? Infinity : (w / 2) / Math.abs(ux);
  const ty = uy === 0 ? Infinity : (h / 2) / Math.abs(uy);
  return Math.min(tx, ty) + 6;
}
