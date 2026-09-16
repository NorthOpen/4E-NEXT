// 两份实现都必须在 typecheck 里被校验到。
// 单独 import 它们（而不是只 import @platform），否则改了接口却漏改一份实现时不会报错。
// 本文件不参与运行时逻辑，只做类型约束。

import type { Platform } from "./types";
import { platform as desktopPlatform } from "./desktop";
import { platform as webPlatform } from "./web";

export const PLATFORM_IMPLEMENTATIONS: readonly [Platform, Platform] = [webPlatform, desktopPlatform];
