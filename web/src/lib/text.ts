// 清理 wiki 标记为可读文本（宏/链接/转写/粗斜体/块/标题）
export function stripWiki(text: string): string {
  return text
    // `^^…^^` 注记（来源/期号，如 `^^PH2^^`）：属于卡片抬头的元信息，纯文本里一律剔除
    .replace(/\^\^[^\n]{0,140}?\^\^/g, "")
    .replace(/\^\^/g, "")
    .replace(/<<[^>]+>>/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/''/g, "")
    .replace(/\/\//g, "")
    .replace(/@@/g, "")
    .replace(/^!+\s*/gm, "")
    .replace(/<{3}/g, "")
    .replace(/>{3}/g, "");
}
