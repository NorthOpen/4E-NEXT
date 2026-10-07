package ltd.banque.a4enext

/**
 * 冒烟自检（安卓端）。与 `desktop/main/main.js` 里的 `--smoke` 是同一套思路：
 * 在**真实外壳里**跑一遍关键能力，逐条打印 PASS/FAIL，而不是靠肉眼看界面猜。
 *
 * 为什么值得写：界面能打开不代表桥接能用。存储、原生 HTTP、IndexedDB、字体加载
 * 这几件事任何一件坏掉，界面都还是"看起来正常"，直到用户发现卡存不上。
 *
 * 结果通过 console.log 输出，tag 为 `4enext-smoke`，用
 *   adb logcat -s 4enext-smoke
 * 即可取回。
 */
object SmokeTest {

    const val TAG = "4enext-smoke"
    private const val PROBE_PREFIX = "4ENEXT_SMOKE_RESULT:"

    /**
     * 在页面里跑的探针，执行完返回一行 `PROBE_PREFIX + JSON`。
     *
     * 注意这是 Kotlin 的原始字符串：JS 里的 `$` 必须写成 `${'$'}`，
     * 否则 Kotlin 会把它当成模板变量去求值，编译期就报「未解析的引用」。
     * 其余动态值一律走占位符，由 [probeJs] 替换。
     */
    private val PROBE_TEMPLATE: String = """
    (async function () {
      var rows = [];
      function add(name, ok, detail) {
        rows.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail) });
      }
      function fin() {
        // 必须在这里 console.log：探针是 async IIFE，
        // evaluateJavascript 拿到的是 Promise，序列化永远是 {}。
        // 结果只能从页面里主动吐出来，再由 onConsoleMessage 接住。
        console.log('__PROBE_PREFIX__' + JSON.stringify(rows));
        return '__PROBE_PREFIX__' + JSON.stringify(rows);
      }
      try {
        // 1. 资源加载：能跑到这里就说明 index.html 从 assets 出来了
        add('appassets 加载 index.html', true, location.href);

        // 2. 桥接注入。没有它，存储/导出/同步全部不可用
        var B = window.__4ENEXT_ANDROID__;
        if (!B) {
          add('原生桥已注入', false, 'window.__4ENEXT_ANDROID__ 不存在');
          return fin();
        }
        add('原生桥已注入', true);

        // 3. 版本号三处对齐：
        //      · B.version          —— 原生桥报的（BuildConfig.VERSION_NAME）
        //      · @@BAKED_VERSION@@  —— 打进安卓包的 versionName
        //      · 侧栏 DOM 上渲染出来的 —— 网页包体里烘进去的 web/package.json 版本
        //    最后一条才是真正的交叉核对：它证明"网页那份产物"和"安卓这个包"是同一个版本。
        //    所以要等 React 真的渲染出侧栏再读，而不是假设它已经在了。
        var nativeVersion = String(B.version || '');
        add('应用版本可读', nativeVersion.length > 0, '原生=' + nativeVersion);

        var rendered = '';
        for (var attempt = 0; attempt < 40; attempt++) {
          var el = document.querySelector('.rail-version');
          if (el && el.textContent) { rendered = el.textContent.replace(/^v/, '').trim(); break; }
          await new Promise(function (r) { setTimeout(r, 250); });
        }
        add('侧栏渲染出应用版本', rendered.length > 0, '侧栏显示=' + (rendered || '(未渲染)'));
        add('原生与包体版本一致', rendered.length > 0 && rendered === nativeVersion, nativeVersion + ' vs ' + rendered);
        add('与安卓包 versionName 一致', nativeVersion === '@@BAKED_VERSION@@', nativeVersion + ' vs @@BAKED_VERSION@@');

        // 4. 存储：写入 / 读回 / 删除，三步都要对
        var probeKey = '__smoke_probe__';
        var probeVal = 'ok-' + Date.now();
        var beforeKeys = B.storage.keys().length;

        // 先直连原生对象（不经 shim），把「原生方法不可用」与「shim 写错」区分开
        var rawNative = window.${AndroidBridge.JS_NAME};
        add('原生对象可直连', !!rawNative);

        B.storage.setItem(probeKey, probeVal);
        var readBack = B.storage.getItem(probeKey);
        add('平台存储 写/读', readBack === probeVal, '写入 ' + probeVal.length + ' 字符');
        var afterKeys = B.storage.keys().length;
        add('存储 keys() 计数', afterKeys === beforeKeys + 1, beforeKeys + ' -> ' + afterKeys);

        var usage = B.storage.usage();
        add(
          '存储 usage() 形状',
          typeof usage.used === 'number' && typeof usage.total === 'number' && usage.used > 0 && usage.total > usage.used,
          'used=' + usage.used + ' total=' + usage.total + ' keys=' + usage.keys
        );

        B.storage.removeItem(probeKey);
        add('平台存储 删除', B.storage.getItem(probeKey) === null);

        // 5. 随包数据：40MB 内嵌数据能否被 fetch 读到
        var mf = await fetch('./data/manifest.json').then(function (r) { return r.status; }).catch(function (e) { return 'err:' + e.message; });
        add('fetch data/manifest.json', mf === 200, 'status=' + mf);

        var big = await fetch('./data/categories/power.json')
          .then(function (r) { return r.text(); })
          .then(function (t) { return t.length; })
          .catch(function (e) { return -1; });
        add('fetch 19MB power.json', big > 1000000, 'len=' + big);

        // 6. IndexedDB：立绘与大图缓存的载体
        var idb = await new Promise(function (res) {
          try {
            var q = indexedDB.open('__smoke_db', 1);
            q.onupgradeneeded = function () { q.result.createObjectStore('s'); };
            q.onsuccess = function () { q.result.close(); indexedDB.deleteDatabase('__smoke_db'); res(true); };
            q.onerror = function () { res(false); };
          } catch (e) { res(false); }
        });
        add('IndexedDB 可用', idb);

        // 7. React 真的渲染出来了（而不是一片空白）
        var rootEl = document.getElementById('root');
        var rootLen = rootEl && rootEl.innerHTML ? rootEl.innerHTML.length : 0;
        add('React 已渲染', rootLen > 1000, 'root.innerHTML=' + rootLen + ' 字符');

        // 8. 字体：离线内置是否生效（不该再有任何指向外部字体服务的引用）
        var cdnLinks = document.querySelectorAll('link[href*=zeoseven], link[href*=gstatic]').length;
        add('字体：无外部字体服务引用', cdnLinks === 0, '外部字体 link 数 = ' + cdnLinks);

        var joined = '';
        var familyList = [];
        try {
          // 用 FontFaceSet.forEach，不用 Array.prototype.slice.call ——
          // 真机上后者会把 FontFaceSet 转成空数组（迭代器协议在这个 WebView 上不通），
          // 于是"字体其实已注册"被误判成"没注册"。
          document.fonts.forEach(function (f) {
            if (familyList.indexOf(f.family) < 0) familyList.push(f.family);
            joined += f.family + ':' + f.status + '|';
          });
        } catch (e) {}
        add('字体：族名', true, familyList.join(' , '));
        add('字体：衬线体已注册', familyList.indexOf('Chiron Sung HK VF') >= 0);
        add('字体：无衬线体已注册', familyList.indexOf('Chiron Hei HK VF') >= 0);
        var loaded = (joined.match(/:loaded/g) || []).length;
        add('字体：已加载分片', loaded > 0, loaded + ' 个 FontFace 已加载');
        add('Material Symbols 已内置', document.fonts.check('24px "Material Symbols Outlined"'));

        // 9. 安全区：刘海屏避让依赖 viewport-fit=cover，否则 inset 恒为 0
        var vp = document.querySelector('meta[name=viewport]');
        add('viewport-fit=cover 已注入', !!vp && /viewport-fit\s*=\s*cover/.test(vp.getAttribute('content') || ''));

        // 9b. 安全区**真的量到并生效**没有。
        //     只查 viewport-fit 是不够的：Android WebView 的 env(safe-area-inset-*)
        //     只覆盖刘海、不含状态栏与手势条，所以壳把真实 inset 以 CSS 变量下发
        //     （--ae-inset-* + data-shell="android"，规则见 web/src/styles.android.css）。
        //     这里断的是「下发链路通」+「页面确实按它让出了顶部」——
        //     0.3.4 恰好就是这两条的断点：原生算出来了却没生效，界面上表现为内容顶着状态栏。
        var shellAttr = document.documentElement.getAttribute('data-shell');
        var aeTop = (getComputedStyle(document.documentElement).getPropertyValue('--ae-inset-top') || '').trim();
        var appEl = document.querySelector('.app');
        var appPadTop = appEl ? parseFloat(getComputedStyle(appEl).paddingTop) : -1;
        add(
          '安全区：原生 inset 已下发且顶部已让出',
          shellAttr === 'android' &&
            /^[0-9.]+px/.test(aeTop) &&
            appPadTop >= 0 &&
            appPadTop + 0.5 >= parseFloat(aeTop) &&
            appPadTop > 0,
          'data-shell=' + shellAttr + ' --ae-inset-top=' + (aeTop || '(空)') + ' .app padding-top=' + appPadTop + 'px'
        );

        // 10. 原生 HTTP 探针通路：走 appassets 上的虚拟路径，证明 shouldInterceptRequest 的分支在。
        //     注意这里的协议头在 Kotlin 侧拼（见 probeJs），因为原始字符串里写 $ 会被当成模板变量。
        var probe = await fetch('@@ORIGIN@@/__api/probe')
          .then(function (r) { return r.json(); })
          .catch(function (e) { return { error: e.message }; });
        add('原生 HTTP 探针通路', probe && probe.native === true, JSON.stringify(probe));

        return fin();
      } catch (err) {
        add('冒烟检查执行', false, err && err.message ? err.message : String(err));
        return fin();
      }
    })();
    """.trimIndent()

    /**
     * 生成最终要注入的探针：把占位符换成真实值。
     *
     * 三处刻意留给这里替换：
     *   · `@@BAKED_VERSION@@` —— 必须是**构建期烘进网页包体的那份版本号**，用来和原生
     *     `BuildConfig.VERSION_NAME` 交叉核对。不能指望 vite 的 define 来替：
     *     kotlin 源文件不在 vite 的模块图里，`__APP_VERSION__` 在那儿是未定义标识符。
     *   · `@@ORIGIN@@` —— 原始字符串里写 `$` 会被 Kotlin 当成模板变量，只能在这里拼。
     *   · `__PROBE_PREFIX__` —— 同理，避免 `$`。
     */
    fun probeJs(assetHost: String, bakedVersion: String): String = PROBE_TEMPLATE
        .replace("__PROBE_PREFIX__", PROBE_PREFIX)
        .replace("@@BAKED_VERSION@@", bakedVersion)
        .replace("@@ORIGIN@@", "https://" + assetHost)

    /**
     * 从 console 行里剥出探针结果（如果这行就是结果）。
     * 返回 [标题, 逐条文本] 或 null。
     *
     * 结果由探针自己 `console.log` 一行 `PROBE_PREFIX + JSON`，经 WebChromeClient.onConsoleMessage
     * 交给 [parseConsoleLine] 打到 logcat；`adb logcat -s 4enext-smoke` 即可取全。
     *
     * 为什么不用 `evaluateJavascript` 的返回值：探针是 **async IIFE**，
     * 返回的是 Promise，而 evaluateJavascript 序列化 Promise 的结果恒为 `{}`。
     * 这一点是 2026-10-07 在真机上试出来的——回调确实触发了，拿到的却是个空对象。
     */
    fun parseConsoleLine(line: String): Pair<String, List<String>>? {
        val idx = line.indexOf(PROBE_PREFIX)
        if (idx < 0) return null
        val json = line.substring(idx + PROBE_PREFIX.length).trim()
        return try {
            val arr = org.json.JSONArray(json)
            val lines = ArrayList<String>()
            var passed = 0
            for (i in 0 until arr.length()) {
                val row = arr.getJSONObject(i)
                val ok = row.optBoolean("ok", false)
                if (ok) passed++
                val detail = row.optString("detail", "")
                val mark = if (ok) "PASS" else "FAIL"
                // detail 全部拼进**同一行**：logcat 对单行里的非 ASCII 处理不稳，
                // 而排障恰恰需要看 detail。用 ASCII 标记 + 单行输出最可靠。
                lines.add("  " + mark + "  " + row.optString("name") + "  ::  " + detail)
            }
            lines.add("结果：" + passed + "/" + arr.length() + " 通过")
            "===== 安卓外壳冒烟自检 =====" to lines
        } catch (t: Throwable) {
            null
        }
    }

    /**
     * 兜底诊断：`evaluateJavascript` 的回调。正常路径下拿到的会是 `{}`（Promise 的序列化），
     * 所以这里**不当作结果来源**，只在真的什么都没有时报一条，便于区分
     * "探针没跑" 与 "探针跑了但结果丢了"。
     */
    fun noteCallback(raw: String?) {
        val text = raw?.trim().orEmpty()
        if (text.isEmpty() || text == "{}" || text == "null") {
            android.util.Log.i(TAG, "探针已注入（回调 " + (if (text.isEmpty()) "空" else text) + "，结果走 console 输出）")
        } else {
            android.util.Log.w(TAG, "evaluateJavascript 回调返回了非预期内容：" + text)
        }
    }
}
