# ShopGuide Agent Server

这是 ShopGuide Agent 的 Node.js 后端，负责商品数据加载、RAG 检索、模型调用、SSE 流式接口、商品卡片和详情接口。

## 后端职责

- 加载 `../ecommerce_agent_dataset` 下的商品 JSON 和图片路径。
- 标准化商品字段，构造可检索文本。
- 根据用户问题解析类目、商品类型、预算、排除词和偏好词。
- 使用本地向量检索或 Qdrant 检索商品。
- 构造严格基于商品上下文的 RAG Prompt。
- 调用 DeepSeek 或 Doubao/Ark 聊天模型生成回答。
- 通过 SSE 返回 `token`、`products`、`done` 事件。
- 提供商品列表、商品详情、商品图片和检索调试接口。

## 目录说明

```text
server/
├─ src/
│  ├─ index.js                    # 服务入口
│  ├─ config.js                   # .env 和环境变量读取
│  ├─ http.js                     # Express 路由、SSE 输出、错误处理
│  ├─ data/
│  │  └─ loader.js                # 商品 JSON 加载和标准化
│  ├─ services/
│  │  ├─ answer.js                # 商品卡片、详情、本地回答、模型 Prompt
│  │  ├─ llm.js                   # OpenAI-compatible 流式模型调用
│  │  ├─ memory.js                # conversationId 会话记忆和导购状态
│  │  └─ retriever.js             # RAG 检索编排、过滤、排序、调试信息
│  ├─ utils/
│  │  ├─ errors.js                # 统一错误格式
│  │  └─ nlp.js                   # 意图识别、同义词、预算、排除词、偏好词
│  ├─ vectordb/
│  │  ├─ local.js                 # 本地向量检索
│  │  ├─ embedding.js             # local / Ark embedding
│  │  ├─ qdrant.js                # Qdrant collection 和搜索
│  │  └─ factory.js               # 检索器工厂
│  ├─ scripts/
│  │  ├─ demo-retrieve.js         # Demo 问题批量检索自检
│  │  ├─ qdrant-health.js         # Qdrant 健康检查
│  │  ├─ qdrant-ingest.js         # 商品向量写入 Qdrant
│  │  └─ qdrant-search-test.js    # Qdrant 检索验证
│  └─ __tests__/
│     ├─ answer.test.js           # 回答和 Prompt 防幻觉测试
│     ├─ embedding.test.js        # embedding 测试
│     ├─ retrieval.test.js        # 基础检索冒烟测试
│     ├─ retrieval-quality.test.js# RAG 检索质量基线测试
│     └─ smoke.test.js            # 后端端到端 smoke 测试
├─ .env                           # 本地配置，不提交
├─ .env.example                   # 配置示例
└─ package.json
```

## 启动

```bash
cd server
npm run dev
```

启动成功后应看到：

```text
ShopGuide Agent server listening on http://localhost:3001
Loaded 100 products ...
Vector store: local 或 qdrant
LLM provider: deepseek 或 ark
Model streaming: enabled
```

## 常用配置

### 本地检索

```env
VECTOR_STORE=local
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=384
```

### Qdrant + 本地 embedding

```env
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=384
```

### Qdrant + Doubao/Ark embedding

```env
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products_ark
EMBEDDING_PROVIDER=ark
EMBEDDING_DIMENSION=1024
ARK_EMBEDDING_MODEL=doubao-embedding-vision-250615
ARK_EMBEDDING_PATH=/embeddings/multimodal
ARK_API_KEY=你的火山方舟 API Key
```

### DeepSeek 聊天模型

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

### Doubao/Ark 聊天模型

```env
LLM_PROVIDER=ark
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=你的 Ark 聊天模型 endpoint id
ARK_API_KEY=你的火山方舟 API Key
```

`EMBEDDING_PROVIDER` 和 `LLM_PROVIDER` 是两套独立开关。可以用 Ark 做 embedding，同时用 DeepSeek 做聊天生成。

## 本轮 RAG 优化

### 1. 检索链路更可解释

`retriever.js` 现在会返回完整调试信息：

- `parsed.category`：识别出的商品类目。
- `parsed.itemIntent`：识别出的商品类型。
- `parsed.maxPrice / minPrice`：预算条件。
- `parsed.negativeTerms`：排除词。
- `parsed.preferences`：偏好词。
- `counts`：总商品数、类目候选、过滤后候选、向量匹配数、最终商品数。
- `filterTrace`：商品通过或被过滤的原因。
- `vectorMatches`：向量分数和偏好命中。
- `finalSelection`：最终商品、综合排序分数和选中理由。

调试命令：

```bash
npm run demo:retrieve
```

### 2. 意图识别增强

`nlp.js` 增强了类目词、商品类型和同义词，例如：

| 用户表达 | 解析结果 |
| --- | --- |
| 口红 | 唇妆 / 唇釉 |
| 轻薄笔记本 | 数码电子 / 笔记本 |
| 无糖饮料 | 食品饮料 / 饮料 |
| 通勤背包 | 服饰运动 / 背包 |
| 拍照手机 | 数码电子 / 手机，偏好拍照和影像 |
| 敏感肌面霜 | 美妆护肤 / 面霜，偏好敏感肌、舒缓、修护 |

### 3. 排序策略增强

检索不再只看向量相似度，而是综合：

```text
rankScore = 向量相似度 + 偏好命中加权 + 商品字段匹配
```

例如：

- `推荐无糖饮料` 会优先排 `无糖`、`0糖`、`低糖` 商品。
- `推荐通勤背包` 会优先排命中 `通勤`、`双肩包`、`日常` 的背包。
- `推荐一款手机，拍照好一点` 会优先排影像相关手机。

### 4. 无结果不硬推

如果硬约束筛不出商品，后端会返回空结果，回答层会明确说明当前商品库没有满足条件的商品。

典型例子：

```text
推荐防晒霜，但不要含酒精
```

如果商品库中的防晒都含有“酒精”相关描述，系统不会硬推荐不符合条件的商品。

### 5. Prompt 防幻觉

`answer.js` 中的 Prompt 已加入约束：

- 只能使用提供的商品上下文。
- 不得编造不存在的商品。
- 不得编造价格、库存、优惠券、销量、功效或活动。
- 候选商品不完全满足条件时必须如实说明。
- 不输出 JSON，不展示内部字段和检索分数。

## API

### GET `/api/health`

开发排障用健康检查，返回商品数量、向量库、Embedding 和聊天模型配置概览。普通客户端 UI 不直接展示 Qdrant、Embedding、LLM 等内部组件状态。

### GET `/api/products`

返回简化商品列表。

### GET `/api/products/:productId`

返回商品详情。

### GET `/api/products/:productId/image`

返回商品图片。

### POST `/api/chat`

导购聊天接口，响应类型是 `text/event-stream`。

请求示例：

```json
{
  "conversationId": "demo",
  "message": "推荐一款适合油皮的防晒霜",
  "limit": 6
}
```

`limit` 用于控制本轮最多返回多少个商品候选。Android 客户端已使用横向滑动商品卡片，当前默认传 `6`；后端会保证模型回答和 `products` 卡片使用同一组候选，最多不超过服务端上限。

SSE 事件：

```text
event: token     # 流式文本
event: products  # 商品卡片
event: done      # 本轮完成
event: error     # 错误
```

`error` 事件会返回结构化错误码：

| 错误码 | 代表含义 |
| --- | --- |
| `VALIDATION_ERROR` | 请求参数不合法，例如 `message` 为空 |
| `RETRIEVAL_ERROR` | 商品检索失败，例如 Qdrant/Embedding/向量索引异常 |
| `MODEL_ERROR` | 模型生成失败，例如 API Key、模型名、权限或网络问题 |
| `NOT_FOUND` | 商品、图片或接口不存在 |
| `INVALID_JSON` | 请求体不是合法 JSON |
| `INTERNAL_ERROR` | 未预期服务端异常 |

Android 客户端会额外把“连不上后端”的情况归类为 `NETWORK_ERROR`，因为这类错误发生时收不到后端响应。

### POST `/api/debug/retrieve`

检索调试接口，用于查看 RAG 检索过程。

请求示例：

```json
{
  "conversationId": "debug-demo",
  "message": "推荐无糖饮料",
  "limit": 4,
  "includeMemory": false
}
```

### POST `/api/conversations/reset`

重置指定 `conversationId` 的会话记忆。

## 测试和自检

```bash
npm run test:answer
npm run test:retrieval
npm run test:retrieval-quality
npm run test:embedding
npm run test:smoke
npm run demo:retrieve
```

推荐日常开发至少跑：

```bash
npm run test:answer
npm run test:retrieval-quality
npm run test:smoke
```

## Qdrant

启动 Qdrant：

```powershell
docker compose up -d qdrant
```

检查：

```bash
npm run qdrant:health
```

写入商品向量：

```bash
npm run qdrant:ingest
```

测试 Qdrant 检索：

```bash
npm run qdrant:test
```

更详细说明见 [../docs/qdrant.md](../docs/qdrant.md)。

## 客户端对接重点

客户端应以 `products` 事件中的结构化商品卡片为准，不要从模型自然语言里解析商品 ID、价格、图片或标题。

```text
token    -> 用于流式展示回答文本
products -> 用于展示可点击商品卡片
done     -> 标记本轮完成
error    -> 展示错误提示
```

## 注意事项

- `.env` 不提交。
- API Key 不写入 README、源码或示例提交。
- 真实商品信息以数据集 JSON 为准。
- 模型回答只作为导购话术，商品卡片和详情数据来自结构化商品数据。
