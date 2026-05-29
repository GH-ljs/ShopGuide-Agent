package com.shopguide.agent.model

/**
 * 商品卡片数据，字段直接对应后端 products SSE 事件。
 */
data class ProductCard(
    val productId: String,
    val title: String,
    val brand: String,
    val category: String,
    val subCategory: String,
    val price: String,
    val imageUrl: String,
    val reason: String
)
