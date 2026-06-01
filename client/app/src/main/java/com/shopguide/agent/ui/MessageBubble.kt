package com.shopguide.agent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shopguide.agent.model.ChatMessage
import com.shopguide.agent.model.ComparisonCard
import com.shopguide.agent.model.MessageRole
import com.shopguide.agent.model.ProductCard

@Composable
fun MessageBubble(
    message: ChatMessage,
    onRetry: (ChatMessage) -> Unit,
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
            val shouldShowTextBubble = message.text.isNotBlank() && (isUser || message.comparison == null)
            if (shouldShowTextBubble) {
                if (isUser) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        if (message.sendFailed) {
                            RetrySendIcon(onClick = { onRetry(message) })
                        }
                        UserBubble(text = message.text)
                    }
                } else {
                    AssistantBubble(text = message.text)
                }
            }

            if (!isUser && message.fallbackNotice.isNotBlank()) {
                if (shouldShowTextBubble) Spacer(modifier = Modifier.height(8.dp))
                FallbackNotice(text = message.fallbackNotice)
            }

            if (!isUser && message.comparison != null) {
                if (shouldShowTextBubble || message.fallbackNotice.isNotBlank()) Spacer(modifier = Modifier.height(10.dp))
                ComparisonCardView(comparison = message.comparison)
            }

            if (message.products.isNotEmpty()) {
                Spacer(modifier = Modifier.height(10.dp))
                // 商品卡片和文本分开渲染，卡片只来自后端结构化 products 事件。
                // 横向滑动更适合移动端导购：不会把一轮回复拉得过长，也方便用户快速比较候选。
                LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(message.products, key = { it.productId }) { product ->
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
private fun RetrySendIcon(onClick: () -> Unit) {
    Canvas(
        modifier = Modifier
            .size(34.dp)
            .clickable(onClick = onClick)
            .padding(5.dp)
    ) {
        val stroke = Stroke(width = 2.4.dp.toPx(), cap = StrokeCap.Round)
        val color = Color(0xFFE5484D)
        val inset = 3.dp.toPx()
        val arcSize = androidx.compose.ui.geometry.Size(
            width = size.width - inset * 2,
            height = size.height - inset * 2
        )

        // 红色环形箭头表示“本轮发送失败，可点击重试”。箭头头部单独绘制，避免图标看起来像字母 C。
        drawArc(
            color = color,
            startAngle = 35f,
            sweepAngle = 300f,
            useCenter = false,
            topLeft = androidx.compose.ui.geometry.Offset(inset, inset),
            size = arcSize,
            style = stroke
        )

        val arrowHead = Path().apply {
            moveTo(size.width * 0.78f, size.height * 0.10f)
            lineTo(size.width * 0.90f, size.height * 0.36f)
            lineTo(size.width * 0.62f, size.height * 0.32f)
        }
        drawPath(
            path = arrowHead,
            color = color
        )
    }
}

@Composable
private fun FallbackNotice(text: String) {
    Card(
        modifier = Modifier.widthIn(max = 360.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF7E8)),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, Color(0xFFFFD79A)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Text(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            text = text,
            color = Color(0xFF8A5A00),
            style = MaterialTheme.typography.bodySmall.copy(lineHeight = 17.sp)
        )
    }
}

@Composable
private fun ComparisonCardView(comparison: ComparisonCard) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF8FAFF)),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, Color(0xFFD7E3FF)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                text = comparison.title.ifBlank { "商品对比" },
                color = Color(0xFF2F6FED),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold
            )

            if (comparison.conclusion.isNotBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = comparison.conclusion,
                    color = Color(0xFF1F2328),
                    style = MaterialTheme.typography.bodySmall.copy(lineHeight = 18.sp)
                )
            }

            if (comparison.columns.isNotEmpty() && comparison.rows.isNotEmpty()) {
                Spacer(modifier = Modifier.height(10.dp))
                ComparisonHeader(comparison = comparison)
                comparison.rows.forEach { row ->
                    ComparisonRowView(comparison = comparison, label = row.label) { productId ->
                        row.values.firstOrNull { it.productId == productId }?.value.orEmpty()
                    }
                }
            }
        }
    }
}

@Composable
private fun ComparisonHeader(comparison: ComparisonCard) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            modifier = Modifier.weight(0.78f),
            text = "维度",
            color = Color(0xFF5F6673),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold
        )
        comparison.columns.forEach { column ->
            val isRecommended = column.productId == comparison.recommendedProductId
            Text(
                modifier = Modifier.weight(1f),
                text = listOf(column.label, column.brand).filter { it.isNotBlank() }.joinToString("\n"),
                color = if (isRecommended) Color(0xFF2F6FED) else Color(0xFF1F2328),
                style = MaterialTheme.typography.labelSmall.copy(lineHeight = 14.sp),
                fontWeight = if (isRecommended) FontWeight.SemiBold else FontWeight.Medium,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun ComparisonRowView(
    comparison: ComparisonCard,
    label: String,
    valueFor: (String) -> String
) {
    Spacer(modifier = Modifier.height(8.dp))
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            modifier = Modifier.weight(0.78f),
            text = label,
            color = Color(0xFF5F6673),
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold
        )
        comparison.columns.forEach { column ->
            val isRecommended = column.productId == comparison.recommendedProductId
            Text(
                modifier = Modifier.weight(1f),
                text = valueFor(column.productId).ifBlank { "-" },
                color = if (isRecommended) Color(0xFF1F4DB8) else Color(0xFF1F2328),
                style = MaterialTheme.typography.bodySmall.copy(lineHeight = 16.sp),
                textAlign = TextAlign.Center,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )
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
    val normalized = normalizeAssistantText(text)
    return buildAnnotatedString {
        var index = 0

        while (index < normalized.length) {
            val start = normalized.indexOf("**", startIndex = index)
            if (start < 0) {
                append(normalized.substring(index))
                break
            }

            val end = normalized.indexOf("**", startIndex = start + 2)
            if (end < 0) {
                append(normalized.substring(index).replace("**", ""))
                break
            }

            append(normalized.substring(index, start))

            // 后端/模型可能用 Markdown 的 **商品名** 表示重点；Compose Text 不会自动解析，
            // 所以在客户端把这类短标记转换成真正的粗体，避免把 ** 暴露给用户。
            pushStyle(SpanStyle(fontWeight = FontWeight.Bold))
            append(normalized.substring(start + 2, end))
            pop()

            index = end + 2
        }
    }
}

private fun normalizeAssistantText(text: String): String {
    // 模型和后端模板可能混用 Markdown：**粗体**、* 列表、- 列表、单星号强调。
    // 客户端统一做一次轻量清洗，避免把 *、- 这类格式符号直接暴露在聊天气泡里。
    return text
        .lines()
        .joinToString("\n") { line ->
            line
                .replace(Regex("^\\s*[-*]\\s+"), "• ")
                .replace(Regex("(?<!\\*)\\*([^*\\n]+)\\*(?!\\*)"), "$1")
        }
        .replace(Regex("\\n{3,}"), "\n\n")
}
