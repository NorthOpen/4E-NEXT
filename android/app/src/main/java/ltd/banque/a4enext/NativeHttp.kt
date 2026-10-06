package ltd.banque.a4enext

import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * 原生 HTTP。**这是安卓端必须自己写、且绕不开的一件事。**
 *
 * 为什么不能让渲染进程直接 `fetch`：
 *   WebDAV 同步要发 PROPFIND / MKCOL / PUT。方法本身 WebView 是支持的，
 *   但页面跑在 `https://appassets.androidplatform.net`，对自建 WebDAV 是**跨源**，
 *   而非简单方法必然触发 CORS 预检——绝大多数 WebDAV 服务端
 *   （Nextcloud / Apache mod_dav / nginx dav）**默认不返回 `Access-Control-Allow-Methods`**，
 *   于是同步在安卓上直接不可用。
 *
 * 桌面端没有这个问题，因为它把请求放进了 Electron 主进程。
 * 这里做的是同一件事：把请求挪出 WebView，用 OkHttp 发。
 * 顺带把自签名证书的问题也收在同一条通路上（见 network_security_config.xml）。
 */
object NativeHttp {

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build()

    data class Result(
        val status: Int,
        val headers: Map<String, String>,
        val bodyText: String,
        val error: String?,
    )

    /**
     * 同步执行一次请求。**必须在工作线程调用**（WebView 的 JavaBridge 线程或线程池都行），
     * 不要在 JS 的 @JavascriptInterface 主线程上直接跑——那会阻塞 UI。
     *
     * @param body 为 null 表示无请求体。WebDAV 的 PROPFIND 也允许空体。
     */
    fun execute(
        url: String,
        method: String,
        headers: Map<String, String>,
        body: String?,
        timeoutMs: Long,
    ): Result {
        return try {
            val builder = Request.Builder().url(url)

            // 逐条加请求头。跳过 WebView/OkHttp 会自己管理的那些，
            // 否则会出现「两个 Content-Length」这类服务端直接 400 的情况。
            for ((rawName, value) in headers) {
                val name = rawName.trim()
                if (name.isEmpty()) continue
                val lower = name.lowercase()
                if (lower == "host" || lower == "content-length" || lower == "connection") continue
                try {
                    builder.addHeader(name, value)
                } catch (_: Throwable) {
                    // 非法头名/值直接跳过，不要让一个坏头毁掉整次同步
                }
            }

            val requestBody: RequestBody? = when {
                body == null -> null
                // 空体也必须显式给出，否则 PROPFIND 会被当成 GET
                else -> body.toRequestBody(contentTypeOf(headers))
            }

            builder.method(method.uppercase(), requestBody)

            val perRequest = client.newBuilder()
                .readTimeout(timeoutMs.coerceAtLeast(1000L), TimeUnit.MILLISECONDS)
                .writeTimeout(timeoutMs.coerceAtLeast(1000L), TimeUnit.MILLISECONDS)
                .callTimeout(timeoutMs.coerceAtLeast(1000L) + 5000L, TimeUnit.MILLISECONDS)
                .build()

            perRequest.newCall(builder.build()).execute().use { response ->
                Result(
                    status = response.code,
                    headers = flatten(response.headers),
                    bodyText = try {
                        response.body?.string() ?: ""
                    } catch (_: Throwable) {
                        ""
                    },
                    error = null,
                )
            }
        } catch (t: Throwable) {
            // 把异常翻成调用方能读的一句话。网络类异常在安卓上文案差别很大，
            // 统一在这里收口，渲染进程侧只看到 error 字段。
            Result(0, emptyMap(), "", describe(t))
        }
    }

    private fun contentTypeOf(headers: Map<String, String>): okhttp3.MediaType? {
        for ((k, v) in headers) {
            if (k.equals("content-type", ignoreCase = true)) return v.toMediaTypeOrNull()
        }
        return "application/xml; charset=utf-8".toMediaTypeOrNull()
    }

    private fun flatten(headers: Headers): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (i in 0 until headers.size) {
            val name = headers.name(i)
            val value = headers.value(i)
            // 同名头（如多个 Set-Cookie）用逗号合并；渲染进程侧只读 ETag / Content-Type 这类单值头
            out[name] = if (out.containsKey(name)) out[name] + ", " + value else value
        }
        return out
    }

    private fun describe(t: Throwable): String {
        val message = t.message ?: return t.javaClass.simpleName
        return when {
            message.contains("Unable to resolve host", ignoreCase = true) -> "无法解析主机名，请检查地址是否正确：$message"
            message.contains("Failed to connect", ignoreCase = true) -> "无法连接到服务器，请检查端口与网络：$message"
            message.contains("timeout", ignoreCase = true) -> "连接超时：$message"
            message.contains("Trust anchor", ignoreCase = true) ||
                message.contains("Certificate", ignoreCase = true) ->
                "证书不受信任。自建服务器的自签名证书需要先安装到系统「加密与凭据」里，详见设置页说明。"
            else -> message
        }
    }
}
