package com.shopguide.agent.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.shopguide.agent.model.ProductCard

@Composable
fun ProductCardView(
    product: ProductCard,
    onClick: (ProductCard) -> Unit
) {
    Card(
        modifier = Modifier
            .width(280.dp)
            .height(132.dp)
            // 点击卡片只把 productId 交回上层，真正的详情请求由 ChatScreen 统一触发。
            .clickable { onClick(product) },
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(8.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(modifier = Modifier.padding(12.dp)) {
            RemoteImage(
                imageUrl = product.imageUrl,
                size = 76.dp,
                contentDescription = "商品图片"
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = product.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = Color(0xFF1F2328),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        modifier = Modifier.weight(1f),
                        text = product.brand,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFF2F6FED),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "- ${product.price}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFF2F6FED),
                        maxLines = 1,
                        overflow = TextOverflow.Clip
                    )
                }
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = listOf(product.category, product.subCategory)
                        .filter { it.isNotBlank() }
                        .joinToString(" / "),
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF5F6673),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
