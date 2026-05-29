package com.shopguide.agent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun Header(isBackendHealthy: Boolean?) {
    // Header 是纯展示组件：父组件传入连接状态，它只负责把状态翻译成文案和颜色。
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color.White)
            .padding(horizontal = 16.dp, vertical = 14.dp)
    ) {
        Text(
            text = "ShopGuide Agent",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold
        )
        Text(
            text = "RAG 电商智能导购",
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFF5F6673)
        )
        Text(
            text = when (isBackendHealthy) {
                true -> "后端已连接"
                false -> "后端未连接"
                null -> "正在检查后端连接"
            },
            style = MaterialTheme.typography.bodySmall,
            color = when (isBackendHealthy) {
                true -> Color(0xFF168A45)
                false -> Color(0xFFB42318)
                null -> Color(0xFF5F6673)
            }
        )
    }
}
