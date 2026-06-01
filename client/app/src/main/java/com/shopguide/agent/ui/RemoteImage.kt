package com.shopguide.agent.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.shopguide.agent.storage.ImageCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun RemoteImage(
    imageUrl: String,
    size: Dp,
    contentDescription: String,
    modifier: Modifier = Modifier,
    placeholderText: String? = null
) {
    val context = LocalContext.current
    var image by remember(imageUrl) { mutableStateOf<ImageBitmap?>(null) }
    var loadFinished by remember(imageUrl) { mutableStateOf(false) }
    val shape = RoundedCornerShape(8.dp)

    LaunchedEffect(imageUrl) {
        loadFinished = false
        // 先读本地缓存，缓存没有时再下载；下载成功会写入缓存，支撑后端离线时展示历史卡片图片。
        image = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = ImageCache.loadOrDownload(context, imageUrl) ?: return@runCatching null
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }.getOrNull()
        }
        loadFinished = true
    }

    val imageModifier = modifier
        .size(size)
        .background(Color(0xFFF1F3F5), shape)

    if (image != null) {
        // 加载成功后渲染真实图片，ContentScale.Crop 保证卡片缩略图尺寸稳定。
        Image(
            bitmap = image!!,
            contentDescription = contentDescription,
            modifier = imageModifier,
            contentScale = ContentScale.Crop
        )
    } else {
        // 加载中或失败时保留同尺寸占位，避免聊天列表因为图片结果变化而跳动。
        if (!loadFinished && placeholderText.isNullOrBlank()) {
            Spacer(modifier = imageModifier)
        } else {
            ImageFallback(
                modifier = imageModifier,
                text = placeholderText ?: "暂无图片"
            )
        }
    }
}

@Composable
private fun ImageFallback(modifier: Modifier, text: String) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Canvas(modifier = Modifier.size(24.dp)) {
                val stroke = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round)
                val color = Color(0xFF9AA1AD)

                // 图片失败占位只表达“图片暂不可用”，不影响商品本身的推荐和点击详情。
                drawRoundRect(
                    color = color,
                    topLeft = androidx.compose.ui.geometry.Offset(3.dp.toPx(), 5.dp.toPx()),
                    size = androidx.compose.ui.geometry.Size(18.dp.toPx(), 14.dp.toPx()),
                    style = stroke
                )
                drawCircle(
                    color = color,
                    radius = 2.dp.toPx(),
                    center = androidx.compose.ui.geometry.Offset(9.dp.toPx(), 10.dp.toPx())
                )
                drawLine(
                    color = color,
                    start = androidx.compose.ui.geometry.Offset(6.dp.toPx(), 17.dp.toPx()),
                    end = androidx.compose.ui.geometry.Offset(12.dp.toPx(), 12.dp.toPx()),
                    strokeWidth = stroke.width,
                    cap = StrokeCap.Round
                )
                drawLine(
                    color = color,
                    start = androidx.compose.ui.geometry.Offset(12.dp.toPx(), 12.dp.toPx()),
                    end = androidx.compose.ui.geometry.Offset(19.dp.toPx(), 18.dp.toPx()),
                    strokeWidth = stroke.width,
                    cap = StrokeCap.Round
                )
            }
            Text(
                text = text,
                color = Color(0xFF8A8D95),
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}
