/**
 * 「免费获得 / 计入花销」标记按钮（仪式、装备共用）。
 *
 * 语义：被标记为「免费获得」的条目不计入「自动花销」——用来区分 DM 赠送 / 职业白得与自行购买。
 * 点击一律阻止冒泡：卡片和行本身都有「更换」的点击语义，不拦的话会顺手把选择器弹出来。
 */
export function FreeMarkToggle({ free, onToggle }: { free: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={"free-mark-chip" + (free ? " on" : "")}
      aria-pressed={free}
      title={free
        ? "已标记为免费获得：不计入自动花销。点击改为「计入花销」"
        : "按市场价格计入自动花销。点击标记为「免费获得」，从自动花销中排除"}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      <span className="material-symbols-outlined">{free ? "task_alt" : "payments"}</span>
      {free ? "免费获得" : "计入花销"}
    </button>
  );
}
