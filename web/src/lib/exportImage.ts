import { platform } from "@platform";
import { toCanvas, toJpeg, toPng } from "html-to-image";

export type ExportFormat = "png" | "jpg" | "pdf";

/** data URL → Blob。桌面端要把字节交给系统保存对话框，不能再靠 a[download]。 */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /data:([^;,]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function triggerDownload(dataUrl: string, filename: string): Promise<unknown> {
  return platform.files.saveBlob(filename, dataUrlToBlob(dataUrl));
}

function sliceBand(source: HTMLCanvasElement, y: number, h: number): HTMLCanvasElement {
  const sy = Math.max(0, Math.round(y));
  const sh = Math.max(1, Math.round(h));
  const band = document.createElement("canvas");
  band.width = source.width;
  band.height = sh;
  const ctx = band.getContext("2d");
  if (ctx) ctx.drawImage(source, 0, sy, source.width, sh, 0, 0, source.width, sh);
  return band;
}

/**
 * 将角色卡分页输出为 A4 PDF。
 * 以 .sheet 的直接子面板为单位做「不跨页」排版：
 * 面板能整块放下则整块放置（当前页放不下则换页）；
 * 面板高于一页时递归拆分为其子元素逐段放置，避免在卡片中间截断。
 */
async function buildPdf(node: HTMLElement, opts: { pixelRatio: number }): Promise<Blob> {
  const canvas = await toCanvas(node, opts);
  const ratio = opts.pixelRatio;
  const sheet = node.querySelector<HTMLElement>(".sheet");
  const panels: HTMLElement[] = sheet ? (Array.from(sheet.children) as HTMLElement[]) : [node];
  const nodeRect = node.getBoundingClientRect();

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const marginL = 12;
  const marginR = 12;
  const marginT = 14;
  const marginB = 14;
  const contentW = pageW - marginL - marginR;
  const contentH = pageH - marginT - marginB;
  // 布局缩放必须基于节点实际 CSS 宽度（canvas 宽度已乘 pixelRatio，仅影响清晰度），
  // 否则整张角色卡会被缩得过小、全部挤进一页
  const cssWidth = canvas.width / ratio;
  const scale = contentW / cssWidth; // 每 CSS 像素对应的毫米数

  let currentY = marginT;

  const placeBand = (band: HTMLCanvasElement, hMm: number) => {
    // 超过一页高度的罕见面板：等比压缩到整页，保证不被截断
    const drawH = Math.min(hMm, contentH);
    const drawW = contentW * (drawH / Math.max(1, hMm));
    const x = marginL + (contentW - drawW) / 2;
    pdf.addImage(band.toDataURL("image/png"), "PNG", x, currentY, drawW, drawH);
    currentY += drawH;
  };

  // trailingGapMm：放置完当前面板后追加的间距（即 .sheet 中面板之间的 gap）
  const placeElement = (el: HTMLElement, trailingGapMm: number) => {
    const rect = el.getBoundingClientRect();
    const topPx = rect.top - nodeRect.top;
    const hPx = rect.height;
    if (hPx < 1) return; // 跳过隐藏/空元素
    const hMm = hPx * scale;
    if (hMm <= contentH + 0.5) {
      // 面板可整块放入一页：当前页放不下（含尾部间距）则换页
      if (currentY + hMm + trailingGapMm > marginT + contentH + 0.5) {
        pdf.addPage();
        currentY = marginT;
      }
      placeBand(sliceBand(canvas, topPx * ratio, hPx * ratio), hMm);
      currentY += trailingGapMm;
    } else {
      // 面板高于一页：拆分为其子元素逐段放置（子元素仍保持不跨页），整组结束后补尾部间距
      const children = Array.from(el.children) as HTMLElement[];
      if (children.length === 0) {
        if (currentY + hMm > marginT + contentH + 0.5) {
          pdf.addPage();
          currentY = marginT;
        }
        placeBand(sliceBand(canvas, topPx * ratio, hPx * ratio), hMm);
      } else {
        for (const child of children) placeElement(child, 0);
      }
      currentY += trailingGapMm;
    }
  };

  for (let i = 0; i < panels.length; i++) {
    const gapMm =
      i + 1 < panels.length
        ? (panels[i + 1].getBoundingClientRect().top - panels[i].getBoundingClientRect().bottom) * scale
        : 0;
    placeElement(panels[i], gapMm);
  }

  return pdf.output("blob");
}

/**
 * 导出角色卡：将指定节点渲染为 PNG / JPG 图片，或将图片按 A4 分页输出为 PDF。
 * 导出前等待字体就绪并留出渲染缓冲，确保渲染模式完成布局。
 */
export async function exportCharacterCard(
  node: HTMLElement,
  format: ExportFormat,
  filename: string,
  backgroundColor?: string
): Promise<void> {
  if (document.fonts?.ready) {
    try {
      // 字体可能加载失败/挂起，加超时保护避免阻塞导出
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]);
    } catch {
      /* 忽略字体等待失败 */
    }
  }
  // 等待渲染模式重渲染与布局完成
  await new Promise((r) => setTimeout(r, 200));

  // 超长角色卡限制像素密度，避免画布/图片超出浏览器尺寸上限
  const rect = node.getBoundingClientRect();
  const pixelRatio = Math.min(2, Math.max(1, 24000 / Math.max(1, rect.height)));
  const opts: { pixelRatio: number; cacheBust: boolean; backgroundColor?: string } = { pixelRatio, cacheBust: true };
  if (backgroundColor) opts.backgroundColor = backgroundColor;

  if (format === "pdf") {
    const blob = await buildPdf(node, opts);
    await platform.files.saveBlob(filename + ".pdf", blob);
    return;
  }

  if (format === "jpg") {
    const dataUrl = await toJpeg(node, { ...opts, quality: 0.92 });
    await triggerDownload(dataUrl, filename + ".jpg");
    return;
  }

  const dataUrl = await toPng(node, opts);
  await triggerDownload(dataUrl, filename + ".png");
}
