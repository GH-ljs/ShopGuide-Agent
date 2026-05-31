package com.shopguide.agent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.shopguide.agent.model.ProductDetail
import com.shopguide.agent.model.ProductFaq
import com.shopguide.agent.model.ProductReview
import com.shopguide.agent.model.ProductSku

@Composable
fun ProductDetailScreen(
    detail: ProductDetail?,
    isLoading: Boolean,
    errorMessage: String?,
    onBack: () -> Unit
) {
    var selectedReview by remember { mutableStateOf<ProductReview?>(null) }
    var dragDistance by remember { mutableFloatStateOf(0f) }

    // 详情页使用“顶部栏 + 可滚动详情 + 底部操作栏”的落地页结构，接近真实电商 App 的浏览路径。
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .background(Color(0xFFF5F6F8))
            .pointerInput(Unit) {
                // 详情页支持从左向右滑动返回，符合移动端从详情回到列表/聊天的常见手势。
                detectHorizontalDragGestures(
                    onDragEnd = {
                        if (dragDistance > 120f) onBack()
                        dragDistance = 0f
                    },
                    onDragCancel = { dragDistance = 0f },
                    onHorizontalDrag = { _, dragAmount ->
                        dragDistance = (dragDistance + dragAmount).coerceAtLeast(0f)
                    }
                )
            }
    ) {
        DetailTopBar(onBack = onBack)

        when {
            isLoading -> DetailStateText("正在加载商品详情...")
            errorMessage != null -> DetailStateText("详情暂时无法加载\n$errorMessage", isError = true)
            detail != null -> {
                ProductDetailContent(
                    detail = detail,
                    modifier = Modifier.weight(1f),
                    onReviewClick = { review -> selectedReview = review }
                )
                BottomActionBar()
            }
        }
    }

    ReviewDetailDialog(
        review = selectedReview,
        onDismiss = { selectedReview = null }
    )
}

@Composable
private fun DetailTopBar(onBack: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(Color.White)
            .padding(horizontal = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        OutlinedButton(
            modifier = Modifier.align(Alignment.CenterStart),
            onClick = onBack
        ) {
            Text("返回")
        }
        Text(
            text = "商品详情",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF15171C)
        )
    }
}

@Composable
private fun DetailStateText(
    text: String,
    isError: Boolean = false
) {
    Text(
        text = text,
        modifier = Modifier.padding(20.dp),
        color = if (isError) Color(0xFFB42318) else Color(0xFF5F6673),
        style = MaterialTheme.typography.bodyMedium
    )
}

@Composable
private fun ProductDetailContent(
    detail: ProductDetail,
    modifier: Modifier = Modifier,
    onReviewClick: (ProductReview) -> Unit
) {
    LazyColumn(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Spacer(modifier = Modifier.height(12.dp))
            ProductHeroSection(detail)
        }

        item {
            InfoSection(title = "商品介绍") {
                Text(
                    text = detail.marketingDescription.ifBlank { "暂无商品介绍" },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFF2F3138)
                )
            }
        }

        if (detail.skus.isNotEmpty()) {
            item {
                InfoSection(title = "规格与价格") {
                    SkuTable(detail.skus.take(6))
                }
            }
        }

        if (detail.officialFaq.isNotEmpty()) {
            item { SectionTitle("官方问答") }
            items(detail.officialFaq.take(4)) { faq ->
                FaqCard(faq)
            }
        }

        if (detail.userReviews.isNotEmpty()) {
            item { SectionTitle("用户评价") }
            items(detail.userReviews.take(4)) { review ->
                ReviewCard(
                    review = review,
                    onClick = { onReviewClick(review) }
                )
            }
        }

        item {
            Spacer(modifier = Modifier.height(10.dp))
        }
    }
}

@Composable
private fun ProductHeroSection(detail: ProductDetail) {
    CardBlock {
        Box(
            modifier = Modifier.fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            RemoteImage(
                imageUrl = detail.imageUrl,
                size = 220.dp,
                contentDescription = "商品主图",
                placeholderText = "暂无图片"
            )
        }

        Spacer(modifier = Modifier.height(18.dp))

        Text(
            text = detail.title,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF15171C)
        )

        Spacer(modifier = Modifier.height(10.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = detail.price,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = Color(0xFFE0523A)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Text(
                text = detail.brand,
                style = MaterialTheme.typography.bodyLarge,
                color = Color(0xFF2F6FED),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = listOf(detail.category, detail.subCategory).filter { it.isNotBlank() }.joinToString(" / "),
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF6B7280)
        )
    }
}

@Composable
private fun InfoSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    SectionTitle(title)
    CardBlock(content = content)
}

@Composable
private fun SkuTable(skus: List<ProductSku>) {
    val propertyKeys = skus
        .flatMap { it.properties.keys }
        .distinct()

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFFF5F6F8), RoundedCornerShape(6.dp))
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (propertyKeys.isEmpty()) {
                Text(
                    modifier = Modifier.weight(1f),
                    text = "规格",
                    style = MaterialTheme.typography.labelMedium,
                    color = Color(0xFF6B7280)
                )
            } else {
                propertyKeys.forEach { key ->
                    Text(
                        modifier = Modifier.weight(1f),
                        text = key,
                        style = MaterialTheme.typography.labelMedium,
                        color = Color(0xFF6B7280),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            Text(
                modifier = Modifier.weight(0.8f),
                text = "价格",
                style = MaterialTheme.typography.labelMedium,
                color = Color(0xFF6B7280)
            )
        }

        skus.forEachIndexed { index, sku ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (propertyKeys.isEmpty()) {
                    Text(
                        modifier = Modifier.weight(1f),
                        text = sku.skuId,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFF2F3138),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                } else {
                    propertyKeys.forEach { key ->
                        Text(
                            modifier = Modifier.weight(1f),
                            text = sku.properties[key].orEmpty().ifBlank { "-" },
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF2F3138),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
                Text(
                    modifier = Modifier.weight(0.8f),
                    text = sku.price,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = Color(0xFFE0523A)
                )
            }
            if (index != skus.lastIndex) {
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun FaqCard(faq: ProductFaq) {
    CardBlock {
        Text(
            text = "Q  ${faq.question}",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF15171C)
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "A  ${faq.answer}",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF4B5563)
        )
    }
}

@Composable
private fun ReviewCard(
    review: ProductReview,
    onClick: () -> Unit
) {
    CardBlock(
        modifier = Modifier.clickable(onClick = onClick)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                modifier = Modifier.weight(1f),
                text = review.nickname.ifBlank { "匿名用户" },
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFF15171C)
            )
            Text(
                text = "评分 ${review.rating}",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFFE0523A)
            )
        }
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = review.content,
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF4B5563),
            maxLines = 3,
            overflow = TextOverflow.Ellipsis
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "查看完整评价",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF6554C0)
        )
    }
}

@Composable
private fun ReviewDetailDialog(
    review: ProductReview?,
    onDismiss: () -> Unit
) {
    if (review == null) return

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text("${review.nickname.ifBlank { "匿名用户" }} 的评价")
        },
        text = {
            Column {
                Text(
                    text = "评分 ${review.rating}",
                    color = Color(0xFFE0523A),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = review.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFF2F3138)
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("关闭")
            }
        }
    )
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.Bold,
        color = Color(0xFF15171C),
        modifier = Modifier.padding(top = 4.dp, bottom = 2.dp)
    )
}

@Composable
private fun CardBlock(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(10.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp), content = content)
    }
}

@Composable
private fun BottomActionBar() {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White,
        shadowElevation = 4.dp
    ) {
        Button(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp)
                .height(48.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF6554C0)),
            onClick = {
                // 当前项目还没有购物车后端，这个按钮先作为演示入口，展示完整电商落地页动线。
            }
        ) {
            Text("加入购物车")
        }
    }
}
