// 三份实现都必须在 typecheck 里被校验到。
// 单独 import 它们（而不是只 import @platform），否则改了接口却漏改一份实现时不会报错。
// 本文件不参与运行时逻辑，只做类型约束。
//
// 注意：三份实现都会进入**每一个**构建产物的类型检查范围，
// 但运行时只会解析其中一份（见 vite.config.ts 的 "@platform" alias）。

import type { Platform } from "./types";
import { platform as androidPlatform } from "./android";
import { platform as desktopPlatform } from "./desktop";
import { platform as webPlatform } from "./web";

export const PLATFORM_IMPLEMENTATIONS: readonly [Platform, Platform, Platform] = [
  webPlatform,
  desktopPlatform,
  androidPlatform,
];
