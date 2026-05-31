package com.shopguide.agent.model

/**
 * 商品详情页使用的完整商品数据。
 *
 * 和 ProductCard 相比，这里包含 SKU、官方问答、用户评价等更重的信息，
 * 只有用户点击商品卡片进入详情页时才请求，避免聊天流里携带过多数据。
 */
data class ProductDetail(
    val productId: String,
    val title: String,
    val brand: String,
    val category: String,
    val subCategory: String,
    val price: String,
    val imageUrl: String,
    val marketingDescription: String,
    val skus: List<ProductSku>,
    val officialFaq: List<ProductFaq>,
    val userReviews: List<ProductReview>
)

// SKU 是同一商品下的不同规格，例如容量、颜色、套餐及其对应价格。
data class ProductSku(
    val skuId: String,
    val properties: Map<String, String>,
    val price: String
)

// 官方问答来自商品数据源，用来补充详情页的可信解释信息。
data class ProductFaq(
    val question: String,
    val answer: String
)

// 用户评价同样只作为商品数据展示，不由客户端或模型临时编造。
data class ProductReview(
    val nickname: String,
    val rating: Int,
    val content: String
)
