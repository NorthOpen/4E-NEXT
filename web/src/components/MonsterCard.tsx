import { safeHtml } from "../lib/sanitize";
import { wikiToHtml } from "../lib/wikirender";

/**
 * 怪物数据块（4E Wiki 的 <div class=creature> 形态）。
 *
 * 数据本身已经是一张完整卡片——标题栏、双栏数据行、段头、威能都在里面，
 * 所以这里**不再往外包一层卡片壳**：主持页与词条页共用这一个组件，
 * 样式全部来自 .gen-creature-card（styles.extra.css 第 ⑬ 段）。
 *
 * creatureText 由数据管线渲染好（out/monsters/categories/monster.json → web/public/data/），
 * 前端只负责把 wiki 标记转成 HTML，不在浏览器里重写一遍展示逻辑。
 */
export default function MonsterCard({ text }: { text: string }) {
  return (
    <div
      className="pc-details gen-creature-card"
      dangerouslySetInnerHTML={safeHtml(wikiToHtml(text, {}))}
    />
  );
}
