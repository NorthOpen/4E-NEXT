# R8/ProGuard 规则。当前 **release 关闭了 minify**（见 build.gradle.kts 里的说明），
# 所以这个文件暂时不生效——保留它是为了两件事：
#   1) 构建脚本引用了它，缺文件会报错；
#   2) 将来真要开 R8 时，下面这些规则必须已经在。
#
# ⚠️ 关键：**桥接方法名不能被混淆。**
# 网页端是按名字调的：
#     window.__4ENEXT_ANDROID_NATIVE__.storageGetItem(...)
#     window.__4ENEXT_ANDROID_NATIVE__.httpRequest(...)
# 这些名字一旦被 R8 改写，画面能打开、存储却全废——而且只在运行时暴露。
-keepclassmembers class ltd.banque.a4enext.AndroidBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class ltd.banque.a4enext.AndroidBridge { *; }

# WebView 通过反射调 @JavascriptInterface，注解本身也要留住
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable

# OkHttp 在部分路径上会读这些可选依赖，缺失属正常，不必警告
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
