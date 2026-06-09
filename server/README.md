# ShopGuide Agent Server

这是 ShopGuide Agent 的 Node.js 后端。它负责把用户的自然语言购物需求转成可执行的导购链路：加载商品数据、解析意图、做 RAG 检索、维护多轮记忆、调用模型或本地兜底回答，并通过 SSE 把文字、商品卡片和对比卡流式返回给 Android 客户端。

后端最重要的原则是：商品事实以数据集 JSON 为准，模型只负责表达和解释，不能编造不存在的商品、价格、库存、优惠、销量或功效。

## 快速启动

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 准备本地配置

```bash
copy .env.example .env
```

默认配置使用本地向量检索和本地兜底回答，不填模型 API Key 也能跑通“客户端 -> 后端 -> 检索 -> SSE -> 商品卡片”的最小闭环。

### 3. 启动服务

```bash
npm run dev
```

启动成功后默认监听：

```text
http://localhost:3001
```

可以用健康检查确认服务状态：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3001/api/health
```

## 配置说明

配置入口是 `server/.env`。`.env.example` 只放占位示例，真实 API Key 只写在本地 `.env`，不要提交。

### 1. 商品数据

```env
PORT=3001
DATASET_DIR=../ecommerce_agent_dataset
```

`DATASET_DIR` 指向商品 JSON 和图片目录。后端启动时会加载商品，后续回答、卡片、详情页和图片接口都从这里取可信数据。

### 2. 检索模式

本地检索适合开发和演示，不依赖外部服务：

```env
VECTOR_STORE=local
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=384
```

Qdrant 适合演示“向量数据库版 RAG”：

```env
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=384
```

使用 Qdrant 时，需要先在仓库根目录启动服务，再在 `server/` 目录写入和验证向量：

```powershell
docker compose up -d qdrant
```

```bash
cd server
npm run qdrant:health
npm run qdrant:ingest
npm run qdrant:test
```

如果要用 Doubao/Ark embedding 写入 Qdrant：

```env
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products_ark
EMBEDDING_PROVIDER=ark
EMBEDDING_DIMENSION=1024
ARK_EMBEDDING_MODEL=doubao-embedding-vision-250615
ARK_EMBEDDING_PATH=/embeddings/multimodal
ARK_EMBEDDING_API_KEY=你的 Ark embedding API Key
```

更完整的 Qdrant 排障和设计说明见 [../docs/qdrant.md](../docs/qdrant.md)。

### 3. 聊天模型

DeepSeek：

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

Doubao/Ark：

```env
LLM_PROVIDER=ark
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=你的 Ark 聊天模型 endpoint id
ARK_API_KEY=你的 Ark 聊天模型 API Key
```

`EMBEDDING_PROVIDER` 和 `LLM_PROVIDER` 是两套独立开关。可以用 Ark 做 embedding，同时用 DeepSeek 做聊天生成。没有可用模型 Key 时，后端会走本地确定性回答；如果模型生成过程中失败，后端也会自动降级为本地规则回答，并通过 `meta type=fallback` 通知客户端展示轻提示，保证 Demo 不因为模型服务短暂异常中断。

### 4. 热门查询缓存

```env
HOT_QUERY_CACHE_ENABLED=true
HOT_QUERY_CACHE_MAX_ENTRIES=80
HOT_QUERY_CACHE_TTL_MS=600000
```

缓存只用于不依赖上下文的新搜索请求，例如“推荐一款适合油皮的防晒霜”。“第二款怎么样”“2 和 3 对比”这类多轮指代不会走缓存，避免把旧会话上下文答乱。

### 5. 会话持久化

```env
SESSION_PERSISTENCE_ENABLED=true
SESSION_STORE_PATH=.data/shopguide_sessions.db
```

默认使用本地 SQLite 保存 `deviceId + conversationId` 对应的结构化会话快照。后端重启后优先从 SQLite 恢复；如果运行时不支持 Node 自带 SQLite，会降级为同目录 JSON 文件。

## 核心链路

`POST /api/chat` 是后端主链路，核心编排在 `src/http.js`：

```text
读取 deviceId / message / conversationId / history
  -> getSession 从内存或 SQLite 恢复 deviceId + conversationId 会话
  -> restoreSessionFromHistory 用客户端 history 做兜底恢复
  -> classifyTurnIntent / parseTurnIntent 解析本轮意图
  -> updateSessionState 更新结构化需求
  -> buildRetrievalQuery 构造检索 query
  -> retrieveProductsWithState 执行过滤和排序
  -> buildLocalAnswer 或 streamModelAnswer 生成回答，模型失败时降级为本地回答
  -> buildComparisonPayload 按需生成对比卡
  -> buildProductCards 生成商品卡片
  -> 通过 SSE 输出 token / meta / comparison / products / done
```

这里有两个边界需要特别注意：

- 检索和过滤由后端执行，模型不能决定哪些商品真实存在。
- 客户端展示的商品卡片来自 `products` 事件，不从模型文本中反向解析商品名、价格或图片。

## 意图与记忆

后端会把用户本轮问题归为几类：

| 类型 | 含义 | 示例 |
| --- | --- | --- |
| `new_search` | 开始一个新需求 | `推荐一款适合油皮的防晒霜` |
| `refine` | 在当前需求上追加条件 | `1万预算`、`再便宜点`、`不要含酒精` |
| `refer` | 指向上一轮某个商品 | `第二款怎么样`、`安热沙这款如何` |
| `compare` | 比较候选商品 | `2和3哪个好`、`前两款对比一下` |
| `missing_context` | 没有候选时的指代/对比追问 | 新会话直接问 `第二款怎么样` |
| `out_of_scope` | 明显非购物导购问题 | `天气怎么样`、`帮我写论文` |
| `multi_need` | 同一句话里包含多个商品品类 | `想买笔记本和防晒霜` |

多轮记忆由 `memory.js` 维护，主要保存最近对话、当前需求、历史需求摘要、上一轮候选商品和对比中的商品组。这样可以支持“先问笔记本 -> 加预算 -> 切到防晒 -> 再回问刚才笔记本第三款”这类真实导购路径。

有模型 Key 时，`intent.js` 会先让 LLM 输出结构化 Plan，例如：

```json
{
  "turn_type": "compare",
  "is_shopping_guidance": true,
  "boundary_reason": "",
  "needs_clarification": false,
  "clarification_reason": "",
  "scope": "last_compared_products",
  "target_refs": [2, 5],
  "focus": ["控油", "清爽"],
  "max_price": null,
  "negative_terms": [],
  "preferences": ["控油"]
}
```

后端不会直接执行原始 Plan，而是先做 Validator 校验：

- `turn_type` 只能是 `new_search / refine / refer / compare / missing_context / out_of_scope / multi_need`。
- `scope` 只能落在允许范围内，`compare/refer` 不能被扩大到全库。
- `target_refs` 必须指向当前候选中真实存在的序号。
- 预算、排除词只有在用户本轮明确提到价格或否定表达时才会变成硬约束。
- `refer/compare` 场景下，LLM 不能凭空改写类目或商品类型，避免污染多轮上下文。
- `out_of_scope / multi_need / missing_context` 也允许由 LLM 规划；如果 LLM 漏判，规则 fallback 会作为安全护栏把它拉回边界，避免进入检索并展示无关卡片。

因此当前机制是：LLM 负责语义解析和任务规划，后端负责约束、校验和执行；没有模型 Key 或模型解析失败时，规则解析会接管，保证 Demo 主链路仍可运行。

## 目录结构

```text
server/
├─ src/
│  ├─ index.js                       # 服务入口，加载配置、商品和向量索引
│  ├─ config.js                      # .env 和环境变量读取
│  ├─ http.js                        # Express 路由、SSE 输出、错误处理和主编排
│  ├─ data/
│  │  └─ loader.js                   # 商品 JSON 加载和标准化
│  ├─ services/
│  │  ├─ answer.js                   # 商品卡片、详情、本地回答、Prompt、对比结构
│  │  ├─ hotCache.js                 # 热门查询缓存和性能统计
│  │  ├─ intent.js                   # LLM 意图解析，失败后回退规则解析
│  │  ├─ llm.js                      # OpenAI-compatible 流式/非流式模型调用
│  │  ├─ memory.js                   # conversationId 会话记忆、需求状态、指代解析
│  │  ├─ sessionStore.js             # deviceId + conversationId 会话持久化
│  │  └─ retriever.js                # RAG 检索编排、过滤、排序、调试信息
│  ├─ utils/
│  │  ├─ errors.js                   # 统一错误格式
│  │  └─ nlp.js                      # 规则意图识别、同义词、预算、排除词、偏好词
│  ├─ vectordb/
│  │  ├─ embedding.js                # local / Ark embedding
│  │  ├─ factory.js                  # 检索器工厂
│  │  ├─ local.js                    # 本地向量检索
│  │  └─ qdrant.js                   # Qdrant collection 和搜索
│  ├─ scripts/
│  │  ├─ demo-retrieve.js            # Demo 问题批量检索自检
│  │  ├─ qdrant-health.js            # Qdrant 健康检查
│  │  ├─ qdrant-ingest.js            # 商品向量写入 Qdrant
│  │  └─ qdrant-search-test.js       # Qdrant 检索验证
│  └─ __tests__/
│     ├─ answer.test.js              # 回答和 Prompt 防幻觉测试
│     ├─ embedding.test.js           # embedding 测试
│     ├─ intent.test.js              # 意图解析测试
│     ├─ memory-eval.test.js         # 多轮记忆、指代、对比专项评测
│     ├─ performance.test.js         # 热门查询缓存和首 token 指标测试
│     ├─ retrieval.test.js           # 基础检索冒烟测试
│     ├─ retrieval-quality.test.js   # RAG 检索质量基线测试
│     ├─ session-persistence.test.js # deviceId 会话隔离和持久化恢复测试
│     └─ smoke.test.js               # 后端端到端 smoke 测试
├─ .env.example                      # 配置示例，可复制为 .env
├─ package.json
└─ README.md
```

## API

### GET `/api/health`

健康检查，返回商品数量、向量库、Embedding、聊天模型和热门缓存状态。

演示或排障时优先看这个接口：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3001/api/health
```

重点字段：

- `ok`：后端 HTTP 服务是否正常响应。
- `productCount`：商品库是否成功加载。
- `vectorStore` / `embeddingProvider` / `embeddingDimension`：当前检索模式和 embedding 维度。
- `qdrantCollection`：使用 Qdrant 时确认 collection 是否和 embedding 方案匹配。
- `modelEnabled` / `llmProvider` / `llmModel`：聊天模型是否启用。
- `sessionPersistence`：会话记忆持久化使用 SQLite、JSON 还是 disabled。
- `hotQueryCache`：热门查询缓存是否启用以及当前统计。

`/api/health` 只说明后端启动和配置状态，不等价于完整 RAG 质量检查。推荐再配合 `/api/debug/retrieve` 或自动化测试验证检索和回答链路。

### GET `/api/performance`

返回热门查询缓存统计，例如 `size / hits / misses / writes / ttlMs`。该接口面向开发和评测，不建议直接展示给普通用户。

### GET `/api/products`

返回简化商品卡片列表。

### GET `/api/products/:productId`

返回商品详情，供客户端详情页展示。

### GET `/api/products/:productId/image`

返回商品图片文件。

### POST `/api/chat`

导购聊天接口，响应类型是 `text/event-stream`。

请求示例：

```json
{
  "deviceId": "demo-device",
  "conversationId": "demo",
  "message": "推荐一款适合油皮的防晒霜",
  "limit": 6,
  "history": []
}
```

字段说明：

- `deviceId`：匿名设备 ID，用于后端隔离和持久化不同设备的会话；旧客户端不传时默认为 `anonymous`。
- `conversationId`：会话 ID，和 `deviceId` 组合后定位一段后端会话记忆。
- `message`：用户本轮输入，最长 500 字。超长文本会返回 `VALIDATION_ERROR`，避免长粘贴内容拖慢 Prompt、检索和流式返回。
- `limit`：本轮最多返回多少个商品候选，服务端仍有上限保护。
- `history`：客户端最近历史，用于数据库不可用或旧数据缺失时兜底恢复上下文。

SSE 事件：

```text
event: token       # 流式文本
event: meta        # 性能/缓存调试信息，客户端可忽略
event: comparison  # 结构化对比卡
event: products    # 商品卡片
event: done        # 本轮完成
event: error       # 结构化错误
```

当聊天模型不可用但检索链路正常时，后端不会直接返回 `MODEL_ERROR`，而是输出降级提示并继续完成本轮：

```text
event: meta
data: {"type":"fallback","fallback":true,"reason":"MODEL_ERROR","message":"当前 AI 生成服务暂时不可用，已使用本地导购规则完成推荐。"}

event: done
data: {"ok":true,"conversationId":"demo","deviceId":"demo-device","fallback":true,"fallbackReason":"MODEL_ERROR"}
```

只有检索失败、请求参数错误、内部异常等无法得到可信商品候选的情况，才会返回 `error` 事件。

如果用户在没有任何候选上下文时直接问“第二款怎么样”“2 和 3 哪个好”，后端会返回普通 `token` 文本解释缺少参照，不会触发商品检索，也不会返回商品卡片：

```text
我还没有可参考的候选商品，所以暂时无法判断“第二款怎么样”指的是哪一款。
```

这个边界由 `missing_context` 意图处理，避免把代词/序号追问误当成新的商品搜索。
如果新会话里提出明显非购物问题，例如“天气怎么样”“帮我写论文”，会被归为 `out_of_scope`，后端只返回边界说明，不检索商品，也不展示商品卡片。
如果同一句话里混入多个商品品类，例如“想买笔记本和防晒霜”，会被归为 `multi_need`。当前一轮对话只返回一组候选卡片，所以后端会先提示用户拆开需求，避免把不同品类混成一组推荐。

### POST `/api/debug/retrieve`

检索调试接口，用于查看 RAG 过程。

请求示例：

```json
{
  "conversationId": "debug-demo",
  "message": "推荐无糖饮料",
  "limit": 4,
  "includeMemory": false
}
```

返回内容包含：

- `turnIntent`：本轮意图类型和解析来源。
- `retrievalScope`：本轮检索范围，例如全库、上一轮商品或对比候选。
- `session`：当前会话记忆快照。
- `retrievalQuery`：用于语义排序的文本。
- `retrieval.parsed`：类目、商品类型、预算、排除词等结构化条件。
- `retrieval.filterTrace`：商品通过或被过滤的原因。
- `retrieval.finalSelection`：最终商品及排序依据。

### POST `/api/conversations/reset`

重置指定 `conversationId` 的后端会话记忆。

## 错误码

| 错误码 | 代表含义 |
| --- | --- |
| `VALIDATION_ERROR` | 请求参数不合法，例如 `message` 为空或超过 500 字 |
| `RETRIEVAL_ERROR` | 商品检索失败，例如 Qdrant、Embedding 或向量索引异常 |
| `MODEL_ERROR` | 模型生成失败，例如 API Key、模型名、权限或网络问题；当前聊天主链路会优先自动降级，通常以 `meta type=fallback` 形式通知客户端 |
| `NOT_FOUND` | 商品、图片或接口不存在 |
| `INVALID_JSON` | 请求体不是合法 JSON |
| `INTERNAL_ERROR` | 未预期服务端异常 |

这些错误码本身不会在服务端界面显示，服务端只负责把它们写进 HTTP JSON 或 SSE `error` 事件。实际可见位置在 Android 客户端：

- `/api/chat` 返回 SSE `error` 时，`ChatApi.kt` 会解析 `error.code`，`ChatScreen.kt` 会把错误文案和错误码写到当前助手消息气泡里。
- 客户端连不上后端时收不到服务端错误，所以 `ChatApi.kt` 会在本地归类为 `NETWORK_ERROR`。
- 普通 HTTP 接口非 2xx 时，客户端归类为 `HTTP_ERROR`。

客户端侧的展示逻辑是：

- `NETWORK_ERROR`、`HTTP_ERROR`、`RETRIEVAL_ERROR`、`VALIDATION_ERROR`、`INTERNAL_ERROR` 等会在助手消息气泡中显示友好错误文案和“错误码：xxx”，同时标记本轮发送失败，用户消息气泡前显示红色重试图标。
- `MODEL_ERROR` 如果已被后端降级处理，则不标记发送失败，只显示模型降级轻提示。

## 测试和自检

`package.json` 中已有脚本：

```bash
npm run test:answer
npm run test:retrieval
npm run test:retrieval-quality
npm run eval:retrieval
npm run test:embedding
npm run test:performance
npm run test:session
npm run test:fallback
npm run test:smoke
npm run demo:retrieve
```

专项测试文件可以直接运行：

```bash
node src/__tests__/intent.test.js
node src/__tests__/memory-eval.test.js
```

推荐日常开发至少跑：

```bash
npm run test:answer
npm run test:retrieval-quality
npm run eval:retrieval
npm run test:smoke
```

`test:retrieval-quality` 是回归测试，重点检查类目、预算、排除词、商品类型等硬边界是否跑偏；`eval:retrieval` 是量化评测，读取 `src/eval/retrieval-cases.json` 中人工标注的相关商品集合，输出 `Recall@K`、`Precision@K`、`HitRate@K` 和 `MRR@K`。前者更适合防回归，后者更适合答辩或报告里展示 RAG 检索效果。

如果改动了 `memory.js`、`intent.js`、`retriever.js` 或对比卡逻辑，再跑：

```bash
node src/__tests__/memory-eval.test.js
node src/__tests__/intent.test.js
```

## 客户端对接重点

客户端应以结构化 SSE 事件为准：

```text
token       -> 用于流式展示回答文本
comparison  -> 用于展示结构化对比组件
products    -> 用于展示可点击商品卡片
done        -> 标记本轮完成
error       -> 展示错误提示
```

不要从模型自然语言里解析商品 ID、价格、图片或标题。商品卡片、对比卡和详情页都应来自后端结构化数据。

## 注意事项

- `.env` 不提交。
- API Key 不写入 README、源码或示例提交。
- 真实商品信息以数据集 JSON 为准。
- 模型回答只作为导购话术，商品卡片和详情数据来自结构化商品数据。
- 多轮会话状态按 `deviceId + conversationId` 保存在后端内存和本地 SQLite 中，服务重启后优先从 SQLite 恢复；客户端 `history` 继续作为兜底材料。
