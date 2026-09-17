import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { FilledTextField, TextButton } from "../components/md";
import SheetDialog from "../components/SheetDialog";
import type { RuleEntry, RulesPayload } from "./types";
import { buildDocs, highlightHtml, searchRules, suggestEntries, termsOf, type RuleDoc } from "./rulesSearch";
import { renderRule, type RuleContext } from "./rulesWiki";
import { safeHtml } from "../lib/sanitize";

const DATA_URL = import.meta.env.BASE_URL + "data/rules.json";

/** 常用入口：给出新手也点得动的第一批关键词 */
const HOT_TERMS = ["冲锋", "借机攻击", "濒死与死亡", "豁免检定", "战斗优势", "困难地形", "威能格式", "行动点"];

const KIND_LABEL: Record<string, string> = {
  rule: "规则",
  sidebar: "边栏",
  power: "威能样例",
  item: "物品样例",
  feat: "专长样例",
  disease: "疾病",
  glossary: "术语",
  faq: "问答",
};

let cache: Promise<RulesPayload> | null = null;

function loadRules(): Promise<RulesPayload> {
  if (!cache) {
    cache = fetch(DATA_URL).then((res) => {
      if (!res.ok) throw new Error("万律书数据加载失败（" + res.status + "）");
      return res.json() as Promise<RulesPayload>;
    });
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

/** 词条标题本身已含英文名（如「火球术 Fireball」）时不再重复展示 */
function showEn(e: RuleEntry): boolean {
  return Boolean(e.titleEn && !e.title.toLowerCase().includes(e.titleEn.toLowerCase()));
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

interface Prepared {
  ctx: RuleContext;
  docs: RuleDoc[];
  byId: Map<string, RuleEntry>;
}

function prepare(payload: RulesPayload): Prepared {
  const byId = new Map<string, RuleEntry>();
  const alias = new Map<string, string>();
  for (const e of payload.entries) {
    byId.set(e.id, e);
    alias.set(normalizeKey(e.id), e.id);
    alias.set(normalizeKey(e.title), e.id);
  }
  const resolve = (target: string): string | undefined => {
    const key = normalizeKey(target.replace(/\|.*$/, ""));
    return alias.get(key) ?? alias.get(key.split(/[（(]/)[0]) ?? byId.get(target.trim())?.id;
  };
  return { ctx: { byId, resolve }, docs: buildDocs(payload.entries), byId };
}

export default function RulesQuickSearch() {
  const [payload, setPayload] = useState<RulesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const [stack, setStack] = useState<RuleEntry[]>([]);

  useEffect(() => {
    let alive = true;
    loadRules()
      .then((p) => {
        if (alive) setPayload(p);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const prepared = useMemo(() => (payload ? prepare(payload) : null), [payload]);
  const docs = prepared?.docs ?? [];
  const terms = useMemo(() => termsOf(query), [query]);
  const outcome = useMemo(() => (query.trim() && docs.length ? searchRules(docs, query) : null), [docs, query]);
  const suggestions = useMemo(
    () => (outcome && outcome.hits.length === 0 ? suggestEntries(docs, query) : []),
    [docs, outcome, query],
  );

  const current = stack.length > 0 ? stack[stack.length - 1] : null;
  const detailHtml = useMemo(() => {
    if (!current || !prepared) return "";
    return renderRule(current, prepared.ctx);
  }, [current, prepared]);

  const related = useMemo(() => {
    if (!current || !prepared) return [];
    const ids = new Set<string>();
    for (const link of current.links) {
      const id = prepared.ctx.resolve(link.target);
      if (id && id !== current.id) ids.add(id);
    }
    for (const t of current.transclusions) {
      const id = prepared.ctx.resolve(t);
      if (id && id !== current.id) ids.add(id);
    }
    return [...ids].map((id) => prepared.byId.get(id)).filter((e): e is RuleEntry => Boolean(e)).slice(0, 12);
  }, [current, prepared]);

  function openEntry(e: RuleEntry) {
    setStack((prev) => (prev[prev.length - 1]?.id === e.id ? prev : [...prev, e]));
  }

  function onDetailClick(ev: ReactMouseEvent<HTMLDivElement>) {
    const el = (ev.target as HTMLElement).closest("a[data-rule]");
    if (!el || !prepared) return;
    ev.preventDefault();
    const id = el.getAttribute("data-rule");
    const target = id ? prepared.byId.get(id) : undefined;
    if (target) openEntry(target);
  }

  const searching = query.trim().length > 0;
  const hits = outcome?.hits ?? [];

  return (
    <div className="rules-quick">
      <div className="rules-quick-bar">
        <div
          className="rules-quick-field"
          onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
            if (e.key === "Enter" && hits.length > 0) openEntry(hits[0].entry);
            if (e.key === "Escape") setQuery("");
          }}
        >
          <FilledTextField
            value={query}
            label="搜索万律书"
            placeholder="输入关键词，如「冲锋」「借机攻击」「濒死」"
            onInput={(e) => setQuery((e.target as HTMLInputElement).value ?? "")}
          />
        </div>
        {searching && <TextButton onClick={() => setQuery("")}>清除</TextButton>}
      </div>

      {error && (
        <p className="rules-note rules-error">
          {error}
          <br />
          请在仓库根目录先执行 pnpm rules 生成万律词条数据，再运行 pnpm --filter 4enext-web copy-data。
        </p>
      )}
      {!payload && !error && <p className="rules-note">正在载入万律书…</p>}

      {payload && (
        <div className="rules-quick-meta">
          收录 {payload.total} 条 · {payload.chapters.length} 章
          {searching ? " · 命中 " + hits.length + " 条" + (outcome?.loose ? "（未找到全部关键词同时命中的词条，以下为部分命中）" : "") : ""}
        </div>
      )}

      {!searching && payload && (
        <>
          <div className="rules-hot">
            <span className="rules-hot-label">常查</span>
            {HOT_TERMS.map((t) => (
              <button key={t} type="button" className="chip" onClick={() => setQuery(t)}>{t}</button>
            ))}
          </div>
          <div className="rules-chapters">
            {payload.chapters.map((c) => {
              const open = openChapter === c.title;
              return (
                <div key={c.title} className={"rules-chapter" + (open ? " open" : "")}>
                  <button type="button" className="rules-chapter-head" onClick={() => setOpenChapter(open ? null : c.title)}>
                    <span className="material-symbols-outlined">{open ? "expand_more" : "chevron_right"}</span>
                    <span className="rules-chapter-title">{c.title}</span>
                    <span className="rules-chapter-count">{c.sections.length} 节</span>
                  </button>
                  {open && (
                    <div className="rules-sections">
                      {c.sections.map((s) => (
                        <div key={s.title} className="rules-section">
                          <div className="rules-section-title">{s.title}</div>
                          <div className="rules-section-entries">
                            {s.entries.length === 0 && <span className="rules-note">（无独立词条）</span>}
                            {s.entries.map((id) => {
                              const e = prepared?.byId.get(id);
                              if (!e) return null;
                              return (
                                <button key={id} type="button" className="chip" onClick={() => openEntry(e)}>{e.title}</button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {searching && (
        <div className="rules-results">
          {hits.map((h) => (
            <button key={h.entry.id} type="button" className="rules-result" onClick={() => openEntry(h.entry)}>
              <span className="rules-result-head">
                <span className="rules-result-title" dangerouslySetInnerHTML={safeHtml(highlightHtml(h.entry.title, terms))} />
                <span className="rules-result-kind">{KIND_LABEL[h.entry.kind] ?? h.entry.kind}</span>
              </span>
              <span className="rules-result-path">
                {[h.entry.chapter, h.entry.section].filter(Boolean).join(" › ")}
                {showEn(h.entry) ? " · " + h.entry.titleEn : ""}
              </span>
              {h.snippet && (
                <span className="rules-result-snippet" dangerouslySetInnerHTML={safeHtml(highlightHtml(h.snippet, terms))} />
              )}
            </button>
          ))}
          {hits.length === 0 && (
            <div className="rules-empty">
              <p className="rules-note">没有找到「{query}」相关的词条。</p>
              {suggestions.length > 0 && (
                <>
                  <p className="rules-note">你是不是想找：</p>
                  <div className="rules-hot">
                    {suggestions.map((s) => (
                      <button key={s.id} type="button" className="chip" onClick={() => openEntry(s)}>{s.title}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {current && (
        <SheetDialog
          open
          xwide
          headline={current.title}
          sub={[current.chapter, current.section].filter(Boolean).join(" › ")}
          onClose={() => setStack([])}
          actions={
            stack.length > 1 ? (
              <TextButton onClick={() => setStack((prev) => prev.slice(0, -1))}>返回上一条</TextButton>
            ) : undefined
          }
        >
          <div className="rules-detail">
            <div className="rules-detail-meta">
              <span className="rules-result-kind">{KIND_LABEL[current.kind] ?? current.kind}</span>
              {showEn(current) && <span className="rules-detail-en">{current.titleEn}</span>}
              {current.source && <span className="rules-detail-en">出处 {current.source}</span>}
              {current.tags.map((t) => (
                <span key={t} className="rules-detail-tag">{t}</span>
              ))}
            </div>
            <div className="rules-body" onClick={onDetailClick} dangerouslySetInnerHTML={safeHtml(detailHtml)} />
            {related.length > 0 && (
              <div className="rules-related">
                <div className="rules-related-title">相关词条</div>
                <div className="rules-hot">
                  {related.map((r) => (
                    <button key={r.id} type="button" className="chip" onClick={() => openEntry(r)}>{r.title}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SheetDialog>
      )}
    </div>
  );
}
