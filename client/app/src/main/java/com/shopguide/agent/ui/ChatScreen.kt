package com.shopguide.agent.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shopguide.agent.model.ChatMessage
import com.shopguide.agent.model.MessageRole
import com.shopguide.agent.model.ProductDetail
import com.shopguide.agent.network.ChatApi
import com.shopguide.agent.network.HealthApi
import com.shopguide.agent.network.ProductDetailApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

@Composable
fun ChatScreen() {
    // remember 保存 Compose 状态；状态变化会触发相关 UI 自动重组，不需要手动 findViewById 更新控件。
    var input by remember { mutableStateOf("") }
    var isBackendHealthy by remember { mutableStateOf<Boolean?>(null) }
    var isStreaming by remember { mutableStateOf(false) }
    var selectedProductId by remember { mutableStateOf<String?>(null) }
    var detail by remember { mutableStateOf<ProductDetail?>(null) }
    var detailLoading by remember { mutableStateOf(false) }
    var detailError by remember { mutableStateOf<String?>(null) }
    val conversationId = remember { UUID.randomUUID().toString() }
    val scope = rememberCoroutineScope()
    // mutableStateListOf 是 Compose 可观察列表；新增消息或替换消息对象时，LazyColumn 会自动刷新。
    val messages = remember {
        mutableStateListOf(
            ChatMessage(
                id = 1,
                role = MessageRole.Assistant,
                text = "你好，我是智能导购助手。你可以直接说预算、品类和偏好，我会从商品库里帮你推荐。"
            )
        )
    }

    fun goBackToChat() {
        // 详情页只是聊天页上的一个临时视图状态，清空选中商品即可回到聊天列表。
        selectedProductId = null
        detail = null
        detailError = null
        detailLoading = false
    }

    LaunchedEffect(Unit) {
        // 首次进入页面时检查后端是否可用；网络 IO 放到 Dispatchers.IO，避免阻塞 UI 线程。
        isBackendHealthy = withContext(Dispatchers.IO) {
            runCatching { HealthApi.checkHealth() }.getOrDefault(false)
        }
    }

    LaunchedEffect(selectedProductId) {
        val productId = selectedProductId ?: return@LaunchedEffect
        // selectedProductId 变化代表用户点击了某张商品卡片，随后按需加载详情。
        detail = null
        detailError = null
        detailLoading = true
        val result = withContext(Dispatchers.IO) {
            runCatching { ProductDetailApi.getProductDetail(productId) }
        }
        detail = result.getOrNull()
        detailError = result.exceptionOrNull()?.message
        detailLoading = false
    }

    BackHandler(enabled = selectedProductId != null) {
        // Android 返回键在详情页优先回到聊天页，而不是直接退出 App。
        goBackToChat()
    }

    if (selectedProductId != null) {
        ProductDetailScreen(
            detail = detail,
            isLoading = detailLoading,
            errorMessage = detailError,
            onBack = { goBackToChat() }
        )
        return
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Header(isBackendHealthy = isBackendHealthy)

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(messages, key = { it.id }) { message ->
                MessageBubble(
                    message = message,
                    onProductClick = { product -> selectedProductId = product.productId }
                )
            }
        }

        InputBar(
            value = input,
            enabled = !isStreaming,
            onValueChange = { input = it },
            onSend = {
                val userText = input.trim()
                if (userText.isEmpty() || isStreaming) return@InputBar

                // 先把用户消息加入列表，让用户立刻看到自己发出的内容。
                messages.add(
                    ChatMessage(
                        id = messages.size + 1,
                        role = MessageRole.User,
                        text = userText
                    )
                )

                val assistantMessageId = messages.size + 1
                // 再创建一条空的助手占位消息，后续 SSE token 会不断填充它的 text。
                messages.add(
                    ChatMessage(
                        id = assistantMessageId,
                        role = MessageRole.Assistant,
                        text = ""
                    )
                )
                input = ""
                isStreaming = true

                scope.launch {
                    withContext(Dispatchers.IO) {
                        ChatApi.streamChat(
                            conversationId = conversationId,
                            message = userText,
                            onToken = { token ->
                                scope.launch {
                                    // token 回调来自 IO 线程，通过 scope.launch 回到 Compose 协程上下文更新状态。
                                    updateAssistantMessage(messages, assistantMessageId) { old ->
                                        old.copy(text = old.text + token)
                                    }
                                }
                            },
                            onProducts = { products ->
                                scope.launch {
                                    // products 事件到达后一次性挂到同一条助手消息下面，MessageBubble 会渲染商品卡片。
                                    updateAssistantMessage(messages, assistantMessageId) { old ->
                                        old.copy(products = products)
                                    }
                                }
                            },
                            onDone = {
                                // done 表示本轮 SSE 正常结束，输入框可以恢复可用。
                                scope.launch { isStreaming = false }
                            },
                            onError = { message ->
                                scope.launch {
                                    // 如果还没有收到任何 token，就用错误文案填充占位助手消息。
                                    updateAssistantMessage(messages, assistantMessageId) { old ->
                                        old.copy(text = old.text.ifBlank { "请求失败：$message" })
                                    }
                                    isStreaming = false
                                }
                            }
                        )
                    }
                    // 兜底收尾：即使后端漏发 done，也避免输入框一直处于“发送中”。
                    isStreaming = false
                }
            }
        )
    }
}

private fun updateAssistantMessage(
    messages: MutableList<ChatMessage>,
    messageId: Int,
    transform: (ChatMessage) -> ChatMessage
) {
    val index = messages.indexOfFirst { it.id == messageId }
    if (index >= 0) {
        // 通过替换整个 ChatMessage 对象触发 Compose 列表项重组，而不是原地修改不可变 data class。
        messages[index] = transform(messages[index])
    }
}
