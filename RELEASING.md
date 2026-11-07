# 发布流程（维护者）

三端 = **WEB / 安卓 / 桌面（Windows）**。日常只做三件事：改版本号 → 推 main → 打一个总 tag。

## 一、准备（一次性）

- 仓库 Secrets 里配好安卓签名（`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`），否则安卓流水线会以「debug 签名，不允许正式分发」失败。
- 桌面端不需要额外 secret：`GITHUB_TOKEN` 由 Actions 注入。

## 二、发一版

```bash
# 1) 同步三端版本号（根 / web / desktop package.json、安卓 versionName+versionCode、README 下载链接）
node scripts/bump-version.mjs 0.4.2

# 2) 提交并推 main —— 网页端自动部署（deploy.yml）
git add -A
git commit -m "feat: V0.4.2"
git push origin main

# 3) 打一个总 tag —— 安卓 + 桌面两条流水线同时开跑
git tag 4E-NEXT-V0.4.2
git push origin 4E-NEXT-V0.4.2
```

之后什么都不用做：

| 端 | 流水线 | 产物 |
|---|---|---|
| WEB | `Deploy to GitHub Pages`（push main 触发） | 网页端更新，版本号取自 `web/package.json` |
| 安卓 | `Android Release`（总 tag 触发） | `4E-NEXT-0.4.2-android.apk` |
| 桌面 | `Desktop Release`（总 tag 触发） | `4E-NEXT-0.4.2-setup.exe` + `4E-NEXT-0.4.2-win-x64-portable.zip` |

每端各自创建一个 Release：**名称和介绍都只写 tag**，例如
`4E-NEXT-Android-V0.4.2`、`4E-NEXT-Desktop-V0.4.2`；发布成功后自动删除同前缀的旧版本
Release（git tag 保留，源码历史不丢），Releases 页始终只留最新一版。

## 三、只重发某一端

```bash
git tag 4E-NEXT-Android-V0.4.2   # 或 4E-NEXT-Desktop-V0.4.2
git push origin 4E-NEXT-Android-V0.4.2
```

分 tag 只拉起对应平台的流水线。**不要和总 tag 一起推**：两套 tag 都会触发构建，
虽然发布脚本会复用已有 Release 并跳过已上传的附件，但会白等一次构建。

## 四、流水线失败时

- 版本校验失败（`tag 里的版本 ... 与 package.json ... 不一致`）：先 `node scripts/bump-version.mjs x.y.z`，
  提交后再重新打 tag。
- 字体/Electron 下载失败：重跑 job 即可（两者都有 `actions/cache`，命中后不再下载）。
- 附件要**替换**（不是新增）：同名附件会被跳过，必须先删掉旧 Release（或其中的旧附件）再重跑，
  否则新产物传不上去。
- 手动验证流水线（不出 Release）：Actions → Desktop Release → Run workflow。

## 五、本地出包（不需要走云端时）

```bash
node web/scripts/copy-data.mjs
node web/scripts/build-desktop.mjs          # → desktop/renderer/
node desktop/scripts/fetch-fonts.mjs        # 首次；约 65MB
node desktop/scripts/fetch-electron.mjs     # 首次；约 158MB
npm --prefix desktop run dist               # 安装版
node desktop/scripts/pack-portable.mjs      # 便携版 + SHA256SUMS.txt

node web/scripts/build-android.mjs          # → android/app/src/main/assets/www/
ANDROID_HOME=... node android/scripts/make-release.mjs --skip-web   # APK + SHA256SUMS.txt
```

## 六、已知限制

- 桌面端未做代码签名：首次运行会有 SmartScreen 提示。
- 只验证了 Windows x64；Linux 支持尚未落地（见后续计划）。
