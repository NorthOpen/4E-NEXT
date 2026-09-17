import { useMemo } from "react";
import { fmtBytes, STORAGE_GROUP_TONE, STORAGE_HINT, STORAGE_LABEL, type StorageBreakdown } from "../lib/storage";
import { poolSizeBytes, type HomebrewPool } from "../lib/userdata";

// 浏览器缓存（localStorage）占用板块：与页面标题同占整行宽度。
// 取色走 lib/storage 的 STORAGE_GROUP_TONE —— 设置页的占用条用的是同一套，
// 两处指的是同一批数据，配色必须一致。

export default function CachePanel({ usage, pools }: { usage: StorageBreakdown; pools: HomebrewPool[] }) {
  const topPools = useMemo(
    () =>
      pools
        .map((p) => ({ id: p.id, name: p.name, bytes: poolSizeBytes(p), count: p.entries.length }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 3),
    [pools],
  );

  const level = usage.percent >= 90 ? "danger" : usage.percent >= 70 ? "warn" : "ok";
  const segments = usage.groups.filter((g) => g.bytes > 0);

  return (
    <section className={"hb-cache hb-cache-" + level}>
      <div className="hb-cache-head">
        <span className="hb-cache-title">
          <span className="material-symbols-outlined">database</span>
          {STORAGE_LABEL}占用
        </span>
        <span className="hb-cache-figure">
          <b>{fmtBytes(usage.used)}</b>
          <span className="hb-cache-total"> / {fmtBytes(usage.total)}</span>
          <span className="hb-cache-pct">{usage.percent.toFixed(1)}%</span>
        </span>
      </div>

      <div className="hb-cache-bar" role="img" aria-label={"已使用 " + usage.percent.toFixed(1) + "%"}>
        {segments.map((g) => (
          <span
            key={g.key}
            className="hb-cache-seg"
            title={g.label + "：" + fmtBytes(g.bytes)}
            style={{ width: Math.max(0.8, (g.bytes / usage.total) * 100) + "%", background: STORAGE_GROUP_TONE[g.key] }}
          />
        ))}
      </div>

      <div className="hb-cache-body">
        <ul className="hb-cache-legend">
          {usage.groups.map((g) => (
            <li key={g.key} className={g.bytes > 0 ? "" : "muted"}>
              <span className="hb-cache-dot" style={{ background: STORAGE_GROUP_TONE[g.key] }} />
              <span className="hb-cache-legend-label">{g.label}</span>
              <span className="hb-cache-legend-val">{fmtBytes(g.bytes)}</span>
            </li>
          ))}
        </ul>

        <div className="hb-cache-side">
          <div className="hb-cache-side-title">占用最大的资源包</div>
          {topPools.length === 0 ? (
            <p className="hint">尚未加载任何资源包。</p>
          ) : (
            <ul className="hb-cache-tops">
              {topPools.map((p) => (
                <li key={p.id}>
                  <span className="hb-cache-top-name" title={p.name}>{p.name}</span>
                  <span className="hb-cache-top-val">{p.count} 条 · {fmtBytes(p.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="hint hb-cache-foot">
        共 {usage.keys} 个存储项。{STORAGE_HINT}
        {level === "warn"
          ? " 用量偏高：建议导出并删除暂时用不到的资源包。"
          : level === "danger"
            ? " 用量告急：新条目可能保存失败，请立即导出并清理资源包。"
            : ""}
      </p>
    </section>
  );
}
