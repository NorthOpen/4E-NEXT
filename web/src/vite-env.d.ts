/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
/** 随包分发的 4e Wiki 数据（public/data/manifest.json）的录入时间，ISO 字符串；读不到时为空串。 */
declare const __DATA_WIKI_AT__: string;
/** 随包分发的 4e 万律数据（public/data/rules.json）的录入时间，ISO 字符串；读不到时为空串。 */
declare const __DATA_RULES_AT__: string;
/** 桌面端构建是否已把字体打进产物（见 web/vite.config.ts 的 desktopAssets 插件）。 */
declare const __DESKTOP_FONTS_BUNDLED__: boolean;
