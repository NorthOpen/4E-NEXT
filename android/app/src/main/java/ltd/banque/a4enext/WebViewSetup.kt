package ltd.banque.a4enext

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream

/**
 * WebView 的装配。整个安卓壳里最容易出事的一段，所以规则都写在这里。
 */
object WebViewSetup {

    /** 资源源。`https://` 而不是自定义 scheme——见 loadUrl 的说明。 */
    const val ASSET_HOST = "appassets.androidplatform.net"
    const val START_URL = "https://$ASSET_HOST/assets/www/index.html"

    /** 原生能力走这个虚拟路径，由 shouldInterceptRequest 拦下。 */
    private const val API_PREFIX = "/__api/"

    const val API_PROBE_PATH = API_PREFIX + "probe"

    /**
     * 桥接 shim。在**任何页面脚本之前**注入（见 MainActivity 里的
     * `addDocumentStartJavaScript`），因为 `web/src/platform/android.ts` 在模块求值阶段
     * 就会读 `window.__4ENEXT_ANDROID__.version`，晚一步就是 undefined。
     *
     * 这里刻意不写 TypeScript 源码：它必须在 WebView 里、以字符串形式、
     * 在打包产物之前执行。所以它是壳的一部分，不是 web/ 的一部分。
     */
    val BRIDGE_SHIM: String = """
    (function () {
      var N = window.${AndroidBridge.JS_NAME};
      if (!N) { console.error('[4enext] 原生桥未注入'); return; }
      var seq = 1;
      var cb = {};
      window.${AndroidBridge.CALLBACK_REGISTRY} = cb;

      /*
       * 安全区：把原生量到的系统栏 inset 挂成 CSS 变量，并在 <html> 上打 data-shell="android"。
       * 样式在 web/src/styles.android.css —— 整批规则只在壳里生效，浏览器 / 桌面端一条都不匹配。
       *
       * 为什么不让 CSS 直接用 env(safe-area-inset-*)：
       * Android WebView 的安全区只覆盖刘海，**不含状态栏与手势条**，env() 在壳里恒为 0。
       * 所以必须由原生给数。这里在 document-start 与 DOMContentLoaded 各读一次，
       * 之后 inset 变化（旋转、手势条切换、折叠屏展开）由原生反向调用本函数刷新。
       */
      function applySafeArea() {
        var root = document.documentElement;
        if (!root) return;
        var s;
        try { s = JSON.parse(N.safeInsets()); } catch (e) { return; }
        if (!s) return;
        root.setAttribute('data-shell', 'android');
        var st = root.style;
        st.setProperty('--ae-inset-top', s.top + 'px');
        st.setProperty('--ae-inset-right', s.right + 'px');
        st.setProperty('--ae-inset-bottom', s.bottom + 'px');
        st.setProperty('--ae-inset-left', s.left + 'px');
      }
      window.__4ENEXT_APPLY_SAFE_AREA__ = applySafeArea;
      applySafeArea();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applySafeArea);
      } else {
        applySafeArea();
      }

      function call(kind, payload) {
        return new Promise(function (resolve, reject) {
          var id = seq++;
          cb[id] = function (raw) {
            var data;
            try { data = JSON.parse(raw); } catch (e) { reject(new Error('原生回调不是合法 JSON')); return; }
            if (data && data.error) { reject(new Error(data.error)); return; }
            resolve(data);
          };
          try {
            if (kind === 'http') { N.httpRequest(JSON.stringify(payload)); }
            else { N.saveFile(JSON.stringify(payload)); }
          } catch (e) {
            delete cb[id];
            reject(e);
          }
        });
      }
      function toBase64(bytes) {
        var chunk = 0x8000, out = '';
        for (var i = 0; i < bytes.length; i += chunk) {
          out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(out);
      }
      window.__4ENEXT_ANDROID__ = {
        version: String(N.version()),
        // 应用主题（深色/浅色）→ 状态栏与导航栏图标的明暗。网页端在主题变化时调用，
        // 见 web/src/ThemeProvider.tsx。
        setDarkTheme: function (dark) { try { N.setDarkTheme(!!dark); } catch (e) {} },
        storage: {
          getItem: function (k) { var v = N.storageGetItem(String(k)); return (v === undefined || v === null) ? null : v; },
          setItem: function (k, v) { N.storageSetItem(String(k), String(v)); },
          removeItem: function (k) { N.storageRemoveItem(String(k)); },
          keys: function () { try { return JSON.parse(N.storageKeys()); } catch (e) { return []; } },
          usage: function () { try { return JSON.parse(N.storageUsage()); } catch (e) { return { used: 0, total: 0, keys: 0 }; } }
        },
        saveFile: function (payload) {
          var out = { filename: String(payload.filename) };
          if (payload.bytes) { out.bytesBase64 = toBase64(payload.bytes); }
          else { out.text = payload.text == null ? '' : String(payload.text); }
          return call('save', out);
        },
        http: function (req) {
          return call('http', {
            url: String(req.url),
            method: String(req.method || 'GET'),
            headers: req.headers || {},
            body: req.body == null ? null : String(req.body),
            timeoutMs: req.timeoutMs || 30000
          });
        }
      };
    })();
    """.trimIndent()

    @SuppressLint("SetJavaScriptEnabled")
    fun configure(
        view: WebView,
        context: Context,
        assetLoader: WebViewAssetLoader,
        onPageFinished: (() -> Unit)? = null,
    ) {
        val settings = view.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // 不设 databaseEnabled：它对应的是早已从 Chromium 移除的 Web SQL Database，
        // 设了没有作用，Android 上还会给废弃警告。IndexedDB 由 domStorageEnabled 覆盖。

        // 与网页端/桌面端同形：整页由 CSS 控制缩放，不靠 WebView 的缩放
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.textZoom = 100
        settings.mediaPlaybackRequiresUserGesture = true

        // 允许混合内容（用户自建 WebDAV 可能是 http://）。默认在 targetSdk 高版本是禁止的，
        // 而局域网里的 http WebDAV 是真实使用场景，所以放开到 COMPATIBILITY 而不是全部放行。
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.allowFileAccess = false
        settings.allowContentAccess = false

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 强制暗色会让网页端自己的主题失效——主题由应用内的 MD3 取色控制。
            // 这里用已废弃的 forceDark 而不是 isForceDarkAllowed：后者在 android.webkit.WebSettings 上的
            // setter 是 @hide（只有 androidx.webkit 的包装类才暴露），直接用会编译不过。
            @Suppress("DEPRECATION")
            settings.forceDark = WebSettings.FORCE_DARK_OFF
        }

        view.setBackgroundColor(Color.TRANSPARENT)
        view.isVerticalScrollBarEnabled = true
        view.overScrollMode = WebView.OVER_SCROLL_IF_CONTENT_SCROLLS

        view.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                val text = msg.message()
                // 冒烟自检的结果混在普通日志里不容易看，单独成段打到专属 tag，
                // 于是 `adb logcat -s 4enext-smoke` 就能一次拿全。
                val parsed = SmokeTest.parseConsoleLine(text)
                if (parsed != null) {
                    android.util.Log.i(SmokeTest.TAG, parsed.first)
                    for (line in parsed.second) android.util.Log.i(SmokeTest.TAG, line)
                    return true
                }
                // 其余一律转发到 logcat，tag 统一，便于真机上用 adb logcat 排错
                android.util.Log.d(
                    "4enext-web",
                    "${msg.message()} @ ${msg.sourceId()}:${msg.lineNumber()}",
                )
                return true
            }
        }

        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView, url: String) {
                super.onPageFinished(v, url)
                onPageFinished?.invoke()
            }

            override fun shouldInterceptRequest(
                v: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                // 原生能力探针：给冒烟自检用，用来证明「原生网络通路」确实在
                if (request.url.host == ASSET_HOST && request.url.path?.startsWith(API_PREFIX) == true) {
                    val body = """{"ok":true,"native":true,"version":"${BuildConfig.VERSION_NAME}"}"""
                    return WebResourceResponse(
                        "application/json",
                        "utf-8",
                        200,
                        "OK",
                        mapOf("Cache-Control" to "no-store"),
                        ByteArrayInputStream(body.toByteArray(Charsets.UTF_8)),
                    )
                }
                return assetLoader.shouldInterceptRequest(request.url)
            }

            /**
             * 一律不让 WebView 自己导航到外部站点：外链交给系统浏览器。
             * 与桌面端「外链交给系统浏览器打开」是同一条规则。
             *
             * **这不只是体验问题，是安全边界。** `addJavascriptInterface` 注册的桥
             * 对 WebView 里**任何**页面都是可见的：一旦让外部页面在本 WebView 里加载并执行 JS，
             * 它就能读写全部本地数据、借原生网络通路探测内网、经 FileProvider 外发文件。
             * 桌面端对应的是 `isAppFrame` 那道校验（见 desktop/main/main.js）；
             * 这里靠两道防线：本方法阻止外部页面加载，AndroidBridge 里再按 webView.url 复核一次。
             *
             * 该方法在 API 24+ 对主框架与 iframe 都会被调用，所以子框架也一并挡住。
             */
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                return if (url.host == ASSET_HOST) {
                    false
                } else {
                    try {
                        context.startActivity(
                            android.content.Intent(android.content.Intent.ACTION_VIEW, url).apply {
                                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                            },
                        )
                    } catch (_: Throwable) {
                        // 没有能处理这个 scheme 的应用就静默忽略，别崩
                    }
                    true
                }
            }
        }
    }

    /**
     * 注册 document-start 脚本。
     *
     * `addDocumentStartJavaScript` 需要 WebViewFeature 支持；不支持时退回
     * 「在 onPageStarted 里 evaluateJavascript」——那个时机对首屏脚本来说仍然够早，
     * 因为 React 包是 module script，要等 DOM 解析后才执行。
     */
    fun injectShim(view: WebView, script: String = BRIDGE_SHIM) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*"))
                return
            } catch (_: Throwable) {
                // 落到下面的兜底
            }
        }
        view.evaluateJavascript(script, null)
    }

    fun assetLoader(context: Context): WebViewAssetLoader = WebViewAssetLoader.Builder()
        .setDomain(ASSET_HOST)
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    /**
     * 让页面重新读一次安全区（旋转、手势条切换、折叠屏展开等 inset 变化时调用）。
     *
     * 首屏**不依赖**这里：shim 会在 document-start 与 DOMContentLoaded 各读一次（见 [BRIDGE_SHIM]）。
     * 页面还没就绪或已经销毁时调用都是无害的空操作。
     */
    fun applySafeArea(view: WebView) {
        view.post {
            try {
                view.evaluateJavascript(
                    "window.__4ENEXT_APPLY_SAFE_AREA__&&window.__4ENEXT_APPLY_SAFE_AREA__();",
                    null,
                )
            } catch (_: Throwable) {
                // 页面已经销毁：没有接收方，丢弃即可
            }
        }
    }

    /**
     * 让 WebView 铺满整屏（含刘海与手势条区域），由网页端的 safe-area 自己避让。
     *
     * ⚠️ 这里必须用 `FrameLayout.LayoutParams`，不能用 `ViewGroup.LayoutParams`。
     * 后者在 FrameLayout 里会在 `measureChildWithMargins` 被强转成 `MarginLayoutParams` 而崩溃：
     *   `ClassCastException: ViewGroup$LayoutParams cannot be cast to ViewGroup$MarginLayoutParams`
     *
     * 这个坑只在真机上暴露——编译期毫无提示，单元测试也覆盖不到，
     * 而表现是**一打开就闪退**。第一次连真机跑自检时就是这么挂的（2026-10-07，SM-S9380）。
     * 根因是 FrameLayout 的 measure 路径要求子 View 的 LayoutParams 是 MarginLayoutParams 的子类，
     * 而 `ViewGroup.LayoutParams` 正是那个基类。
     */
    fun applyEdgeToEdge(view: WebView) {
        view.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        view.setPadding(0, 0, 0, 0)
        view.isNestedScrollingEnabled = true
    }
}
