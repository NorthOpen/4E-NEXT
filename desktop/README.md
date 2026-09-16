# 4E NEXT 桌面离线版（Electron 外壳）

桌面版是**网页端的离线打包**，不是第二套应用：UI、数据、导出逻辑全部复用 `web/` 的同一份源码，
外壳只替换和环境打交道的事。

## 目录结构

```
web/                     唯一的应用源码（网页端 + 桌面端共用）
  src/platform/          平台接缝：两个实现 + 一份接口
    types.ts             接口定义（两端共用，typecheck 同时校验两份实现）
    web.ts               浏览器实现（localStorage / a[download] / fetch / CDN 字体）
    desktop.ts           Electron 实现（经 preload 桥转发 / 内置字体）
    index.ts             默认解析到 web.ts
    _impls.ts            让两份实现都进入 typecheck 的类型锚点
  vite.config.ts         BUILD_TARGET=desktop 时：切实现、换字体、复制 desktop/assets

desktop/                 外壳：不含任何 UI 代码
  main/main.js           主进程：app:// 协议、数据文件、保存对话框、主进程 HTTP、证书询问
  preload/preload.js     预加载层：把主进程能力以同步 API 暴露给渲染进程
  build/icon-keyed.png   图标源：favicon.svg 在洋红底上的 1024×1024 渲染
  build/icon.png         应用图标（透明背景的青色标记，打包时写入 exe 资源）
  assets/fonts/          内置字体（抓取生成，不入库）
  scripts/               取 Electron 运行时 / 抓字体 / 生成图标 / 组装便携版
  renderer/              由 web 构建生成（不入库）
  release/               打包产物（不入库）
```

**关键约束**：`desktop/` 里没有应用源码。想改界面就必须改 `web/`，改了会立刻体现在网页端构建里——
用目录结构堵死「桌面端悄悄分叉」。

## 依赖安装：desktop 不进 pnpm workspace

`desktop/` **刻意不是 pnpm workspace 成员**（`pnpm-workspace.yaml` 里只有 web）。原因是它依赖
electron（约 100MB 二进制）+ electron-builder，加进 workspace 会有两个后果：

1. 网页端的 CI（`deploy.yml` 里的 `pnpm install --frozen-lockfile`）每次都要顺带下载 Electron；
2. workspace 一变，`pnpm-lock.yaml` 就必须同步更新，否则 CI 会以
   `ERR_PNPM_OUTDATED_LOCKFILE` 直接失败，**网页端部署整条挂掉**。

所以桌面端用自己的 npm 装依赖：

```bash
npm --prefix desktop install
```

外壳没有任何运行时依赖（主进程只用 electron 与 Node 内置模块），只有两个 devDependencies，
`desktop/package-lock.json` 已入库，安装结果可复现。

## 平台接缝

两端只在这些地方不同，全部收在 `web/src/platform/`：

| 能力 | 网页端（web.ts） | 桌面端（desktop.ts） |
| --- | --- | --- |
| 存储 | `localStorage`（约 5MB 配额） | 应用数据目录下的 `storage.json`（不受配额限制） |
| 字体 | Chiron 分片，从 CDN 按需下载 | 同一套 Chiron 分片内置，**完全离线可用** |
| 另存为 | `<a download>` | 系统保存对话框，记住上次目录 |
| HTTP | `fetch`，受 CORS 约束 | 主进程 `net.fetch` 直连，**不需要服务端开 CORS** |
| 证书 | 浏览器警告页 | 弹窗询问是否信任（自建 WebDAV 常用自签名证书） |

**存储契约**：接缝只换「键值放在哪里」，不换「存什么」。
`SavedCard` / `HomebrewPool` / 同步文档的 JSON 结构两端逐字节一致，
所以网页端与桌面端之间可以经 WebDAV 互相同步。
图片压缩预算（`IMAGE_BUDGET`）也刻意两端保持一致——桌面端放宽会让同步过去的卡撑爆网页端配额。

## 内置字体

网页版从 ZeoSeven CDN 取 Chiron 字体（`fontsapi.zeoseven.com/546` 衬线、`/547` 无衬线），
由 cn-font-split 按 unicode-range 切成大量小分片，浏览器只下载页面真正用到的字所在的分片。
桌面版不能依赖网络，所以把**同一套分片**整包封进产物——字形与网页版完全一致。

```bash
npm --prefix desktop run fetch-fonts            # → desktop/assets/fonts/（1055 个分片，64.7 MB）
npm --prefix desktop run fetch-fonts -- --force # 重新拉 CSS 并重新下载全部分片
```

脚本做四件事：

1. 拉 546 / 547 两张 `result.css`；
2. **只取 `@font-face` 块**，丢掉其余规则——上游以后若加了全局 body 字体规则，静态引入会盖掉
   `html[data-font]` 的切换逻辑；
3. 把 `url("./xxx.woff2")` 改写成 `url("./sung/xxx.woff2")` 并下载（并发 16，已存在的分片跳过）；
4. 输出 `chiron.css`，头部保留上游的版权与 OFL 授权声明。

上游 CSS 用指纹 `SOURCE_ID` 标识；改抓取逻辑时同步改它，下次运行会自动重拉。

> **踩过的坑**：上游 CSS 开头的授权声明本身就是一段 `/* ... */`。把它原样嵌进我们自己的注释里，
> 它自带的 `*/` 会提前闭合外层注释，后面整段变成非法 CSS。脚本里已剥掉它的注释定界符。

族名本来就叫 `Chiron Sung HK VF` / `Chiron Hei HK VF`，与 `styles.css` 一致，不需要改写。
字体没抓到时不阻断构建：vite 插件会保留 CDN 链接并打印警告，同时在产物里
把 `__DESKTOP_FONTS_BUNDLED__` 置为 false，让 `desktop.ts` 继续按 CDN 方式加载无衬线体。

## 图标

图标就是网页版的 favicon 本身：**透明背景、无圆角、只有那个青色标记**（`#00838f`，取自
`web/public/favicon.svg` 的 fill），与网页版视觉一致。

```bash
npm --prefix desktop run make-icon
```

制作分两步，原因是一个容易踩的坑：**无头 Chrome 截图不保留透明通道**——页面背景透明的区域会被
填成白色（实测占画布 31.7%）。所以：

1. 先在**洋红 `#ff00ff` 底**上渲染 `favicon.svg`，得到 `build/icon-keyed.png`（1024×1024，已入库）；
2. `make-icon.mjs` 把洋红抠成 alpha，输出 `build/icon.png`（RGBA，透明背景）。

选洋红做键色是因为它与 `#00838f` 在**绿色通道**上相距最远（0 对 131），而标记是纯色平涂，
于是可以逐像素精确反解 alpha：`alpha = G / 131`。抗锯齿边缘因此能被完整还原，
不会出现锯齿或彩色描边。端点值从图里实测而不是写死，以防截图管线带来色彩偏移。

脚本自带 PNG 解码/编码（`node:zlib`），因为构建环境里没有 sharp / canvas 这类图像库。

输出实测：63.0% 实心 / 36.4% 透明 / 0.6% 抗锯齿。打进 exe 的 `.ico` 含 7 个尺寸（16~256），
全部为带 alpha 的 RGBA。

> **exe 图标是个坑**：图标写在 PE 文件的资源段里，把 `electron.exe` 改名成 `4E NEXT.exe`
> **不会**换掉它（任务栏会显示 Electron 默认图标）。必须经 electron-builder 打包，
> 它会用 rcedit 改写资源。所以 `pack:portable` 是从 electron-builder 的 `--dir` 产物复制，
> 而不是自己解压 Electron 压缩包。

## 构建

```bash
# 0) 一次性：取 Electron 运行时 + 抓内置字体
npm --prefix desktop run fetch-electron
npm --prefix desktop run fetch-fonts

# 1) 桌面端渲染产物 -> desktop/renderer/
pnpm --filter 4enext-web build:desktop

# 2) 直接运行外壳（开发调试；菜单「视图 → 开发者工具」）
npm --prefix desktop run start

# 3) 外壳冒烟自检：在真实 Electron 环境里跑一遍关键能力并打印 PASS/FAIL
npm --prefix desktop run smoke

# 4) 出包
npm --prefix desktop run dist            # 安装程序 + release/win-unpacked
npm --prefix desktop run pack:portable   # 免安装便携版（含 zip）
```

网页端构建完全不受影响：`pnpm --filter 4enext-web build` 仍然只产出 `web/dist`。

### 构建环境注意事项

- **首次安装依赖**：Electron 二进制约 100MB。国内网络建议配镜像，并把下载缓存留在仓库外：
  ```bash
  export CI=true
  export ELECTRON_CACHE="$PWD/.electron-cache"
  export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
  export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
  ```
- **不要把 `ELECTRON_BUILDER_CACHE` 指向仓库内部**。仓库根 `package.json` 有 `"type": "module"`，
  缓存目录一旦落在仓库里，electron-builder 的 CJS 工具脚本（如图标转换）会被当成 ESM 解析而崩溃。
  默认位置（用户目录）没有这个问题。
- **受限/沙箱环境**：Electron 启动必须创建 mojo 命名管道做进程间通信，
  在禁止命名管道的沙箱里会直接 `FATAL ... platform_channel.cc: Access denied` 退出；
  Vite 构建也需要 esbuild 以管道 stdio 启动服务进程，同样会被拒。
  这两件事都必须在正常（非受限）环境里做。

## 打包产物

| 产物 | 命令 | 说明 |
| --- | --- | --- |
| `release/4E-NEXT-<version>-setup.exe` | `dist` | NSIS 安装程序 |
| `release/win-unpacked/` | `dist` | 安装包实际部署的内容，可直接运行 |
| `release/4E-NEXT-<version>-win-x64-portable.zip` | `pack:portable` | 免安装便携版（带 `portable.txt`，数据写在旁边） |

## 数据放在哪

- **便携模式**：程序目录里有 `portable.txt` 时，数据写在同目录的 `data/` 里。
- **常规模式**：没有 `portable.txt` 时写在系统应用数据目录（Windows 为 `%APPDATA%\4E NEXT`）。
- 卸载/删除文件夹都不会动用户数据；升级只要替换程序目录里的文件。

## 桌面端特有的行为

- **存储文案**：私设页的存储板块显示「本地数据文件」而不是「浏览器缓存」，不再写死 5MB 上限。
- **写入失败提示**：磁盘写失败由主进程回报，走和网页端配额写满同一条提示链路，同样不静默。
- **窗口**：默认 1440×900、最小 1024×720，退出时记住尺寸与位置。
- **外链**：一律交给系统浏览器打开，不在应用窗口里加载网页。
- **同步提示**：桌面端连不上 WebDAV 时不会再提示「请配置 CORS」——桌面端本来就不受跨域限制。
- **单实例**：重复启动会聚焦已有窗口，不会开出第二个实例同时写数据文件。

## 体积构成

装完约 432 MB：

| 部分 | 大小 | 说明 |
| --- | --- | --- |
| Electron 运行时 | ~313 MB | 已裁掉 53 个用不到的语言包（见下） |
| 内置 Chiron 字体（1055 个分片） | 64.7 MB | 与网页版同源，离线可用 |
| 内嵌 4E Wiki 数据（`power.json` 单个 19MB） | 40.6 MB | 全部资源分类 |
| 前端资源（JS/CSS/图标字体） | 6.1 MB | |

其余可选的瘦身方向：按实际语料裁剪字体分片集，或让用户首次联网时按需缓存。

## 打包体积上的取舍

出包前已经剔掉三处确定的冗余，改动都固化在配置里，不会再长回来：

| 冗余 | 处理 | 收益 |
| --- | --- | --- |
| Electron 自带 55 种语言包 | `electron-builder.yml` 里 `win.electronLanguages: [zh-CN, en-US]` | 48.3 MB → 1.1 MB |
| `renderer/_headers` | 网页端托管配置（Netlify / CF Pages 响应头），desktop 构建时删掉 | 桌面端无用 |
| 便携版暂存目录 | 打完 zip 即删（要保留加 `--keep-stage`） | 约 432 MB |

刻意保留的东西：`LICENSES.chromium.html`（19.5 MB）是 Chromium / Electron 的 OSS 署名文件，
BSD 类许可证要求随二进制分发，**不要删**；`dxcompiler.dll` / `vk_swiftshader.dll` 分别是 DirectX 与
Vulkan 的软件回退，删掉会让无独显或虚拟机环境黑屏。

## 清理

```bash
npm --prefix desktop run clean           # 清 release/（约 800MB+，最有价值）
npm --prefix desktop run clean -- --all  # 连 renderer/ 一起清（需重新 build:desktop）
```

## 发布流程

以 0.2.3-beta.4 为例，tag 用 `4E-NEXT-Desktop-V0.2.3B-beta.4`。

```bash
# 1) 提交
git add -A
git commit -m "feat: V0.2.3B"

# 2) 打 tag —— git 不允许 tag 名带空格，用连字符
git tag -a "4E-NEXT-Desktop-V0.2.3B-beta.4" -m "4E NEXT 桌面版 0.2.3-beta.4（测试版）"
git push origin main
git push origin "4E-NEXT-Desktop-V0.2.3B-beta.4"

# 3) 出包（产出安装程序、便携版 zip 与 SHA256SUMS.txt）
pnpm --filter 4enext-web build:desktop
npm --prefix desktop run dist
npm --prefix desktop run pack:portable

# 4) 创建 Release 并上传附件（不依赖 gh CLI）
export GITHUB_TOKEN=xxx        # classic PAT 的 repo scope 即可
node desktop/scripts/create-release.mjs \
  --tag "4E-NEXT-Desktop-V0.2.3B-beta.4" \
  --title "4E NEXT 桌面版 0.2.3-beta.4（测试版）" \
  --notes-file desktop/RELEASE-NOTES.md \
  --prerelease
```

`create-release.mjs` 会自动发现 `desktop/release/` 下的 `*.exe` / `*.zip` 与 `SHA256SUMS.txt` 并上传，
并且**复用已存在的同名 Release、跳过已传过的附件**——所以大文件传一半断了，直接重跑就能续传。

也可以分批传，避免单次调用太久：

```bash
node desktop/scripts/create-release.mjs --tag "<tag>" --skip-upload                  # 只建 Release
node desktop/scripts/create-release.mjs --tag "<tag>" --assets "desktop/release/xxx.zip"   # 单独传一个附件
```

装了 `gh` 的话，等价写法：

```bash
gh release create "4E-NEXT-Desktop-V0.2.3B-beta.4" \
  --title "4E NEXT 桌面版 0.2.3-beta.4（测试版）" \
  --notes-file desktop/RELEASE-NOTES.md --prerelease \
  desktop/release/*.exe desktop/release/*.zip desktop/release/SHA256SUMS.txt
```

**几条踩过的坑**：

- **tag 名不能带空格**，git 会直接拒绝（`is not a valid tag name`）。要可读就用连字符。
- **务必带 `--prerelease`**：beta 若被标成 Latest，会顶掉 stable 版本的默认下载。
- **只传 `setup.exe`、`portable.zip`、`SHA256SUMS.txt`**。`win-unpacked/` 是 432MB 的未打包目录，
  GitHub 单附件上限虽然够（2GB），但没有分发价值。
- token 用 classic PAT 时 scope 选 `repo`；fine-grained token 需要 `Contents: Read and write`。
- 附件文件名按版本号推导**不可靠**（tag 里是 `V0.2.3B-beta.4`，产物却是 `0.2.3-beta.4`），
  所以脚本用目录扫描而不是拼字符串。

## 已知限制（测试版）

1. **只验证了 Windows x64**；外壳代码跨平台，但 macOS / Linux 未实测。
2. 未做代码签名，首次运行会有 SmartScreen 提示。
3. Chiron 字体授权为 SIL OFL 1.1，原始版权与授权声明随字体保留在 `desktop/assets/fonts/chiron.css` 头部。
