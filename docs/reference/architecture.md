# 系统架构

本文档说明 ShopGuide Agent 的核心模块、数据流和关键工程取舍。

## 1. 总体架构

```text
Android 原生客户端
  ├─ 聊天输入
  ├─ SSE 流式渲染
  ├─ 商品卡片 / 商品详情页
  ├─ 多会话本地历史
  └─ 匿名 deviceId

Node.js 后端
  ├─ HTTP / SSE API
  ├─ LLM Plan + Validator
  ├─ 结构化多轮记忆
  ├─ 商品检索 / 过滤 / 排序
  ├─ LLM 或本地兜底回答
  ├─ 商品卡片 / 对比卡结构化返回
  └─ SQLite 会话持久化

商品数据与向量检索
  ├─ ecommerce_agent_dataset JSON + 图片
  ├─ local 向量检索
  └─ Qdrant + Ark/local embedding
```

## 2. 后端模块

后端位于 `server/src`。

| 模块 | 职责 |
| --- | --- |
| `index.js` | 服务启动入口，加载配置、商品数据和检索器 |
| `config.js` | 读取 `.env`，集中管理端口、数据集、向量库、Embedding、LLM、缓存和会话持久化配置 |
| `http.js` | Express 路由、SSE 输出、`memory -> retriever -> answer` 主编排 |
| `data/loader.js` | 读取商品 JSON，标准化商品字段、图片路径和可检索文本 |
| `services/intent.js` | LLM Plan 解析与后端 Validator 校验 |
| `services/memory.js` | 多轮会话记忆、需求状态、序号指代、跨需求恢复 |
| `services/sessionStore.js` | `deviceId + conversationId` 会话持久化，默认 SQLite |
| `services/retriever.js` | 商品过滤、排序和检索调试信息 |
| `services/answer.js` | 本地兜底回答、Prompt、商品卡片、详情页和结构化对比卡 |
| `services/llm.js` | OpenAI-compatible 聊天模型调用，支持 DeepSeek / Ark |
| `services/hotCache.js` | 热门新搜索缓存和统计 |
| `vectordb/embedding.js` | local / Ark embedding 统一入口 |
| `vectordb/local.js` | 本地向量检索 |
| `vectordb/qdrant.js` | Qdrant collection、入库和检索 |
| `vectordb/factory.js` | 按配置选择 local 或 Qdrant 检索器 |

## 3. 客户端模块

客户端位于 `client/app/src/main/java/com/shopguide/agent`。

| 模块 | 职责 |
| --- | --- |
| `ui/ChatScreen.kt` | 主聊天界面、多会话抽屉、发送和流式状态 |
| `ui/MessageBubble.kt` | 用户/助手消息气泡 |
| `ui/ProductCardView.kt` | 商品卡片 |
| `ui/ComparisonCard.kt` | 结构化对比卡 |
| `ui/ProductDetailScreen.kt` | 商品详情页 |
| `network/ChatApi.kt` | 请求 `/api/chat` 并解析 SSE 事件 |
| `network/ConversationApi.kt` | 重置后端会话 |
| `network/ProductDetailApi.kt` | 商品详情接口 |
| `storage/ConversationStore.kt` | 多会话本地历史 |
| `storage/DeviceStore.kt` | 匿名 `deviceId` |

## 4. 主链路数据流

```text
1. 用户在 Android 输入购物需求
2. 客户端发送 deviceId / conversationId / message / history
3. 后端按 deviceId + conversationId 获取会话
4. 如果内存没有命中，优先从 SQLite 恢复，history 作为兜底
5. LLM Plan 或规则解析本轮意图
6. Validator 校验意图边界，避免 LLM 越权
7. memory 更新结构化需求状态
8. retriever 按类目、预算、排除词、候选范围等过滤商品
9. local 或 Qdrant 做语义排序
10. answer/LLM 基于候选商品生成回答
11. 后端通过 SSE 返回 token / comparison / products / done
12. 客户端渲染流式文字、对比卡和商品卡片
13. 后端将成功回答后的 session 写回 SQLite
```

## 5. 受控 RAG Agent 设计

项目没有把所有事情交给 LLM，而是采用受控链路：

```text
LLM 负责：
- 理解自然语言
- 输出结构化 Plan
- 生成自然语言导购话术

后端负责：
- 校验 Plan 是否越界
- 控制检索范围
- 执行预算、类目、排除词等硬过滤
- 保证商品卡片和回答使用同一批候选
- 保存结构化记忆
```

这样做的原因是电商导购有强业务约束：商品、价格、库存、优惠、功效不能让模型自由发挥，必须以商品库结构化数据为准。

## 6. 多轮记忆设计

后端会话状态包含：

- `state`：当前可复用约束，例如类目、商品类型、预算、排除词、偏好词。
- `turns`：最近对话轮次。
- `lastProducts`：上一轮实际展示的商品。
- `referenceProducts`：当前需求的候选基准，用于“第二款/第三款”指代。
- `comparisonProducts`：最近一次对比范围，用于“哪款更健康/不那么甜”等连续追问。
- `needs[]`：同一会话中的多个购物需求，例如先聊笔记本，再聊防晒，再回到笔记本。
- `summary`：从结构化 `needs` 派生出的长期摘要。

会话按 `deviceId + conversationId` 隔离。`deviceId` 是客户端本地生成的匿名 UUID，不是真实设备号。

## 7. 向量检索设计

项目支持两种检索模式：

```text
VECTOR_STORE=local
```

适合本地 Demo，向量在 Node 进程内存中，零外部依赖。

```text
VECTOR_STORE=qdrant
```

适合展示真实 RAG 架构，商品向量持久化在 Qdrant 中。Qdrant 支持高效向量检索、payload 存储和过滤。

Embedding 也分两种：

```text
EMBEDDING_PROVIDER=local  -> 384 维本地哈希向量
EMBEDDING_PROVIDER=ark    -> 1024 维 Ark embedding
```

Qdrant collection 建议按 embedding 方案命名：

```text
shopguide_products_local
shopguide_products_ark
```

因为 collection 的向量维度必须和 embedding 方案一致。

## 8. 防幻觉边界

项目通过多层约束避免幻觉：

- 检索结果不足时，不硬凑商品。
- 商品价格、图片、类目、详情来自结构化商品数据。
- Prompt 明确禁止编造不存在的商品、价格、库存、优惠和功效。
- 本地兜底回答只使用候选商品字段。
- `products` 事件和 `comparison` 事件由后端结构化生成，不从 LLM 文本反解析。
- 后端 Validator 会阻止 LLM 凭空添加预算、排除词或扩大对比范围。

## 9. 性能与稳定性

- 热门查询缓存只缓存 `new_search`，不缓存“第二款怎么样”“比较2和3”等依赖上下文的追问。
- `/api/chat` 会发送 `meta` 事件记录缓存和首 token 信息。
- `/api/performance` 可查看缓存统计。
- 会话持久化默认使用 SQLite，后端重启后可恢复多轮上下文。
- 自动化测试覆盖回答、意图、记忆、检索、性能、持久化和 smoke。

## 10. 为什么不引入 LangChain / LlamaIndex

当前项目选择轻量自研编排，而不是引入重框架，原因是：

- 电商导购业务约束强，预算、序号、卡片一致性和对比范围必须后端强控制。
- 当前商品规模和数据源固定，框架带来的抽象收益有限。
- 自研链路更容易解释评分重点：意图、检索、生成、结构化返回和防幻觉边界。
- 已有自动化测试围绕当前模块边界建立，稳定性更可控。
