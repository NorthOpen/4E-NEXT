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

如您希望在本地部署并开发，克隆本仓库至本地后使用 `pnpm --filter dnd4e-kcc-web dev`，在本地浏览器构建即可。


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
