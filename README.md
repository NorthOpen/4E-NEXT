# 4E NEXT

面向 D&D 4E 中文社区，基于4e Wiki 数据的网页端车卡器。

使用完全的 **Google Material Design** 设计风格开发。

## 快速开始

点击访问[在线版本](https://4e-next.banque.ltd/)

## 技术栈

| 层       | 技术                                                              |
| -------- | ----------------------------------------------------------------- |
| 数据管线 | TypeScript（Node 26）+ zod                                        |
| 前端     | React 19 + Vite 6 + TypeScript 5.7 + @vitejs/plugin-react         |
| MD3 组件 | @material/web 2.5.0 + @lit/react 1.0.8                            |
| 动态取色 | @material/material-color-utilities 0.3.0                          |
| 头像裁切 | react-easy-crop 5                                                 |
| 图片转换 | html-to-image + jspdf                                             |
| 字体     | Chiron Sung HK VF + Chiron Sans HK VF + Material Symbols Outlined |

## 本地开发

如您希望在本地部署并开发，克隆本仓库至本地后使用 `pnpm --filter 4enext-web dev`，在本地浏览器构建即可。

## 多端同步（WebDAV）

4E NEXT 支持用**你自己的网盘**在多台设备之间同步数据，不需要注册账号，数据也不经过任何第三方服务器。

同步的是**人物卡**与**私设资源包**；外观设置与页面布局属于本机偏好，不参与同步。

### 配置步骤

1. 准备一个支持 WebDAV 的网盘：坚果云、Nextcloud、群晖 DSM、自建 WebDAV 均可。
2. 生成一个**应用专用密码**（坚果云：账户信息 → 安全选项 → 添加应用密码）。
   > 不要填账号登录密码。应用密码可以随时单独吊销，泄露面小得多。
3. 打开 4E NEXT → 设置 → 数据与同步，填入 WebDAV 地址（如 `https://dav.jianguoyun.com/dav/`）、用户名、应用密码与远端文件夹。
   远端文件夹默认 `4enext`，首次同步会自动创建；它只是你网盘里的一个普通目录，可以随时改名或删除。
4. 点「测试连接」，通过后打开「启用同步」，再点「立即同步」。

配置只保存在本机浏览器里，**密码不会上传到任何地方**，也不会写进同步文件。

### 说明

- **地址必须是 HTTPS**：本站部署在 HTTPS 上，浏览器会拦截对 `http://` 地址的请求（混合内容）。
- **服务端必须放行跨域（CORS）**：浏览器对 WebDAV 使用的 `PUT` / `MKCOL` 会先发跨域预检，
  服务端需放行这些方法与 `Authorization`、`Content-Type`、`If-Match` 等请求头
  （`PROPFIND` 只用于「测试连接」，同步流程本身不依赖它）。
  **多数公共网盘不提供这项设置**，能自己改服务端配置的（自建 Nextcloud、群晖、Cloudreve、MinIO 等）才比较稳。
  点「测试连接」会明确告知到底卡在哪一环——是网络不通、只拦了 PROPFIND，还是完全没返回跨域许可。
- **同步是手动的**：点一次「立即同步」才执行。之所以不做后台自动同步，是因为同步失败时用户必须能看见——
  否则会以为数据已经上去了，等换设备才发现没同步。
- **冲突不会静默丢弃**：两台设备改了同一张卡时，本地那份保留原名，另一份另存为「冲突副本」并由你决定去留。

### 自测

```bash
node web/scripts/sync-selftest.mjs
```

覆盖合并算法与双设备端到端模拟（冲突、墓碑、删除传播、幂等）。

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
