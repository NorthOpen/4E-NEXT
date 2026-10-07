# 4E NEXT 安卓版（WebView 外壳）

安卓版是**网页端的离线打包**，不是第三个产品：UI、数据、导出逻辑全部复用 `web/` 的同一份源码，
外壳只替换和环境打交道的事。

与 `desktop/` 是**同一种架构**（自定义宿主 + 平台接缝 + 原生代发请求），
不是同一个技术栈，但设计规则一致——改之前先读一遍 `desktop/README.md`，两边能对照着看。

## 为什么是手写壳而不是 Capacitor

这是维护者拍板的选择（2026-10-06），理由记在这里免得以后反复：

| | 手写壳 + `WebViewAssetLoader` | Capacitor |
| --- | --- | --- |
| 与桌面端架构 | **同构**：自定义宿主、原生代发请求、响应头控制 | 另一套容器模型 |
| 存储/导出/同步谁写 | 自己写（本目录就是） | 插件现成，但 WebDAV 仍要自己写 |
| 对 CSP 的控制 | 完全可控（meta 注入） | 无公开 API 加自定义响应头 |
| 额外运行时 | 无 | 多一层容器 |

**最关键的一条**：`WebViewAssetLoader` 把 `assets/` 映射成
`https://appassets.androidplatform.net/` —— 一个**真实的 https 源**。
于是 secure context、同源 fetch、IndexedDB、SPA 路由全部正常，
不需要碰自定义 scheme（WebView 117 起自定义 scheme 无法改 URL path，
会直接打碎本应用的 history 路由）。

## 目录结构

```
android/
  settings.gradle.kts      仓库与插件解析
  build.gradle.kts         插件版本（AGP 8.13.2 / Kotlin 2.2.21）
  gradle.properties        Gradle 参数（不用改）
  gradlew(.bat)            构建入口
  local.properties         SDK 路径（本机专属，不入库）
  app/
    build.gradle.kts       模块配置：minSdk 31 / compileSdk 36 / 依赖版本
    src/main/
      AndroidManifest.xml  权限只有 INTERNET；导出走 FileProvider
      assets/www/          网页端构建产物（由 web 构建生成，不入库）
      java/ltd/banque/a4enext/
        App.kt               进程级单例（持有 NativeStore）
        MainActivity.kt      唯一的 Activity：返回键、安全区、落盘
        WebViewSetup.kt      WebView 装配 + 桥接 shim
        AndroidBridge.kt     @JavascriptInterface 桥（与 preload.js 同形）
        NativeStore.kt       本地文件存储 + 凭据加密
        NativeHttp.kt        OkHttp 代发请求（WebDAV 必需）
        NativeExporter.kt    导出 → 系统分享
        SmokeTest.kt         真机冒烟自检
      res/
        xml/network_security_config.xml   自签名证书信任策略
        xml/file_paths.xml                FileProvider 可分享目录
        values/{strings,colors,themes}.xml
        mipmap-*/                         启动图标：前景层 + 单色层 + 传统图标（脚本生成）
        mipmap-anydpi-v26|v33/            自适应图标描述（v33 多一层 monochrome）
  scripts/make-icon.mjs    生成启动图标（默认样式：品牌青底 + 白色 4E 字形）
```

**关键约束**：`android/` 里没有应用源码。想改界面就必须改 `web/`。

壳专属的版面补偿（安全区、状态栏留白）也是网页端代码，但**单独一个文件**：
`web/src/styles.android.css`。里面每条规则都带 `html[data-shell="android"]`，
而那个属性只有壳在 document-start 时才打上（见 `WebViewSetup.BRIDGE_SHIM`），
所以网页端、桌面端、iOS PWA 的版面与改动前逐像素相同。

## 平台接缝

三端只在 `web/src/platform/` 里不同：

| 能力 | 网页端 | 桌面端 | 安卓端 |
| --- | --- | --- | --- |
| 存储 | `localStorage`（约 5MB） | 应用数据目录 `storage.json` | 应用私有目录 `storage.json` |
| 字体 | CDN 分片按需下载 | 内置，完全离线 | **同一套内置分片，完全离线** |
| 另存为 | `<a download>` | 系统保存对话框 | **系统分享面板**（见下） |
| HTTP | `fetch` + CORS | 主进程 `net.fetch` | **原生 OkHttp**（见下） |
| 证书 | 浏览器警告页 | 按指纹询问信任 | `network_security_config`（见下） |

三条与桌面端**同形但实现不同**的：

### 存储：为什么不能用 localStorage

WebView 的 `localStorage` 每源 **10 MiB**（Chromium 源码
`kPerStorageAreaQuota = 10 * 1024 * 1024`），而且 **Android 会在低存储时回收 WebView 的
localStorage**——把人物卡放在那儿是在赌运气。

所以 `NativeStore` 走与桌面端同一条路：**启动时整份读进内存 → 同步读 → 防抖异步落盘**。
`PlatformStorage` 的接口是同步的，改成异步会牵动几十处调用点，网页端也得跟着改。

**凭据不明文落盘**：`4enext.webdav.v1` 的 `password` 与 `4enext.ai.v1` 的
`apiKey`/`apiKeys` 用 Android Keystore 里的 AES-GCM 密钥加密（对应桌面端的 safeStorage/DPAPI）。
契约与桌面端一致：渲染进程拿到的仍是明文；代价也一样——**换机器后需要重填一次**。

### HTTP：为什么必须走原生

**不是为了优化，是必需品。** 页面跑在 `https://appassets.androidplatform.net`，
对自建 WebDAV 是跨源；而 `PROPFIND` / `MKCOL` 是非简单方法，**必然触发 CORS 预检**。
绝大多数 WebDAV 服务端（Nextcloud / Apache mod_dav / nginx dav）**默认不返回
`Access-Control-Allow-Methods`**，于是同步直接不可用。

桌面端没这个问题（Electron 主进程发请求）。安卓端做的是同一件事：用 OkHttp 发，
把请求挪出 WebView。

> 注意：**`fetch()` 本身支持任意 HTTP 方法**，卡住的从来不是"方法白名单"，而是 CORS 预检。
> 这是个流传很广的误解，别照着它去排查。

### 证书：为什么是配置文件而不是弹窗

**Android 7（API 24）起，应用默认不信任用户自己安装的 CA。**
用户把自建 WebDAV 的证书装进手机，App 依然连不上——与"浏览器点一下继续"的直觉相反。

安卓 WebView **没有** Electron `setCertificateVerifyProc` 的等价物：
`onReceivedSslError` 只对当前这次请求生效，且会让信任模型退化成"每次问一遍"或"永久放行"。
而 `CertificatePinner` **解决不了这个问题**——OkHttp 源码写明 pinning 发生在
**TLS 握手成功之后**，自签名证书连第一步都过不去。

所以现在的做法是 `network_security_config.xml` 显式放行 `user` 信任域 + 一份导入 CA 的图文说明。
**零原生代码**。如果之后用户反馈"导 CA 太麻烦"，再考虑做按指纹的交互式信任
（＝把桌面端那套逻辑用 Kotlin 重写一遍，并把全部 WebDAV 流量继续留在原生侧）——
那是移植里最贵的一块，不要提前做。

### 导出：为什么是分享而不是另存为

**`<a download>` 在 Android WebView 里根本不工作**（不支持 `download` 属性，
`WebViewClient` 也没有默认下载实现）。四条导出路径（JSON / PNG / JPG / PDF）会全断。

现在的做法：写进应用私有 `cache/exports`，经 FileProvider 交给系统分享面板。
用户自己选存到「文件」、发微信还是进网盘。**不需要任何存储权限。**

> 局限（诚实写在这儿）：`startActivity` 之后拿不到"用户到底存没存"。
> 所以 `saveText`/`saveBlob` 返回的 `ok` 含义是"文件已生成并交给系统"，
> **不是**桌面端那种"用户点了保存"。调用方不要据此提示"已保存到 X"。
> 另外 `cache/` 可能被系统清理，所以每次导出都会重写一份，不依赖历史文件。

## 安全区与系统栏（状态栏 / 刘海 / 手势条）

**做过两次，第一次是错的**，所以这里把两条错路都记下来，免得第三次走回去：

| 做法 | 为什么不行 |
| --- | --- |
| `webView.setPadding(insets)` | WebView 的**网页视口不含 View 的 padding**：内边距只是 View 自己的空白区，Blink 仍然按整块 View 排版。真机表现是"内容照旧顶着状态栏"（0.3.4，SM-S9380） |
| 只靠 `env(safe-area-inset-*)` | Android WebView 的安全区**只覆盖刘海（display cutout）**，不含状态栏与手势条，这两个值是 0；而且网页端也只有少数几处用了它 |

现在的做法是**原生只负责量，网页端负责避让**：

1. `MainActivity` 在 `setOnApplyWindowInsetsListener` 里取 `systemBars()` 与
   `displayCutout()` 的**较大值**（横屏时刘海在左右，而 systemBars 的左右是 0），
   把物理像素换算成 CSS px（÷ density，不换算在高密度屏上会差 2–4 倍），
   写进 `AndroidBridge.safeAreaJson`；
2. shim 读 `safeInsets()`，把四个值挂成 `<html>` 上的 `--ae-inset-top/right/bottom/left`，
   并打上 `data-shell="android"`（document-start 与 DOMContentLoaded 各一次）；
3. `web/src/styles.android.css` 里那批 `html[data-shell="android"]` 规则据此让位：
   `.app` 让出上下左右、底部导航高度加上手势条、吸顶标签页的 `top` 从视口顶端下移，
   另有一条**固定留白条**盖住状态栏 —— 页面是文档滚动的，只靠 padding 一滚就会把内容卷到时间底下。

inset 变化时（旋转、手势条切换、折叠屏展开）主线程反向调用
`window.__4ENEXT_APPLY_SAFE_AREA__()` 让网页端重读一次，不需要重载页面。

**系统栏图标的明暗**同样只能由原生设置：网页端主题可切（设置页的「深色」），
`ThemeProvider` 在主题变化时通过 `setDarkTheme(dark)` 报给原生，
原生再设 `isAppearanceLightStatusBars/NavigationBars`。不联动的话，深色主题下
深色图标压在同为深色的界面上，时间和电量直接看不见。

> `safeInsets()` 与 `setDarkTheme()` **刻意不做 `fromApp()` 来源校验**（其余桥方法都做）：
> 两者都在页面渲染早期就被调用，那时 `pageIsOurs` 还没置位、又走不到主线程兜底，
> 加了守卫就等于恒不生效；而它们能暴露的只有"状态栏多高"和"换个图标明暗"，
> 既无用户数据也无能力，与存储 / 原生 HTTP / 导出不是一类。

## 构建

```bash
# 0) 一次性：Android SDK（platform-tools + platforms;android-36 + build-tools;36.0.0）
#    并在 android/local.properties 里写 sdk.dir，或设 ANDROID_HOME
#    以及内置字体（65MB / 1055 个分片，**不入库**：desktop/assets/fonts 在 .gitignore 里）：
node desktop/scripts/fetch-fonts.mjs

# 1) 渲染产物 -> android/app/src/main/assets/www/
pnpm --filter 4enext-web build:android

# 2) 启动图标（源图取自桌面版已做好的 icon.png，不重新渲染）
node android/scripts/make-icon.mjs

# 3) 出包
cd android
./gradlew assembleDebug      # 调试包
./gradlew assembleRelease    # 发布包（签名见下）

# 一步到位（含网页产物 + 复制成发布名 + SHA256 + 验签）：
pnpm release:android
```

> **内置字体那一步不能省。** 字体不入库，所以 CI 检出的工作区里是没有的；
> 少了它，web 构建会**静默**退回「保留字体 CDN 链接、跳过字体复制」那条分支——
> 包能装能跑、界面正常，只是**离线时没有正文字体**（0.3.5 第一次发布就是这么发出去的：
> Release 附件 23.4 MB，而正常产物是 87.9 MB，差的正是那 64.7MB 字体）。
> 因此打 tag 出包时 `make-release.mjs` 会带上 `--require-offline-fonts`，
> 缺字体直接失败；工作流里也有「取字体 + 缓存」两步（见 `.github/workflows/android-release.yml`）。

### 环境要求

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| JDK | 17+（实测 Temurin 21） | **`JAVA_HOME` 必须指向它** |
| Gradle | 8.14.3 | 由 wrapper 管理 |
| AGP | 8.13.2 | 见 `build.gradle.kts` |
| Kotlin | 2.2.21 | |
| compileSdk / targetSdk | 36 | |
| minSdk | **31（Android 12）** | 维护者定的下限 |

> **本机踩过的坑**：`PATH` 里的 `java.exe` 指向 Oracle 的转发器（JDK 11），
> 而 `JAVA_HOME` 是 Temurin 21。两者不一致时 Gradle 会用错 JDK。
> 构建前确认 `JAVA_HOME`，或直接 `./gradlew -Dorg.gradle.java.home=...`。

> **Gradle 分发包走镜像**：`gradle-wrapper.properties` 里的 `distributionUrl` 指向
> 腾讯云镜像。官方 `services.gradle.org` 实测被限速到 0.08 MB/s，131MB 要跑半个多小时。
> 换镜像后 19 秒。这是**刻意的偏离官方默认值**，不是笔误。

### 依赖版本不能随手升

`app/build.gradle.kts` 里的版本号是**查过 AAR 元数据后钉死的**。
每个 AndroidX/OkHttp 构件的 `aar-metadata.properties` 里有 `minCompileSdk` 与
`minAndroidGradlePluginVersion` 两条硬门槛，达不到就是构建期直接失败：

| 构件 | 版本 | 门槛 |
| --- | --- | --- |
| `androidx.core:core-ktx` | 1.18.0 | 1.19.1 需 AGP 9.1.0 ✗ |
| `com.squareup.okhttp3:okhttp` | 5.4.0 | 5.5.0 需 compileSdk 37 ✗ |
| `androidx.activity:activity` | 1.13.0 | minAGP 8.9.1 ✓ |
| `androidx.webkit:webkit` | 1.17.1 | minAGP 7.2.0 ✓ |

想升到最新版就必须连 AGP + Gradle + compileSdk 一起升到 9.x / 37，
那是有破坏性变更的一步，**值得单开一次改动来做，不要混在功能改动里**。

## 资源打包策略

| 类型 | 处理 | 理由 |
| --- | --- | --- |
| `woff2`（1055 个字体分片） | **不压缩** | WOFF2 本身已是 Brotli 压缩，再 Deflate 是零/负收益（实测 6 个真实分片反而变大 0.99%）；不压缩可从 APK 直接内存映射 |
| `json`（40MB 数据） | **保持压缩** | 能压到约 1MB，APK 直接少约 39MB 下载量；代价是读 19MB 的 `power.json` 要先解压进内存 |

实测产物（0.3.5）：release APK **87.9 MB**（debug 92.9 MB，差的是一份 debug 签名与未优化资源）。
其中字体 1055 个分片未压缩存储、`power.json` 19.9MB → 压缩后 3.1MB。

## 安全设计

壳比网页端多几个"能力"，也就多几条边界。这几条是刻意做的取舍，改 Kotlin 前请先读：

| 能力 | 风险 | 现在的处理 |
| --- | --- | --- |
| `addJavascriptInterface` 注册的桥 | 桥对 WebView 里**任何**页面可见；它背后是全部本地数据 + 一条原生网络通路（可探测内网）+ 文件导出 | **两道防线**：`WebViewClient.shouldOverrideUrlLoading` 阻止外部页面加载（主框架与 iframe 都挡）；`AndroidBridge.fromApp()` 再按 `webView.url` 复核一次，不是本应用页面一律拒绝。对应桌面端的 `isAppFrame` |
| `http:request`（原生代发请求） | 一旦被注入脚本，就是一条探测内网/本机的 SSRF 通道 | 同上两道防线；且入参只走 JSON、逐个请求头过滤掉 WebView 自管的 Host/Content-Length/Connection |
| 自签名证书放行 | 放行 `user` 信任域意味着**任何**用户装的 CA 都被信任，而不只是用户自己那台服务器 | 这是刻意的取舍：换来零原生代码。要收紧就得做按指纹的交互式信任，见上文「证书」一节。**注意此配置下证书透明度（CT）验证会被禁用** |
| 导出走的 FileProvider | 恶意内容若能触发导出，可把文件写到用户选定的位置 | 一律弹系统分享面板，用户取消即不写；导出目录限定在 `cache/exports`，且文件名做了路径分隔符过滤（`NativeExporter.sanitize`） |
| `cache/` 可能被系统清理 | 导出文件"看起来存了"其实没了 | 每次导出都重写一份，不依赖历史文件；且从不对用户说"已保存到 X"（见上文「导出」） |
| `storage.json` 里的凭据 | 明文落在应用私有目录 | 经 Android Keystore 的 AES-GCM 密钥加密后落盘（`password` → `passwordEnc`），渲染进程侧契约不变。**代价**：密文绑定本机密钥库，换机器需要重填一次 |
| 明文 HTTP | 用户自建 WebDAV 可能是 `http://` | `network_security_config` 的 base-config 是 `cleartextTrafficPermitted="false"`，WebView 侧则放宽到 `MIXED_CONTENT_COMPATIBILITY_MODE`——**两者不一致是有意的**：WebView 那条是为了让局域网里的 http WebDAV 能用，网络安全配置那条管的是原生 OkHttp。若将来要收紧，改这里并同步文档 |

这些是"改之前先读"的东西，不是可选项。

## WebDAV 协议契约自检（不需要真机）

```bash
pnpm test:webdav
```

起一个内存里的最小 WebDAV 服务端（Basic 认证 + MKCOL/GET/PUT/PROPFIND），
按 `web/src/lib/sync/webdav.ts` 的**真实调用序列**打一遍并断言状态码，
期望值直接取自那边的判断分支（201 已创建 / 405 已存在 / 409 父目录缺失 / 404 无文件 / 207 支持 PROPFIND / 401 认证失败）。

为什么单独测这一层：安卓端的 HTTP 是**原生代发**（OkHttp），与桌面端的主进程代发是两套实现，
协议契约只要有一处对不上，表现就是"同步静默失败"，而且**只在真机上才暴露**。
这个测试把其中"协议层对不对"的部分在没有设备的情况下验掉了。

也顺带验证一件容易踩的事：**自定义方法带空 body**——`webdav.ts` 发 MKCOL 时不带 body，
而 OkHttp 对标准方法（GET/HEAD）不允许带 body、对 MKCOL/PROPFIND 这类自定义方法是允许的，这条路径必须通。

这个测试已挂进 `deploy.yml`：三端共用同一份同步代码，改坏了会同时坏。

## 冒烟自检（需要真机或模拟器）

与桌面端的 `--smoke` 同形：在**真实外壳里**跑一遍关键能力，逐条打印 PASS/FAIL。

**一条命令跑完**（自动确认设备、清 logcat、装包、启动、收结果）：

```bash
pnpm smoke:android              # 装 debug 包自检
pnpm smoke:android --release    # 装 release 包自检（发布前应当跑这个）
pnpm smoke:android --apk <路径> # 指定任意 APK
```

> 为什么脚本要自己清 logcat：不清的话会把**上一轮**的结论一起读出来，
> 看起来像"这次通过了"——那比没有结论更危险。

手动跑（等价）：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n ltd.banque.a4enext/.MainActivity --ez smoke true
adb logcat -s 4enext-smoke
```

自检覆盖 13 项：资源加载、桥接注入、**版本号两端一致**（原生 BuildConfig vs 包体烘入的
`__APP_VERSION__`）、存储写读删与计数、`usage()` 形状、两份内嵌数据 fetch、
IndexedDB、React 渲染、离线字体（外部引用数必须为 0）、Material Symbols、安全区 viewport。

> 为什么值得写：界面能打开**不代表**桥接能用。存储、原生 HTTP、IndexedDB、字体加载
> 任何一件坏掉，界面都还是"看起来正常"，直到用户发现卡存不上。

## 与网页端/桌面端的数据互通

**三端经 WebDAV 互相同步**。存储契约与桌面端逐字节一致：
`storage.json` 里就是同一份 `SavedCard` / `HomebrewPool` / 同步文档 JSON。

`passwordEnc` / `apiKeyEnc` 这类**密文字段是各端本机的**（桌面是 DPAPI、安卓是 Keystore），
它们不参与同步——同步走的是渲染进程里的明文文档。所以密文格式不同不影响互通。

## 已知限制

1. **最低支持 Android 12（`minSdk 31`）**，更低版本不支持。
   **截至 0.3.4 已在真机上验证通过**：`pnpm smoke:android --release` 在
   Samsung SM-S9380（Android 16 / arm64-v8a）上 **23/23 通过**。
   0.3.5 只改了图标与安全区（自检探针随之变成 24 项），**真机复核尚未重跑** ——
   跑法没变，`pnpm smoke:android --release` 会自动挑 `android/release/` 里最新的包。
   完整验证清单、以及"真机上跑出来的三个 bug"（0.3.5 又补了三个，见该文件），见 `android/VERIFICATION.md`。
2. **未做按指纹的交互式证书信任**：自签名证书需要用户先把 CA 装进系统凭据库。
3. **导出无法回报"用户是否真的保存了"**（见上文「导出」一节）。
4. **返回键语义是"关闭当前浮层 / 再按一次退出"**，不是浏览器的历史后退——
   本应用没有用 History API 做视图切换（视图是 React state），
   所以返回键被翻译成一次合成的 Escape（见 `web/src/main.tsx`），
   复用各浮层本来就有的关闭逻辑，而不是另造一套导航栈。
5. 未做代码签名时 `assembleRelease` 会回落到 debug 签名，
   产物能装但不能用于正式分发（换签名后无法覆盖安装）。

## 签名与发布

> **要生成发布密钥库，请照 [SIGNING.md](SIGNING.md) 走。**
> 那边写清了「要做什么」与「必须记录什么」——尤其是**密钥丢失或口令遗忘就无法再更新应用**，
> 以及一旦用于正式发布，同一个 `applicationId` 就再也不能换密钥。
> 本节只讲代码侧怎么接。

签名配置按 **项目属性 → `local.properties` → 环境变量** 三级回落，都不入库：

```properties
# android/local.properties
keystore.path=../keystore/4enext-release.jks
keystore.password=...
keystore.alias=4enext
keystore.keyPassword=...
```

```bash
# 临时覆盖（不改文件）
./gradlew -Pkeystore.path=../keystore/4enext-release.jks assembleRelease
```

未配置签名时 release **回落到 debug 签名**并打印醒目警告——
包能装、能自测，但**不能用于正式分发**。

验证签名（**用 `apksigner` 而不是 `jarsigner`**，后者只做 v1）：

```bash
$ANDROID_HOME/build-tools/36.0.0/apksigner.bat verify --verbose --print-certs app-release.apk
```

`pnpm release:android` 已经内置了这一步：它会打印签名方案与证书 DN，
并在检出 debug 签名时明确警告。

> 顺序约束：若手动对齐，**`zipalign` 必须在 `apksigner` 之前**，不能反。

## 分发

**只发 GitHub Releases 的 APK，不上 Google Play。** 原因是内容授权而不是技术：
把第三方 wiki 文本与 D&D 4E 规则内容**打包进 APK** 与"网页上引用"的法律暴露面不同，
构成再分发而非引用（4E 规则文本从未以 OGL 或任何开放许可发布）。
这条需要项目负责人明确承担，详见根目录 `安卓版技术路径.md`。

技术上的附带结论：Play 对**仍以 APK 形式发布**的应用有 100MB 硬上限，
而本应用 payload 就有约 105MB，所以那条路本来也不通（AAB 可以，但先说清授权）。
