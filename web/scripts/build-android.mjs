// 安卓端渲染产物构建。
// 与 build-desktop.mjs 同形：不用 cross-env，直接在这个 Node 进程里设环境变量，
// 再调用 vite 的 JS API，这样 Windows / macOS / Linux 上的 npm script 写法完全一致。
process.env.BUILD_TARGET = "android";

const { build } = await import("vite");

await build();
console.log("[build-android] 安卓端产物已输出到 android/app/src/main/assets/www/");
