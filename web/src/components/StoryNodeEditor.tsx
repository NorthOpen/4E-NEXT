import { useEffect, useState } from "react";
import { HexColorPicker } from "react-colorful";
import SheetDialog from "./SheetDialog";
import { FilledTextField, TextButton } from "./md";
import {
  STORY_COLORS, STORY_ICONS, STORY_KINDS, isTokenColor, removeNode, textOn, updateNode,
  type StoryColor, type StoryNode,
} from "../data/story";

/**
 * 编辑方块（二级弹窗）：名字 / 颜色 / 图标。
 *
 * 颜色分两层，和私设（Homebrew）的卡片配色是同一套做法：
 *   · 五个预设 —— 全是 MD3 语义色令牌，所以跟着全局取色种子与深浅模式一起变；
 *   · 自选色 —— 与设置页「自选」同款的选色器（react-colorful 色盘 + HEX 输入框），
 *     直接复用那边的全局类（.swatch / .hex-input / .color-picker-pop / .hb-color-clear），
 *     不自造一套。自选色是写死的 HEX，不随主题变（这正是它和预设的区别）。
 * 图标是一排芯片，选中填当前配色；所有改动即时生效，弹窗背后的白板会实时跟着变。
 */
export default function StoryNodeEditor({ node, open, onClose }: {
  node: StoryNode | null;
  open: boolean;
  onClose: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hex, setHex] = useState("");

  const color = node?.color ?? "";
  const isCustom = !!color && !isTokenColor(color);

  // 换方块 / 点预设色时把 HEX 输入框同步过来
  useEffect(() => { setHex(isCustom ? color : ""); }, [node?.id, color, isCustom]);
  // 选色器要一个合法色值：先用输入框里合法的 HEX，其次自选色，最后给 MD3 默认紫兜底
  const shown = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : isCustom ? color : "#6750a4";

  if (!node) return null;
  const id = node.id;   // 收窄后的 id：下面嵌在函数里的用法不会被 TS 的收窄丢掉
  const kind = STORY_KINDS.find((k) => k.key === node.kind) ?? STORY_KINDS[0];
  const token: StoryColor = isTokenColor(color) ? color : kind.color;
  const icon = node.icon ?? kind.icon;
  // 自选色也要让弹窗里的选中态跟着变，所以同样把一对变量挂到根节点上
  const skin = isTokenColor(color) ? {} : ({ "--k-bg": color, "--k-fg": textOn(color) } as Record<string, string>);

  function pickPreset(c: StoryColor) {
    setPickerOpen(false);
    updateNode(id, { color: c });
  }

  return (
    <SheetDialog
      open={open}
      headline="编辑方块"
      sub={kind.label + " · " + (node.title || "未命名")}
      onClose={onClose}
      actions={
        <TextButton className="gm-danger" onClick={() => { removeNode(id); onClose(); }}>删除</TextButton>
      }
    >
      <div className={"se c-" + token} style={skin}>
        <FilledTextField
          className="se-name"
          label="名字"
          value={node.title}
          onInput={(e) => updateNode(id, { title: (e.target as unknown as { value: string }).value ?? "" })}
        />

        <div className="se-field">
          <span className="se-label">类型</span>
          <div className="se-chips">
            {STORY_KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                className={"se-kind" + (node.kind === k.key ? " active" : "")}
                title={k.label + "（同时套用它的图标与配色）"}
                aria-pressed={node.kind === k.key}
                onClick={() => updateNode(id, { kind: k.key, icon: k.icon, color: k.color })}
              >
                <span className="material-symbols-outlined">{k.icon}</span>
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <div className="se-field">
          <span className="se-label">颜色</span>
          <div className="se-chips">
            {STORY_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={"se-color c-" + c.key + (!isCustom && token === c.key ? " active" : "")}
                title={c.label + "（跟随全局取色与深浅模式）"}
                aria-label={c.label}
                aria-pressed={!isCustom && token === c.key}
                onClick={() => pickPreset(c.key)}
              >
                <span className="se-swatch" />
              </button>
            ))}
          </div>

          <div className="hb-color-custom">
            <span className="hb-color-custom-label">自选色</span>
            <button
              type="button"
              className={"swatch" + (isCustom ? " active" : "")}
              style={{ background: shown }}
              title={pickerOpen ? "收起选色器" : "展开选色器，自选方块颜色"}
              aria-label="自选方块颜色"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((v) => !v)}
            />
            <input
              className="hex-input"
              value={hex}
              placeholder="#RRGGBB"
              aria-label="方块颜色 HEX 值"
              onChange={(e) => {
                setHex(e.target.value);
                const v = e.target.value.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(v)) updateNode(id, { color: v.toLowerCase() });
              }}
              onKeyDown={(e) => { if (e.key === "Enter") setPickerOpen(false); }}
            />
            {isCustom && (
              <button type="button" className="hb-color-clear" onClick={() => setHex("")} title="清空自选色，回到预设">
                清空
              </button>
            )}
          </div>

          {pickerOpen && (
            <div className="color-picker-pop">
              <HexColorPicker color={shown} onChange={(c) => updateNode(id, { color: c.toLowerCase() })} />
            </div>
          )}
        </div>

        <div className="se-field">
          <span className="se-label">图标</span>
          <div className="se-chips">
            {STORY_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                className={"se-icon" + (icon === ic ? " active" : "")}
                title={ic}
                aria-label={ic}
                aria-pressed={icon === ic}
                onClick={() => updateNode(id, { icon: ic })}
              >
                <span className="material-symbols-outlined">{ic}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </SheetDialog>
  );
}
