import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "./package.json";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 读一份产物的 generatedAt（管线各步写下的时间戳），路径相对 web/ 解析。
 *
 * 不读文件 mtime：mtime 每次 git checkout 都会变，读出来是个没有意义的「刚刚」。
 * 读不到（本地没跑过管线 / 数据文件未生成）时返回空串，界面显示「未知」，构建照常进行。
 */
function generatedAtOf(relPath: string): string {
  try {
    const raw = readFileSync(resolve(here, relPath), "utf8");
    const parsed = JSON.parse(raw) as { generatedAt?: unknown };
    return typeof parsed.generatedAt === "string" ? parsed.generatedAt : "";
  } catch {
    return "";
  }
}

/**
 * 随包分发的 4e Wiki 数据是什么时候录入的（设置页「致谢」展示，用来判断该不该重跑管线）。
 *
 * 优先取 canonical 的 _meta.json：那是「把 data/ 里那份 wiki 快照解析成规范数据」的时刻，
 * 也就是「这批内容是什么时候录进来的」。manifest.json 的戳是索引步写下的，
 * 只跑 normalize 不跑 index 时会停在更早的一次 —— 实际出现过分叉（canonical 08-21 / manifest 08-19），
 * 那种情况下 manifest 会少报几天。canonical 读不到时回落到 manifest。
 */
const WIKI_DATA_AT = generatedAtOf("../out/canonical/_meta.json") || generatedAtOf("public/data/manifest.json");

/** 4e 万律数据（万律书单文件 TW5 词条化产物）的录入时间；万律没有 canonical 层，直接取产物自己的戳。 */
const RULES_DATA_AT = generatedAtOf("public/data/rules.json");

// 构建目标：web（默认，部署到网页端） / desktop（Electron 外壳内嵌） / android（安卓 WebView 壳内嵌）
//
// 三者共用同一份源码，只在「平台接缝」处换实现（见 src/platform/）：
//   BUILD_TARGET=desktop 时 "@platform" 指向 src/platform/desktop.ts，
//   BUILD_TARGET=android 时指向 src/platform/android.ts，
//   于是各自的包体里不含另外两个平台的代码。这是「一个平台不影响另一个」的结构保证。
const buildTarget = process.env.BUILD_TARGET ?? "web";
const isDesktop = buildTarget === "desktop";
const isAndroid = buildTarget === "android";

/**
 * 内容安全策略（网页端）。
 *
 * 这里是三份 CSP 的"基准版"，另外两份必须与它保持一致：
 *   · web/public/_headers —— Cloudflare Pages / Netlify 下发真实响应头（frame-ancestors 只在响应头里生效）
 *   · desktop/main/main.js —— 桌面端由 app:// 协议的响应头下发，额外放行 app:
 * 这份 meta 的价值在于 GitHub Pages：它不读 _headers，只有 meta 能兜住。
 *
 * 为什么不写在 index.html 里：vite dev 会注入内联的 React Refresh 预置脚本，
 * script-src 'self' 会把它拦掉，开发时整页白屏。所以只在 build 阶段注入。
 *
 * 各指令的依据：
 *   script-src 'self'   —— 词条正文里的内联事件处理器（onerror= 之类）即便混进 DOM 也不会执行，
 *                          这是 lib/sanitize.ts 之外的第二道防线；
 *   style-src           —— 需要 'unsafe-inline'：官方词条正文有 700+ 处 style="…" 排版属性；
 *   connect-src         —— 放开 https/http：WebDAV 同步地址由用户自填，无法预先枚举；
 *   img-src blob:data:  —— 立绘裁切与 html-to-image 导出用得到。
 */
const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fontsapi.zeoseven.com; " +
  "font-src 'self' data: https://fontsapi.zeoseven.com; " +
  "img-src 'self' data: blob: https:; " +
  "connect-src 'self' https: http:; " +
  "media-src 'self' data: blob:; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'none'; " +
  "frame-ancestors 'none'";

/** build 期把 CSP 注入 index.html（dev 不注入，见上面说明） */
function cspMeta(): Plugin {
  return {
    name: "4enext-csp",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler(html: string) {
        // 缩进跟随原 </head> 那一行，产物里看起来才和手写的一样
        return html.replace("</head>", '<meta http-equiv="Content-Security-Policy" content="' + CSP + '" />\n  </head>');
      },
    },
  };
}

const desktopAssetsDir = resolve(here, "../desktop/assets");
const desktopRendererDir = resolve(here, "../desktop/renderer");
const androidAssetsDir = resolve(here, "../android/app/src/main/assets/www");
const fontsCss = resolve(desktopAssetsDir, "fonts", "chiron.css");
// 内置字体是否就绪（由 desktop/scripts/fetch-fonts.mjs 生成）。没就绪就退回 CDN，不让构建直接失败。
// 安卓端复用同一份字体：桌面端已经抓好并校验过，没必要再抓一遍（64.7MB）。
const bundledFonts = (isDesktop || isAndroid) && existsSync(fontsCss);

/**
 * 「离线壳」专属构建步骤（桌面端与安卓端共用同一套逻辑）：
 *   ① 把 index.html 里的字体 CDN 链接换成内置字体样式表；
 *   ② 把 desktop/assets（内置字体）复制进产物目录。
 * 网页端不挂这个插件，index.html 与产物一个字节都不动。
 *
 * 两端的差异只有三处，都由参数给出：产物目录、日志前缀、是否需要 viewport-fit=cover。
 */
function shellAssets(opts: { label: string; outDir: string; fetchFontsHint: string; viewportCover: boolean }): Plugin {
  return {
    name: "4enext-" + opts.label + "-assets",
    apply: "build",
    // order: "post" —— 必须排在 cspMeta 之后，才能把它注入的 meta 摘掉。
    // 桌面端的 CSP 改由 app:// 协议的响应头下发（desktop/main/main.js），那边要额外放行 app: 协议。
    // 安卓端由 WebView 加载本地资源，同样拿不到自定义响应头，改由 index.html 的 meta 兜住——
    // 所以安卓**保留** cspMeta 注入的那条 meta，只有桌面端摘掉。
    transformIndexHtml: {
      order: "post",
      handler(html: string) {
        let out = html;
        if (isDesktop) {
          out = out
            .split("\n")
            .filter((line) => !line.includes('http-equiv="Content-Security-Policy"'))
            .join("\n");
        }
        if (opts.viewportCover) {
          // 刘海屏/手势条：让页面铺满整屏，再由 CSS 的 env(safe-area-inset-*) 自己避让。
          // 不给 viewport-fit=cover 的话，安全区 inset 恒为 0，内容会被刘海压住。
          out = out.replace(
            /<meta\s+name="viewport"[^>]*>/i,
            '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
          );
        }
        if (!bundledFonts) {
          console.warn("[" + opts.label + "] 未找到内置字体：" + fontsCss);
          console.warn("[" + opts.label + "] 保留字体 CDN 链接（离线首次启动会回退系统字体）。");
          console.warn("[" + opts.label + "] 需要离线可用请先执行：" + opts.fetchFontsHint);
          return out;
        }
        const kept = out
          .split("\n")
          .filter((line) => !line.includes("fontsapi.zeoseven.com"))
          .join("\n");
        return kept.replace("</head>", '    <link rel="stylesheet" href="./fonts/chiron.css" />\n  </head>');
      },
    },
    closeBundle() {
      // _headers 是给 Netlify / Cloudflare Pages 用的响应头配置，来自 web/public。
      // 装进壳里它只是一个没人读的孤儿文件。
      rmSync(join(opts.outDir, "_headers"), { force: true });
      if (!existsSync(desktopAssetsDir)) return;
      cpSync(desktopAssetsDir, opts.outDir, { recursive: true });
    },
  };
}

const desktopAssets = () =>
  shellAssets({
    label: "desktop",
    outDir: desktopRendererDir,
    fetchFontsHint: "node desktop/scripts/fetch-fonts.mjs",
    viewportCover: false,
  });

const androidAssets = () =>
  shellAssets({
    label: "android",
    outDir: androidAssetsDir,
    fetchFontsHint: "npm --prefix desktop run fetch-fonts",
    viewportCover: true,
  });

export default defineConfig(({ command }) => ({
  plugins: isDesktop
    ? [react(), cspMeta(), desktopAssets()]
    : isAndroid
      ? [react(), cspMeta(), androidAssets()]
      : [react(), cspMeta()],
  server: { port: 5173 },
  // 仅构建产物使用相对路径（可双击打开 dist/index.html、兼容子路径部署）；dev 保持绝对路径避免白屏
  base: command === "build" ? "./" : "/",
  resolve: {
    alias: {
      "@platform": resolve(
        here,
        isDesktop ? "src/platform/desktop.ts" : isAndroid ? "src/platform/android.ts" : "src/platform/index.ts",
      ),
    },
  },
  build: {
    // 桌面端/安卓端产物直接落到各自的外壳目录，网页端 dist/ 一个字节都不动
    outDir: isDesktop ? desktopRendererDir : isAndroid ? androidAssetsDir : resolve(here, "dist"),
    emptyOutDir: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // 下面两个「字体是否已内置」的常量必须**在三种构建里都定义**：
    // src/platform/_impls.ts 会把三份实现都 import 进来做类型校验，
    // 只在单一目标下 define 的话，另外两种构建会在求值时报 ReferenceError。
    // 取值本身只对各自的壳有意义（网页端恒为 false）。
    __DESKTOP_FONTS_BUNDLED__: JSON.stringify(bundledFonts),
    __ANDROID_FONTS_BUNDLED__: JSON.stringify(bundledFonts),
    // 设置页「致谢」展示的数据录入日期（见上面的 dataGeneratedAt）
    __DATA_WIKI_AT__: JSON.stringify(WIKI_DATA_AT),
    __DATA_RULES_AT__: JSON.stringify(RULES_DATA_AT),
  },
}));
