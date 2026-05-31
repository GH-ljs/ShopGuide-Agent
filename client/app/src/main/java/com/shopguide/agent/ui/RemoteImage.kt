package com.shopguide.agent.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
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
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var image by remember(imageUrl) { mutableStateOf<ImageBitmap?>(null) }
    val shape = RoundedCornerShape(8.dp)

    LaunchedEffect(imageUrl) {
        // 先读本地缓存，缓存没有时再下载；下载成功会写入缓存，支撑后端离线时展示历史卡片图片。
        image = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = ImageCache.loadOrDownload(context, imageUrl) ?: return@runCatching null
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }.getOrNull()
        }
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
        Spacer(modifier = imageModifier)
    }
}
