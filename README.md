# ShopGuide Agent

基于 RAG 的多模态电商智能导购 AI Agent 课题项目。

## 当前进度

目前完成的是**后端 MVP 起步版本**，还没有开始做 Android/iOS 原生客户端。

已完成任务：

- 搭建 Node.js 后端服务骨架。
- 读取 `ecommerce_agent_dataset` 中的 100 条商品 JSON 数据。
- 标准化商品字段，包括商品 ID、标题、品牌、类目、价格、SKU、图片路径、详情描述、FAQ、评价等。
- 实现本地文本向量检索 MVP，支持类目识别、商品类型识别、预算过滤、简单否定条件过滤和余弦相似度排序。
- 增加可切换向量检索架构，当前默认 `VECTOR_STORE=local`，预留 `qdrant` 接入点。
- 实现 Qdrant 商品向量入库和检索脚本，可切换到 `VECTOR_STORE=qdrant`。
- 支持 `EMBEDDING_PROVIDER=ark` 调用 Doubao/Ark embedding API。
- 实现 `POST /api/chat` SSE 流式接口，可以逐段返回导购回复。
- 实现基于 `conversationId` 的内存多轮会话记忆，支持追问时继承最近上下文。
- 实现结构化导购状态，保存类目、商品类型、预算、排除词、偏好和上一轮商品。
- 实现结构化商品卡片返回，方便后续客户端展示商品图、标题、价格和推荐理由。
- 实现无聊天模型 Key 时的本地兜底回答，方便先跑通端到端链路。
- 聊天生成支持 Ark 或 DeepSeek 这类 OpenAI-compatible 接口。
- 编写基础架构文档和后端运行说明。

## 项目结构

```text
ShopGuide-Agent/
├─ client/                       # Android 原生客户端，下一阶段创建
├─ docs/                         # 技术文档
├─ ecommerce_agent_dataset/       # 商品 JSON + 图片数据
├─ server/                       # Node.js 后端
└─ README.md
```

## 启动后端

```bash
cd server
node src/index.js
```

如果本机全局 Node 不可用，可以先用 Codex 自带的 Node 验证：

```bash
"C:\Users\pc\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" src/index.js
```

服务默认启动在：

```text
http://localhost:3001
```

启动成功后会看到类似输出：

```text
ShopGuide Agent server listening on http://localhost:3001
Loaded 100 products from ...
Model streaming: disabled, using local fallback
```

其中 `Model streaming: disabled` 表示还没有配置聊天模型 Key，当前使用本地规则兜底回答，这是正常的。

## 向量检索配置

默认使用零依赖本地检索：

```text
VECTOR_STORE=local
```

已经支持 Qdrant 配置：

```text
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=384
```

如果要使用 Doubao/Ark embedding：

```text
QDRANT_COLLECTION=shopguide_products_ark
EMBEDDING_PROVIDER=ark
EMBEDDING_DIMENSION=1024
ARK_EMBEDDING_MODEL=你的 doubao-embedding-vision endpoint id
ARK_EMBEDDING_PATH=/embeddings/multimodal
ARK_API_KEY=你的火山方舟 API Key
```

如果聊天生成使用 DeepSeek：

```text
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

如果后续要切回 Doubao/Ark 聊天生成，只需要改回：

```text
LLM_PROVIDER=ark
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=你的 Ark 聊天模型 endpoint id
ARK_API_KEY=你的火山方舟 API Key
```

注意：`EMBEDDING_PROVIDER` 和 `LLM_PROVIDER` 是两套开关。比如你可以继续用 Doubao/Ark 做 embedding，同时用 DeepSeek 做聊天生成；这时 `ARK_API_KEY` 用于 embedding，`DEEPSEEK_API_KEY` 用于聊天生成。

先启动 Qdrant，然后写入商品向量：

```bash
cd server
node src/qdrant.ingest.js
node src/qdrant.search.test.js
```

Qdrant 本地 Docker 配置说明见 [docs/qdrant.md](docs/qdrant.md)。

## 测试

```bash
cd server
node src/retrieval.test.js
node src/smoke.test.js
```

也可以访问健康检查接口：

```text
http://localhost:3001/api/health
```

## API

- `GET /api/health`: 服务健康检查
- `GET /api/products`: 商品列表
- `POST /api/chat`: SSE 流式导购对话
- `POST /api/conversations/reset`: 清空指定会话记忆
- `POST /api/debug/retrieve`: 查看检索调试信息

详细接口文档见 [docs/api.md](docs/api.md)。

`POST /api/chat` 请求体示例：

```json
{
  "conversationId": "demo-user-1",
  "message": "推荐一款适合油皮的洗面奶"
}
```

同一个 `conversationId` 的最近对话会保存在内存中，服务重启后会清空。

## 客户端开发准备

客户端第一阶段只需要接入三个能力：

1. 调用 `POST /api/chat`，按 SSE 事件渲染流式文字和商品卡片。
2. 新建对话时生成新的 `conversationId`，或调用 `POST /api/conversations/reset` 清空旧会话。
3. 调试推荐结果时调用 `POST /api/debug/retrieve`，查看候选数量、向量匹配分数和最终商品。

SSE 事件顺序通常是：

```text
token... -> products -> done
```

商品展示以 `products` 事件里的结构化卡片为准，不要从模型自然语言里解析价格、图片或商品 ID。

## 后续里程碑

1. 创建 Android Kotlin 客户端。
2. 在客户端展示流式文字和商品卡片。
3. 强化商品对比、收藏或购物车能力。
4. 增加图片找货、语音输入等多模态加分项。
