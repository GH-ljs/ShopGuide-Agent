package com.shopguide.agent.storage

import android.content.Context
import com.shopguide.agent.model.ChatMessage
import com.shopguide.agent.model.ComparisonCard
import com.shopguide.agent.model.ComparisonColumn
import com.shopguide.agent.model.ComparisonRow
import com.shopguide.agent.model.ComparisonValue
import com.shopguide.agent.model.MessageRole
import com.shopguide.agent.model.ProductCard
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class ConversationSummary(
    val id: String,
    val title: String,
    val messageCount: Int,
    val isCurrent: Boolean
)

/**
 * 会话的本地存储。
 *
 * 这里先用 SharedPreferences 做轻量持久化：它适合保存少量 JSON 字符串，能解决“关闭 App 后聊天丢失”
 * 和“多个会话之间切换”的基础问题。等后续要做搜索、分页、删除、同步时，再升级成 Room 数据库会更合适。
 */
object ConversationStore {
    private const val PREF_NAME = "shopguide_conversation"
    private const val KEY_CONVERSATION_ID = "conversation_id"
    private const val KEY_MESSAGES = "messages"
    private const val KEY_SESSIONS = "sessions"

    fun loadConversationId(context: Context): String {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val existingId = prefs.getString(KEY_CONVERSATION_ID, null)
        if (!existingId.isNullOrBlank()) return existingId

        val newId = UUID.randomUUID().toString()
        val sessions = loadSessions(context).ifEmpty {
            listOf(StoredSession(id = newId, title = "新对话", updatedAt = System.currentTimeMillis()))
        }
        prefs.edit()
            .putString(KEY_CONVERSATION_ID, sessions.first().id)
            .putString(KEY_SESSIONS, sessions.toJson().toString())
            .apply()
        return sessions.first().id
    }

    fun replaceConversation(context: Context): String {
        val currentId = loadConversationId(context)
        val currentSession = loadSessions(context).firstOrNull { it.id == currentId }
        if (currentSession != null && currentSession.messages.none { it.role == MessageRole.User }) {
            // 当前会话还没有正式用户消息时，继续复用它，避免用户反复点“新建对话”生成一堆空历史。
            return currentId
        }

        val newId = UUID.randomUUID().toString()
        val sessions = loadSessions(context).toMutableList()
        sessions.add(0, StoredSession(id = newId, title = "新对话", updatedAt = System.currentTimeMillis()))

        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CONVERSATION_ID, newId)
            .putString(KEY_SESSIONS, sessions.toJson().toString())
            .apply()
        return newId
    }

    fun loadMessages(context: Context): List<ChatMessage> {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val currentId = loadConversationId(context)
        val session = loadSessions(context).firstOrNull { it.id == currentId }
        if (session != null) return session.messages

        // 兼容旧版本：之前只保存一个 messages 字段，升级到多会话后仍尽量把它读回来。
        val raw = prefs.getString(KEY_MESSAGES, "[]").orEmpty()

        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    add(array.getJSONObject(index).toChatMessage())
                }
            }
        }.getOrDefault(emptyList())
    }

    fun saveMessages(context: Context, messages: List<ChatMessage>) {
        val currentId = loadConversationId(context)
        val sessions = loadSessions(context).toMutableList()
        val currentIndex = sessions.indexOfFirst { it.id == currentId }
        val existingSession = if (currentIndex >= 0) sessions[currentIndex] else null
        val messageChanged = existingSession?.messages != messages
        val updated = StoredSession(
            id = currentId,
            title = if (existingSession?.titleEdited == true) existingSession.title else buildTitle(messages),
            // 只有真正产生新消息或流式内容变化时，才刷新“最近会话”排序时间。
            // 这样用户只是点选历史会话查看，不会导致它跳到列表最上面。
            updatedAt = if (messageChanged) System.currentTimeMillis() else existingSession?.updatedAt ?: System.currentTimeMillis(),
            messages = messages,
            titleEdited = existingSession?.titleEdited == true
        )

        if (currentIndex >= 0) {
            sessions[currentIndex] = updated
        } else {
            sessions.add(0, updated)
        }

        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SESSIONS, sessions.sortedByDescending { it.updatedAt }.toJson().toString())
            .apply()
    }

    fun loadSummaries(context: Context): List<ConversationSummary> {
        val currentId = loadConversationId(context)
        return loadSessions(context)
            .sortedByDescending { it.updatedAt }
            .map { session ->
                ConversationSummary(
                    id = session.id,
                    title = session.title,
                    messageCount = session.messages.size,
                    isCurrent = session.id == currentId
                )
            }
    }

    fun switchConversation(context: Context, conversationId: String) {
        // 切换当前会话只改指针，不改消息内容。这样历史记录不会因为切换动作被覆盖。
        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CONVERSATION_ID, conversationId)
            .apply()
    }

    fun renameConversation(context: Context, conversationId: String, title: String) {
        val sessions = loadSessions(context).map { session ->
            if (session.id == conversationId) {
                val newTitle = title.trim().ifBlank { session.title }
                // 手动重命名后设置 titleEdited，避免后续保存消息时又被自动标题覆盖。
                session.copy(title = newTitle, titleEdited = true, updatedAt = System.currentTimeMillis())
            } else {
                session
            }
        }

        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SESSIONS, sessions.sortedByDescending { it.updatedAt }.toJson().toString())
            .apply()
    }

    fun deleteConversations(context: Context, conversationIds: Set<String>): String {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val currentId = loadConversationId(context)
        val remaining = loadSessions(context)
            .filterNot { it.id in conversationIds }
            .toMutableList()

        if (remaining.isEmpty()) {
            remaining.add(StoredSession(id = UUID.randomUUID().toString(), title = "新对话", updatedAt = System.currentTimeMillis()))
        }

        val nextCurrentId = if (currentId in conversationIds) remaining.first().id else currentId

        prefs.edit()
            .putString(KEY_CONVERSATION_ID, nextCurrentId)
            .putString(KEY_SESSIONS, remaining.sortedByDescending { it.updatedAt }.toJson().toString())
            .apply()

        return nextCurrentId
    }

    private fun loadSessions(context: Context): List<StoredSession> {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_SESSIONS, "[]").orEmpty()

        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    add(array.getJSONObject(index).toStoredSession())
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun buildTitle(messages: List<ChatMessage>): String {
        val firstUserMessage = messages.firstOrNull { it.role == MessageRole.User }?.text.orEmpty()
        if (firstUserMessage.isBlank()) return "新对话"

        // 历史列表只需要短标题，截断能避免很长的问题把弹窗撑坏。
        return firstUserMessage.take(18)
    }

    private fun JSONObject.toChatMessage(): ChatMessage {
        val productsJson = optJSONArray("products") ?: JSONArray()
        val products = buildList {
            for (index in 0 until productsJson.length()) {
                val item = productsJson.getJSONObject(index)
                add(
                    ProductCard(
                        productId = item.optString("productId"),
                        title = item.optString("title"),
                        brand = item.optString("brand"),
                        category = item.optString("category"),
                        subCategory = item.optString("subCategory"),
                        price = item.optString("price"),
                        imageUrl = item.optString("imageUrl"),
                        reason = item.optString("reason")
                    )
                )
            }
        }

        return ChatMessage(
            id = optInt("id"),
            role = MessageRole.valueOf(optString("role", MessageRole.Assistant.name)),
            text = optString("text"),
            products = products,
            comparison = optJSONObject("comparison")?.toComparisonCard()
        )
    }

    private fun ChatMessage.toJson(): JSONObject {
        val productsJson = JSONArray()
        products.forEach { product ->
            productsJson.put(
                JSONObject()
                    .put("productId", product.productId)
                    .put("title", product.title)
                    .put("brand", product.brand)
                    .put("category", product.category)
                    .put("subCategory", product.subCategory)
                    .put("price", product.price)
                    .put("imageUrl", product.imageUrl)
                    .put("reason", product.reason)
            )
        }

        return JSONObject()
            .put("id", id)
            .put("role", role.name)
            .put("text", text)
            .put("products", productsJson)
            .put("comparison", comparison?.toJson())
    }

    private fun JSONObject.toComparisonCard(): ComparisonCard {
        val columnsJson = optJSONArray("columns") ?: JSONArray()
        val rowsJson = optJSONArray("rows") ?: JSONArray()
        return ComparisonCard(
            title = optString("title"),
            conclusion = optString("conclusion"),
            recommendedProductId = optString("recommendedProductId"),
            columns = buildList {
                for (index in 0 until columnsJson.length()) {
                    val item = columnsJson.getJSONObject(index)
                    add(
                        ComparisonColumn(
                            productId = item.optString("productId"),
                            label = item.optString("label"),
                            title = item.optString("title"),
                            brand = item.optString("brand")
                        )
                    )
                }
            },
            rows = buildList {
                for (rowIndex in 0 until rowsJson.length()) {
                    val row = rowsJson.getJSONObject(rowIndex)
                    val valuesJson = row.optJSONArray("values") ?: JSONArray()
                    add(
                        ComparisonRow(
                            label = row.optString("label"),
                            values = buildList {
                                for (valueIndex in 0 until valuesJson.length()) {
                                    val item = valuesJson.getJSONObject(valueIndex)
                                    add(
                                        ComparisonValue(
                                            productId = item.optString("productId"),
                                            value = item.optString("value")
                                        )
                                    )
                                }
                            }
                        )
                    )
                }
            }
        )
    }

    private fun ComparisonCard.toJson(): JSONObject {
        val columnsJson = JSONArray()
        columns.forEach { column ->
            columnsJson.put(
                JSONObject()
                    .put("productId", column.productId)
                    .put("label", column.label)
                    .put("title", column.title)
                    .put("brand", column.brand)
            )
        }

        val rowsJson = JSONArray()
        rows.forEach { row ->
            val valuesJson = JSONArray()
            row.values.forEach { value ->
                valuesJson.put(
                    JSONObject()
                        .put("productId", value.productId)
                        .put("value", value.value)
                )
            }
            rowsJson.put(
                JSONObject()
                    .put("label", row.label)
                    .put("values", valuesJson)
            )
        }

        return JSONObject()
            .put("title", title)
            .put("conclusion", conclusion)
            .put("recommendedProductId", recommendedProductId)
            .put("columns", columnsJson)
            .put("rows", rowsJson)
    }

    private data class StoredSession(
        val id: String,
        val title: String,
        val updatedAt: Long,
        val messages: List<ChatMessage> = emptyList(),
        val titleEdited: Boolean = false
    )

    private fun JSONObject.toStoredSession(): StoredSession {
        val messagesJson = optJSONArray("messages") ?: JSONArray()
        val messages = buildList {
            for (index in 0 until messagesJson.length()) {
                add(messagesJson.getJSONObject(index).toChatMessage())
            }
        }

        return StoredSession(
            id = optString("id"),
            title = optString("title", "新对话"),
            updatedAt = optLong("updatedAt"),
            messages = messages,
            titleEdited = optBoolean("titleEdited", false)
        )
    }

    private fun List<StoredSession>.toJson(): JSONArray {
        val array = JSONArray()
        forEach { session ->
            val messagesJson = JSONArray()
            session.messages.forEach { message -> messagesJson.put(message.toJson()) }

            array.put(
                JSONObject()
                    .put("id", session.id)
                    .put("title", session.title)
                    .put("updatedAt", session.updatedAt)
                    .put("titleEdited", session.titleEdited)
                    .put("messages", messagesJson)
            )
        }
        return array
    }
}
