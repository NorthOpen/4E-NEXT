// 组装安卓发布产物：release APK + SHA256SUMS.txt。
// 与 desktop/scripts/pack-portable.mjs 是同一套思路——把「出包」这件事收成一个命令，
// 免得每次发布都靠手敲一串参数、还容易漏步骤。
//
// 用法：
//   node android/scripts/make-release.mjs
//   node android/scripts/make-release.mjs --skip-web     # 复用已有的 assets/www，不重新构建
//
// 做四件事：
//   1) （默认）构建网页端产物到 android/app/src/main/assets/www/
//   2) 跑 gradlew assembleRelease
//   3) 把 APK 复制成发布用的名字
//   4) 算 SHA256 写进 release/SHA256SUMS.txt
//
// 签名：没配 keystore 时 release 会回落到 debug 签名（构建脚本会打印警告）。
// 那种产物能装、能验证，但**不能用于正式分发**。

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = join(here, "..");
const rootDir = join(androidDir, "..");
const releaseDir = join(androidDir, "release");

const skipWeb = process.argv.includes("--skip-web");
const isWindows = process.platform === "win32";

// --require-release-signing：把「debug 签名」从警告升级为失败。
//
// 为什么需要这个开关：没配签名时 release 会**静默回落到 debug 签名**（只打印警告），
// 这条回落对「本地先出个包自测」是对的，但对「打 tag 发布」是错的——
// 工作流会照常建 Release 并把 debug 签名的包传上去，而 android/RELEASE-NOTES.md
// 与 SIGNING.md 都写明那种包**不能对外分发**（换了签名就无法覆盖安装，用户只能卸载，
// 而卸载会连应用私有目录里的人物卡一起删掉）。
//
// 所以正式发布这条路要求「证明不了是发布密钥签名，就别发」：
// 检出 debug 签名、或压根找不到 apksigner 可以验，都直接失败。
// 手动触发（workflow_dispatch，只为拿个包做真机自测）不加这个开关，行为不变。
const requireReleaseSigning = process.argv.includes("--require-release-signing");

function step(msg) {
  console.log("[make-release] " + msg);
}

/**
 * 跑一条命令，失败就整体退出。
 *
 * 在 Windows 上必须 shell: true —— `pnpm` 与 `gradlew` 都是 `.cmd`/`.bat`。
 * 但 Node 会为此发一条 DEP0190 警告（"传 args 给 shell 有风险"），
 * 所以这里把命令拼成一个字符串再交出去，既消掉警告，也避免参数被 shell 重新切分。
 */
function run(commandLine, cwd, extraEnv = {}) {
  step("$ " + commandLine);
  const result = spawnSync(commandLine, {
    cwd,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    console.error("[make-release] 命令失败（退出码 " + result.status + "）：" + commandLine);
    process.exit(1);
  }
}

/** 把路径安全地放进 shell 命令行（Windows 路径含空格时必须加引号）。 */
function q(p) {
  return '"' + p + '"';
}

// ---------------------------------------------------------------- 1) 网页产物

if (skipWeb) {
  step("跳过网页端构建（--skip-web）");
} else {
  step("构建网页端产物 -> android/app/src/main/assets/www/");
  run("pnpm --filter 4enext-web build:android", rootDir);
}

const wwwIndex = join(androidDir, "app", "src", "main", "assets", "www", "index.html");
if (!existsSync(wwwIndex)) {
  console.error("[make-release] 找不到渲染产物：" + wwwIndex);
  console.error("[make-release] 先执行：pnpm --filter 4enext-web build:android");
  process.exit(1);
}

// ---------------------------------------------------------------- 2) 定位 JDK

/**
 * 找可用的 JDK。
 *
 * 为什么要管这件事：本机 PATH 里的 `java.exe` 是 Oracle 的转发器（JDK 11），
 * 而 `JAVA_HOME` 是 Temurin 21——两者不一致时 Gradle 会用错 JDK，
 * 报出来的错还跟 Java 版本没关系，很难定位。
 *
 * 策略：信任 JAVA_HOME，但**校验它的主版本确实 >= 17**；不合格就报错而不是硬跑。
 */
function resolveJavaHome() {
  const candidates = [process.env.JAVA_HOME, process.env.JDK_HOME].filter(Boolean);
  for (const home of candidates) {
    const release = join(home, "release");
    if (!existsSync(release)) continue;
    const match = readFileSync(release, "utf8").match(/JAVA_VERSION="(\d+)/);
    if (!match) continue;
    const major = Number(match[1]);
    if (major >= 17) {
      step("使用 JDK：" + home + "（主版本 " + major + "）");
      return home;
    }
    step("跳过 JDK " + home + "：主版本 " + major + " < 17");
  }
  console.error("[make-release] 找不到主版本 >= 17 的 JDK。");
  console.error("[make-release] 请把 JAVA_HOME 指向 JDK 17 或更高（AGP 8.13 的最低要求是 17）。");
  console.error("[make-release] 注意：PATH 里的 java 可能与 JAVA_HOME 不一致，本脚本只认 JAVA_HOME。");
  process.exit(1);
}

const javaHome = resolveJavaHome();

// ---------------------------------------------------------------- 3) 出包

const gradlew = isWindows ? "gradlew.bat" : "./gradlew";
step("gradlew assembleRelease");
run(gradlew + " assembleRelease --console=plain", androidDir, { JAVA_HOME: javaHome });

// 版本号从 app/build.gradle.kts 读，而不是另开一份配置：
// 安卓的 versionName 必须与 web/package.json 一致，让它只有一个来源（构建脚本），
// 发布脚本只是把它读出来拼文件名。
const gradleScript = readFileSync(join(androidDir, "app", "build.gradle.kts"), "utf8");
const versionMatch = gradleScript.match(/versionName\s*=\s*"([^"]+)"/);
if (!versionMatch) {
  console.error("[make-release] 在 app/build.gradle.kts 里找不到 versionName");
  process.exit(1);
}
const version = versionMatch[1];

// 顺带核对：安卓的 versionName 与网页端 package.json 必须是同一个号，
// 否则会出现「APK 里跑的网页产物是 0.3.4，APK 自己写着 0.3.3」这种最难查的不一致。
const webVersion = JSON.parse(readFileSync(join(rootDir, "web", "package.json"), "utf8")).version;
if (webVersion !== version) {
  console.error("[make-release] 版本号不一致：web/package.json = " + webVersion + "，android versionName = " + version);
  process.exit(1);
}
step("版本号：" + version + "（与 web/package.json 一致）");

const builtApk = join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!existsSync(builtApk)) {
  console.error("[make-release] 找不到产物：" + builtApk);
  process.exit(1);
}

// ---------------------------------------------------------------- 4) 复制 + 校验和

mkdirSync(releaseDir, { recursive: true });
const outName = "4E-NEXT-" + version + "-android.apk";
const outApk = join(releaseDir, outName);
rmSync(outApk, { force: true });
copyFileSync(builtApk, outApk);

const sizeMb = statSync(outApk).size / 1048576;
step("产物：" + outName + "（" + sizeMb.toFixed(1) + " MB）");

const sha256 = createHash("sha256").update(readFileSync(outApk)).digest("hex");
writeFileSync(join(releaseDir, "SHA256SUMS.txt"), sha256 + "  " + outName + "\n", "utf8");
step("SHA256：" + sha256);

// 签名状态自检：用 apksigner 验一遍，别把"回落到 debug 签名"的包当正式包发出去。
//
// 用 apksigner 而不是 jarsigner：后者只做 v1（JAR signing），
// 而 Android 11+ 对 targetSdk 30+ 的包要求至少 v2，只签 v1 的包会装不上。
const apksigner = join(
  process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "",
  "build-tools",
  "36.0.0",
  isWindows ? "apksigner.bat" : "apksigner",
);
if (existsSync(apksigner)) {
  step("校验签名");
  const verify = spawnSync(q(apksigner) + " verify --verbose --print-certs " + q(outApk), {
    encoding: "utf8",
    shell: true,
  });
  const text = (verify.stdout || "") + (verify.stderr || "");

  // apksigner 的实际输出形如：
  //   Verified using v2 scheme (APK Signature Scheme v2): true
  const schemes = [...text.matchAll(/Verified using (v[\d.]+) scheme[^:]*:\s*(true|false)/g)]
    .filter((m) => m[2] === "true")
    .map((m) => m[1]);
  const dn = /Signer #1 certificate DN:\s*(.+)/.exec(text);

  step("签名方案：" + (schemes.length ? schemes.join(", ") : "(未验到任何方案)"));
  step("签名证书：" + (dn ? dn[1].trim() : "(未取到)"));

  // debug 证书的 DN 里带 "CN=Android Debug"
  const isDebugSigned = /CN=Android Debug/i.test(dn ? dn[1] : "");
  if (isDebugSigned) {
    console.warn("");
    console.warn("[make-release] ⚠️  这是 **debug 签名**（CN=Android Debug），只能用于自测，");
    console.warn("[make-release]    不能用于正式分发——换了签名就无法覆盖安装。");
    console.warn("[make-release]    配置方式见 android/README.md 的「签名与发布」。");
    console.warn("");
  }
  if (verify.status !== 0) {
    console.warn("[make-release] ⚠️  apksigner verify 返回非零，签名可能有问题，请人工确认。");
  }
  if (requireReleaseSigning && isDebugSigned) {
    console.error("");
    console.error("[make-release] 已中止：--require-release-signing 要求发布密钥签名，实际是 debug 签名。");
    console.error("[make-release]   CI 上出现这一条，说明仓库 Secrets 没配全——");
    console.error("[make-release]   需要 ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD /");
    console.error("[make-release]   ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD 四个（见 android/SIGNING.md 第四节）。");
    console.error("[make-release]   本地出包则检查 android/local.properties 的四行是否齐全。");
    process.exit(1);
  }
} else {
  step("未找到 apksigner，跳过签名校验（" + apksigner + "）");
  if (requireReleaseSigning) {
    console.error("[make-release] 已中止：--require-release-signing 要求验签，但找不到 apksigner（" + apksigner + "）。");
    console.error("[make-release]   「验不了」不等于「签对了」，正式发布不做无证据的放行。");
    process.exit(1);
  }
}

console.log(JSON.stringify({ apk: outApk, version, sizeMb: Number(sizeMb.toFixed(1)), sha256 }));
