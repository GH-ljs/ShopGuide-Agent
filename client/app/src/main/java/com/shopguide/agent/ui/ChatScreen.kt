package com.shopguide.agent.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shopguide.agent.model.ChatMessage
import com.shopguide.agent.model.MessageRole
import com.shopguide.agent.model.ProductDetail
import com.shopguide.agent.network.ChatApi
import com.shopguide.agent.network.ConversationApi
import com.shopguide.agent.network.HealthApi
import com.shopguide.agent.network.ProductDetailApi
import com.shopguide.agent.storage.ConversationSummary
import com.shopguide.agent.storage.ConversationStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val LOADING_TEXT = "正在检索商品并生成回答..."

@Composable
fun ChatScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)

    // conversationId 同时影响后端记忆和本地历史。把它持久化后，重开 App 才能继续同一段对话。
    var conversationId by remember { mutableStateOf(ConversationStore.loadConversationId(context)) }
    var input by remember { mutableStateOf("") }
    var isBackendHealthy by remember { mutableStateOf<Boolean?>(null) }
    var isStreaming by remember { mutableStateOf(false) }
    var selectedProductId by remember { mutableStateOf<String?>(null) }
    var detail by remember { mutableStateOf<ProductDetail?>(null) }
    var detailLoading by remember { mutableStateOf(false) }
    var detailError by remember { mutableStateOf<String?>(null) }
    var conversationRevision by remember { mutableStateOf(0) }
    var batchMode by remember { mutableStateOf(false) }
    var selectedConversationIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var renameTarget by remember { mutableStateOf<ConversationSummary?>(null) }
    var renameText by remember { mutableStateOf("") }
    var deleteTarget by remember { mutableStateOf<ConversationSummary?>(null) }
    var activeConversationMenuId by remember { mutableStateOf<String?>(null) }
    var shouldAutoScroll by remember { mutableStateOf(false) }
    var pendingInstantScrollToBottom by remember { mutableStateOf(true) }
    var pendingSendScrollToBottom by remember { mutableStateOf(false) }
    var pendingStreamScrollToBottom by remember { mutableStateOf(false) }

    // mutableStateListOf 是 Compose 可观察列表；替换某条消息对象时，聊天列表会自动刷新。
    val messages = remember {
        mutableStateListOf<ChatMessage>().apply {
            val savedMessages = ConversationStore.loadMessages(context)
            addAll(savedMessages.ifEmpty { listOf(welcomeMessage()) })
        }
    }

    fun goBackToChat() {
        // 详情页只是聊天页上的一个临时视图状态，清空选中商品即可回到聊天列表。
        selectedProductId = null
        detail = null
        detailError = null
        detailLoading = false
    }

    fun resetConversation() {
        if (isStreaming) return

        val oldConversationId = conversationId
        conversationId = ConversationStore.replaceConversation(context)
        messages.clear()
        messages.add(welcomeMessage())
        shouldAutoScroll = false
        pendingInstantScrollToBottom = true
        conversationRevision += 1
        batchMode = false
        selectedConversationIds = emptySet()

        scope.launch(Dispatchers.IO) {
            // 即使本地已经换了新 conversationId，也通知后端清理旧会话，避免服务端内存继续保留无用上下文。
            runCatching { ConversationApi.resetConversation(oldConversationId) }
        }
    }

    fun openConversation(summary: ConversationSummary) {
        if (isStreaming) return

        ConversationStore.switchConversation(context, summary.id)
        conversationId = summary.id
        messages.clear()
        messages.addAll(ConversationStore.loadMessages(context).ifEmpty { listOf(welcomeMessage()) })
        shouldAutoScroll = false
        pendingInstantScrollToBottom = true
    }

    fun reloadCurrentConversation(newConversationId: String = ConversationStore.loadConversationId(context)) {
        conversationId = newConversationId
        messages.clear()
        messages.addAll(ConversationStore.loadMessages(context).ifEmpty { listOf(welcomeMessage()) })
        shouldAutoScroll = false
        pendingInstantScrollToBottom = true
        conversationRevision += 1
    }

    fun deleteConversations(ids: Set<String>) {
        if (ids.isEmpty() || isStreaming) return

        val nextConversationId = ConversationStore.deleteConversations(context, ids)
        batchMode = false
        selectedConversationIds = emptySet()
        deleteTarget = null
        reloadCurrentConversation(nextConversationId)
    }

    fun sendMessage(text: String) {
        val userText = text.trim()
        if (userText.isEmpty() || isStreaming) return

        messages.add(
            ChatMessage(
                id = nextMessageId(messages),
                role = MessageRole.User,
                text = userText
            )
        )

        val assistantMessageId = nextMessageId(messages)
        messages.add(
            ChatMessage(
                id = assistantMessageId,
                role = MessageRole.Assistant,
                text = LOADING_TEXT
            )
        )

        input = ""
        isStreaming = true
        shouldAutoScroll = true
        pendingSendScrollToBottom = true

        scope.launch {
            withContext(Dispatchers.IO) {
                ChatApi.streamChat(
                    conversationId = conversationId,
                    message = userText,
                    onToken = { token ->
                        scope.launch {
                            pendingStreamScrollToBottom = isNearConversationBottom(listState)
                            // token 来自 SSE 流。第一段 token 到达时替换掉加载文案，形成自然的流式回答。
                            updateAssistantMessage(messages, assistantMessageId) { old ->
                                val baseText = if (old.text == LOADING_TEXT) "" else old.text
                                old.copy(text = baseText + token)
                            }
                        }
                    },
                    onProducts = { products ->
                        scope.launch {
                            pendingStreamScrollToBottom = isNearConversationBottom(listState)
                            // 商品卡片必须来自后端结构化 products 事件，避免客户端从模型自然语言里猜商品。
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
                                old.copy(text = friendlyErrorMessage(message, old.text))
                            }
                            isStreaming = false
                        }
                    }
                )
            }

            // 兜底收尾：如果后端没有发 done，也避免输入栏一直卡在“生成中”。
            isStreaming = false
        }
    }

    LaunchedEffect(Unit) {
        // 首次进入页面检查后端是否可用；网络 IO 放到后台线程，避免阻塞 UI。
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

    LaunchedEffect(messages.size, messages.lastOrNull()?.text, messages.lastOrNull()?.products?.size) {
        ConversationStore.saveMessages(context, messages)

        if (messages.isEmpty()) return@LaunchedEffect

        when {
            pendingInstantScrollToBottom -> {
                // 切换会话要直接显示底部，不做动画，避免用户看到“从上滚到下”的过程。
                listState.scrollToItem(messages.lastIndex)
                pendingInstantScrollToBottom = false
            }

            pendingSendScrollToBottom -> {
                // 用户刚发送消息时主动跟到底部，让新一轮问答从当前位置开始展示。
                listState.animateScrollToItem(messages.lastIndex)
                pendingSendScrollToBottom = false
            }

            shouldAutoScroll && pendingStreamScrollToBottom -> {
                // token 或商品卡片到达前如果用户还在底部附近，就继续跟随。
                // 这个判断在状态更新前记录，能覆盖“卡片突然插入导致列表变长”的场景。
                listState.animateScrollToItem(messages.lastIndex)
                pendingStreamScrollToBottom = false
            }
        }
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

    val summaries = ConversationStore.loadSummaries(context).also { conversationRevision }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ConversationDrawer(
                conversations = summaries,
                isStreaming = isStreaming,
                batchMode = batchMode,
                selectedIds = selectedConversationIds,
                activeMenuId = activeConversationMenuId,
                onNewConversation = {
                    resetConversation()
                    scope.launch { drawerState.close() }
                },
                onSelectConversation = { summary -> openConversation(summary) },
                onRenameConversation = { summary ->
                    renameTarget = summary
                    renameText = summary.title
                },
                onDeleteConversation = { summary -> deleteTarget = summary },
                onActivateConversationMenu = { summary ->
                    activeConversationMenuId = summary.id
                },
                onDismissConversationMenu = { activeConversationMenuId = null },
                onStartBatchManage = {
                    activeConversationMenuId = null
                    batchMode = true
                    selectedConversationIds = emptySet()
                },
                onExitBatchManage = {
                    batchMode = false
                    selectedConversationIds = emptySet()
                },
                onToggleBatchSelection = { summary ->
                    selectedConversationIds = if (summary.id in selectedConversationIds) {
                        selectedConversationIds - summary.id
                    } else {
                        selectedConversationIds + summary.id
                    }
                },
                onDeleteSelected = { deleteConversations(selectedConversationIds) }
            )
        }
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Header(
                isBackendHealthy = isBackendHealthy,
                isStreaming = isStreaming,
                onOpenMenu = { scope.launch { drawerState.open() } }
            )

            LazyColumn(
                state = listState,
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

            QuickPromptRow(
                enabled = !isStreaming,
                onPromptClick = { prompt -> sendMessage(prompt) }
            )

            InputBar(
                value = input,
                enabled = !isStreaming,
                onValueChange = { input = it },
                onSend = { sendMessage(input) }
            )
        }
    }

    RenameConversationDialog(
        target = renameTarget,
        value = renameText,
        onValueChange = { renameText = it },
        onDismiss = { renameTarget = null },
        onConfirm = { target, title ->
            ConversationStore.renameConversation(context, target.id, title)
            renameTarget = null
            conversationRevision += 1
        }
    )

    DeleteConversationDialog(
        target = deleteTarget,
        onDismiss = { deleteTarget = null },
        onConfirm = { target -> deleteConversations(setOf(target.id)) }
    )
}

@Composable
private fun QuickPromptRow(
    enabled: Boolean,
    onPromptClick: (String) -> Unit
) {
    val prompts = listOf(
        "推荐一款适合油皮的防晒霜",
        "推荐无糖饮料",
        "推荐通勤背包",
        "想买一台办公用轻薄笔记本"
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        prompts.forEach { prompt ->
            OutlinedButton(
                onClick = { onPromptClick(prompt) },
                enabled = enabled
            ) {
                Text(prompt)
            }
        }
    }
}

private fun welcomeMessage(): ChatMessage {
    return ChatMessage(
        id = 1,
        role = MessageRole.Assistant,
        text = "你好，我是你的电商导购助手。可以直接告诉我预算、品类、使用场景和偏好，我会只基于商品库给你推荐，并说明为什么适合。"
    )
}

@Composable
private fun ConversationDrawer(
    conversations: List<ConversationSummary>,
    isStreaming: Boolean,
    batchMode: Boolean,
    selectedIds: Set<String>,
    activeMenuId: String?,
    onNewConversation: () -> Unit,
    onSelectConversation: (ConversationSummary) -> Unit,
    onRenameConversation: (ConversationSummary) -> Unit,
    onDeleteConversation: (ConversationSummary) -> Unit,
    onActivateConversationMenu: (ConversationSummary) -> Unit,
    onDismissConversationMenu: () -> Unit,
    onStartBatchManage: () -> Unit,
    onExitBatchManage: () -> Unit,
    onToggleBatchSelection: (ConversationSummary) -> Unit,
    onDeleteSelected: () -> Unit
) {
    ModalDrawerSheet(
        modifier = Modifier.width(308.dp),
        drawerContainerColor = Color(0xFFF8F8FA)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 22.dp)
        ) {
            DrawerHeader()

            Spacer(modifier = Modifier.height(20.dp))

            NewConversationButton(
                enabled = !isStreaming,
                onClick = onNewConversation
            )

            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = if (batchMode) "批量管理" else "最近会话",
                style = MaterialTheme.typography.labelMedium,
                color = Color(0xFF8A8D95)
            )

            Spacer(modifier = Modifier.height(8.dp))

            if (batchMode) {
                BatchManageBar(
                    selectedCount = selectedIds.size,
                    onDeleteSelected = onDeleteSelected,
                    onExit = onExitBatchManage
                )
                Spacer(modifier = Modifier.height(8.dp))
            }

            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(conversations, key = { it.id }) { summary ->
                    ConversationDrawerItem(
                        summary = summary,
                        isStreaming = isStreaming,
                        batchMode = batchMode,
                        selected = summary.id in selectedIds,
                        showMenuButton = activeMenuId == summary.id,
                        onClick = {
                            when {
                                isStreaming -> Unit
                                batchMode -> onToggleBatchSelection(summary)
                                else -> onSelectConversation(summary)
                            }
                        },
                        onActivateMenu = { onActivateConversationMenu(summary) },
                        onDismissMenu = onDismissConversationMenu,
                        onRename = { onRenameConversation(summary) },
                        onDelete = { onDeleteConversation(summary) },
                        onStartBatchManage = onStartBatchManage
                    )
                }
            }

            HorizontalDivider()

            AccountEntry()
        }
    }
}

@Composable
private fun BatchManageBar(
    selectedCount: Int,
    onDeleteSelected: () -> Unit,
    onExit: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            modifier = Modifier.weight(1f),
            text = "已选 $selectedCount 个",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF777A83)
        )
        TextButton(
            enabled = selectedCount > 0,
            onClick = onDeleteSelected
        ) {
            Text("删除")
        }
        TextButton(onClick = onExit) {
            Text("完成")
        }
    }
}

@Composable
private fun DrawerHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            modifier = Modifier.weight(1f),
            text = "ShopGuide",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF15171C)
        )
        Text(
            text = "AI",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF6554C0)
        )
    }
}

@Composable
private fun NewConversationButton(
    enabled: Boolean,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clip(RoundedCornerShape(16.dp))
            .clickable(enabled = enabled, onClick = onClick),
        color = Color.White,
        shadowElevation = 0.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Text(
                text = "＋",
                style = MaterialTheme.typography.titleLarge,
                color = Color(0xFF1F2328)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "新建对话",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium,
                color = Color(0xFF1F2328)
            )
        }
    }
}

@Composable
private fun ConversationDrawerItem(
    summary: ConversationSummary,
    isStreaming: Boolean,
    batchMode: Boolean,
    selected: Boolean,
    showMenuButton: Boolean,
    onClick: () -> Unit,
    onActivateMenu: () -> Unit,
    onDismissMenu: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
    onStartBatchManage: () -> Unit
) {
    val itemColor = if (summary.isCurrent) Color(0xFFEDE8FF) else Color.Transparent
    val titleColor = if (summary.isCurrent) Color(0xFF24193E) else Color(0xFF262A33)
    var menuExpanded by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(itemColor)
            // 生成中不切换会话，避免用户在 SSE 还没结束时把当前消息写到另一个会话里。
            .clickable(
                enabled = !isStreaming,
                onClick = {
                    onClick()
                    if (!batchMode) onActivateMenu()
                }
            )
            .padding(horizontal = 14.dp, vertical = 11.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (batchMode) {
                Checkbox(
                    checked = selected,
                    onCheckedChange = { onClick() }
                )
                Spacer(modifier = Modifier.width(6.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = summary.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (summary.isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                    color = titleColor,
                    maxLines = 1
                )
            }
            if (!batchMode && showMenuButton) {
                Box {
                    TextButton(
                        enabled = !isStreaming,
                        onClick = {
                            onActivateMenu()
                            menuExpanded = true
                        }
                    ) {
                        Text("⋮", color = Color(0xFF777A83))
                    }
                    ConversationActionMenu(
                        expanded = menuExpanded,
                        onDismiss = {
                            menuExpanded = false
                            onDismissMenu()
                        },
                        onStartBatchManage = {
                            menuExpanded = false
                            onDismissMenu()
                            onStartBatchManage()
                        },
                        onRename = {
                            menuExpanded = false
                            onDismissMenu()
                            onRename()
                        },
                        onDelete = {
                            menuExpanded = false
                            onDismissMenu()
                            onDelete()
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ConversationActionMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    onStartBatchManage: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss
    ) {
        DropdownMenuItem(
            leadingIcon = { BatchManageIcon() },
            text = { Text("批量管理") },
            onClick = onStartBatchManage
        )
        DropdownMenuItem(
            leadingIcon = { RenameIcon() },
            text = { Text("修改标题") },
            onClick = onRename
        )
        DropdownMenuItem(
            leadingIcon = { DeleteIcon() },
            text = { Text("删除对话", color = Color(0xFFE05858)) },
            onClick = onDelete
        )
    }
}

@Composable
private fun BatchManageIcon() {
    Canvas(modifier = Modifier.size(24.dp)) {
        val stroke = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round)
        val color = Color(0xFF262A33)

        // 两个叠放方框表示“批量”，勾选表示“管理/选择”。
        drawRoundRect(
            color = color,
            topLeft = androidx.compose.ui.geometry.Offset(5.dp.toPx(), 7.dp.toPx()),
            size = androidx.compose.ui.geometry.Size(11.dp.toPx(), 11.dp.toPx()),
            style = stroke
        )
        drawRoundRect(
            color = color,
            topLeft = androidx.compose.ui.geometry.Offset(8.dp.toPx(), 4.dp.toPx()),
            size = androidx.compose.ui.geometry.Size(11.dp.toPx(), 11.dp.toPx()),
            style = stroke
        )
        val check = Path().apply {
            moveTo(10.dp.toPx(), 10.dp.toPx())
            lineTo(12.dp.toPx(), 12.dp.toPx())
            lineTo(16.dp.toPx(), 8.dp.toPx())
        }
        drawPath(check, color = color, style = stroke)
    }
}

@Composable
private fun RenameIcon() {
    Canvas(modifier = Modifier.size(24.dp)) {
        val stroke = Stroke(width = 2.2.dp.toPx(), cap = StrokeCap.Round)
        val color = Color(0xFF262A33)

        // 铅笔图标用于“修改标题”，比字符符号更稳定，不受字体影响。
        drawLine(
            color = color,
            start = androidx.compose.ui.geometry.Offset(7.dp.toPx(), 16.dp.toPx()),
            end = androidx.compose.ui.geometry.Offset(16.dp.toPx(), 7.dp.toPx()),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round
        )
        drawLine(
            color = color,
            start = androidx.compose.ui.geometry.Offset(15.dp.toPx(), 6.dp.toPx()),
            end = androidx.compose.ui.geometry.Offset(18.dp.toPx(), 9.dp.toPx()),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round
        )
        drawLine(
            color = color,
            start = androidx.compose.ui.geometry.Offset(6.dp.toPx(), 19.dp.toPx()),
            end = androidx.compose.ui.geometry.Offset(18.dp.toPx(), 19.dp.toPx()),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round
        )
    }
}

@Composable
private fun DeleteIcon() {
    Canvas(modifier = Modifier.size(24.dp)) {
        val strokeWidth = 2.dp.toPx()
        val color = Color(0xFFE05858)

        // 线性垃圾桶图标用于危险操作，配合红色文字形成明确风险提示。
        drawLine(
            color = color,
            start = androidx.compose.ui.geometry.Offset(7.dp.toPx(), 8.dp.toPx()),
            end = androidx.compose.ui.geometry.Offset(17.dp.toPx(), 8.dp.toPx()),
            strokeWidth = strokeWidth,
            cap = StrokeCap.Round
        )
        drawLine(
            color = color,
            start = androidx.compose.ui.geometry.Offset(10.dp.toPx(), 5.dp.toPx()),
            end = androidx.compose.ui.geometry.Offset(14.dp.toPx(), 5.dp.toPx()),
            strokeWidth = strokeWidth,
            cap = StrokeCap.Round
        )
        drawRoundRect(
            color = color,
            topLeft = androidx.compose.ui.geometry.Offset(8.dp.toPx(), 9.dp.toPx()),
            size = androidx.compose.ui.geometry.Size(8.dp.toPx(), 10.dp.toPx()),
            style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
        )
    }
}

@Composable
private fun RenameConversationDialog(
    target: ConversationSummary?,
    value: String,
    onValueChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: (ConversationSummary, String) -> Unit
) {
    if (target == null) return

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("修改标题") },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                label = { Text("会话标题") }
            )
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(target, value) }) {
                Text("保存")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

@Composable
private fun DeleteConversationDialog(
    target: ConversationSummary?,
    onDismiss: () -> Unit,
    onConfirm: (ConversationSummary) -> Unit
) {
    if (target == null) return

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("删除对话") },
        text = { Text("删除后，本地将不再保留这个会话记录。") },
        confirmButton = {
            TextButton(onClick = { onConfirm(target) }) {
                Text("删除", color = Color(0xFFE05858))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

@Composable
private fun AccountEntry() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 16.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(
            modifier = Modifier.size(42.dp),
            shape = RoundedCornerShape(50),
            color = Color(0xFFEDE8FF)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text("我", color = Color(0xFF6554C0), fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "登录 / 账号",
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = Color(0xFF2F3138)
            )
            Text(
                text = "待接入",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF8A8D95)
            )
        }
    }
}

private fun nextMessageId(messages: List<ChatMessage>): Int {
    return (messages.maxOfOrNull { it.id } ?: 0) + 1
}

private fun friendlyErrorMessage(error: String, currentText: String): String {
    val prefix = if (currentText == LOADING_TEXT || currentText.isBlank()) {
        "这次请求没有成功。请确认后端服务、模型 Key 和网络都可用，然后再试一次。"
    } else {
        currentText
    }

    return "$prefix\n\n错误信息：$error"
}

private fun isNearConversationBottom(listState: LazyListState): Boolean {
    val layoutInfo = listState.layoutInfo
    val totalItems = layoutInfo.totalItemsCount
    if (totalItems == 0) return true

    val lastVisibleIndex = layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: return true
    // 留 1 条消息的容差：商品卡片和流式文本高度会变化，过于严格会导致明明在底部却不跟随。
    return lastVisibleIndex >= totalItems - 2
}

private fun updateAssistantMessage(
    messages: MutableList<ChatMessage>,
    messageId: Int,
    transform: (ChatMessage) -> ChatMessage
) {
    val index = messages.indexOfFirst { it.id == messageId }
    if (index >= 0) {
        // 替换整个 ChatMessage 对象可以触发 Compose 列表项重组，避免原地修改导致 UI 不刷新。
        messages[index] = transform(messages[index])
    }
}
