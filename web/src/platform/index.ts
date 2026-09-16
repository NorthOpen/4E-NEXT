// 默认解析到网页端实现。
// 桌面构建时 vite 会把 "@platform" alias 指到 ./desktop.ts（见 web/vite.config.ts），
// 因此桌面包体里不会包含任何 localStorage 代码，网页包体里也不会包含任何 IPC 代码。

export { platform } from "./web";
export type * from "./types";
