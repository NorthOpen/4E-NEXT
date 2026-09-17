// HTML 洗消器（白名单）：所有 dangerouslySetInnerHTML 的唯一入口。
//
// 为什么必须有这一层：
//   词条详情（entry.details / sourceText）可以来自三处**不可信**来源——
//     ① 用户导入的 .d4e 私设包（界面文案鼓励"导入朋友分享的包"）
//     ② WebDAV 同步下来的远端文档（共用目录 / 服务器被入侵）
//     ③ 本机历史数据（导入时没有校验过）
//   而 wikirender.ts 的 wikiToHtml() 是**原样放行 HTML** 的（这是官方数据的既有格式，
//   不能改成转义，否则怪物卡、表格、职业特性全部会变成代码文本）。
//   所以在"注入 DOM 的那一步"统一洗消：无论上游是谁拼的字符串，出这个口子之前都被过滤。
//
// 白名单依据：对 out/ 全量产物（21 个 JSON、42145 条含 HTML 的字符串）做过词频统计——
//   真实用到的标签只有 table/td/tr/th/div/span/b/br/a/p/caption/li/ul/ol/font/hr/i 这一小撮，
//   属性只有 class/colspan/style/href/id/bgcolor/rowspan/color/width，
//   链接 scheme **全部是相对路径或锚点**，内联事件处理器 **一个都没有**。
//   因此下面的白名单在不影响任何现有渲染的前提下，把执行类构造全部挡在外面。
//
// 性能：洗消结果按输入字符串缓存，并且连 { __html } 对象一起缓存——
//   对象标识稳定，React 才不会每次渲染都重新设置 innerHTML（角色卡面板会高频重渲染）。

/** 出现即连内容一起删除：这些标签本身就是执行/加载/表单构造 */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "param",
  "form", "input", "button", "select", "option", "optgroup", "textarea",
  "base", "link", "meta", "title", "template", "noscript",
  "svg", "math", "audio", "video", "source", "track", "portal", "canvas",
]);

/** 允许保留的标签。结构类标签一律放行（它们只是盒子），以不改变现有版式为准 */
const ALLOWED_TAGS = new Set([
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "div", "span", "p", "b", "strong", "i", "em", "u", "s", "strike", "del", "ins", "mark", "small", "big",
  "br", "hr", "a", "img", "font", "center",
  "ul", "ol", "li", "dl", "dt", "dd",
  "h1", "h2", "h3", "h4", "h5", "h6", "sup", "sub", "code", "pre", "blockquote",
  "details", "summary", "figure", "figcaption", "section", "article", "aside", "header", "footer", "main", "nav",
]);

/** 属性白名单（data-* / aria-* 另行放行） */
const ALLOWED_ATTRS = new Set([
  "class", "title", "colspan", "rowspan", "scope", "headers",
  "width", "height", "align", "valign", "border", "cellpadding", "cellspacing",
  "bgcolor", "color", "face", "size",
  "role", "tabindex", "alt", "loading", "start", "reversed", "open",
  // 下面两个由本模块自己写入（外链新窗口 + 不带 referrer），列入白名单是为了保证幂等
  "target", "rel",
]);

/** 带链接语义的属性：值必须过 scheme 白名单 */
const URL_ATTRS = new Set(["href", "src"]);

/** 样式里禁止出现的写法（能发请求 / 能覆盖全屏伪造界面的构造） */
const STYLE_DENY = /url\s*\(|expression\s*\(|@import|behavior\s*:|binding\s*:|-moz-binding|position\s*:\s*(fixed|absolute|sticky)/i;

/** 归一化 URL 里的混淆写法（控制字符与空白；HTML 实体已由 DOMParser 解码） */
function normalizeUrl(raw: string): string {
  return raw.replace(/[\u0000-\u0020\u007f]+/g, "");
}

/**
 * URL 是否安全。允许：相对路径、锚点、https、mailto、tel，以及 img 的 data:image。
 * 拒绝：javascript: / vbscript: / file: / blob: / data:text/html / http（https 站点本来也会被混合内容拦掉）。
 */
function isSafeUrl(raw: string, allowDataImage: boolean): boolean {
  const s = normalizeUrl(raw);
  if (s === "" || s.startsWith("#")) return true;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return true; // 相对路径
  if (/^http:/i.test(s)) return false;
  if (/^https:/i.test(s)) return true;
  if (/^(mailto|tel):/i.test(s)) return true;
  if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp|bmp|avif|svg\+xml)[;,]/i.test(s)) return true;
  return false;
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function cleanAttrs(el: Element, tag: string): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    // 事件处理器（onerror/onload/onclick…）一律删除。
    // id 也删除：页面里有 getElementById("equip-g-…") 的滚动定位，内容里的 id 可以把它顶掉。
    if (name.startsWith("on") || name === "id" || name === "srcdoc") {
      el.removeAttribute(attr.name);
      continue;
    }

    if (name === "style") {
      if (STYLE_DENY.test(value)) el.removeAttribute(attr.name);
      continue;
    }

    if (URL_ATTRS.has(name)) {
      const allowData = name === "src" && tag === "img";
      if (!isSafeUrl(value, allowData)) {
        el.removeAttribute(attr.name);
        continue;
      }
      continue;
    }

    if (name.startsWith("data-") || name.startsWith("aria-")) continue;
    if (!ALLOWED_ATTRS.has(name)) el.removeAttribute(attr.name);
  }

  // 外链统一新窗口打开且不带 referrer（必须在属性循环之后设，否则会被循环当成未知属性删掉）
  if (tag === "a") {
    const href = el.getAttribute("href");
    if (href && /^https:/i.test(normalizeUrl(href))) {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noreferrer noopener");
    } else {
      el.removeAttribute("target");
      el.removeAttribute("rel");
    }
  } else {
    el.removeAttribute("target");
    el.removeAttribute("rel");
  }
}

/** 自底向上清理：先处理完子树，再处理节点自身，脱壳时移上去的孩子已经是干净的 */
function walk(el: Element): void {
  for (const child of Array.from(el.children)) {
    walk(child);

    const tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      child.remove();
      continue;
    }
    // 非白名单标签：脱掉外壳保留文字（TiddlyWiki 宏残留 <item-level-14>、<list-links> 之类走这条）
    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(child);
      continue;
    }
    cleanAttrs(child, tag);
  }
}

const cache = new Map<string, string>();
const objectCache = new Map<string, { __html: string }>();
const CACHE_MAX = 4000;

/** 洗消一段 HTML；空输入返回空串。 */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  // 没有尖括号的纯文本直接返回，省掉一次 DOM 解析（角色卡里绝大多数字段走这条）
  if (html.indexOf("<") < 0) return html;

  const hit = cache.get(html);
  if (hit !== undefined) return hit;

  let out: string;
  try {
    // DOMParser 生成的是惰性文档：不执行脚本、不加载图片，可以安全遍历
    const doc = new DOMParser().parseFromString(html, "text/html");
    walk(doc.body);
    out = doc.body.innerHTML;
  } catch {
    // 解析异常时宁可退化成纯文本，也不原样放行
    out = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(html, out);
  return out;
}

/**
 * 直接产出 React 的 dangerouslySetInnerHTML 入参。
 * { __html } 对象一并缓存，保证同一段内容在多次渲染里是同一个引用。
 */
export function safeHtml(html: string | null | undefined): { __html: string } {
  const key = html ?? "";
  const hit = objectCache.get(key);
  if (hit) return hit;
  const obj = { __html: sanitizeHtml(key) };
  if (objectCache.size >= CACHE_MAX) objectCache.clear();
  objectCache.set(key, obj);
  return obj;
}
