package com.shopguide.agent.storage

import android.content.Context
import java.util.UUID

/**
 * 保存匿名设备身份。
 *
 * 这里的 deviceId 不是系统设备号，也不需要读取任何隐私权限；它只是 App 首次启动时生成的随机 UUID。
 * 后端用 deviceId + conversationId 隔离和持久化会话，解决多用户部署时上下文串线、服务重启后记忆丢失的问题。
 */
object DeviceStore {
    private const val PREF_NAME = "shopguide_device"
    private const val KEY_DEVICE_ID = "device_id"

    fun loadDeviceId(context: Context): String {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val existingId = prefs.getString(KEY_DEVICE_ID, null)
        if (!existingId.isNullOrBlank()) return existingId

        val newId = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE_ID, newId).apply()
        return newId
    }
}
