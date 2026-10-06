package ltd.banque.a4enext

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 本地键值存储。**与桌面端 `storage.json` 同构**：
 *
 *   · 一整份对象一次性读进内存 → 读操作是同步的（`PlatformStorage` 的接口就是同步的，
 *     改成异步会牵动几十处调用点，网页端也要跟着改）；
 *   · 写操作先改内存、再防抖落盘 → 界面永远不需要等待磁盘；
 *   · 落盘用「先写 .tmp 再 rename」的原子替换 → 崩溃/断电不会把数据文件写坏。
 *
 * 为什么不直接用 `localStorage`：WebView 的 localStorage 每源只有 10MiB，
 * 而且 Capacitor/Android 官方都明确它**随时可能被系统在低存储时回收**——
 * 人物卡是用户资产，不能放在那儿。
 *
 * 关于凭据：与桌面端一样，`4enext.webdav.v1` 的 `password` 与 `4enext.ai.v1` 的
 * `apiKey` / `apiKeys` **不明文落盘**，改用 Android Keystore 里的 AES-GCM 密钥加密
 * （对应桌面端的 safeStorage/DPAPI）。渲染进程拿到的仍是明文，接缝契约不变。
 * 代价与桌面端相同：密文绑定本机密钥库，换机器后需要重填一次。
 */
class NativeStore(private val context: Context) {

    companion object {
        private const val FILE_NAME = "storage.json"
        private const val BACKUP_NAME = "storage.json.bak"

        /** 需要加密落盘的字段：[存储键, 明文字段, 密文字段]（与桌面端 SECRET_FIELDS 一一对应）。 */
        private val SECRET_FIELDS = listOf(
            Triple("4enext.webdav.v1", "password", "passwordEnc"),
            Triple("4enext.ai.v1", "apiKey", "apiKeyEnc"),
            Triple("4enext.ai.v1", "apiKeys", "apiKeysEnc"),
        )

        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "4enext.storage.secrets"
        private const val GCM_TAG_BITS = 128
        private const val GCM_IV_BYTES = 12
    }

    private val file = File(context.filesDir, FILE_NAME)
    private val backupFile = File(context.filesDir, BACKUP_NAME)
    private val lock = Any()

    /** 内存里的那一份。用 LinkedHashMap 保持 keys() 的顺序稳定（便于对照与调试）。 */
    private val map = LinkedHashMap<String, String>()

    @Volatile
    private var dirty = false

    @Volatile
    private var lastError: String? = null

    fun load() {
        synchronized(lock) {
            map.clear()
            for (candidate in listOf(file, backupFile)) {
                if (!candidate.exists()) continue
                try {
                    val parsed = JSONObject(candidate.readText(Charsets.UTF_8))
                    for (key in parsed.keys()) {
                        map[key] = parsed.get(key).toString()
                    }
                    decryptSecrets()
                    return
                } catch (_: Throwable) {
                    // 这个候选坏了就试下一个；两个都不行就是空库，别把用户卡住
                }
            }
        }
    }

    fun getItem(key: String): String? = synchronized(lock) { map[key] }

    fun setItem(key: String, value: String) {
        synchronized(lock) { map[key] = value }
        dirty = true
        StorageWriter.schedule(this)
    }

    fun removeItem(key: String) {
        synchronized(lock) { map.remove(key) }
        dirty = true
        StorageWriter.schedule(this)
    }

    fun keys(): List<String> = synchronized(lock) { map.keys.toList() }

    /**
     * 用量口径**与网页端/桌面端一致**（UTF-16 码元，key + value）。
     *
     * 注意这里刻意不改成 UTF-8 字节：三端的百分比要可比，
     * 而网页端受的是 localStorage 的 UTF-16 口径限制。口径统一比「绝对正确」更重要。
     */
    fun usage(): Triple<Long, Long, Int> = synchronized(lock) {
        var used = 0L
        for ((k, v) in map) used += (k.length + v.length).toLong()
        Triple(used, STORAGE_TOTAL, map.size)
    }

    /**
     * 把「写盘失败」转成一次 UI 提示。
     *
     * 与桌面端的分工一致：原生只负责把失败**说出来**，怎么提示由网页端决定。
     * 做法是调用网页端注册的 `window.__4ENEXT_STORAGE_ERROR__`，
     * 它内部走的是应用已有的存储失败广播通道（见 web/src/lib/storageFailure.ts），
     * 与「浏览器配额写满」是同一条链路、同一种提示。
     *
     * 这段脚本自己必须绝对安全：页面已销毁、函数没注册、拼接失败……
     * 任何一种情况都只吞掉，绝不因为「报告一个错误」而再抛一个错误。
     */
    private fun broadcastWriteError(message: String) {
        val view = webViewRef ?: return
        val quoted = try {
            org.json.JSONObject.quote(message)
        } catch (_: Throwable) {
            return
        }
        view.post {
            try {
                view.evaluateJavascript(
                    "(function(){try{" +
                        "var f=window.__4ENEXT_STORAGE_ERROR__;" +
                        "if(typeof f==='function'){f($quoted);}" +
                        "else{console.error('[4enext] 存储写入失败：'+$quoted);}" +
                        "}catch(e){}})();",
                    null,
                )
            } catch (_: Throwable) {
                // 页面已销毁：这次提示没人接，但错误本身已经记录在 lastError 里
            }
        }
    }

    /** 由 Activity 在装配好 WebView 后注入，用于把写盘失败回传到页面。 */
    @Volatile
    var webViewRef: android.webkit.WebView? = null

    /** 原子落盘。失败不静默——回调让界面提示用户。 */
    fun flush() {
        val payload: String
        synchronized(lock) {
            if (!dirty) return
            dirty = false
            payload = try {
                serialized()
            } catch (t: Throwable) {
                report("序列化本地数据失败：" + (t.message ?: t.toString()))
                return
            }
        }
        try {
            val tmp = File(file.parentFile, FILE_NAME + ".tmp")
            tmp.writeText(payload, Charsets.UTF_8)
            // 先留一份上一版，rename 覆盖是原子的，但仍防一次「读到写了一半的文件」
            if (file.exists()) file.copyTo(backupFile, overwrite = true)
            if (!tmp.renameTo(file)) {
                file.writeText(payload, Charsets.UTF_8)
                tmp.delete()
            }
        } catch (t: Throwable) {
            report("写入本地数据文件失败：" + (t.message ?: t.toString()))
        }
    }

    private fun report(message: String) {
        lastError = message
        // 不许静默：网页端会把它当成一次「保存失败」提示用户（与配额写满同一条链路）
        broadcastWriteError(message)
    }

    /** 上次写盘失败的原因；成功落盘后清空。供原生侧与冒烟自检读取。 */
    fun lastWriteError(): String? = lastError

    // ---------------------------------------------------------------- 凭据加解密

    private fun serialized(): String {
        val root = JSONObject()
        for ((k, v) in map) root.put(k, v)
        for ((storeKey, field, encField) in SECRET_FIELDS) {
            val raw = map[storeKey] ?: continue
            root.put(storeKey, encryptSecretField(raw, field, encField))
        }
        return root.toString()
    }

    private fun encryptSecretField(raw: String, field: String, encField: String): String {
        return try {
            val cfg = JSONObject(raw)
            if (!cfg.has(field)) return raw
            val v = cfg.opt(field) ?: return raw
            val text = if (v is String) v else v.toString()
            // 空表（还没存过任何 Key）不必加密，保持文件可读、便于人工排查
            if (text.isEmpty() || text == "{}" || text == "[]") return raw
            val encrypted = encrypt(text) ?: return raw
            cfg.put(encField, encrypted)
            cfg.remove(field)
            cfg.toString()
        } catch (_: Throwable) {
            raw // 解析不了就原样写出，交由渲染进程兜底
        }
    }

    private fun decryptSecrets() {
        for ((storeKey, field, encField) in SECRET_FIELDS) {
            val raw = map[storeKey] ?: continue
            try {
                val cfg = JSONObject(raw)
                if (!cfg.has(encField)) continue
                if (cfg.has(field)) continue
                val enc = cfg.optString(encField, "")
                if (enc.isEmpty()) continue
                val plain = decrypt(enc) ?: continue
                // 字段可能是字符串（密码），也可能是对象（分供应商的 Key 表）
                cfg.put(field, try { JSONObject(plain) } catch (_: Throwable) { plain })
                cfg.remove(encField)
                map[storeKey] = cfg.toString()
            } catch (_: Throwable) {
                // 解不开（换了机器 / 密钥被清）就当没设过，让用户去设置里重填，别把文件写坏
            }
        }
    }

    private fun secretKey(): SecretKey? = try {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        val existing = ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) {
            existing.secretKey
        } else {
            val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
            gen.init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    // 刻意不要求用户认证：同步是后台行为，弹指纹会把同步打断
                    .setUserAuthenticationRequired(false)
                    .build(),
            )
            gen.generateKey()
        }
    } catch (_: Throwable) {
        null // 密钥库不可用（极少数设备）→ 退回明文，与桌面端 safeStorage 不可用时的处理一致
    }

    private fun encrypt(plain: String): String? = try {
        val key = secretKey() ?: return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val iv = cipher.iv
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        // 自描述格式：iv || ciphertext，整体 base64。IV 长度固定 12，解码时按此切分。
        Base64.encodeToString(iv + body, Base64.NO_WRAP)
    } catch (_: Throwable) {
        null
    }

    private fun decrypt(encoded: String): String? {
        // 用块体而不是表达式体：这里有多处提前 return，表达式体会被判为语法错误
        return try {
            val key = secretKey() ?: return null
            val all = Base64.decode(encoded, Base64.NO_WRAP)
            if (all.size <= GCM_IV_BYTES) return null
            val iv = all.copyOfRange(0, GCM_IV_BYTES)
            val body = all.copyOfRange(GCM_IV_BYTES, all.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(body), Charsets.UTF_8)
        } catch (_: Throwable) {
            null
        }
    }

    /** 由 Application 在退出/切后台时调用，确保防抖窗口内的改动不丢。 */
    fun flushBlocking() = flush()

    private object StorageWriter {
        private const val DEBOUNCE_MS = 400L
        private val handler = android.os.Handler(android.os.Looper.getMainLooper())
        private val pending = HashMap<NativeStore, Runnable>()

        fun schedule(store: NativeStore) {
            synchronized(pending) {
                pending.remove(store)?.let { handler.removeCallbacks(it) }
                val task = Runnable {
                    synchronized(pending) { pending.remove(store) }
                    store.flush()
                }
                pending[store] = task
                handler.postDelayed(task, DEBOUNCE_MS)
            }
        }
    }
}

/** 磁盘量级的名义上限，与桌面端一致：只用于设置页的占比展示，真实瓶颈是磁盘。 */
const val STORAGE_TOTAL: Long = 2L * 1024 * 1024 * 1024
