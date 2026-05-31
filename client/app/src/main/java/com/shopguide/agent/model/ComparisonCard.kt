package com.shopguide.agent.model

/**
 * 后端 comparison SSE 事件对应的结构化对比数据。
 *
 * 它和普通文本回答互补：文本负责自然语言解释，ComparisonCard 负责稳定展示
 * “推荐结论、对比维度、每款商品取舍”，避免客户端从 AI 文本里反向解析商品事实。
 */
data class ComparisonCard(
    val title: String,
    val conclusion: String,
    val recommendedProductId: String,
    val columns: List<ComparisonColumn>,
    val rows: List<ComparisonRow>
)

data class ComparisonColumn(
    val productId: String,
    val label: String,
    val title: String,
    val brand: String
)

data class ComparisonRow(
    val label: String,
    val values: List<ComparisonValue>
)

data class ComparisonValue(
    val productId: String,
    val value: String
)
