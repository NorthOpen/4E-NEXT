// 桌面端渲染产物构建。
// 不用 cross-env：直接在这个 Node 进程里设环境变量，再调用 vite 的 JS API，
// 这样 Windows / macOS / Linux 上的 npm script 写法完全一致。
process.env.BUILD_TARGET = "desktop";

const { build } = await import("vite");

await build();
console.log("[build-desktop] 桌面端产物已输出到 desktop/renderer/");
