# ShopGuide Agent 设计文档

## 1. 项目概述

ShopGuide Agent 是一个基于 RAG 的多模态电商智能导购 AI Agent 原型。项目目标不是简单问答，而是打通：

```text
Android 原生客户端
-> Node.js 后端
-> 意图解析与多轮记忆
-> 商品检索、硬过滤、排序
-> LLM 或本地兜底回答
-> SSE 流式返回
-> 商品卡片、详情页、结构化对比卡展示
```

核心原则：回答、商品卡片、对比结果和详情页必须基于商品库真实数据，禁止编造不存在的商品、价格、库存、优惠、销量和功效。

## 2. 系统架构

```text
client/
  Android 原生客户端，负责聊天输入、SSE 流式渲染、商品卡片、商品详情页、多会话历史。

server/
  Node.js + Express 后端，负责 HTTP API、SSE、RAG 编排、意图解析、会话记忆、检索排序、模型调用和本地兜底回答。

ecommerce_agent_dataset/
  脱敏商品数据和图片资源，当前约 100 条商品，覆盖美妆护肤、数码电子、服饰运动、食品饮料。

qdrant_storage/
  本地 Qdrant 运行数据目录，不提交。

docs/
  架构、API、RAG 链路、验收清单、评审模式和最终提交材料。
```

## 3. 技术栈

| 层级 | 技术 |
| --- | --- |
| Android 客户端 | Kotlin、Jetpack Compose、Material3 |
| 后端服务 | Node.js、Express |
| 流式协议 | SSE |
| 向量检索 | 本地向量索引 / Qdrant |
| Embedding | 本地哈希向量 / Ark embedding |
| 聊天模型 | DeepSeek / Doubao Ark，兼容无 Key 本地兜底 |
| 会话持久化 | SQLite |
| 自动化测试 | Node.js 脚本测试 |

## 4. 后端关键模块

| 模块 | 职责 |
| --- | --- |
| `server/src/http.js` | Express 路由和 `/api/chat` 主编排 |
| `server/src/services/intent.js` | LLM Plan 解析与后端 Validator |
| `server/src/services/memory.js` | 多轮会话状态、需求隔离、序号指代、跨需求恢复 |
| `server/src/services/retriever.js` | 商品类目、预算、排除词硬过滤，以及向量排序 |
| `server/src/services/answer.js` | 本地兜底回答、Prompt、商品卡片、详情页、对比卡 |
| `server/src/services/reviewTrace.js` | 评审模式证据链，解释一次回答的意图、过滤、证据和安全边界 |
| `server/src/services/sessionStore.js` | SQLite 会话持久化 |
| `server/src/services/hotCache.js` | 热门查询缓存 |

## 5. 客户端关键模块

| 模块 | 职责 |
| --- | --- |
| `ChatScreen.kt` | 主聊天界面、多会话抽屉、发送和流式状态 |
| `ChatApi.kt` | 请求 `/api/chat` 并解析 SSE |
| `ProductCardView.kt` | 商品卡片展示 |
| `ProductDetailScreen.kt` | 商品详情页 |
| `ComparisonCard.kt` | 结构化对比卡 |
| `ConversationStore.kt` | 客户端本地聊天历史 |
| `DeviceStore.kt` | 匿名 `deviceId`，用于后端会话隔离 |

客户端聊天列表采用 Jetpack Compose `LazyColumn` 实现虚拟列表滚动，只组合和布局可视区域附近的消息项。消息项使用稳定 `message.id` 作为 key，并按用户消息、助手消息和底部锚点设置 `contentType`，帮助 Compose 在长对话和流式 token 更新时更稳定地复用同类列表项。商品卡片横向列表使用 `LazyRow`，同样通过 `productId` 和 `contentType` 优化卡片复用。

## 6. 核心数据流

```text
1. 用户在 Android 输入自然语言购物需求。
2. 客户端发送 deviceId、conversationId、message、history。
3. 后端恢复会话状态，识别本轮是新搜索、追问、指代、对比还是边界问题。
4. LLM Plan 或规则解析输出结构化意图。
5. Validator 校验 Plan，避免模型凭空扩大检索范围或增加硬约束。
6. memory 更新预算、类目、偏好、排除词和多需求状态。
7. retriever 执行类目、商品类型、预算、排除词等硬过滤。
8. local/Qdrant 对过滤后的候选进行语义排序。
9. answer/LLM 基于同一批候选生成回答。
10. 后端通过 SSE 返回 token、review、comparison、products、done。
11. Android 渲染流式回答、商品卡片、对比卡和详情页。
```

## 7. 配置说明

后端配置位于 `server/.env`，敏感 Key 只保存在本地，不提交仓库。

常用本地 Demo 配置：

```env
VECTOR_STORE=local
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=384
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
HOT_QUERY_CACHE_ENABLED=true
SESSION_PERSISTENCE_ENABLED=true
```

Qdrant + Ark embedding 配置：

```env
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products_ark
EMBEDDING_PROVIDER=ark
EMBEDDING_DIMENSION=1024
ARK_EMBEDDING_API_KEY=你的 Ark embedding Key
ARK_EMBEDDING_MODEL=doubao-embedding-vision-250615
```

聊天模型配置：

```env
LLM_PROVIDER=ark
ARK_API_KEY=你的 Ark 聊天模型 Key
ARK_MODEL=你的 Ark endpoint id
```

## 8. 关键问题解决方案

### 8.1 防止模型编造商品事实

项目没有让 LLM 直接决定商品集合。LLM 只负责理解用户意图和生成表达，真正的商品候选由后端检索、过滤和排序得到。

防幻觉措施：

- 商品名、价格、图片、类目、详情页全部来自商品库。
- Prompt 明确禁止编造商品、价格、库存、优惠、销量和功效。
- 本地兜底回答只使用候选商品字段。
- `products` 和 `comparison` 事件由后端结构化生成，不从模型文本反解析。
- `review` 证据链会展示本轮回答使用了哪些候选和哪些安全边界。

### 8.2 多轮对话中的上下文污染

系统将同一会话中的不同购物需求拆成结构化 `needs`。例如先聊笔记本，再聊防晒霜，之后问“刚才笔记本第三款呢”，后端可以恢复到笔记本需求，而不是误用防晒候选。

关键状态：

- `lastProducts`：上一轮展示商品。
- `referenceProducts`：当前需求的候选基准。
- `comparisonProducts`：最近一次对比范围。
- `needs[]`：多个购物需求的结构化快照。

### 8.3 对比问题不回到全库乱搜

当用户问“第二款和第三款哪个更清爽”时，系统不会重新从全库召回，而是只在上一轮候选中解析第 2 和第 3 款。这样可以保证对比卡、文字回答和商品卡片都来自同一组商品。

### 8.4 无模型 Key 也能跑通 Demo

如果没有配置 LLM API Key，后端会使用本地确定性回答。这样评审或本地演示时，即使模型服务不可用，仍然可以验证：

- SSE 流式返回。
- 商品检索。
- 商品卡片。
- 多轮记忆。
- 对比卡。
- 防幻觉边界。

### 8.5 评审模式证据链

`/api/chat` 会额外返回 `review` SSE 事件，`/api/debug/retrieve` 会直接返回 `review` 字段。

`review` 包含：

- 意图类型和来源。
- 硬过滤条件。
- 检索范围和候选数量。
- 最终商品证据。
- 禁止编造的可信边界。

这让项目从“黑盒 RAG 问答”变成“可解释、可验真的可信导购系统”。

### 8.6 客户端长对话性能优化

聊天类 App 的消息会随着多轮对话不断增长，如果直接用普通 `Column` 渲染全部消息，长会话会造成不必要的组合、测量和布局开销。

本项目在客户端使用 Compose 官方虚拟列表：

- 主聊天列表使用 `LazyColumn`，只渲染可视窗口附近的消息。
- 消息项使用稳定 key，避免新增、重试、流式更新时列表项身份错乱。
- 用户消息、助手消息、底部锚点使用不同 `contentType`，便于同类 UI 复用。
- 商品卡片使用 `LazyRow` 横向虚拟列表，避免一轮推荐中的多张卡片拉长主列表。
- 自动滚动统一滚到底部锚点，而不是最后一条消息，保证长回复或商品卡片插入后能显示到真正底部。

这个优化主要面向比赛演示中的长对话、多轮追问和流式回答场景，保证历史消息变多时仍保持较稳定的滚动体验。

## 9. 自动化测试

后端测试覆盖：

- 回答边界和 Prompt。
- 意图解析与 Validator。
- 多轮记忆和跨需求恢复。
- 检索质量基线。
- 性能缓存。
- 会话持久化。
- 模型失败降级。
- 端到端 smoke。

建议交付前运行：

```bash
cd server
npm run test:answer
npm run test:retrieval-quality
npm run test:smoke
node src/__tests__/memory-eval.test.js
```
