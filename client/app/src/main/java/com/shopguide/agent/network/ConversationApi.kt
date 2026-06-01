package com.shopguide.agent.network

import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * 会话相关接口。
 *
 * 后端会按 conversationId 保存最近几轮上下文。客户端重新开始对话时，需要通知后端清理这段上下文，
 * 否则新问题可能会被上一轮聊天记录影响。
 */
object ConversationApi {
    fun resetConversation(deviceId: String, conversationId: String): Boolean {
        val url = URL("${ApiConfig.BASE_URL}/api/conversations/reset")
        val connection = url.openConnection() as HttpURLConnection

        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")

            val requestBody = JSONObject()
                .put("deviceId", deviceId)
                .put("conversationId", conversationId)
                .toString()

            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(requestBody)
            }

            connection.responseCode in 200..299
        } finally {
            connection.disconnect()
        }
    }
}
