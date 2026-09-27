import { useRef, useState } from "react";
import { FilledButton, OutlinedButton, TextButton } from "./md";
import type { ExportFormat } from "../lib/exportImage";
import type { SavedCard } from "../lib/storage";

// 存档面板（存档列表 + 导出）。
//
// 为什么单独成一个组件：导引模式要把「存档」这一步**直接纳入导引页**里展示
// （与背景 / 储备 / 速览一样就地打开），而它原本长在 App 的对话框里。
// 抽出来之后，App 的「存档」弹窗与导引的舞台共用同一份实现，
// 不存在两套列表 / 两套导出逻辑 —— 改一处两边都变。
//
// 组件自己持有「正在重命名哪张卡」「导出格式」「导出中」这些纯展示状态；
// 真正动数据与动文件的动作（切换 / 保存 / 重命名 / 删除 / 新建 / 导入 / 导出）
// 全部由 App 以回调传进来 —— 那些要动 cards、activeId、人物卡 DOM 与渲染模式。

interface Props {
  cards: SavedCard[];
  activeId: string;
  /** 切换到某张卡 */
  onSwitch: (id: string) => void;
  /** 把当前编辑内容写回某张卡 */
  onSaveCard: (id: string) => void;
  /** 重命名某张卡 */
  onRename: (id: string, name: string) => void;
  /** 删除某张卡 */
  onDelete: (id: string) => void;
  /** 新建一张空白人物卡 */
  onNewCard: () => void;
  /** 导入 JSON 存档（App 负责解析与校验） */
  onImportFile: (file: File) => void;
  /** 导出当前人物卡为图片 / PDF（App 负责渲染与下载） */
  onExportImage: (format: ExportFormat) => Promise<void>;
  /** 导出当前人物卡的 JSON 备份 */
  onExportJson: () => void;
}

export default function SavePanel(props: Props) {
  const { cards, activeId, onSwitch, onSaveCard, onRename, onDelete, onNewCard, onImportFile, onExportImage, onExportJson } = props;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [exporting, setExporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  function confirmRename() {
    const name = renameText.trim();
    if (renamingId && name) onRename(renamingId, name);
    setRenamingId(null);
  }

  async function runExport() {
    setExporting(true);
    try {
      await onExportImage(exportFormat);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="dialog-save-layout">
      <div className="dialog-save-list">
        <div className="save-panel-actions">
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = "";
            }}
          />
          <TextButton onClick={() => importRef.current?.click()}>导入存档</TextButton>
          <TextButton onClick={onNewCard}>＋ 新建人物卡</TextButton>
        </div>
        <div className="preset-list">
          {cards.map((c) => (
            <div key={c.id} className={c.id === activeId ? "card-row active" : "card-row"}>
              <div className="card-row-main">
                {renamingId === c.id ? (
                  <input
                    className="card-rename-input"
                    value={renameText}
                    autoFocus
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmRename();
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setRenamingId(null);
                      }
                    }}
                    onBlur={() => setRenamingId(null)}
                  />
                ) : (
                  <button type="button" className="card-row-name" onClick={() => onSwitch(c.id)} title="切换到这张卡">
                    <span className="preset-name">{c.name}{c.id === activeId ? "（当前）" : ""}</span>
                    <span className="preset-label">Lv{c.char.level} · {new Date(c.updatedAt).toLocaleString("zh-CN")}</span>
                  </button>
                )}
              </div>
              <div className="card-row-btns">
                <button type="button" className="crop-btn" onClick={() => onSaveCard(c.id)}>保存</button>
                <button type="button" className="crop-btn" onClick={() => { setRenamingId(c.id); setRenameText(c.name); }}>重命名</button>
                {cards.length > 1 && <button type="button" className="crop-btn crop-danger" onClick={() => onDelete(c.id)}>删除</button>}
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
            <FilledButton disabled={exporting} onClick={() => void runExport()}>{exporting ? "导出中…" : "导出"}</FilledButton>
          </div>

          <div className="export-group">
            <span className="export-group-label">存档备份</span>
            <p className="hint">导出为 JSON 文件，可随时重新导入。</p>
            <OutlinedButton onClick={onExportJson}>导出存档</OutlinedButton>
          </div>
        </div>
      </div>
    </div>
  );
}
