# ShopGuide Agent — Android 客户端

项目的 Android 原生客户端，使用 **Kotlin + Jetpack Compose** 开发，对接后端 SSE 流式接口，实现导购对话和商品卡片展示。

## 架构

```text
┌─────────────────────────────────────────────────┐
│  MainActivity                                    │
│    └─ ChatScreen                                 │
│         ├─ Header              ← 后端连接状态     │
│         ├─ LazyColumn                            │
│         │    └─ MessageBubble                     │
│         │         ├─ 文字内容（流式逐段追加）      │
│         │         └─ ProductCardView （商品卡片）  │
│         └─ InputBar            ← 输入 + 发送      │
│                                                    │
│  Network Layer                                     │
│    ├─ ApiConfig       → http://10.0.2.2:3001      │
│    ├─ HealthApi       → GET /api/health           │
│    └─ ChatApi         → POST /api/chat (SSE)      │
└─────────────────────────────────────────────────┘
```

## 当前能力

- ✅ 连接后端健康检查接口，顶栏显示连接状态
- ✅ 调用 `POST /api/chat` 接收 SSE 流式回复
- ✅ 逐 token 流式渲染文字到消息气泡
- ✅ 解析 `products` 事件展示结构化商品卡片（标题、品牌、价格、推荐理由）
- ✅ 错误事件处理并显示友好提示
- ✅ 按 `conversationId` 进行多轮对话
- ✅ 中文本地化界面

## 项目结构

```text
client/
├─ app/src/main/java/com/shopguide/agent/
│  ├─ MainActivity.kt              # 入口 Activity，加载 ChatScreen
│  ├─ model/
│  │  ├─ ChatMessage.kt            # 聊天消息：id, role, text, products
│  │  ├─ MessageRole.kt            # 角色枚举（User / Assistant）
│  │  └─ ProductCard.kt            # 商品卡片：title, brand, price, reason
│  ├─ network/
│  │  ├─ ApiConfig.kt              # 后端地址（模拟器: 10.0.2.2:3001）
│  │  ├─ ChatApi.kt                # SSE 流式请求，解析 token/products/done/error
│  │  └─ HealthApi.kt              # 健康检查 GET /api/health
│  └─ ui/
│     ├─ ChatScreen.kt             # 主聊天界面：消息列表 + 输入 + 流式更新
│     ├─ Header.kt                 # 顶栏：标题 + 后端已连接/未连接/检查中
│     ├─ InputBar.kt               # 输入框 + 发送按钮（发送中禁用）
│     ├─ MessageBubble.kt          # 消息气泡：用户蓝色靠右，助手白色靠左
│     └─ ProductCardView.kt        # 商品卡片组件（Card 布局）
├─ build.gradle.kts                # 根构建配置
├─ settings.gradle.kts             # 项目设置
└─ app/build.gradle.kts            # App 模块构建配置
```

## 打开方式

1. 打开 Android Studio。
2. 选择 **Open**，找到本目录：
   ```text
   D:\code\agent\ShopGuide-Agent\client
   ```
3. 等待 Gradle Sync 完成（首次可能需要下载依赖）。
4. 选择模拟器或真机，点击 **Run**。

### SDK 路径

本机 SDK 路径配置在 `local.properties`：

```properties
sdk.dir=D\:\\Application\\AndroidSDK
```

`local.properties` 是本地配置文件，已加入 `.gitignore`，请勿提交到 GitHub。

### 网络配置

客户端通过 `ApiConfig.kt` 中的 `BASE_URL` 指定后端地址：

- **模拟器**：`http://10.0.2.2:3001`（10.0.2.2 是模拟器访问宿主机 localhost 的特殊 IP）
- **真机**：需改为电脑的局域网 IP，例如 `http://192.168.x.x:3001`

确保 `AndroidManifest.xml` 已配置：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<application android:usesCleartextTraffic="true" ...>
```

## SSE 事件解析

`ChatApi.streamChat()` 使用原生 `HttpURLConnection` + `BufferedReader` 逐行读取 SSE 流，无需引入第三方网络库：

| SSE 事件 | 触发时机 | 客户端处理 |
|----------|----------|-----------|
| `token` | 流式文本片段 | 追加到当前助手消息的 text |
| `products` | 商品卡片数据 | 设置到当前助手消息的 products |
| `done` | 本轮完成 | 标记流式结束 |
| `error` | 后端错误 | 显示友好错误文案 |

**注意**：商品卡片数据以 `products` 事件为准，不要从模型自然语言文本中解析商品信息。

## 依赖

使用以下 Compose BOM 和依赖：

```kotlin
androidx.compose:compose-bom:2024.09.03
androidx.activity:activity-compose:1.9.3
androidx.compose.material3:material3
```

当前没有引入 Retrofit/OkHttp 等网络库，使用系统自带 `HttpURLConnection` 最小化依赖。

## 构建参数

| 配置 | 值 |
|------|-----|
| compileSdk | 36 |
| minSdk | 26 |
| targetSdk | 36 |
| Kotlin | 2.0.21 |
| AGP | 8.13.0 |
| Gradle | 9.0.0 |
| JVM target | 17 |

## 后端接口

客户端对接的后端接口（默认 `http://10.0.2.2:3001`）：

| 接口 | 方法 | 用途 |
|------|------|------|
| `/api/chat` | POST | SSE 流式导购对话 |
| `/api/health` | GET | 检查后端是否可用 |
| `/api/conversations/reset` | POST | 重置会话记忆 |

详细接口说明见 [docs/api.md](../docs/api.md)。
