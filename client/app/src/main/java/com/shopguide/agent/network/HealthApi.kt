package com.shopguide.agent.network

import java.net.HttpURLConnection
import java.net.URL

/**
 * 最小健康检查客户端。
 *
 * 这里先使用系统自带 HttpURLConnection，避免一开始引入太多网络库。
 */
object HealthApi {
    fun checkHealth(): Boolean {
        val url = URL("${ApiConfig.BASE_URL}/api/health")
        val connection = url.openConnection() as HttpURLConnection

        return try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 3000
            connection.readTimeout = 3000
            connection.responseCode in 200..299
        } finally {
            connection.disconnect()
        }
    }
}
