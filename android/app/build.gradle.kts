// 4E NEXT 安卓壳（应用模块）
//
// 设计原则与 desktop/ 完全一致：**这个模块里没有应用源码**。
// 界面就是 web/ 的同一份构建产物，构建时复制到 app/src/main/assets/www/。
// 壳只负责「和环境打交道的四件事」：存储、另存为/分享、网络请求、字体。
//
// 想改界面就必须改 web/ —— 用目录结构堵死「安卓端悄悄分叉」。

import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 签名配置按 项目属性 → local.properties → 环境变量 三级回落，**都不入库**。
//
// 三级都要支持，是因为三种场景都真实存在：
//   · 本地出包 —— android/local.properties 里写 keystore.path / password / alias / keyPassword
//   · 临时覆盖 —— ./gradlew -Pkeystore.path=... assembleRelease
//   · CI 出包  —— 从 GitHub Secrets 注入环境变量，密钥不落盘到工作区
val keystoreProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(key: String, env: String): String? =
    (project.findProperty(key) as String?)?.takeIf { it.isNotBlank() }
        ?: keystoreProps.getProperty(key)?.takeIf { it.isNotBlank() }
        ?: System.getenv(env)?.takeIf { it.isNotBlank() }

// keystore.path 相对 android/ 解析（与 local.properties 同目录），也接受绝对路径
val ksPathRaw = signingValue("keystore.path", "ANDROID_KEYSTORE_PATH")
val ksFile = ksPathRaw?.let { rootProject.file(it) }
val hasReleaseSigning = ksFile != null && ksFile.exists()

android {
    namespace = "ltd.banque.a4enext"
    compileSdk = 36

    defaultConfig {
        applicationId = "ltd.banque.a4enext"
        // minSdk 31（Android 12）：这是维护者定的下限。
        // 好处很实在——省掉一批 API 24~30 的兼容分支，且分区存储/照片选择器行为统一。
        minSdk = 31
        targetSdk = 36
        versionCode = 306
        versionName = "0.3.6"
    }

    androidResources {
        // 只保留中文与英文资源：这个应用界面只有中文，其余语言纯属白占体积。
        // （旧写法 resourceConfigurations 已废弃，AGP 会提示改用 localeFilters。）
        localeFilters += listOf("zh-rCN", "en")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = ksFile
                storePassword = signingValue("keystore.password", "ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keystore.alias", "ANDROID_KEY_ALIAS")
                keyPassword = signingValue("keystore.keyPassword", "ANDROID_KEY_PASSWORD")
                // 显式打开 v1/v2/v3：默认就是这样，写出来是为了防止以后被误改。
                // 注意用 Gradle 走 signingConfigs 而不是 `npx cap build` 那类 CLI——
                // 后者默认可能是 jarsigner，只签 v1，在 Android 11+ 上会装不上。
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseSigning) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
            // 纯 WebView 壳：R8 收益极小（壳本身只有几百行 Kotlin），
            // 而它经 @JavascriptInterface 暴露的方法名一旦被混淆，
            // 网页端那边 `window.__4ENEXT_ANDROID_NATIVE__.storageGetItem` 就会变成 undefined——
            // 属于"编译能过、运行才炸"的类型。保持关闭。
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")

            if (!hasReleaseSigning) {
                logger.warn(
                    "[4E NEXT] release 未配置签名，已回落到 debug 签名。\n" +
                        "[4E NEXT] 产物可以安装，但**不能用于正式分发**（换签名后无法覆盖安装）。\n" +
                        "[4E NEXT] 配置方式见 android/README.md 的「签名与发布」。",
                )
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    // 资源打包策略：
    //
    //   woff2 —— **不压缩**。WOFF2 本身就是 Brotli 压缩格式，再 Deflate 一遍是零收益甚至负收益
    //            （实测 6 个真实分片：90,932 → 91,830 字节，反而变大），
    //            而 noCompress 能让 asset 直接从 APK 内存映射，省掉每次解压。
    //            1055 个字体分片按 unicode-range 按需加载，这一条对首屏有实际意义。
    //
    //   json  —— **保持压缩**。40MB 的数据 JSON 能压到约 1MB，APK 直接少 ~39MB 下载量，
    //            这个收益远大于内存映射省下的那点开销。代价是读 19MB 的 power.json 时
    //            要先解压进内存——实测可接受，若将来数据涨到 100MB 级再重新评估。
    androidResources {
        noCompress += "woff2"
    }

    packaging {
        resources {
            excludes += setOf("META-INF/*.kotlin_module", "META-INF/DEPENDENCIES", "DebugProbesKt.bin")
        }
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    // ⚠️ 这些版本号是**查过 AAR 元数据后钉死的**，不是随手取「最新稳定版」。别顺手升级。
    //
    // 每个 AndroidX/OkHttp 构件的 aar-metadata.properties 里有 minCompileSdk 与
    // minAndroidGradlePluginVersion 两条硬门槛，达不到就是构建期直接失败。当前
    // AGP 8.13.2 的上限是 compileSdk 36，所以可用版本是：
    //
    //   androidx.core:core-ktx      1.19.1 → minAGP 9.1.0   ✗
    //                               1.18.0 → minAGP 8.9.1   ✓
    //   com.squareup.okhttp3:okhttp 5.5.0  → minCompileSdk 37 ✗
    //   （okhttp-android 是 okhttp 的传递依赖）
    //                               5.4.0  → minCompileSdk 36 ✓
    //   androidx.activity:activity  1.13.0 → minAGP 8.9.1   ✓
    //   androidx.webkit:webkit      1.17.1 → minAGP 7.2.0   ✓
    //
    // 想升级到最新版，必须连 AGP 与 Gradle 一起升（AGP 9.x + compileSdk 37）。
    // 那是有破坏性变更的一步，值得单开一次改动来做，不要混在功能改动里。

    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("androidx.activity:activity:1.13.0")

    // WebViewAssetLoader（把 assets/ 映射成 https:// 源）+ addDocumentStartJavaScript（注入桥接 shim）
    implementation("androidx.webkit:webkit:1.17.1")

    implementation("androidx.documentfile:documentfile:1.1.0")

    // 原生 HTTP：WebDAV 的 PROPFIND/MKCOL/PUT 必须走这里，不能走 WebView 的 fetch（跨域预检会被挡）
    implementation("com.squareup.okhttp3:okhttp:5.4.0")

    implementation("com.google.android.material:material:1.14.0")
}
