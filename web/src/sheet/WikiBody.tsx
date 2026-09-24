import { useMemo, type ReactNode } from "react";
import type { Entry } from "../data/types";
import { tokenizeWikiBody } from "../lib/wikirender";
import { safeHtml } from "../lib/sanitize";
import { SmartHover } from "./SmartHover";

// 正文中的「中文 English」名称对（如「大气精魂 Air Spirit」「召唤自然盟友 Summon Natural Ally」）：
// 在中文与英文之间插入 <br/>，使英文排在中文下方，且中间无空行。
// 仅当英文直接后接中文/中文标点/行尾时触发，避免把「力量 Strength 调整值」这类句中英文术语误切。
export function enBreak(html: string): string {
  return html.replace(
    // 中文短语 + 空格 + 英文词（1~4 词）。仅在英文直接后接中文/中文标点或行尾时换行，
    // 避免把「力量 Strength 调整值」这类英文后带空格的句中术语误切。
    /([\u4e00-\u9fff·、]{1,}) ([A-Za-z][A-Za-z'’\-]{1,}(?: [A-Za-z'’\-]{1,}){0,3})(?=[\u4e00-\u9fff]|[\u3000-\u303f，。；！？、：“”‘’]|$)/g,
    "$1<br/>$2",
  );
}

/**
 * 词条正文渲染：保留换行/表格，并把 [[威能]]、[[专长]] 等超链接转为悬浮卡片预览。
 * - `pop` 由调用方注入（车卡传 EntryCard，私设预览传对应卡片），避免 WikiBody ↔ EntryCard 互相 import；
 * - `portal` 供位于 overflow 容器内（如私设预览栏）的场景使用，弹出层改为 fixed 定位不被裁剪。
 */
export function WikiBody({ body, fields, lookup, indent, pop, portal }: {
  body: string;
  fields: Record<string, string>;
  lookup: (target: string) => Entry | undefined;
  pop?: (e: Entry) => ReactNode;
  indent?: boolean;
  portal?: boolean;
}) {
  const tokens = useMemo(() => tokenizeWikiBody(body, fields, indent), [body, fields, indent]);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "link") {
          const entry = lookup(t.target);
          if (!entry || !pop) return <span key={i} className="wiki-ref-plain">{t.alias}</span>;
          return <SmartHover key={i} className="wiki-ref" popClass="wiki-ref-pop" portal={portal} pop={pop(entry)}>{t.alias}</SmartHover>;
        }
        if (t.kind === "html") return <div key={i} className="wiki-html" dangerouslySetInnerHTML={safeHtml(enBreak(t.html))} />;
        return <span key={i} dangerouslySetInnerHTML={safeHtml(enBreak(t.html))} />;
      })}
    </>
  );
}