package ltd.banque.a4enext

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * 导出与分享。
 *
 * 安卓上的「另存为」和桌面端长得不一样，这是刻意的：
 *   · 桌面端弹系统保存对话框，用户挑一个目录，文件落在那里；
 *   · 安卓上 `<a download>` **根本不工作**（WebView 不支持 download 属性，
 *     也没有默认下载实现），所以必须换一条路。
 *
 * 这里选的是**写进应用私有 cache/exports，再交给系统分享面板**：
 * 用户自己决定存到「文件」、发微信还是丢进网盘。
 * 对手机用户来说这比硬造一个目录选择器顺手得多，而且**不需要任何存储权限**。
 *
 * 局限（诚实写在这里）：`startActivity` 之后无法从系统分享面板同步拿到
 * 「用户到底存没存」。所以返回的 ok 含义是「文件已生成并交给系统」，
 * 而不是桌面端那种「用户点了保存」。调用方不要据此提示「已保存到 X」。
 */
class NativeExporter(private val context: Context) {

    private val io = Executors.newSingleThreadExecutor { r ->
        Thread(r, "4enext-export").apply { isDaemon = true }
    }

    fun share(filename: String, text: String?, bytesBase64: String?, onDone: (JSONObject) -> Unit) {
        io.execute {
            val result = try {
                val dir = File(context.cacheDir, "exports").apply { mkdirs() }
                val target = uniqueFile(dir, sanitize(filename))
                if (bytesBase64 != null) {
                    target.writeBytes(Base64.decode(bytesBase64, Base64.NO_WRAP))
                } else {
                    target.writeText(text ?: "", Charsets.UTF_8)
                }
                val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", target)
                launchShare(uri, mimeOf(target.name))
                JSONObject().put("ok", true).put("path", target.absolutePath)
            } catch (t: Throwable) {
                JSONObject().put("ok", false).put("reason", t.message ?: t.toString())
            }
            onDone(result)
        }
    }

    private fun launchShare(uri: Uri, mime: String) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(send, null).apply {
            // 从 Application context 起 Activity 必须带这个 flag
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(chooser)
    }

    /**
     * 同名文件不覆盖：加序号。
     *
     * 为什么不让它覆盖：`cache/exports` 里上一份可能已经被分享出去、
     * 正被别的应用读着（比如网盘开始上传了）。覆盖会让对方读到半截文件。
     */
    private fun uniqueFile(dir: File, name: String): File {
        val base = name.substringBeforeLast('.', name)
        val ext = name.substringAfterLast('.', "")
        var candidate = File(dir, name)
        var i = 1
        while (candidate.exists()) {
            val suffix = if (ext.isEmpty()) "" else ".$ext"
            candidate = File(dir, "$base($i)$suffix")
            i++
        }
        return candidate
    }

    /** 去掉路径分隔符等不适合做文件名的字符，避免写到 exports/ 之外。 */
    private fun sanitize(name: String): String {
        val cleaned = name.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").trim()
        return cleaned.ifEmpty { "4enext-export" }
    }

    private fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "json" -> "application/json"
        "d4e" -> "application/json"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "pdf" -> "application/pdf"
        "txt" -> "text/plain"
        else -> "application/octet-stream"
    }

    fun clearExports() {
        io.execute {
            try {
                File(context.cacheDir, "exports").deleteRecursively()
            } catch (_: Throwable) {
                // 清缓存是尽力而为
            }
        }
    }
}
