# ShopGuide Agent Android 客户端

这是 ShopGuide Agent 的 Android 原生客户端，使用 Kotlin + Jetpack Compose 开发。客户端对接后端 SSE 流式接口，实现导购聊天、商品卡片、商品详情页、结构化对比卡和多会话本地历史。

## 客户端职责

- 提供原生 Android 聊天界面。
- 调用 `GET /api/health` 检查后端连接状态。
- 调用 `POST /api/chat` 接收 SSE 流式回答。
- 按 `token` 事件逐段追加 AI 文本。
- 按 `products` 事件展示可信商品卡片。
- 按 `comparison` 事件展示结构化商品对比结果。
- 点击商品卡片后调用商品详情接口并进入详情页。
- 在本地保存多会话历史，并把最近历史发给后端辅助恢复上下文。

## 当前能力

- 连接后端健康检查接口，顶栏显示连接状态。
- 聊天窗口支持中文输入、发送中禁用、错误提示和快捷问题。
- 使用 SSE 渲染流式回答。
- 横向展示商品卡片，包含标题、品牌、类目、价格、图片和推荐理由。
- 点击商品卡片进入详情页，展示主图、价格、规格、官方问答和用户评价。
- 支持 Android 返回键和详情页右滑返回。
- 支持结构化对比卡，适配“2 和 3 哪个好”“前两款对比一下”等问题。
- 支持多会话抽屉、会话切换、新建、重命名、删除和批量管理。
- 支持本地持久化聊天记录，关闭 App 后仍能恢复当前会话。

## 项目结构

```text
client/
├─ app/src/main/java/com/shopguide/agent/
│  ├─ MainActivity.kt                 # 入口 Activity，加载 ChatScreen
│  ├─ model/
│  │  ├─ ChatMessage.kt               # 聊天消息：id, role, text, products, comparison
│  │  ├─ ComparisonCard.kt            # 结构化对比卡模型
│  │  ├─ MessageRole.kt               # 角色枚举：User / Assistant
│  │  ├─ ProductCard.kt               # 商品卡片模型
│  │  └─ ProductDetail.kt             # 商品详情、SKU、FAQ、评价模型
│  ├─ network/
│  │  ├─ ApiConfig.kt                 # 后端地址和聊天商品数量配置
│  │  ├─ ChatApi.kt                   # POST /api/chat，解析 SSE 事件
│  │  ├─ ConversationApi.kt           # POST /api/conversations/reset
│  │  ├─ HealthApi.kt                 # GET /api/health
│  │  └─ ProductDetailApi.kt          # GET /api/products/:productId
│  ├─ storage/
│  │  ├─ ConversationStore.kt         # SharedPreferences 多会话历史
│  │  ├─ DeviceStore.kt               # 匿名 deviceId，本机身份与后端会话隔离
│  │  └─ ImageCache.kt                # 商品图片轻量内存缓存
│  └─ ui/
│     ├─ ChatScreen.kt                # 主聊天界面、会话抽屉、发送和流式状态
│     ├─ Header.kt                    # 顶栏：菜单、标题、后端状态
│     ├─ InputBar.kt                  # 输入框和发送按钮
│     ├─ MessageBubble.kt             # 用户/助手消息气泡
│     ├─ ProductCardView.kt           # 商品卡片和对比卡组件
│     ├─ ProductDetailScreen.kt       # 商品详情页
│     └─ RemoteImage.kt               # 远程图片加载和缓存展示
├─ app/build.gradle.kts               # App 模块构建配置
├─ build.gradle.kts                   # 根构建配置
├─ gradle.properties
└─ settings.gradle.kts
```

## 打开方式

1. 打开 Android Studio。
2. 选择 Open，打开目录：

```text
D:\code\agent\ShopGuide-Agent\client
```

3. 等待 Gradle Sync 完成。
4. 启动后端服务。
5. 选择模拟器或真机，点击 Run。

## SDK 与本地文件

Android SDK 路径通常配置在 `local.properties`：

```properties
sdk.dir=D\:\\Application\\AndroidSDK
```

`local.properties` 是本地配置文件，已加入 `.gitignore`，不要提交到 GitHub。

## 网络配置

后端地址在：

```text
app/src/main/java/com/shopguide/agent/network/ApiConfig.kt
```

常见配置：

```kotlin
// Android 模拟器访问电脑本机服务
const val BASE_URL = "http://10.0.2.2:3001"

// 真机访问电脑服务，需要替换成电脑局域网 IP
const val BASE_URL = "http://192.168.x.x:3001"
```

当前代码里 `BASE_URL` 可能是开发机器的局域网 IP。换电脑、换网络或改用模拟器时，需要先检查这里。

`CHAT_PRODUCT_LIMIT` 控制客户端每轮希望展示的商品卡片数量：

```kotlin
const val CHAT_PRODUCT_LIMIT = 6
```

后端仍会做上限保护，避免一次返回太多商品导致回答失焦。

确保 `AndroidManifest.xml` 已配置：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<application android:usesCleartextTraffic="true" ...>
```

## SSE 事件解析

`ChatApi.streamChat()` 使用 Android 标准库 `HttpURLConnection` + `BufferedReader` 逐行读取 SSE 流。MVP 阶段没有引入 Retrofit/OkHttp，依赖更少，便于说明网络链路。

| SSE 事件 | 触发时机 | 客户端处理 |
| --- | --- | --- |
| `token` | 流式文本片段 | 追加到当前助手消息的 `text` |
| `meta` | 缓存和首 token 调试信息 | 当前 UI 忽略，但保留解析分支 |
| `comparison` | 商品对比结构生成完成 | 设置到当前助手消息的 `comparison` |
| `products` | 商品卡片生成完成 | 设置到当前助手消息的 `products` |
| `done` | 本轮完成 | 结束发送中状态 |
| `error` | 后端返回结构化错误 | 展示友好错误文案和错误码 |

商品卡片和对比卡必须来自结构化事件，不能从模型自然语言文本中解析商品信息。这样可以保证文字回答、卡片、详情页使用同一批可信商品数据。

## 会话与历史

`ConversationStore` 使用 `SharedPreferences` 保存多会话数据，当前保存内容包括：

- 当前 `conversationId`。
- 会话列表。
- 每个会话的标题、更新时间和消息列表。
- 每条助手消息中的商品卡片和对比卡。

`DeviceStore` 会在 App 首次启动时生成匿名 `deviceId`，并保存在本地 `SharedPreferences`。它不是系统设备号，只用于让后端按 `deviceId + conversationId` 隔离和持久化会话。

发送消息时，客户端会把 `deviceId`、`conversationId` 和最近若干条历史放进 `/api/chat` 请求。历史不是为了让客户端参与推荐，而是帮助后端在数据库不可用或旧数据缺失时兜底恢复 turns、上一轮商品和多轮上下文。

当前本地存储适合 Demo 和少量历史。后续如果要做搜索、分页、云同步或更大规模历史，建议迁移到 Room 数据库。

## 商品详情页

卡片点击后，客户端调用：

```text
GET /api/products/:productId
```

详情页展示：

- 商品主图。
- 标题、品牌、价格、类目。
- 营销介绍。
- SKU 规格和价格。
- 官方问答。
- 用户评价。
- 演示用“加入购物车”按钮。

当前购物车后端尚未实现，详情页底部按钮主要用于展示完整电商落地页动线。

## 后端接口

默认后端地址来自 `ApiConfig.BASE_URL`。

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/api/health` | GET | 检查后端是否可用 |
| `/api/chat` | POST | SSE 流式导购对话 |
| `/api/products/:productId` | GET | 商品详情 |
| `/api/products/:productId/image` | GET | 商品图片 |
| `/api/conversations/reset` | POST | 重置后端会话记忆 |

详细接口说明见 [../docs/api.md](../docs/api.md)。

## 依赖

主要依赖：

```kotlin
androidx.compose:compose-bom:2024.09.03
androidx.activity:activity-compose:1.9.3
androidx.compose.material3:material3
```

当前没有引入 Retrofit、OkHttp 或图片加载库，网络和图片都使用 Android/Java 标准库实现。这样做的好处是 MVP 依赖少、链路清晰；代价是后续要做缓存策略、重试、日志和图片解码优化时，需要补充专门库或抽象。

## 构建参数

| 配置 | 值 |
| --- | --- |
| compileSdk | 36 |
| minSdk | 26 |
| targetSdk | 36 |
| Kotlin | 2.0.21 |
| AGP | 8.13.0 |
| Gradle | 9.0.0 |
| JVM target | 17 |

## 常见排障

- 顶栏显示后端未连接：先确认 `server` 已启动，再检查 `ApiConfig.BASE_URL` 是否适合当前模拟器或真机。
- 模拟器连不上 `localhost`：模拟器访问宿主机要用 `10.0.2.2`。
- 真机连不上电脑：手机和电脑需在同一局域网，后端防火墙需允许 3001 端口。
- 有文字但没有商品卡片：检查后端是否发出 `products` 事件，或用 `/api/debug/retrieve` 看检索是否为空。
- 详情页图片不显示：检查 `/api/products/:productId/image` 是否能访问，以及客户端是否把相对路径补齐为 `BASE_URL + path`。
