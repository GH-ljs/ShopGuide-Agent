package com.shopguide.agent.ui

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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shopguide.agent.model.ChatMessage
import com.shopguide.agent.model.MessageRole
import com.shopguide.agent.model.ProductCard
import com.shopguide.agent.network.HealthApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun ChatScreen() {
    var input by remember { mutableStateOf("") }
    var isBackendHealthy by remember { mutableStateOf<Boolean?>(null) }
    val messages = remember {
        mutableStateListOf(
            ChatMessage(
                id = 1,
                role = MessageRole.Assistant,
                text = "Hi, I am your shopping guide. Tell me your budget, category, and preferences."
            )
        )
    }

    LaunchedEffect(Unit) {
        // Network requests must run on an IO thread, then write the result back to Compose state.
        isBackendHealthy = withContext(Dispatchers.IO) {
            runCatching { HealthApi.checkHealth() }.getOrDefault(false)
        }
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
                MessageBubble(message = message)
            }
        }

        InputBar(
            value = input,
            onValueChange = { input = it },
            onSend = {
                val userText = input.trim()
                if (userText.isEmpty()) return@InputBar

                messages.add(
                    ChatMessage(
                        id = messages.size + 1,
                        role = MessageRole.User,
                        text = userText
                    )
                )

                // This temporary mock reply keeps the UI usable before the SSE chat API is connected.
                messages.add(
                    ChatMessage(
                        id = messages.size + 1,
                        role = MessageRole.Assistant,
                        text = "Received: $userText\nNext, this reply will come from /api/chat as an SSE stream.",
                        products = listOf(
                            ProductCard(
                                title = "Sample product card",
                                brand = "ShopGuide",
                                price = "CNY 199",
                                reason = "This is placeholder data. Later it will come from the backend products event."
                            )
                        )
                    )
                )
                input = ""
            }
        )
    }
}
