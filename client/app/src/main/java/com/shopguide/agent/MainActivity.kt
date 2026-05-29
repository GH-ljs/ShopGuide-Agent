package com.shopguide.agent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import com.shopguide.agent.ui.ChatScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // setContent 是 Compose 应用的入口：从这里开始挂载声明式 UI 树。
        setContent {
            ShopGuideApp()
        }
    }
}

@Composable
fun ShopGuideApp() {
    MaterialTheme {
        // Surface 提供整页背景和 Material 主题承载层，真正的业务页面交给 ChatScreen。
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = Color(0xFFF6F7F9)
        ) {
            ChatScreen()
        }
    }
}

@Preview(showBackground = true)
@Composable
fun ChatScreenPreview() {
    ShopGuideApp()
}
