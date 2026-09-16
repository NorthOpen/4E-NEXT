# 4E NEXT 桌面版 0.2.3-beta.4（测试版）

**这是网页版的离线打包，不是第二个产品。** 界面、数据格式、导出逻辑与网页版完全共用一份源码，
外壳只替换了和运行环境打交道的事。

## 下载

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `4E-NEXT-0.2.3-beta.4-setup.exe` | 169.8 MB | **Windows 安装程序**（NSIS，免管理员权限，可选安装目录） |
| `4E-NEXT-0.2.3-beta.4-win-x64-portable.zip` | 213.2 MB | 免安装便携版，解压即用（解压后约 432 MB） |

两个包内容一致，区别只在数据放哪：

- **安装版**：数据写在 `%APPDATA%\4E NEXT`，开始菜单/桌面有快捷方式，带卸载程序。
- **便携版**：程序目录里有 `portable.txt`，数据写在同目录的 `data\` 里，
  整个文件夹拷到 U 盘就能带走，删掉文件夹即彻底卸载。

> 未做代码签名，Windows SmartScreen 可能提示「已保护你的电脑」。
> 选择「更多信息 → 仍要运行」即可。

## beta.4 修了什么

**图标回到网页版的 favicon 本身：透明背景、无圆角、只有那个青色标记。**

去掉了我之前自作主张加的两样东西——teal 渐变底和 22% 圆角。现在用的就是
`web/public/favicon.svg` 里的那个标记，颜色取自它自己的 fill `#00838f`，其余全透明。

制作上有个坑值得记一笔：**无头 Chrome 截图不保留透明通道**——页面背景透明的区域会被填成白色。
所以先在洋红（`#ff00ff`）底上渲染标记，再在 Node 里把洋红抠成 alpha。

选洋红是因为它与 `#00838f` 在绿色通道上相距最远（0 对 131），而标记是纯色平涂，
因此可以逐像素精确反解出 alpha——抗锯齿边缘也能被完整还原，不会出现锯齿或彩色描边。

生成的 PNG 实测：63.0% 实心 / 36.4% 透明 / 0.6% 抗锯齿边缘。
打进 exe 的 `.ico` 含 7 个尺寸（16 到 256），**每一个都是带 alpha 的 RGBA**——
也就是说任务栏里不会再出现底色方块。

> 上一版（beta.3）把字体换回 Chiron 的改动保持不变，本版只动图标。

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
| 自签名证书 | 浏览器警告页 | 弹窗询问是否信任 |

其他按桌面环境做的调整：窗口尺寸与位置会被记住；外链交给系统浏览器打开；
连不上 WebDAV 时不再提示「请配置 CORS」；重复启动不会开出第二个实例。

## 验收结果

在**打包后的真实外壳里**跑自检，**17 项全部通过**：

```
PASS  app:// 加载 index.html
PASS  预加载桥已注入
PASS  应用版本可读                 [0.2.3-beta.4]
PASS  平台存储 写/读/删
PASS  存储 keys()/usage()
PASS  fetch data/manifest.json     [status=200]
PASS  fetch 19MB power.json        [len=14957858]
PASS  fetch 根路径回 index.html    [status=200]
PASS  IndexedDB 可用
PASS  React 已渲染                 [root.innerHTML=43929 字符]
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

网页端不受影响：`pnpm --filter 4enext-web build` 仍然只产出 `web/dist`，
`web/index.html` 一个字节没动（仍走 CDN），`web/dist` 里没有混入任何内置字体。

## 已知限制

1. **体积仍偏大**：安装包 169.8 MB，装完约 432 MB。构成：
   内置 Chiron 字体 64.7 MB + 内嵌 4E Wiki 数据 40.6 MB（`power.json` 单个 19MB）+ Electron 运行时。
   字体占了大头，这是「离线 + 与网页版同形」的直接代价。
2. **只验证了 Windows x64**。外壳代码本身是跨平台的，但 macOS / Linux 未实测。
3. 未做代码签名，首次运行会有 SmartScreen 提示。
4. 图标是透明背景的纯标记（与网页版 favicon 一致）。在深色任务栏上依赖 `#00838f` 自身的对比度，
   若之后要做 Windows 磁贴或启动器大图，可能需要另做带底的版本。
5. Chiron 字体授权为 SIL OFL 1.1，随字体保留了原始版权与授权声明（见 `desktop/assets/fonts/chiron.css` 头部）。
