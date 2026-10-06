package ltd.banque.a4enext

import android.app.Application

/**
 * 应用级单例。只放「必须比 Activity 活得久」的东西。
 *
 * `NativeStore` 放这里而不是 Activity 里：横竖屏切换、从最近任务回来、
 * 甚至 Activity 被系统回收后重建，内存里那份数据都不该重新读盘一次。
 * 更重要的是——**防抖落盘的定时器不能随 Activity 一起消失**。
 */
class App : Application() {

    lateinit var store: NativeStore
        private set

    override fun onCreate() {
        super.onCreate()
        store = NativeStore(this)
        store.load()
    }
}
