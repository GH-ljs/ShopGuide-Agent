package com.shopguide.agent.model

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

data class ProductSku(
    val skuId: String,
    val properties: String,
    val price: String
)

data class ProductFaq(
    val question: String,
    val answer: String
)

data class ProductReview(
    val nickname: String,
    val rating: Int,
    val content: String
)
