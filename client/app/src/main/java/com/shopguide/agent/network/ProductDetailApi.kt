package com.shopguide.agent.network

import com.shopguide.agent.model.ProductDetail
import com.shopguide.agent.model.ProductFaq
import com.shopguide.agent.model.ProductReview
import com.shopguide.agent.model.ProductSku
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 商品详情接口客户端。
 *
 * 聊天页只拿 ProductCard，详情页再按 productId 单独请求完整商品信息，
 * 这样可以让聊天流更轻，也让“卡片展示”和“详情浏览”两个职责分开。
 */
object ProductDetailApi {
    fun getProductDetail(productId: String): ProductDetail {
        val url = URL("${ApiConfig.BASE_URL}/api/products/${productId}")
        val connection = url.openConnection() as HttpURLConnection

        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 5000
            connection.readTimeout = 10000

            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("HTTP ${connection.responseCode}")
            }

            val text = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            return parseDetail(JSONObject(text))
        } finally {
            connection.disconnect()
        }
    }

    private fun parseDetail(json: JSONObject): ProductDetail {
        // 这里把后端 JSON 转成 Kotlin data class，UI 层只面对强类型对象，不直接操作 JSONObject。
        return ProductDetail(
            productId = json.optString("productId"),
            title = json.optString("title"),
            brand = json.optString("brand"),
            category = json.optString("category"),
            subCategory = json.optString("subCategory"),
            price = formatPrice(json.opt("price")),
            imageUrl = absoluteUrl(json.optString("imageUrl")),
            marketingDescription = json.optString("marketingDescription"),
            skus = parseSkus(json),
            officialFaq = parseFaq(json),
            userReviews = parseReviews(json)
        )
    }

    private fun parseSkus(json: JSONObject): List<ProductSku> {
        val array = json.optJSONArray("skus") ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
                val propertiesJson = item.optJSONObject("properties")
                // SKU properties 是不同品类的动态规格字段，例如“存储配置/产品版本”或“色号/规格”。
                // 保留结构化 Map，详情页才能动态生成更像电商页的规格表格。
                val properties = propertiesJson
                    ?.keys()
                    ?.asSequence()
                    ?.associateWith { key -> propertiesJson.optString(key) }
                    .orEmpty()
                add(
                    ProductSku(
                        skuId = item.optString("sku_id"),
                        properties = properties,
                        price = formatPrice(item.opt("price"))
                    )
                )
            }
        }
    }

    private fun parseFaq(json: JSONObject): List<ProductFaq> {
        val array = json.optJSONArray("officialFaq") ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
                add(
                    ProductFaq(
                        question = item.optString("question"),
                        answer = item.optString("answer")
                    )
                )
            }
        }
    }

    private fun parseReviews(json: JSONObject): List<ProductReview> {
        val array = json.optJSONArray("userReviews") ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
                add(
                    ProductReview(
                        nickname = item.optString("nickname"),
                        rating = item.optInt("rating"),
                        content = item.optString("content")
                    )
                )
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
        // 详情页图片和聊天卡片图片共用后端图片接口，相对路径需要补齐服务地址。
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        if (path.startsWith("/")) return "${ApiConfig.BASE_URL}$path"
        return path
    }
}
