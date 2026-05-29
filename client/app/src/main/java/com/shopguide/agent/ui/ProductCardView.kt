package com.shopguide.agent.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.unit.dp
import com.shopguide.agent.model.ProductCard

@Composable
fun ProductCardView(
    product: ProductCard,
    onClick: (ProductCard) -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick(product) },
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(8.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(modifier = Modifier.fillMaxWidth()) {
                RemoteImage(
                    imageUrl = product.imageUrl,
                    size = 72.dp,
                    contentDescription = "商品图片"
                )
                Spacer(modifier = Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = product.title,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "${product.brand} - ${product.price}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFF2F6FED)
                    )
                    Text(
                        text = listOf(product.category, product.subCategory)
                            .filter { it.isNotBlank() }
                            .joinToString(" / "),
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF5F6673)
                    )
                }
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = product.reason,
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF5F6673)
            )
        }
    }
}
