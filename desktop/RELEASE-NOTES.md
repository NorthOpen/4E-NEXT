# 4E NEXT 0.3.4（首个正式版）

**这是网页版的离线打包，不是第二个产品。** 界面、数据格式、导出逻辑与网页版完全共用一份源码，
外壳只替换了和运行环境打交道的事。

从这一版起版本号不再带 `B` 后缀——`V0.3.4` 就是正式版号。

## 下载

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `4E-NEXT-0.3.4-setup.exe` | 170.5 MB | **Windows 安装程序**（NSIS，免管理员权限，可选安装目录） |
| `4E-NEXT-0.3.4-win-x64-portable.zip` | 214.1 MB | 免安装便携版，解压即用（解压后约 439.7 MB） |

SHA256（与同目录的 `SHA256SUMS.txt` 一致）：

```
fa515d212fe9e084758213fc32b05ec732763a699b75a9529e37f655b90ab441  4E-NEXT-0.3.4-setup.exe
77eedc6901d0cc8ed283f2c19bf679005ed73f021e3c63602eff214f3cd68e1e  4E-NEXT-0.3.4-win-x64-portable.zip
```

两个包内容一致，区别只在数据放哪：

- **安装版**：数据写在 `%APPDATA%\4E NEXT`，开始菜单/桌面有快捷方式，带卸载程序。
- **便携版**：程序目录里有 `portable.txt`，数据写在同目录的 `data\` 里，
  整个文件夹拷到 U 盘就能带走，删掉文件夹即彻底卸载。

> 未做代码签名，Windows SmartScreen 可能提示「已保护你的电脑」。
> 选择「更多信息 → 仍要运行」即可。

## 这一版对桌面用户意味着什么

上一份桌面产物停在 `0.2.3-beta.4`。桌面外壳本身一直跟着仓库走，但**装好的那个 exe 落后了整整一个
0.3.x 特性周期**——也就是说，之前下载桌面版的用户拿不到下面这些：

| 0.2.3-beta.4 桌面版没有 | 0.3.4 有 |
| --- | --- |
| AI 车卡助手 | 客户端直连模型，预设 10 家（DeepSeek、OpenRouter、Kimi、智谱 GLM、通义千问、SiliconFlow、OpenAI、Anthropic、Ollama、LM Studio）＋自定义 OpenAI 兼容端点；逐槽位挑选威能与专长、属性购点校验、失败步骤可单独重试 |
| 主持模式 | 审阅页 + 主持侧 AI 页 |
| 私设体系 | `CategorySpec` 统一每类自包含 spec 架构，种族/装备/威能/专长实例落地 |
| 手机端布局 | 一整份 `styles.mobile.css`：断点、触摸目标、底部卡片 |
| 教程 | 「人物」步骤从第 4 步提前到第 2 步（教学内容版本升到 4） |

本版相对 `0.3.3B` 的应用侧改动，是触屏交互这一批：

**悬停浮层在触屏上改走 MD3 底部卡片。** 词条预览原先靠 `mouseenter` / `mouseleave` 驱动，
触屏上既没有 hover 也没有 mouseleave——手指点开之后浮层就再也关不掉。现在触屏一律走底部卡片，
有明确的关闭动作；鼠标端行为不变。

同批还修了手机端的几处可用性问题（搜索页、面板布局编辑器、角色卡与立绘裁切），
并给手机端单独拆了一份样式表。

## 数据与迁移

**桌面端与网页端是两个独立的存储位置**，网页版已有的卡不会自动出现。
迁移方式是用 WebDAV：先在网页版「设置 → 数据与同步」里点「立即同步」，
再在桌面端填同样的配置拉取。

## 与网页版的差异

| | 网页版 | 桌面版 |
| --- | --- | --- |
| 数据存储 | 浏览器 localStorage，约 5MB 上限 | 本地文件，不受配额限制 |
| 正文字体 | Chiron 分片，从 CDN 按需下载 | 同一套 Chiron 分片内置，**完全离线可用** |
| 另存为 | 浏览器下载 | 系统保存对话框，记住上次目录 |
| WebDAV 同步 | 需要服务端配置 CORS | 主进程直连，**不用再配 CORS** |
| 自签名证书 | 浏览器警告页 | 弹窗询问是否信任（**按证书指纹**记住） |

其他按桌面环境做的调整：窗口尺寸与位置会被记住；外链交给系统浏览器打开；
连不上 WebDAV 时不再提示「请配置 CORS」；重复启动不会开出第二个实例；
WebDAV 密码经 `safeStorage` 加密后落盘。

## 验收结果

在**打包前的真实外壳里**跑自检，**17 项全部通过**：

```
PASS  app:// 加载 index.html
PASS  预加载桥已注入
PASS  应用版本可读                 [0.3.4]
PASS  平台存储 写/读/删
PASS  存储 keys()/usage()
PASS  fetch data/manifest.json     [status=200]
PASS  fetch 19MB power.json        [len=14957858]
PASS  fetch 根路径回 index.html    [status=200]
PASS  IndexedDB 可用
PASS  React 已渲染                 [root.innerHTML=45165 字符]
PASS  字体：无外部字体服务引用     [外部字体 link 数 = 0]
PASS  字体：衬线体 Chiron Sung HK VF 已注册
PASS  字体：无衬线体 Chiron Hei HK VF 已注册
PASS  字体：已加载分片             [650 个 FontFace 已加载]
PASS  Material Symbols 已内置
PASS  主进程 HTTP 自定义方法       [PROPFIND=207 MKCOL=201 PUT=207 GET=207]
PASS  界面截图已保存
```

四条关键项：**「无外部字体服务引用」为 0** 证明离线字体真的生效；
**「已加载分片 650」** 证明 1055 个分片能穿过 asar 正常加载；
**「主进程 HTTP 自定义方法」** 证明 WebDAV 不再需要服务端配置跨域；
**「fetch 19MB power.json」** 证明 40MB 内嵌数据读取正常。

版本号那一项读的是 `app.getVersion()`（即打进包里的 `desktop/package.json`），
界面上侧栏与设置页显示的也是同一个号，都是 `0.3.4`。

网页端不受影响：`pnpm --filter 4enext-web build` 仍然只产出 `web/dist`，
`web/index.html` 一个字节没动（仍走 CDN），`web/dist` 里没有混入任何内置字体。

## 已知限制

1. **体积仍偏大**：内置 Chiron 字体 64.7 MB + 内嵌 4E Wiki 数据 40.6 MB
   （`power.json` 单个 19MB）+ Electron 运行时。字体占了大头，这是「离线 + 与网页版同形」的直接代价。
2. **只验证了 Windows x64**。外壳代码本身是跨平台的，但 macOS / Linux 未实测。
3. 未做代码签名，首次运行会有 SmartScreen 提示。
4. 图标是透明背景的纯标记（与网页版 favicon 一致）。在深色任务栏上依赖 `#00838f` 自身的对比度，
   若之后要做 Windows 磁贴或启动器大图，可能需要另做带底的版本。
5. Chiron 字体授权为 SIL OFL 1.1，随字体保留了原始版权与授权声明（见 `desktop/assets/fonts/chiron.css` 头部）。
6. 便携版整个目录拷到另一台机器后，WebDAV 应用密码需要重填一次——
   `safeStorage` 的密文绑定当前系统账户。
