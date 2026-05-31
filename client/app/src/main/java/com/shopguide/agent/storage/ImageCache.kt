package com.shopguide.agent.storage

import android.content.Context
import java.io.File
import java.net.URL
import java.security.MessageDigest

/**
 * 商品图片磁盘缓存。
 *
 * 历史会话只保存商品卡片数据，图片 URL 仍指向后端。如果后端关闭，直接重新请求图片会失败。
 * 因此图片首次加载成功后写入 App 私有缓存目录，后续历史卡片优先读本地文件，保证离线查看旧会话时仍有缩略图。
 */
object ImageCache {
    fun loadOrDownload(context: Context, imageUrl: String): ByteArray? {
        if (imageUrl.isBlank()) return null

        val cacheFile = cacheFileFor(context, imageUrl)
        if (cacheFile.exists()) {
            return runCatching { cacheFile.readBytes() }.getOrNull()
        }

        return runCatching {
            val bytes = URL(imageUrl).openStream().use { input -> input.readBytes() }
            cacheFile.parentFile?.mkdirs()
            cacheFile.writeBytes(bytes)
            bytes
        }.getOrNull()
    }

    private fun cacheFileFor(context: Context, imageUrl: String): File {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(imageUrl.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte) }

        return File(File(context.cacheDir, "product_images"), "$digest.img")
    }
}
