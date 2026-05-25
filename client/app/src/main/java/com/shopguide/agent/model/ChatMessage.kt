package com.shopguide.agent.model

/**
 * 一条聊天消息。
 *
 * role 决定消息显示在左侧还是右侧；products 用来承接后端 SSE products 事件。
 */
data class ChatMessage(
    val id: Int,
    val role: MessageRole,
    val text: String,
    val products: List<ProductCard> = emptyList()
)
