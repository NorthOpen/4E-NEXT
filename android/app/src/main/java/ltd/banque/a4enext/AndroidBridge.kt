package ltd.banque.a4enext

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * 原生桥。
 *
 * 形态与桌面端的 `preload.js` **刻意保持一致**——同一个 `window.__4ENEXT_*` 形状的契约，
 * 同一批方法名，同一套同步/异步划分：
 *
 *   同步（@JavascriptInterface 直接返回）：存储读、版本、用量
 *     —— 因为 `PlatformStorage` 的接口就是同步的，改成异步会牵动几十处调用点，
 *        网页端也得跟着改，违反「安卓端不影响网页端」。
 *   异步（回调 ID 回传）：HTTP、导出
 *     —— 这两件事本来就要等网络/磁盘，且必须离开 WebView 线程。
 *
 * 为什么不用 `addWebMessageListener`：它要求 `WebViewFeature` 支持，
 * 而且要在 `WebViewCompat` 与平台 API 之间做分支。这里网络请求是唯一的重活，
 * 用「@JavascriptInterface 发起 + evaluateJavascript 回调」反而更少意外，
 * 也不需要升级任何特性检测。
 */
class AndroidBridge(
    private val webViewProvider: () -> WebView,
    private val store: NativeStore,
    private val exporter: NativeExporter,
    private val versionName: String,
    /**
     * 网页端报告应用主题（深色 / 浅色）时回调，由宿主切换状态栏与导航栏图标的明暗。
     * 回调在**主线程**被调用（见 [setDarkTheme]）。
     */
    private val onDarkThemeChange: (Boolean) -> Unit = {},
) {

    companion object {
        /** 与桌面端 preload.js 暴露的对象名对应；这里是安卓侧的原生对象名。 */
        const val JS_NAME = "__4ENEXT_ANDROID_NATIVE__"

        /**
         * 桥接调用逐条打日志。默认关闭——正常运行时每次读写都打日志既吵又影响性能。
         * 调试「存储静默失效」这类问题时把它打开（真机自检时很有用）。
         */
        const val DIAG = false

        /** 回调注册表挂在 window 上的属性名。由 document-start 注入的 shim 创建。 */
        const val CALLBACK_REGISTRY = "__4ENEXT_ANDROID_CB__"
    }

    private val main = Handler(Looper.getMainLooper())
    private val network = Executors.newFixedThreadPool(4) { r ->
        Thread(r, "4enext-http").apply { isDaemon = true }
    }
    private val exports = Executors.newSingleThreadExecutor { r ->
        Thread(r, "4enext-save").apply { isDaemon = true }
    }
    private val nextId = AtomicLong(1)
    private val pending = ConcurrentHashMap<Long, Boolean>()

    /** 来源校验失败只报一次，避免刷屏。 */
    private val warnedOrigin = java.util.concurrent.atomic.AtomicBoolean(false)

    /**
     * 第二道防线：确认这次调用来自**我们自己的页面**。
     *
     * `addJavascriptInterface` 注册的桥对 WebView 里**任何**页面可见，
     * 而它背后握着全部本地数据、一条原生网络通路（可探测内网）和文件导出能力。
     * 一旦某个外部页面在本 WebView 里执行了 JS，这些就全归它了。
     *
     * 第一道防线是 `WebViewClient.shouldOverrideUrlLoading`（阻止外部页面加载）。
     * 那一道已经足够，但这里再按实际 URL 复核一次——两道防线都很便宜，
     * 而漏掉的代价（用户数据外泄 + SSRF）不成比例。
     *
     * 桌面端对应的是 `isAppFrame`（见 desktop/main/main.js），规则一致。
     */
    /**
     * 第二道防线：确认这次调用来自**我们自己的页面**。
     *
     * `addJavascriptInterface` 注册的桥对 WebView 里**任何**页面可见，
     * 而它背后握着全部本地数据、一条原生网络通路（可探测内网）和文件导出能力。
     * 一旦某个外部页面在本 WebView 里执行了 JS，这些就全归它了。
     *
     * 第一道防线是 `WebViewClient.shouldOverrideUrlLoading`（阻止外部页面加载）。
     * 这里再按实际 URL 复核一次——两道防线都很便宜，而漏掉的代价不成比例。
     * 桌面端对应的是 `isAppFrame`（见 desktop/main/main.js），规则一致。
     *
     * ⚠️ **不要在桥方法里直接读 `webView.url`。** 那是 WebView 的 UI 状态，
     * 必须在主线程访问；而 `@JavascriptInterface` 方法是在 WebView 的
     * JavaBridge 线程上被调用的。在后台线程读 `url` 会拿不到值（或抛异常），
     * 于是守卫恒为 false——**读操作静默返回 null，写操作直接丢弃**。
     *
     * 这个坑 2026-10-07 在真机上表现为「数据存不住」：
     * 界面一切正常、读写都不报错，但重启后全丢。所以真值改由主线程
     * 在 `onPageFinished` 时写入 [pageIsOurs]，这里只读那个标志。
     */
    private fun fromApp(): Boolean {
        if (pageIsOurs) return true
        // 兜底：万一标志还没置上（例如 onPageFinished 尚未回调），
        // 再试一次直接读——但只在主线程上试，避免上面那个坑。
        if (android.os.Looper.myLooper() !== android.os.Looper.getMainLooper()) return false
        val url = try {
            webViewProvider().url
        } catch (_: Throwable) {
            null
        }
        val ok = url != null && url.startsWith("https://" + WebViewSetup.ASSET_HOST + "/")
        if (!ok && warnedOrigin.compareAndSet(false, true)) {
            android.util.Log.w(
                AndroidBridge::class.java.simpleName,
                "桥接调用被来源校验拒绝：webView.url=" + (url ?: "(null)") +
                    "，期望前缀 https://" + WebViewSetup.ASSET_HOST + "/",
            )
        }
        return ok
    }

    /** 由主线程在页面加载完成时置位。见 [fromApp] 的说明。 */
    @Volatile
    var pageIsOurs: Boolean = false

    /**
     * 最近一次量到的系统栏安全区，形如 `{"top":44.0,"right":0.0,"bottom":24.0,"left":0.0}`（单位 CSS px）。
     * 由主线程在 inset 变化时写入；[safeInsets] 只读它，不自己去碰 window。
     */
    @Volatile
    var safeAreaJson: String = """{"top":0.0,"right":0.0,"bottom":0.0,"left":0.0}"""

    // ---------------------------------------------------------------- 同步能力

    @JavascriptInterface
    fun version(): String = versionName

    /**
     * 系统栏安全区（CSS px），由主线程在 inset 变化时写入 [safeAreaJson]。
     *
     * **刻意不做 [fromApp] 来源校验**：document-start 注入的 shim 会在页面脚本之前读它，
     * 而那时 `pageIsOurs` 还没置位（它在 onPageFinished 才写），并且本方法跑在
     * JavaBridge 线程上、走不了主线程兜底 —— 加了守卫就恒返回 0，状态栏留白会时有时无。
     * 它暴露的内容只有「状态栏/手势条有多高」，既不含用户数据也不构成任何能力，
     * 与存储、原生 HTTP、导出那几条（都照旧走 fromApp）不是一回事。
     */
    @JavascriptInterface
    fun safeInsets(): String = safeAreaJson

    /**
     * 网页端在主题切换时报告明暗（见 `web/src/ThemeProvider.tsx`），
     * 用来把状态栏/导航栏的图标换成深色或浅色 —— 否则深色主题下系统图标是深色的，
     * 压在同为深色的界面上等于看不见。
     *
     * 同 [safeInsets]：不加来源校验（首屏渲染发生在 onPageFinished 之前），
     * 它的全部作用就是换个图标明暗，没有可利用面。
     */
    @JavascriptInterface
    fun setDarkTheme(dark: Boolean) {
        main.post { onDarkThemeChange(dark) }
    }

    @JavascriptInterface
    fun storageGetItem(key: String): String? {
        val v = if (fromApp()) store.getItem(key) else null
        if (DIAG) android.util.Log.i("4enext-bridge", "storageGetItem(" + key + ") -> " + (v ?: "(null)"))
        return v
    }

    @JavascriptInterface
    fun storageSetItem(key: String, value: String) {
        if (!fromApp()) return
        store.setItem(key, value)
        if (DIAG) android.util.Log.i("4enext-bridge", "storageSetItem(" + key + ", " + value + ")")
    }

    @JavascriptInterface
    fun storageRemoveItem(key: String) {
        if (!fromApp()) return
        store.removeItem(key)
    }

    @JavascriptInterface
    fun storageKeys(): String {
        val arr = org.json.JSONArray()
        // 显式成环而不是 JSONObject.wrap(list)：wrap 的返回是 Any?，
        // 直接 .toString() 会被判成「可空接收者」而给出警告，且真为 null 时会 NPE。
        if (fromApp()) {
            for (k in store.keys()) arr.put(k)
        }
        return arr.toString()
    }

    @JavascriptInterface
    fun storageUsage(): String {
        val (used, total, keys) = if (fromApp()) store.usage() else Triple(0L, 0L, 0)
        return JSONObject()
            .put("used", used)
            .put("total", total)
            .put("keys", keys)
            .toString()
    }

    // ---------------------------------------------------------------- 异步能力

    /**
     * 发起一次原生 HTTP 请求，完成后回调 `window.__4ENEXT_ANDROID_CB__[id](payload)`。
     *
     * 返回值只是「已受理」；真正的结果走回调。调用方（shim）负责把它包成 Promise。
     */
    @JavascriptInterface
    fun httpRequest(reqJson: String): String {
        val id = nextId.getAndIncrement()
        if (!fromApp()) {
            postResult(id, error = "拒绝：调用方不是本应用页面")
            return id.toString()
        }
        val req = try {
            JSONObject(reqJson)
        } catch (t: Throwable) {
            postResult(id, error = "请求参数不是合法 JSON：" + (t.message ?: ""))
            return id.toString()
        }

        val url = req.optString("url", "")
        if (url.isEmpty()) {
            postResult(id, error = "请求地址为空")
            return id.toString()
        }
        val method = req.optString("method", "GET").ifEmpty { "GET" }
        val body = if (req.isNull("body")) null else req.optString("body", "").ifEmpty { null }
        val timeout = req.optLong("timeoutMs", 30_000L)
        val headers = LinkedHashMap<String, String>()
        req.optJSONObject("headers")?.let { obj ->
            for (k in obj.keys()) headers[k] = obj.optString(k, "")
        }

        pending[id] = true
        network.execute {
            val result = NativeHttp.execute(url, method, headers, body, timeout)
            postResult(
                id,
                payload = JSONObject()
                    .put("status", result.status)
                    .put("ok", result.status in 200..299)
                    .put("headers", JSONObject.wrap(result.headers))
                    .put("bodyText", result.bodyText)
                    .apply { if (result.error != null) put("error", result.error) },
            )
        }
        return id.toString()
    }

    @JavascriptInterface
    fun saveFile(payloadJson: String): String {
        val id = nextId.getAndIncrement()
        if (!fromApp()) {
            postResult(id, error = "拒绝：调用方不是本应用页面")
            return id.toString()
        }
        val payload = try {
            JSONObject(payloadJson)
        } catch (t: Throwable) {
            postResult(id, error = "保存参数不是合法 JSON：" + (t.message ?: ""))
            return id.toString()
        }
        val filename = payload.optString("filename", "4enext-export")
        val text = if (payload.isNull("text")) null else payload.optString("text", "")
        val bytes = if (payload.isNull("bytesBase64")) null else payload.optString("bytesBase64", "")

        pending[id] = true
        exports.execute {
            exporter.share(filename, text, bytes) { result ->
                postResult(id, payload = result)
            }
        }
        return id.toString()
    }

    // ---------------------------------------------------------------- 回调回传

    private fun postResult(id: Long, payload: JSONObject? = null, error: String? = null) {
        if (pending.remove(id) == null) return
        val body = payload ?: JSONObject().put("ok", false).put("error", error ?: "未知错误")
        val script = "window.$CALLBACK_REGISTRY&&window.$CALLBACK_REGISTRY[$id]&&window.$CALLBACK_REGISTRY[$id](${JSONObject.quote(body.toString())});delete window.$CALLBACK_REGISTRY[$id];"
        main.post {
            try {
                webViewProvider().evaluateJavascript(script, null)
            } catch (_: Throwable) {
                // 页面已经销毁：结果没人接，丢弃即可
            }
        }
    }

    fun shutdown() {
        network.shutdownNow()
        exports.shutdownNow()
        pending.clear()
    }
}
