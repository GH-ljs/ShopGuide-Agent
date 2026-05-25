package com.shopguide.agent.model

/**
 * 商品卡片数据。
 *
 * 当前先保留最小展示字段；接入后端后会和 products 事件字段继续对齐。
 */
data class ProductCard(
    val title: String,
    val brand: String,
    val price: String,
    val reason: String
)
