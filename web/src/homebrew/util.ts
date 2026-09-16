// 私设页共用小工具

import { platform } from "@platform";

/** 另存一个文本文件（.d4e 资源包 / JSON）。网页端走浏览器下载，桌面端走系统保存对话框。 */
export function downloadText(filename: string, text: string): void {
  void platform.files.saveText(filename, text);
}

/** 友好日期（无效值回退为「—」）。 */
export function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}
