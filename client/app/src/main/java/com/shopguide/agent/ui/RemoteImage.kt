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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL

@Composable
fun RemoteImage(
    imageUrl: String,
    size: Dp,
    contentDescription: String,
    modifier: Modifier = Modifier
) {
    var image by remember(imageUrl) { mutableStateOf<ImageBitmap?>(null) }
    val shape = RoundedCornerShape(8.dp)

    LaunchedEffect(imageUrl) {
        image = withContext(Dispatchers.IO) {
            runCatching {
                URL(imageUrl).openStream().use { input ->
                    BitmapFactory.decodeStream(input)?.asImageBitmap()
                }
            }.getOrNull()
        }
    }

    val imageModifier = modifier
        .size(size)
        .background(Color(0xFFF1F3F5), shape)

    if (image != null) {
        Image(
            bitmap = image!!,
            contentDescription = contentDescription,
            modifier = imageModifier,
            contentScale = ContentScale.Crop
        )
    } else {
        Spacer(modifier = imageModifier)
    }
}
