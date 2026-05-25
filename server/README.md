# ShopGuide Agent Server

这是多模态电商智能导购项目的 Node.js 后端 MVP。

## 当前能力

- 加载 `../ecommerce_agent_dataset` 下的商品 JSON。
- 使用本地文本向量检索器搜索商品。
- 通过 `VECTOR_STORE` 支持本地检索和 Qdrant 检索切换。
- 支持把商品数据生成向量并写入 Qdrant collection。
- 支持通过 `EMBEDDING_PROVIDER=ark` 调用 Doubao/Ark embedding API。
- 通过 SSE 流式返回导购回复。
- 返回结构化商品卡片。
- 支持基于 `conversationId` 的内存多轮会话。
- 支持结构化导购状态，用于处理“再便宜点”“不要含酒精”等追问。
- 没有聊天模型 Key 时也可以离线运行。
- 聊天生成支持 `LLM_PROVIDER=ark` 或 `LLM_PROVIDER=deepseek`。

## 启动

```bash
cd server
node src/index.js
```

默认向量检索配置：

```text
VECTOR_STORE=local
```

Qdrant 配置：

```text
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=384
```

Doubao/Ark embedding 配置示例：

```text
QDRANT_COLLECTION=shopguide_products_ark
EMBEDDING_PROVIDER=ark
EMBEDDING_DIMENSION=1024
ARK_EMBEDDING_MODEL=你的 doubao-embedding-vision endpoint id
ARK_EMBEDDING_PATH=/embeddings/multimodal
ARK_API_KEY=你的火山方舟 API Key
```

DeepSeek 聊天模型配置示例：

```text
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

切回 Doubao/Ark 聊天模型时，改回：

```text
LLM_PROVIDER=ark
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=你的 Ark 聊天模型 endpoint id
ARK_API_KEY=你的火山方舟 API Key
```

`EMBEDDING_PROVIDER` 和 `LLM_PROVIDER` 是两套开关。embedding 继续使用 Doubao/Ark 时，`ARK_API_KEY` 要保留；聊天生成使用 DeepSeek 时，`DEEPSEEK_API_KEY` 只负责聊天生成。

本地 Qdrant 启动与检查说明见 `../docs/qdrant.md`。

写入商品向量并验证检索：

```bash
node src/qdrant.ingest.js
node src/qdrant.search.test.js
```

测试导购接口：

```bash
curl -N -X POST http://localhost:3001/api/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"推荐一款适合油皮的洗面奶\"}"
```

## API

### `GET /api/health`

返回服务状态和已加载商品数量。

### `GET /api/products`

返回简化商品列表。

### `POST /api/chat`

请求示例：

```json
{
  "message": "200元以下的蓝牙耳机有哪些？",
  "conversationId": "demo"
}
```

同一个 `conversationId` 的最近对话会参与下一轮检索和模型 Prompt。当前会话记忆存放在进程内存里，服务重启后会清空。

响应类型为 `text/event-stream`：

- `event: token`: 流式文本片段
- `event: products`: 商品卡片列表
- `event: done`: 完成标记

### `POST /api/conversations/reset`

清空指定 `conversationId` 的内存会话状态。客户端新建对话时可以调用。

```json
{
  "conversationId": "demo"
}
```

### `POST /api/debug/retrieve`

返回检索调试信息，包括解析出的类目、商品类型、过滤候选数量、向量匹配和最终商品卡片。这个接口用于开发调试，不建议直接面向最终用户。

```json
{
  "message": "推荐一款适合油皮的防晒霜",
  "conversationId": "debug-demo",
  "includeMemory": false
}
```

完整接口文档见 `../docs/api.md`。

## 客户端对接重点

第一阶段客户端优先实现：

1. `POST /api/chat`: 接收 SSE，渲染 `token` 文本流和 `products` 商品卡片。
2. `POST /api/conversations/reset`: 新建对话或清空上下文。
3. `GET /api/health`: 启动页或调试页检查后端是否可用。

`products` 事件是商品卡片的唯一可靠来源，客户端不要从模型文本里反向解析商品价格、图片路径或商品 ID。

## 测试

```bash
node src/retrieval.test.js
node src/embedding.test.js
node src/smoke.test.js
node src/qdrant.search.test.js
```

## 下一步

1. 增强反选条件和多商品对比。
2. 增加购物车相关 API。
3. 连接 Android 客户端，通过 SSE 展示流式回复。
