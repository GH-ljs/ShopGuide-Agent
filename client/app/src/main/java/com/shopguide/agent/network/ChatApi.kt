package com.shopguide.agent.network

import com.shopguide.agent.model.ProductCard
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Calls /api/chat and parses token/products/done/error SSE events.
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
            connection.readTimeout = 60000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "text/event-stream")

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
                val content = JSONObject(data).optString("content")
                if (content.isNotEmpty()) onToken(content)
            }

            "products" -> {
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
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        if (path.startsWith("/")) return "${ApiConfig.BASE_URL}$path"
        return path
    }
}
