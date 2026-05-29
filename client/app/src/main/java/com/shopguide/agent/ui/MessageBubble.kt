package com.shopguide.agent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shopguide.agent.model.ChatMessage
import com.shopguide.agent.model.MessageRole
import com.shopguide.agent.model.ProductCard

@Composable
fun MessageBubble(
    message: ChatMessage,
    onProductClick: (ProductCard) -> Unit
) {
    val isUser = message.role == MessageRole.User

    // 用户消息靠右、助手消息靠左，是聊天类 UI 最常见的阅读约定。
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(if (isUser) 0.76f else 0.96f),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
        ) {
            if (message.text.isNotBlank()) {
                if (isUser) {
                    UserBubble(text = message.text)
                } else {
                    AssistantBubble(text = message.text)
                }
            }

            if (message.products.isNotEmpty()) {
                Spacer(modifier = Modifier.height(10.dp))
                // 商品卡片和文本分开渲染，卡片只来自后端结构化 products 事件。
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    message.products.forEach { product ->
                        ProductCardView(
                            product = product,
                            onClick = onProductClick
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun UserBubble(text: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF2F6FED)),
        shape = RoundedCornerShape(
            topStart = 16.dp,
            topEnd = 16.dp,
            bottomStart = 16.dp,
            bottomEnd = 6.dp
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
            color = Color.White,
            style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 21.sp)
        )
    }
}

@Composable
private fun AssistantBubble(text: String) {
    Card(
        modifier = Modifier.widthIn(min = 220.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(
            topStart = 6.dp,
            topEnd = 16.dp,
            bottomStart = 16.dp,
            bottomEnd = 16.dp
        ),
        border = BorderStroke(1.dp, Color(0xFFE5EAF2)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "AI 导购",
                    color = Color(0xFF2F6FED),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 长回复依靠更大的行高和段落间距提高可读性，避免像截图里那样挤成一块。
            Text(
                text = renderAssistantMarkdown(text.trim()),
                color = Color(0xFF1F2328),
                style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp)
            )
        }
    }
}

private fun renderAssistantMarkdown(text: String): AnnotatedString {
    return buildAnnotatedString {
        var index = 0

        while (index < text.length) {
            val start = text.indexOf("**", startIndex = index)
            if (start < 0) {
                append(text.substring(index))
                break
            }

            val end = text.indexOf("**", startIndex = start + 2)
            if (end < 0) {
                append(text.substring(index))
                break
            }

            append(text.substring(index, start))

            // 后端/模型可能用 Markdown 的 **商品名** 表示重点；Compose Text 不会自动解析，
            // 所以在客户端把这类短标记转换成真正的粗体，避免把 ** 暴露给用户。
            pushStyle(SpanStyle(fontWeight = FontWeight.Bold))
            append(text.substring(start + 2, end))
            pop()

            index = end + 2
        }
    }
}
