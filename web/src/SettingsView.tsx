import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { HexColorPicker } from "react-colorful";
import { useTheme, type BgMode } from "./ThemeProvider";
import { Switch, FilledButton, Slider } from "./components/md";
import { readFileAsDataUrl } from "./lib/image";
import { NORD_PRESETS, type SeedMode } from "./theme";
import { shouldWarnOversize, prepareImageForStore, IMAGE_SIZE_HINT } from "./lib/settings";
import PanelLayoutEditor from "./components/PanelLayoutEditor";
import SyncSettings from "./components/SyncSettings";

export default function SettingsView({ layout }: { layout: "single" | "double" }) {
  const { seedMode, seedHex, presetHex, isDark, setSeedMode, setSeedHex, setPresetHex, setDark, bgMode, setBgMode, setBgCustom, bgImage, bgBlur, bgFeather, setBgBlur, setBgFeather, fontMode, setFontMode } = useTheme();
  const bgFileRef = useRef<HTMLInputElement>(null);
  const [oversize, setOversize] = useState<File | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [hexInput, setHexInput] = useState(seedHex);

  // 自选色变化（选色器/外部）时同步 HEX 输入框
  useEffect(() => setHexInput(seedHex), [seedHex]);

  async function applyBg(f: File, compress: boolean) {
    const url = await readFileAsDataUrl(f);
    setBgCustom(compress ? await prepareImageForStore(url) : url);
  }

  async function onBgFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    // 背景图过大：提醒用户选择「取消 / 由网站自动压缩」后再继续
    if (shouldWarnOversize(f.size)) {
      setOversize(f);
      return;
    }
    await applyBg(f, false);
  }

  return (
    <div className={"settings" + (layout === "double" ? " double" : "")}>
      <div className="settings-col">
      <section className="block">
        <h3 className="block-title">外观设置</h3>
        <div className="settings-row">
          <span className="field-label">深浅模式</span>
          <Switch selected={isDark} onChange={(e) => setDark((e.target as any).selected)} />
          <span className="label">{isDark ? "深色" : "浅色"}</span>
        </div>
        <div className="settings-row">
          <span className="field-label">全局字体</span>
          <div className="md3-seg" role="radiogroup" aria-label="全局字体">
            <button type="button" role="radio" aria-checked={fontMode === "serif"} className={"md3-seg-btn" + (fontMode === "serif" ? " on" : "")} onClick={() => setFontMode("serif")}>
              {fontMode === "serif" && <span className="material-symbols-outlined md3-seg-check">check</span>}
              衬线体
            </button>
            <button type="button" role="radio" aria-checked={fontMode === "sans"} className={"md3-seg-btn" + (fontMode === "sans" ? " on" : "")} onClick={() => setFontMode("sans")}>
              {fontMode === "sans" && <span className="material-symbols-outlined md3-seg-check">check</span>}
              无衬线体
            </button>
          </div>
        </div>
        <div className="settings-row">
          <span className="field-label">动态取色种子</span>
          <div className="md3-seg" role="radiogroup" aria-label="动态取色种子">
            {(["preset", "picker", "portrait", "background"] as SeedMode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={seedMode === m} className={"md3-seg-btn" + (seedMode === m ? " on" : "")} onClick={() => setSeedMode(m)}>
                {seedMode === m && <span className="material-symbols-outlined md3-seg-check">check</span>}
                {({ preset: "预设", picker: "自选", portrait: "跟随立绘", background: "跟随背景" } as Record<SeedMode, string>)[m]}
              </button>
            ))}
          </div>
        </div>
        {seedMode === "preset" && (
          <div className="settings-row">
            <div className="swatch-row">
              {NORD_PRESETS.map((p) => (
                <button key={p.color} type="button" className={presetHex === p.color ? "swatch active" : "swatch"} style={{ background: p.color }} title={p.name} onClick={() => setPresetHex(p.color)} />
              ))}
            </div>
          </div>
        )}
        {seedMode === "picker" && (
          <div className="picker-color">
            <div className="settings-row">
              <span className="field-label">种子色</span>
              <button type="button" className={presetHex === seedHex ? "swatch active" : "swatch"} style={{ background: seedHex }} title="点击切换选色器" onClick={() => setColorOpen((v) => !v)} />
              <input
                className="hex-input"
                value={hexInput}
                aria-label="HEX 颜色值"
                onChange={(e) => {
                  setHexInput(e.target.value);
                  const v = e.target.value.trim();
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) setSeedHex(v.toLowerCase());
                }}
                onKeyDown={(e) => { if (e.key === "Enter") setColorOpen(false); }}
              />
            </div>
            {colorOpen && (
              <div className="color-picker-pop">
                <HexColorPicker color={seedHex} onChange={setSeedHex} />
              </div>
            )}
          </div>
        )}
        {seedMode === "portrait" && <p className="hint">取色来自车卡页上传的立绘原图（非裁切版本）。</p>}
        {seedMode === "background" && !bgImage && <p className="hint">尚未设置背景图，将回退到默认色。请先在下方「背景」中开启。</p>}
      </section>


      <section className="block">
        <h3 className="block-title">背景</h3>
        <div className="settings-row">
          <span className="field-label">背景图</span>
          <Switch selected={bgMode !== "off"} onChange={(e) => setBgMode((e.target as any).selected ? "portrait" : "off")} />
          <span className="label">{bgMode !== "off" ? "开启" : "关闭（默认）"}</span>
        </div>
        {bgMode !== "off" && (
          <>
            <div className="settings-row">
              <span className="field-label">背景来源</span>
              <div className="md3-seg" role="radiogroup" aria-label="背景来源">
                {([["portrait", "与立绘同步"], ["custom", "自行上传"]] as [BgMode, string][]).map(([m, label]) => (
                  <button key={m} type="button" role="radio" aria-checked={bgMode === m} className={"md3-seg-btn" + (bgMode === m ? " on" : "")} onClick={() => setBgMode(m)}>
                    {bgMode === m && <span className="material-symbols-outlined md3-seg-check">check</span>}
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {bgMode === "portrait" && <p className="hint">与立绘同步：使用车卡页上传的立绘原图（非裁切版本）作为背景。</p>}
            {bgMode === "custom" && (
              <div className="settings-row">
                <span className="field-label">上传背景</span>
                <FilledButton onClick={() => bgFileRef.current?.click()}>选择图片</FilledButton>
                <input ref={bgFileRef} type="file" accept="image/*" onChange={onBgFile} style={{ display: "none" }} />
              </div>
            )}
            {bgMode === "custom" && <p className="hint">建议横向图片、比例约 16:9 为佳。</p>}
            <div className="settings-row">
              <span className="field-label">模糊强度</span>
              <Slider min={0} max={16} step={1} value={bgBlur} onInput={(e) => setBgBlur((e.target as any).value)} />
              <span className="label">{bgBlur}px</span>
            </div>
            <div className="settings-row">
              <span className="field-label">羽化强度</span>
              <Slider min={50} max={90} step={1} value={bgFeather} onInput={(e) => setBgFeather((e.target as any).value)} />
              <span className="label">{bgFeather}%</span>
            </div>

          </>
        )}

      </section>

      <section className="block">
        <h3 className="block-title">车卡页面板块</h3>
        <p className="hint">人物页由下列板块组成。按住板块拖动即可调整它们的先后顺序与所在栏位。</p>
        <PanelLayoutEditor defaultMode={layout} />
      </section>

      <SyncSettings />
      </div>

      <div className="settings-col">
      <section className="block">
        <h3 className="block-title">致谢</h3>
        <div className="settings-row">
          <span className="field-label">数据支持</span>
          <a className="settings-link" href="https://4e-wiki.netlify.app/" target="_blank" rel="noreferrer">4e Wiki（现任维护者：风之守护）</a>
          <a className="settings-link" href="https://4e-rules.netlify.app/" target="_blank" rel="noreferrer">4e万律（现任维护者：风之守护）</a>
        </div>
        <div className="settings-row">
          <span className="field-label">特别感谢</span>
          <span className="label">所有历代的4E全书维护者、所有的4E中文译者</span>
        </div>
      </section>

      <section className="block">
        <h3 className="block-title">源码仓库</h3>
        <div className="settings-row">
          <span className="field-label">地址</span>
          <a className="settings-link" href="https://github.com/NorthOpen/4E-NEXT" target="_blank" rel="noreferrer">github.com/NorthOpen/4E-NEXT</a>
        </div>
        <div className="settings-row">
          <span className="field-label">作者</span>
          <span className="label">北开 KitaAkeru</span>
        </div>
        <div className="settings-row">
          <span className="field-label">贡献者</span>
          <span className="label">灵霜</span>
        </div>
        <div className="settings-row">
          <span className="field-label">当前版本</span>
          <span className="label">{__APP_VERSION__}B</span>
        </div>
      </section>

      <section className="block">
        <h3 className="block-title">漏洞提交</h3>
        <div className="settings-row">
          <span className="field-label">邮箱</span>
          <a className="settings-link" href="mailto:kitahard@outlook.com">kitahard@outlook.com</a>
        </div>
        <div className="settings-row">
          <span className="field-label">群聊</span>
          <span className="label">1064444761</span>
        </div>
      </section>

      <section className="block">
        <h3 className="block-title">法律声明与版权信息</h3>
        <p className="hint">
          4E NEXT的开发目标是制作一个基于网页的数据处理、自动计算与表格排版工具。4E NEXT不涉及对于龙与地下城四版规则内容与对海岸巫师威世智所持版权内容的二次分发。为了方便用户使用，项目内部封装了由中文译者提供，中文开发者维护的4e Wiki作为数据来源。
        </p>
        <p className="hint">
          《龙与地下城》（DUNGEONS &amp; DRAGONS）、DUNGEONS &amp; DRAGONS 兼容性标志、D&amp;D、《玩家手册》（PLAYER&rsquo;S HANDBOOK）、《地下城主指南》（DUNGEON MASTER&rsquo;S GUIDE）和《怪物图鉴》（MONSTER MANUAL）是 Wizards of the Coast, Inc. 在美国和其他国家的商标。
        </p>
        <p className="hint">
          《龙与地下城》第 4 版《玩家手册》，由 Rob Heinsoo、Andy Collins 和 James Wyatt 撰写；《地下城主指南》，由 James Wyatt 撰写；《怪物图鉴》，由 Mike Mearls、Stephen Schubert 和 James Wyatt 撰写 &copy; 2008 Wizards of the Coast, Inc. 保留所有权利。
        </p>
        <p className="hint">
          4E NEXT Logo基于CC-BY-NC4.0协议提供，作者@KitaAkeru
        </p>
      </section>
      </div>

      {oversize && (
        <div className="crop-overlay" onClick={() => setOversize(null)}>
          <div className="crop-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="crop-dialog-body">
              <p className="crop-dialog-title">背景图过大（{Math.ceil(oversize.size / 1024)} KB）</p>
              <p className="hint">为节省本地存储空间，背景图片建议小于 {Math.ceil(IMAGE_SIZE_HINT / 1024)} KB。请选择：</p>
            </div>
            <div className="crop-controls">
              <button type="button" className="crop-btn" onClick={() => setOversize(null)}>取消，自行压缩上传</button>
              <button type="button" className="crop-btn primary" onClick={() => { const f = oversize; setOversize(null); void applyBg(f, true); }}>自动压缩</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}