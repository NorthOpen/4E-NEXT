// 轻量 Markdown 渲染（人物背景、私设条目正文等自由文本），支持常用语法子集：
// 标题 # ~ ####、**加粗**、*斜体*、`行内代码`、```代码块```、- / * 无序列表、1. 有序列表、
// > 引用、--- 分割线、[文字](链接)、| 表格 |。输入统一转义，不解析原始 HTML。
export function mdToHtml(src: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /**
   * 链接地址净化。
   * 输入此刻已经过 esc()（& < > 已转义），所以这里只需处理引号与控制字符——
   * 否则 `[字](x" onmouseover="…)` 会从 href 属性里逃逸出来变成事件处理器。
   * 协议只放行 http/https/mailto，javascript:、data: 等一律不生成链接（退化为纯文本）。
   */
  const safeHref = (raw: string): string | null => {
    const url = raw.trim().replace(/[\u0000-\u0020\u007f]+/g, "");
    if (!url) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) && !/^(https?|mailto):/i.test(url)) return null;
    return url.replace(/"/g, "%22").replace(/'/g, "%27");
  };

  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\*([^*]+)\*/g, "<i>$1</i>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
        const href = safeHref(url);
        return href ? `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>` : label;
      });

  const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s);
  const isTableSplit = (s: string) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(s);
  const cells = (s: string) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  const lines = src.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let inList: "ul" | "ol" | null = null;
  const closeList = () => {
    if (inList) {
      out.push("</" + inList + ">");
      inList = null;
    }
  };
  const openList = (kind: "ul" | "ol") => {
    if (inList !== kind) {
      closeList();
      out.push("<" + kind + ">");
      inList = kind;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (line.trim().startsWith("```")) {
      if (inCode) {
        out.push("<pre><code>" + esc(codeBuf.join("\n")) + "</code></pre>");
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    // 表格：表头行 + 分隔行 + 若干数据行
    if (isTableRow(line) && i + 1 < lines.length && isTableSplit(lines[i + 1])) {
      closeList();
      const head = cells(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        rows.push(cells(lines[j]));
        j++;
      }
      out.push("<table><thead><tr>" + head.map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>");
      for (const r of rows) out.push("<tr>" + r.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>");
      out.push("</tbody></table>");
      i = j - 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      out.push("<hr>");
      continue;
    }
    if (/^#{1,4} /.test(line)) {
      closeList();
      const lv = line.match(/^#+/)![0].length;
      out.push("<h" + (lv + 2) + ">" + inline(line.slice(lv + 1)) + "</h" + (lv + 2) + ">");
      continue;
    }
    if (/^> /.test(line)) {
      closeList();
      out.push("<blockquote>" + inline(line.slice(2)) + "</blockquote>");
      continue;
    }
    if (/^[-*] /.test(line)) {
      openList("ul");
      out.push("<li>" + inline(line.slice(2)) + "</li>");
      continue;
    }
    if (/^\d+\. /.test(line)) {
      openList("ol");
      out.push("<li>" + inline(line.replace(/^\d+\.\s*/, "")) + "</li>");
      continue;
    }
    if (/^\s*$/.test(line)) {
      closeList();
      out.push("");
      continue;
    }
    closeList();
    out.push("<p>" + inline(line) + "</p>");
  }
  if (inCode) out.push("<pre><code>" + esc(codeBuf.join("\n")) + "</code></pre>");
  closeList();
  return out.join("\n");
}

/** 旧版 wikitext 正文尽力转换为 Markdown（标题/加粗/斜体/链接/分割线）。 */
export function wikiToMarkdown(src: string): string {
  return src
    .replace(/^!{4}\s?/gm, "#### ")
    .replace(/^!{3}\s?/gm, "### ")
    .replace(/^!{2}\s?/gm, "## ")
    .replace(/^!{1}\s?/gm, "# ")
    .replace(/''([^']+)''/g, "**$1**")
    .replace(/\/\/([^/\n]+)\/\//g, "*$1*")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/^-{4,}$/gm, "---")
    .replace(/<<[^>]*>>/g, "")
    .trim();
}
