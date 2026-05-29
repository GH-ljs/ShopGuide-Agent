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
    var input by remember { mutableStateOf("") }
    var isBackendHealthy by remember { mutableStateOf<Boolean?>(null) }
    var isStreaming by remember { mutableStateOf(false) }
    var selectedProductId by remember { mutableStateOf<String?>(null) }
    var detail by remember { mutableStateOf<ProductDetail?>(null) }
    var detailLoading by remember { mutableStateOf(false) }
    var detailError by remember { mutableStateOf<String?>(null) }
    val conversationId = remember { UUID.randomUUID().toString() }
    val scope = rememberCoroutineScope()
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
        selectedProductId = null
        detail = null
        detailError = null
        detailLoading = false
    }

    LaunchedEffect(Unit) {
        isBackendHealthy = withContext(Dispatchers.IO) {
            runCatching { HealthApi.checkHealth() }.getOrDefault(false)
        }
    }

    LaunchedEffect(selectedProductId) {
        val productId = selectedProductId ?: return@LaunchedEffect
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

                messages.add(
                    ChatMessage(
                        id = messages.size + 1,
                        role = MessageRole.User,
                        text = userText
                    )
                )

                val assistantMessageId = messages.size + 1
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
                                    updateAssistantMessage(messages, assistantMessageId) { old ->
                                        old.copy(text = old.text + token)
                                    }
                                }
                            },
                            onProducts = { products ->
                                scope.launch {
                                    updateAssistantMessage(messages, assistantMessageId) { old ->
                                        old.copy(products = products)
                                    }
                                }
                            },
                            onDone = {
                                scope.launch { isStreaming = false }
                            },
                            onError = { message ->
                                scope.launch {
                                    updateAssistantMessage(messages, assistantMessageId) { old ->
                                        old.copy(text = old.text.ifBlank { "请求失败：$message" })
                                    }
                                    isStreaming = false
                                }
                            }
                        )
                    }
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
        messages[index] = transform(messages[index])
    }
}
