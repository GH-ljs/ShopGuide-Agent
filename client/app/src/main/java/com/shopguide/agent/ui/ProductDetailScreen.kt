package com.shopguide.agent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shopguide.agent.model.ProductDetail

@Composable
fun ProductDetailScreen(
    detail: ProductDetail?,
    isLoading: Boolean,
    errorMessage: String?,
    onBack: () -> Unit
) {
    // 详情页根据 loading/error/detail 三种状态切换内容，这是移动端网络页面的常见状态模型。
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .background(Color(0xFFF6F7F9))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color.White)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Button(onClick = onBack) {
                Text("返回聊天")
            }
            Text(
                text = "商品详情",
                modifier = Modifier.padding(start = 12.dp),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
        }

        when {
            isLoading -> {
                Text(
                    text = "正在加载商品详情...",
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            errorMessage != null -> {
                Text(
                    text = "加载失败：$errorMessage",
                    modifier = Modifier.padding(16.dp),
                    color = Color(0xFFB42318),
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            detail != null -> {
                // 只有拿到完整详情数据后才渲染正文，避免 UI 直接依赖可能为空的网络结果。
                ProductDetailContent(detail = detail)
            }
        }
    }
}

@Composable
private fun ProductDetailContent(detail: ProductDetail) {
    // LazyColumn 适合详情页这种可滚动内容，SKU/FAQ/评价都可以作为独立 item 渲染。
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            CardBlock {
                RemoteImage(
                    imageUrl = detail.imageUrl,
                    size = 180.dp,
                    contentDescription = "商品图片"
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = detail.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "${detail.brand} - ${detail.price}",
                    color = Color(0xFF2F6FED),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = listOf(detail.category, detail.subCategory).filter { it.isNotBlank() }.joinToString(" / "),
                    color = Color(0xFF5F6673),
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }

        item {
            SectionTitle("商品介绍")
            CardBlock {
                Text(
                    text = detail.marketingDescription.ifBlank { "暂无商品介绍" },
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }

        if (detail.skus.isNotEmpty()) {
            item { SectionTitle("规格与价格") }
            items(detail.skus) { sku ->
                CardBlock {
                    Text(text = sku.properties.ifBlank { sku.skuId }, fontWeight = FontWeight.SemiBold)
                    Text(text = sku.price, color = Color(0xFF2F6FED))
                }
            }
        }

        if (detail.officialFaq.isNotEmpty()) {
            item { SectionTitle("官方问答") }
            // 详情页先展示前 3 条，保证页面紧凑；后续可扩展“查看更多”。
            items(detail.officialFaq.take(3)) { faq ->
                CardBlock {
                    Text(text = faq.question, fontWeight = FontWeight.SemiBold)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(text = faq.answer, style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        if (detail.userReviews.isNotEmpty()) {
            item { SectionTitle("用户评价") }
            // 评价同样截取前 3 条，避免长列表淹没商品核心信息。
            items(detail.userReviews.take(3)) { review ->
                CardBlock {
                    Text(text = "${review.nickname}  评分 ${review.rating}", fontWeight = FontWeight.SemiBold)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(text = review.content, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(top = 4.dp)
    )
}

@Composable
private fun CardBlock(content: @Composable ColumnScope.() -> Unit) {
    // CardBlock 统一详情页每个信息块的白底卡片样式，减少重复布局代码。
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(8.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp), content = content)
    }
}
