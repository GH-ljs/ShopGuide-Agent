package com.shopguide.agent.network

import com.shopguide.agent.model.ProductCard
import com.shopguide.agent.model.ChatMessage
import com.shopguide.agent.model.ComparisonCard
import com.shopguide.agent.model.ComparisonColumn
import com.shopguide.agent.model.ComparisonRow
import com.shopguide.agent.model.ComparisonValue
import com.shopguide.agent.model.MessageRole
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class ChatApiError(
    val code: String,
    val userMessage: String,
    val details: String = ""
)

/**
 * 调用后端 /api/chat，并解析 token/meta/comparison/products/done/error 六类 SSE 事件。
 *
 * 这里先用 Android 标准库 HttpURLConnection，目的是减少 MVP 阶段的外部依赖；
 * 后续如果要加重试、拦截器、统一日志，可以再替换为 OkHttp/Retrofit。
 */
object ChatApi {
    fun streamChat(
        conversationId: String,
        message: String,
        history: List<ChatMessage>,
        onToken: (String) -> Unit,
        onComparison: (ComparisonCard) -> Unit,
        onProducts: (List<ProductCard>) -> Unit,
        onDone: () -> Unit,
        onError: (ChatApiError) -> Unit
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
                .put("limit", ApiConfig.CHAT_PRODUCT_LIMIT)
                .put("history", history.toHistoryJson())
                .toString()

            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(requestBody)
            }

            if (connection.responseCode !in 200..299) {
                onError(
                    ChatApiError(
                        code = "HTTP_ERROR",
                        userMessage = "服务暂时不可用，请稍后再试。",
                        details = "HTTP ${connection.responseCode}"
                    )
                )
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
                            handleEvent(eventName, data, onToken, onComparison, onProducts, onDone, onError)
                        }
                    }
                }
            }
        } catch (error: Exception) {
            // 客户端连不上后端时不会收到 SSE error，只能在这里归类为 NETWORK_ERROR。
            onError(
                ChatApiError(
                    code = "NETWORK_ERROR",
                    userMessage = "无法连接后端服务，请确认服务已启动。",
                    details = error.message ?: "Chat request failed"
                )
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun handleEvent(
        eventName: String,
        data: String,
        onToken: (String) -> Unit,
        onComparison: (ComparisonCard) -> Unit,
        onProducts: (List<ProductCard>) -> Unit,
        onDone: () -> Unit,
        onError: (ChatApiError) -> Unit
    ) {
        when (eventName) {
            "token" -> {
                // token 是模型文本增量，直接追加到当前助手消息即可形成“逐字出现”的体验。
                val content = JSONObject(data).optString("content")
                if (content.isNotEmpty()) onToken(content)
            }

            "meta" -> {
                // meta 是后端性能评测/缓存命中信息。当前聊天 UI 不直接展示它，
                // 保留解析分支可以避免新增 SSE 事件时被误认为未知错误。
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

            "comparison" -> {
                // comparison 是后端已经绑定商品 ID 的结构化对比数据，客户端只负责展示；
                // 不从 token 文本里二次解析，避免自然语言变化导致 UI 卡片和回答不一致。
                val comparisonJson = JSONObject(data).optJSONObject("comparison") ?: return
                onComparison(comparisonJson.toComparisonCard())
            }

            "done" -> onDone()

            "error" -> {
                // 后端把错误也包装成 SSE 事件。客户端根据 code 转成用户文案，同时保留错误码给开发排障。
                val error = JSONObject(data).optJSONObject("error")
                val code = error?.optString("code").orEmpty().ifBlank { "INTERNAL_ERROR" }
                val message = error?.optString("message").orEmpty()
                val details = error?.optString("details").orEmpty()
                onError(
                    ChatApiError(
                        code = code,
                        userMessage = friendlyMessageForCode(code, message),
                        details = details
                    )
                )
            }
        }
    }

    private fun friendlyMessageForCode(code: String, fallback: String): String {
        return when (code) {
            "VALIDATION_ERROR" -> "请输入你的购物需求。"
            "RETRIEVAL_ERROR" -> "商品检索暂时不可用，请稍后再试。"
            "MODEL_ERROR" -> "AI 生成暂时不可用，请稍后再试。"
            "NOT_FOUND" -> "没有找到对应资源。"
            "INVALID_JSON" -> "请求格式异常，请稍后再试。"
            "INTERNAL_ERROR" -> "服务暂时不可用，请稍后再试。"
            else -> fallback.ifBlank { "服务暂时不可用，请稍后再试。" }
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

    private fun JSONObject.toComparisonCard(): ComparisonCard {
        val columnsJson = optJSONArray("columns") ?: JSONArray()
        val rowsJson = optJSONArray("rows") ?: JSONArray()
        return ComparisonCard(
            title = optString("title"),
            conclusion = optString("conclusion"),
            recommendedProductId = optString("recommendedProductId"),
            columns = buildList {
                for (index in 0 until columnsJson.length()) {
                    val item = columnsJson.getJSONObject(index)
                    add(
                        ComparisonColumn(
                            productId = item.optString("productId"),
                            label = item.optString("label"),
                            title = item.optString("title"),
                            brand = item.optString("brand")
                        )
                    )
                }
            },
            rows = buildList {
                for (rowIndex in 0 until rowsJson.length()) {
                    val row = rowsJson.getJSONObject(rowIndex)
                    val valuesJson = row.optJSONArray("values") ?: JSONArray()
                    add(
                        ComparisonRow(
                            label = row.optString("label"),
                            values = buildList {
                                for (valueIndex in 0 until valuesJson.length()) {
                                    val item = valuesJson.getJSONObject(valueIndex)
                                    add(
                                        ComparisonValue(
                                            productId = item.optString("productId"),
                                            value = item.optString("value")
                                        )
                                    )
                                }
                            }
                        )
                    )
                }
            }
        )
    }

    private fun List<ChatMessage>.toHistoryJson(): JSONArray {
        val array = JSONArray()
        forEach { message ->
            val productIds = JSONArray()
            message.products.forEach { product -> productIds.put(product.productId) }

            // history 只作为后端在内存丢失时的上下文恢复材料：正文恢复 turns，商品 ID 恢复上一轮推荐，
            // 避免把整张商品卡片重复塞进请求体，也避免跨会话共享任何历史。
            array.put(
                JSONObject()
                    .put("role", if (message.role == MessageRole.User) "user" else "assistant")
                    .put("content", message.text)
                    .put("productIds", productIds)
            )
        }
        return array
    }
}
