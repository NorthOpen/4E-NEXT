// 在设备（或模拟器）上跑安卓端冒烟自检，并把结果打到终端。
//
// 用法：pnpm smoke:android
//
// 做四件事：确认有设备 → 装 debug 包 → 带 smoke 开关启动 → 抓 logcat 并打印结论。
//
// 为什么要有这个脚本而不是让人手敲一长串 adb：手敲太容易漏步骤
// （比如忘了清 logcat 缓冲，于是读到上一次的旧结论——
// 那比没有结论更危险，因为它看起来像"通过了"）。
//
// 签名说明：默认装 **debug** 包。debug 包与 release 包不能互相覆盖安装
// （签名不同），所以如果机器上装过 release 版，先卸载。

import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = join(here, "..");

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) {
  console.error("[smoke:android] 需要设置 ANDROID_HOME 或 ANDROID_SDK_ROOT");
  process.exit(1);
}
const isWindows = process.platform === "win32";
const adb = join(sdk, "platform-tools", isWindows ? "adb.exe" : "adb");
if (!existsSync(adb)) {
  console.error("[smoke:android] 找不到 adb：" + adb);
  process.exit(1);
}

const APP_ID = "ltd.banque.a4enext";
const TAG = "4enext-smoke";

// 默认装 debug 包；--release 或 --apk <路径> 可以换成别的产物。
// 发布前应当用**真的 release 包**跑一遍——debug 与 release 的 DEX 处理不同，
// 「debug 能跑」不等于「release 能跑」。
//
// --release 取的是 release/ 目录里的产物，**按版本号从新到旧挑**，而不是写死文件名：
// 写死等于每次发版都得回来改这个脚本，忘一次就是"找不到 APK"。
const argv = process.argv.slice(2);
const apkFlagIndex = argv.indexOf("--apk");
const APK =
  apkFlagIndex >= 0 && argv[apkFlagIndex + 1]
    ? join(process.cwd(), argv[apkFlagIndex + 1])
    : argv.includes("--release")
      ? newestReleaseApk()
      : join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");

/** release/ 目录里版本号最大的那个 APK（文件名形如 `4E-NEXT-0.3.5-android.apk`）。 */
function newestReleaseApk() {
  const dir = join(androidDir, "release");
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => /^4E-NEXT-.+-android\.apk$/.test(f))
    : [];
  if (files.length === 0) {
    console.error("[smoke:android] " + dir + " 里没有 APK，先执行：pnpm release:android");
    process.exit(1);
  }
  files.sort((a, b) => compareVersion(b, a)); // 新的在前
  if (files.length > 1) {
    console.log(
      "[smoke:android] release/ 里有 " + files.length + " 个包，取最新的：" + files[0] +
        "（其余：" + files.slice(1).join(", ") + "）",
    );
  }
  return join(dir, files[0]);
}

/** 比较两个发布文件名里的版本号（按段比数字，不看字典序）。 */
function compareVersion(a, b) {
  const part = (name) => {
    const m = name.match(/^4E-NEXT-(.+)-android\.apk$/);
    return m ? m[1] : "0";
  };
  const segments = (v) => v.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pa = segments(part(a));
  const pb = segments(part(b));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

if (!existsSync(APK)) {
  console.error("[smoke:android] 找不到 APK：" + APK);
  console.error("[smoke:android] debug 包：cd android && gradlew.bat assembleDebug");
  console.error("[smoke:android] release 包：pnpm release:android");
  process.exit(1);
}

function adbRun(args, { capture = true } = {}) {
  return spawnSync(adb, args, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
}

// ---------------------------------------------------------------- 1) 确认设备

const devices = adbRun(["devices"]).stdout || "";
const ready = devices
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("*"))
  .filter((l) => /\sdevice$/.test(l));

if (ready.length === 0) {
  console.error("[smoke:android] 没有处于 device 状态的设备。");
  console.error(devices.trim());
  console.error("");
  console.error("  模拟器：先启动一个 AVD。x86_64 镜像需要 hypervisor 驱动");
  console.error("          （Android Emulator hypervisor driver，安装需管理员权限）；");
  console.error("          ARM 镜像在 x86_64 主机上会被模拟器直接拒绝。");
  console.error("  实体机：插上并开启 USB 调试，然后 `adb devices` 应显示 device 而不是 unauthorized");
  process.exit(1);
}
console.log("[smoke:android] 设备：" + ready.join(", "));

// ---------------------------------------------------------------- 2) 清缓冲 + 装包

// 先清 logcat：不清的话会把上一轮的结论一起读出来，看起来像"这次通过了"
adbRun(["logcat", "-c"]);
console.log("[smoke:android] 已清空 logcat 缓冲");

console.log("[smoke:android] 安装 " + APK);
const install = adbRun(["install", "-r", "-d", APK], { capture: true });
if (install.status !== 0) {
  console.error((install.stdout || "") + (install.stderr || ""));
  console.error("[smoke:android] 安装失败。若提示签名冲突，先卸载旧包：adb uninstall " + APP_ID);
  process.exit(1);
}
console.log("[smoke:android] 安装完成");

// ---------------------------------------------------------------- 3) 启动自检

adbRun(["shell", "am", "force-stop", APP_ID]);
console.log("[smoke:android] 启动自检模式（--ez smoke true）");
adbRun(["shell", "am", "start", "-n", APP_ID + "/.MainActivity", "--ez", "smoke", "true"]);

// ---------------------------------------------------------------- 4) 抓结果

// 自检在页面加载后等 2.5 秒才注入探针，再等 React 渲染出侧栏（最多 10 秒轮询），
// 之后还要读 19MB 数据。给足 90 秒。
console.log("[smoke:android] 等待结果（最多 90 秒）…");
const logcat = spawnSync(adb, ["logcat", "-s", TAG + ":I", "*:S"], {
  encoding: "utf8",
  timeout: 90000,
});

const text = (logcat.stdout || "") + (logcat.stderr || "");
const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

if (lines.length === 0) {
  console.error("[smoke:android] 没有抓到任何自检输出。");
  console.error("  可能原因：应用没起来（看 adb logcat 全量日志）、");
  console.error("  WebView 加载失败、或探针抛错被吞。");
  console.error("  全量日志：adb logcat | Select-String 4enext");
  process.exit(1);
}

console.log("");
for (const line of lines) {
  // 去掉 logcat 的前缀（时间戳 / pid / tag），只留正文
  const m = line.match(new RegExp(TAG + "\\s*:\\s*(.*)$"));
  console.log("  " + (m ? m[1] : line));
}

const failed = lines.filter((l) => l.includes("FAIL"));
const summary = lines.find((l) => l.includes("结果："));
console.log("");
if (failed.length > 0) {
  console.error("[smoke:android] 有 " + failed.length + " 项未通过。");
  process.exit(1);
}
if (!summary) {
  console.error("[smoke:android] 没读到「结果：」汇总行，自检可能中途断了。");
  process.exit(1);
}
console.log("[smoke:android] " + summary.replace(/^.*结果：/, "结果："));
