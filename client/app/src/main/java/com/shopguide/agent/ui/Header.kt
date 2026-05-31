package com.shopguide.agent.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun Header(
    isBackendHealthy: Boolean?,
    isStreaming: Boolean,
    onOpenMenu: () -> Unit
) {
    // 顶部栏压缩成单行：左侧菜单、中间标题、右侧状态点，避免占用聊天首屏空间。
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(Color.White)
            .padding(horizontal = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        IconButton(
            modifier = Modifier.align(Alignment.CenterStart),
            onClick = onOpenMenu,
            enabled = !isStreaming
        ) {
            TwoLineMenuIcon()
        }

        Text(
            text = "ShopGuide Agent",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF111318)
        )

        ConnectionDot(
            modifier = Modifier.align(Alignment.CenterEnd),
            isBackendHealthy = isBackendHealthy
        )
    }
}

@Composable
private fun TwoLineMenuIcon() {
    Canvas(modifier = Modifier.size(28.dp)) {
        // 自定义两横线菜单：上长下短，比普通三横线更接近移动端 AI 应用的侧栏入口。
        val color = Color(0xFF1F2328)
        val stroke = 2.4.dp.toPx()
        drawLine(
            color = color,
            start = Offset(x = 4.dp.toPx(), y = 10.dp.toPx()),
            end = Offset(x = 24.dp.toPx(), y = 10.dp.toPx()),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )
        drawLine(
            color = color,
            start = Offset(x = 4.dp.toPx(), y = 18.dp.toPx()),
            end = Offset(x = 17.dp.toPx(), y = 18.dp.toPx()),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )
    }
}

@Composable
private fun ConnectionDot(
    modifier: Modifier,
    isBackendHealthy: Boolean?
) {
    val color = when (isBackendHealthy) {
        true -> Color(0xFF16A34A)
        false -> Color(0xFFDC2626)
        null -> Color(0xFF9CA3AF)
    }

    Canvas(
        modifier = modifier
            .padding(end = 18.dp)
            .size(10.dp)
    ) {
        drawCircle(color = color)
    }
}
