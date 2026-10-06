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

/**
 * 唯一的 Activity。里面几乎什么都不做——界面全在 WebView 里，
 * 这里只处理三件「WebView 自己搞不定」的事：
 *
 *   1. 系统返回键 —— 默认行为是**直接退出应用**，而不是走网页端的历史栈。
 *      这是安卓移植里最高频、也最容易漏的体验问题（用户一按就退出，以为崩了）。
 *   2. 边到边布局与安全区 —— 刘海和手势条会遮住固定定位的元素。
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
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }

        val app = application as App
        webView = WebView(this)
        app.store.webViewRef = webView
        bridge = AndroidBridge(
            // 桥在 WebView 之前建好，回调时才取实例——避免"先建桥再补引用"那种绕法
            webViewProvider = { webView },
            store = app.store,
            exporter = NativeExporter(this),
            versionName = BuildConfig.VERSION_NAME,
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

        // 安全区：把系统栏 inset 交给网页端，由它用 env(safe-area-inset-*) 与自身布局避让。
        // 原生侧不做布局猜测——避让逻辑留在 web/，与桌面端、浏览器端是同一套。
        ViewCompat.setOnApplyWindowInsetsListener(container) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            webView.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
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
