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
    transformIndexHtml(html: string) {
      if (!bundledFonts) {
        console.warn("[desktop] 未找到内置字体：" + fontsCss);
        console.warn("[desktop] 保留字体 CDN 链接（离线首次启动会回退系统字体）。");
        console.warn("[desktop] 需要离线可用请先执行：node desktop/scripts/fetch-fonts.mjs");
        return html;
      }
      const kept = html
        .split("\n")
        .filter((line) => !line.includes("fontsapi.zeoseven.com"))
        .join("\n");
      return kept.replace("</head>", '    <link rel="stylesheet" href="./fonts/chiron.css" />\n  </head>');
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
  plugins: isDesktop ? [react(), desktopAssets()] : [react()],
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
