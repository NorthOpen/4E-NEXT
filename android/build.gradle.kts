// 顶层构建脚本。
//
// 只声明插件版本，不在这里 apply —— 各模块自己 apply（见 app/build.gradle.kts）。
//
// 版本选择原则：**不追新**。AGP 9.x 有 Variant API 强制化的破坏性变更，
// 会连带影响插件生态；这里钉在 8.13.x，配 Gradle 8.14.3（见 gradle-wrapper.properties）。

plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.21" apply false
}
