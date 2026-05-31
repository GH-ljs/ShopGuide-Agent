package com.shopguide.agent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun InputBar(
    value: String,
    enabled: Boolean,
    onValueChange: (String) -> Unit,
    onInputFocusChanged: (Boolean) -> Unit,
    onSend: () -> Unit
) {
    // 输入栏不保存自己的状态，而是由 ChatScreen 传入 value/onValueChange，保持 Compose 的单向数据流。
    val canSend = enabled && value.isNotBlank()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color.White)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        OutlinedTextField(
            modifier = Modifier
                .weight(1f)
                // 由父组件记录输入框焦点，比单纯读键盘高度更可靠；很多机型键盘动画期间 inset 更新会滞后。
                .onFocusChanged { state -> onInputFocusChanged(state.isFocused) },
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            placeholder = { Text("输入你的购物需求") },
            singleLine = false,
            maxLines = 3
        )
        Button(
            onClick = onSend,
            enabled = canSend
        ) {
            // 流式请求期间禁用发送，避免同一个会话并发发送多条消息导致上下文顺序错乱。
            Text(if (enabled) "发送" else "生成中")
        }
    }
}
