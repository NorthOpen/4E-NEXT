import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "./package.json";

const here = dirname(fileURLToPath(import.meta.url));

// 构建目标：web（默认，部署到网页端） / desktop（Electron 外壳内嵌）
//
// 两者共用同一份源码，只在「平台接缝」处换实现（见 src/platform/）：
//   BUILD_TARGET=desktop 时 "@platform" 指向 src/platform/desktop.ts，
//   于是桌面包体里不含任何 localStorage / a[download] / fetch 的 CORS 代码，
//   网页包体里也不会含任何 IPC 代码。这是「桌面端不影响网页端」的结构保证。
const isDesktop = process.env.BUILD_TARGET === "desktop";

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
const fontsCss = resolve(desktopAssetsDir, "fonts", "chiron.css");
// 内置字体是否就绪（由 desktop/scripts/fetch-fonts.mjs 生成）。没就绪就退回 CDN，不让构建直接失败。
const bundledFonts = isDesktop && existsSync(fontsCss);

/**
 * 桌面端专属构建步骤：
 *   ① 把 index.html 里的字体 CDN 链接换成内置字体样式表；
 *   ② 把 desktop/assets（内置字体）复制进渲染产物。
 * 网页端不挂这个插件，index.html 与产物一个字节都不动。
 */
function desktopAssets(): Plugin {
  return {
    name: "4enext-desktop-assets",
    apply: "build",
    // order: "post" —— 必须排在 cspMeta 之后，才能把它注入的 meta 摘掉。
    // 桌面端的 CSP 改由 app:// 协议的响应头下发（desktop/main/main.js），那边要额外放行 app: 协议。
    transformIndexHtml: {
      order: "post",
      handler(html: string) {
        const withoutCsp = html
          .split("\n")
          .filter((line) => !line.includes('http-equiv="Content-Security-Policy"'))
          .join("\n");
        if (!bundledFonts) {
          console.warn("[desktop] 未找到内置字体：" + fontsCss);
          console.warn("[desktop] 保留字体 CDN 链接（离线首次启动会回退系统字体）。");
          console.warn("[desktop] 需要离线可用请先执行：node desktop/scripts/fetch-fonts.mjs");
          return withoutCsp;
        }
        const kept = withoutCsp
          .split("\n")
          .filter((line) => !line.includes("fontsapi.zeoseven.com"))
          .join("\n");
        return kept.replace("</head>", '    <link rel="stylesheet" href="./fonts/chiron.css" />\n  </head>');
      },
    },
    closeBundle() {
      // _headers 是给 Netlify / Cloudflare Pages 用的响应头配置，来自 web/public。
      // 网页端部署需要它，Electron 里它只是一个没人读的孤儿文件。
      rmSync(join(desktopRendererDir, "_headers"), { force: true });
      if (!existsSync(desktopAssetsDir)) return;
      cpSync(desktopAssetsDir, desktopRendererDir, { recursive: true });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: isDesktop ? [react(), cspMeta(), desktopAssets()] : [react(), cspMeta()],
  server: { port: 5173 },
  // 仅构建产物使用相对路径（可双击打开 dist/index.html、兼容子路径部署）；dev 保持绝对路径避免白屏
  base: command === "build" ? "./" : "/",
  resolve: {
    alias: {
      "@platform": resolve(here, isDesktop ? "src/platform/desktop.ts" : "src/platform/index.ts"),
    },
  },
  build: {
    // 桌面端产物直接落到外壳目录，网页端 dist/ 一个字节都不动
    outDir: isDesktop ? desktopRendererDir : resolve(here, "dist"),
    emptyOutDir: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // 桌面端用来判断「字体是否已内置」：内置则不再动态插入字体 CDN 链接
    __DESKTOP_FONTS_BUNDLED__: JSON.stringify(bundledFonts),
  },
}));
