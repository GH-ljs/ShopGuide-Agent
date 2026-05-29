package com.shopguide.agent.network

import com.shopguide.agent.model.ProductCard
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * 调用后端 /api/chat，并解析 token/products/done/error 四类 SSE 事件。
 *
 * 这里先用 Android 标准库 HttpURLConnection，目的是减少 MVP 阶段的外部依赖；
 * 后续如果要加重试、拦截器、统一日志，可以再替换为 OkHttp/Retrofit。
 */
object ChatApi {
    fun streamChat(
        conversationId: String,
        message: String,
        onToken: (String) -> Unit,
        onProducts: (List<ProductCard>) -> Unit,
        onDone: () -> Unit,
        onError: (String) -> Unit
    ) {
        val url = URL("${ApiConfig.BASE_URL}/api/chat")
        val connection = url.openConnection() as HttpURLConnection

        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 5000
            // SSE 是长连接，读超时要比普通 JSON 接口更长，否则模型还在生成时客户端可能提前断开。
            connection.readTimeout = 60000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "text/event-stream")

            // 客户端只发送用户消息和 conversationId；检索、Prompt、模型调用都由后端负责。
            val requestBody = JSONObject()
                .put("conversationId", conversationId)
                .put("message", message)
                .toString()

            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(requestBody)
            }

            if (connection.responseCode !in 200..299) {
                onError("HTTP ${connection.responseCode}")
                return
            }

            BufferedReader(InputStreamReader(connection.inputStream, Charsets.UTF_8)).use { reader ->
                var eventName = ""

                // SSE 是按行传输的协议：先读 event: xxx，再读 data: {...}，空行在这里无需额外处理。
                while (true) {
                    val line = reader.readLine() ?: break

                    when {
                        line.startsWith("event:") -> {
                            eventName = line.removePrefix("event:").trim()
                        }

                        line.startsWith("data:") -> {
                            val data = line.removePrefix("data:").trim()
                            handleEvent(eventName, data, onToken, onProducts, onDone, onError)
                        }
                    }
                }
            }
        } catch (error: Exception) {
            onError(error.message ?: "Chat request failed")
        } finally {
            connection.disconnect()
        }
    }

    private fun handleEvent(
        eventName: String,
        data: String,
        onToken: (String) -> Unit,
        onProducts: (List<ProductCard>) -> Unit,
        onDone: () -> Unit,
        onError: (String) -> Unit
    ) {
        when (eventName) {
            "token" -> {
                // token 是模型文本增量，直接追加到当前助手消息即可形成“逐字出现”的体验。
                val content = JSONObject(data).optString("content")
                if (content.isNotEmpty()) onToken(content)
            }

            "products" -> {
                // 商品卡片必须来自结构化 products 事件，不能从模型自然语言文本里解析价格或商品名。
                val productsJson = JSONObject(data).optJSONArray("products") ?: return
                val products = buildList {
                    for (index in 0 until productsJson.length()) {
                        val item = productsJson.getJSONObject(index)
                        add(
                            ProductCard(
                                productId = item.optString("productId"),
                                title = item.optString("title"),
                                brand = item.optString("brand"),
                                category = item.optString("category"),
                                subCategory = item.optString("subCategory"),
                                price = formatPrice(item.opt("price")),
                                imageUrl = absoluteUrl(item.optString("imageUrl")),
                                reason = item.optString("reason")
                            )
                        )
                    }
                }
                onProducts(products)
            }

            "done" -> onDone()

            "error" -> {
                // 后端把错误也包装成 SSE 事件，客户端可以用同一条流完成错误展示和 loading 收尾。
                val error = JSONObject(data).optJSONObject("error")
                val message = error?.optString("message") ?: "Backend error"
                val details = error?.optString("details").orEmpty()
                onError(if (details.isBlank()) message else "$message: $details")
            }
        }
    }

    private fun formatPrice(value: Any?): String {
        return when (value) {
            is Number -> "CNY ${value.toDouble().toString().trimEnd('0').trimEnd('.')}"
            is String -> if (value.isBlank()) "" else "CNY $value"
            else -> ""
        }
    }

    private fun absoluteUrl(path: String): String {
        // 后端返回 /api/products/:id/image 这种相对路径时，客户端补齐 BASE_URL 才能真正加载图片。
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        if (path.startsWith("/")) return "${ApiConfig.BASE_URL}$path"
        return path
    }
}
