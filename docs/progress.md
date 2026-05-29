# 项目完成情况

## 后端（Node.js）

### 已完成
- **商品数据**：100 条商品，覆盖美妆护肤、数码电子、服饰运动、食品生活 4 个类目
- **向量检索**：本地 TF-IDF 索引 + Qdrant 外部向量库双实现，工厂模式切换
- **Embedding**：本地哈希（384维）+ Ark 豆包 API（1024维）
- **LLM 集成**：DeepSeek / 豆包双通道，OpenAI 兼容流式 + SSE 解析
- **SSE 接口**：`POST /api/chat` 推送 `token` / `products` / `done` / `error` 事件
- **多轮记忆**：会话状态跟踪（类目、价格区间、排除项、偏好）
- **结构化回答**：推荐理由 + 商品卡片数据生成

### 待完成
- 商品图片服务端点
- 会话持久化（目前仅内存存储）
- 图片搜索（以图搜图）

## 客户端（Android 原生）

### 已完成
- **技术栈**：Kotlin + Jetpack Compose + Material3
- **对话界面**：ChatScreen（消息列表）、MessageBubble（气泡）、InputBar（输入+发送）
- **SSE 客户端**：基于 HttpURLConnection 解析流式事件
- **商品卡片**：ProductCardView 展示标题/品牌/价格/推荐理由
- **连接状态**：Header 显示服务端连接状态

### 待完成
- 商品卡片图片加载（模型缺 imagePath 字段）
- 网络层升级为 Retrofit/OkHttp
- 加载状态指示器
- 连接失败的错误恢复 UI

## 端到端状态

**已跑通**：用户输入 → RAG 检索 → LLM 流式生成 → SSE 推送 → Android 渲染文本+卡片

**待补充**：商品图片展示链路、会话重置 UI、弱网/断连处理
