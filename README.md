# 4E NEXT

面向 D&D 4E 中文社区，基于4e Wiki 数据的网页端车卡器。

使用完全的 **Google Material Design** 设计风格开发。

## 快速开始

点击访问[在线版本](https://4e-next.banque.ltd/)

## 技术栈

| 层       | 技术                                                              |
| -------- | ----------------------------------------------------------------- |
| 数据管线 | TypeScript（Node 22+；CI 22，本地开发 26）+ cheerio + zod    |
| 前端     | React 19 + Vite 6 + TypeScript 5.7 + @vitejs/plugin-react         |
| MD3 组件 | @material/web 2.5.0 + @lit/react 1.0.8                            |
| 动态取色 | @material/material-color-utilities 0.3.0                          |
| 取色控件 | react-colorful 5                                                  |
| 头像裁切 | react-easy-crop 5                                                 |
| 图片转换 | html-to-image + jspdf                                             |
| 字体     | Chiron Sung HK VF + Chiron Hei HK VF + Material Symbols Outlined |
| 桌面端   | Electron 44 + electron-builder |

## 本地开发

如您希望在本地部署并开发，克隆本仓库至本地后使用 `pnpm --filter 4enext-web dev`，在本地浏览器构建即可。

数据管线（4e Wiki → 规范 JSON）与怪物数据管线（怪物手册合订本 xlsx → 规范 JSON）的说明见
[怪物数据管线.md](怪物数据管线.md)。

## 桌面版

除网页版外，项目提供封装后的setup与portable两种桌面版本。为在意缓存占用和希望使用独立应用的用户提供。

点击下载[最新版本](https://github.com/NorthOpen/4E-NEXT/releases)


## WebDAV

4E NEXT 支持使用**WebDAV**在多台设备之间同步数据。

以下为配置范例：

1. 在服务端放行跨域（**仅网页版需要**；桌面版由主进程直接请求，不受跨域限制）。
   以 Nextcloud 为例，较新版本可在 `config.php` 中配置允许的域
   （见 Nextcloud 文档中 DAV 的 CORS 相关配置）；群晖、Cloudreve 等请在各自的 Web 服务器配置里放行
   `GET` / `PUT` / `MKCOL` / `PROPFIND` 方法与 `Authorization`、`Content-Type`、`If-Match` 请求头。

2. 准备应用专用密码。
   > 注意：不要填写webdav服务端的账号与登录密码，建议为本项服务单独创建相应内容。

3. 打开 4E NEXT → 设置 → 数据与同步，填入 WebDAV 地址、用户名、应用密码与远端文件夹。
   远端文件夹默认 `4enext`，首次同步会自动创建，支持改名或删除。

4. 点「测试连接」，通过后打开「启用同步」，再点「立即同步」。


## 开源许可

<a href="LICENSE"><img src="https://img.shields.io/badge/License-MPL 2.0-green.svg?style=flat-square" alt="License: MPL 2.0"/></a>

4E NEXT遵循Mozilla Public License Version 2.0，条款与效力请参阅LICENSE文件。

## 致谢

项目数据来源：由现任维护者风之守护维护的[4e Wiki](https://4e-wiki.netlify.app/)、[4e 万律](https://4e-rules.netlify.app/)

以及所有历代的4e全书维护者、所有的4e中文译者。

## 法律声明与版权信息

4E NEXT的开发目标是制作一个基于网页的数据处理、自动计算与表格排版工具。4E NEXT不涉及对于龙与地下城四版规则内容与对海岸巫师威世智所持版权内容的二次分发。为了方便用户使用，项目内部封装了由中文译者提供，中文开发者维护的4e Wiki作为数据来源。

《龙与地下城》（DUNGEONS & DRAGONS）、DUNGEONS & DRAGONS 兼容性标志、D&D、《玩家手册》（PLAYER’S HANDBOOK）、《地下城主指南》（DUNGEON MASTER’S GUIDE）和《怪物图鉴》（MONSTER MANUAL）是 Wizards of the Coast, Inc. 在美国和其他国家的商标。

《龙与地下城》第 4 版《玩家手册》，由 Rob Heinsoo、Andy Collins 和 James Wyatt 撰写；《地下城主指南》，由 James Wyatt 撰写；《怪物图鉴》，由 Mike Mearls、Stephen Schubert 和 James Wyatt 撰写 © 2008 Wizards of the Coast, Inc. 保留所有权利。
