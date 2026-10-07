package ltd.banque.a4enext

import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

/**
 * 唯一的 Activity。里面几乎什么都不做——界面全在 WebView 里，
 * 这里只处理三件「WebView 自己搞不定」的事：
 *
 *   1. 系统返回键 —— 默认行为是**直接退出应用**，而不是走网页端的历史栈。
 *      这是安卓移植里最高频、也最容易漏的体验问题（用户一按就退出，以为崩了）。
 *   2. 安全区与系统栏 —— 把状态栏/手势条的 inset 以 CSS px 交给网页端避让，
 *      并让系统图标的明暗跟随应用主题。
 *   3. 切后台时把防抖窗口内的存储改动落盘。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var bridge: AndroidBridge
    private var lastBackAt = 0L
    private var runSmoke = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        // 先按浅色主题起（网页端设置项默认 isDark=false），
        // 网页端渲染出来后会用桥（setDarkTheme）报一次真实主题，见 applySystemBarsAppearance。
        applySystemBarsAppearance(dark = false)

        val app = application as App
        webView = WebView(this)
        app.store.webViewRef = webView
        bridge = AndroidBridge(
            // 桥在 WebView 之前建好，回调时才取实例——避免"先建桥再补引用"那种绕法
            webViewProvider = { webView },
            store = app.store,
            exporter = NativeExporter(this),
            versionName = BuildConfig.VERSION_NAME,
            onDarkThemeChange = { dark -> applySystemBarsAppearance(dark) },
        )

        runSmoke = intent?.getBooleanExtra(EXTRA_SMOKE, false) == true

        setupContent()
        setupBackHandling()

        if (savedInstanceState == null) {
            webView.loadUrl(WebViewSetup.START_URL)
        } else {
            webView.restoreState(savedInstanceState) ?: webView.loadUrl(WebViewSetup.START_URL)
        }
    }

    private fun setupContent() {
        val container = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            // 与启动窗口同色，避免 WebView 首帧之前的白闪
            setBackgroundColor(0xFF00838F.toInt())
        }
        container.addView(webView)
        setContentView(container)

        WebViewSetup.configure(
            webView,
            this,
            WebViewSetup.assetLoader(this),
        ) {
            // onPageFinished 一定在主线程，这里读 url 是安全的。
            // 把「当前页面确实是自家页面」这一判断固定下来给桥用——
            // 桥方法跑在后台线程，不能自己去读 webView.url（见 AndroidBridge.fromApp）。
            val url = webView.url
            bridge.pageIsOurs = url != null && url.startsWith("https://" + WebViewSetup.ASSET_HOST + "/")
            if (!bridge.pageIsOurs) {
                android.util.Log.w("MainActivity", "页面加载完成但来源不是本应用页面：" + url)
            }
            runSmokeIfRequested()
        }
        WebViewSetup.applyEdgeToEdge(webView)
        WebViewSetup.injectShim(webView)

        webView.addJavascriptInterface(bridge, AndroidBridge.JS_NAME)

        // 安全区：**只把量到的 inset 换算成 CSS px 交给网页端**，由 web/ 自己避让
        // （变量与规则见 web/src/styles.android.css）。原生侧不做任何布局猜测——
        // 避让逻辑留在 web/，与桌面端、浏览器端是同一套。
        //
        // ⚠️ 不要改回「给 WebView 加 padding」：WebView 的网页视口不含 View 的 padding，
        // 加了也不生效。0.3.4 真机上的表现就是"内容直接顶着状态栏显示"（2026-10-07，SM-S9380）。
        ViewCompat.setOnApplyWindowInsetsListener(container) { _, insets ->
            val json = safeAreaJson(insets)
            if (json != bridge.safeAreaJson) {
                bridge.safeAreaJson = json
                WebViewSetup.applySafeArea(webView)
            }
            insets
        }
    }

    /**
     * 系统栏 inset → CSS px 的 JSON。
     *
     * 单位必须换算：WindowInsets 给的是物理像素，而 Blink 的 CSS px 是「物理像素 ÷ density」，
     * 直接把物理像素写进 CSS 变量在高密度屏上会差 2–4 倍。
     *
     * 取 systemBars 与 displayCutout 的较大值：横屏时刘海在左/右，而 systemBars 的左右是 0，
     * 只取其中一个都会漏。
     */
    private fun safeAreaJson(insets: WindowInsetsCompat): String {
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
        val density = resources.displayMetrics.density
        fun css(px: Int): Double {
            val v = maxOf(px, 0) / density.toDouble()
            return kotlin.math.round(v * 100) / 100.0
        }
        return JSONObject()
            .put("top", css(maxOf(bars.top, cutout.top)))
            .put("right", css(maxOf(bars.right, cutout.right)))
            .put("bottom", css(maxOf(bars.bottom, cutout.bottom)))
            .put("left", css(maxOf(bars.left, cutout.left)))
            .toString()
    }

    /**
     * 状态栏 / 导航栏图标的明暗跟随应用主题。
     *
     * 网页端主题可变（设置页有「深色」开关，见 web/src/ThemeProvider.tsx），
     * 而系统图标的明暗只能由原生设置 —— 不联动的话，深色主题下会出现
     * 「深色图标压在深色界面上」，时间和电量直接看不见。
     */
    private fun applySystemBarsAppearance(dark: Boolean) {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    private fun setupBackHandling() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    // 先问网页端：它管着自己的路由栈与浮层（底部卡片、对话框）。
                    webView.evaluateJavascript(BACK_PROBE_JS) { result ->
                        if (result?.trim('"') == "true") return@evaluateJavascript
                        if (webView.canGoBack()) {
                            webView.goBack()
                            return@evaluateJavascript
                        }
                        // 网页端也没得退了：连按两次才退出，避免误触
                        val now = System.currentTimeMillis()
                        if (now - lastBackAt < 2000) {
                            finish()
                        } else {
                            lastBackAt = now
                            android.widget.Toast
                                .makeText(this@MainActivity, "再按一次返回退出", android.widget.Toast.LENGTH_SHORT)
                                .show()
                        }
                    }
                }
            },
        )
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    /**
     * 冒烟自检：只有带 `--ez smoke true` 启动时才跑，正常启动完全不执行。
     *
     * 先等 2.5 秒再注入探针——`onPageFinished` 时 React 还在挂载，
     * 立刻查 `#root` 只会得到一个空 div。桌面端那份自检也做了同样的等待。
     */
    private fun runSmokeIfRequested() {
        if (!runSmoke) return
        webView.postDelayed(
            {
                // 版本号取自 BuildConfig（＝打进包里的 Android versionName）。
                // 探针会拿它和网页包体里烘进去的版本比对，两边不一致就说明有一处漏改了。
                //
                // 结果**不从这里取**：探针是 async IIFE，返回的是 Promise，
                // evaluateJavascript 序列化 Promise 恒为 {}。真正的结果由探针
                // console.log 出来、经 WebChromeClient.onConsoleMessage 落到 logcat。
                // 这个回调只用于确认"探针确实注入了"。
                webView.evaluateJavascript(
                    SmokeTest.probeJs(WebViewSetup.ASSET_HOST, BuildConfig.VERSION_NAME),
                ) { raw -> SmokeTest.noteCallback(raw) }
            },
            2500,
        )
    }

    override fun onPause() {
        super.onPause()
        // 防抖窗口内可能还有没落盘的改动；切后台是最可能被系统杀掉的时间点
        (application as App).store.flushBlocking()
    }

    override fun onDestroy() {
        bridge.shutdown()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        /**
         * 冒烟自检开关。用 `adb shell am start --ez smoke true ...` 触发。
         * 默认关闭——正常启动路径上不能有任何自检开销。
         */
        const val EXTRA_SMOKE = "smoke"

        /**
         * 问网页端「这次返回键你处理掉了吗」。
         * 网页端通过挂 `window.__4ENEXT_ANDROID_BACK__` 来接管：
         * 它把返回键翻译成一次合成的 Escape，于是界面里所有浮层的关闭逻辑都照常生效。
         * 返回 true 表示已消费，原生侧就不再动。
         */
        private const val BACK_PROBE_JS =
            "(function(){try{return window.__4ENEXT_ANDROID_BACK__?window.__4ENEXT_ANDROID_BACK__():false}catch(e){return false}})()"
    }
}
