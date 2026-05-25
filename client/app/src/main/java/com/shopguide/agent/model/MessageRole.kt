package com.shopguide.agent.model

/**
 * 消息角色只允许两种，避免用字符串时出现拼写错误。
 */
enum class MessageRole {
    User,
    Assistant
}
