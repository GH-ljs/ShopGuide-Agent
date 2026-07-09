# 系统架构

本文说明 ShopGuide Agent 当前主线的模块、数据流和关键工程取舍。

## 总体架构

```text
app/ 跨端前端
  ├─ H5 聊天、商品卡、详情页、购物车
  ├─ 微信小程序构建路径
  └─ 本地会话、收藏、购物车状态

server/ Node.js 后端
  ├─ HTTP / SSE API
  ├─ LLM Planner + Validator
  ├─ 多轮会话记忆
  ├─ 主动追问
  ├─ RAG 检索 / 过滤 / 排序
  ├─ DeepSeek 或本地规则回答
  └─ SQLite 会话持久化

数据与检索
  ├─ ecommerce_agent_dataset JSON + 图片
  ├─ Qdrant + Doubao/Ark embedding
  └─ local 检索兜底
```

## 前端模块

前端位于 `app/src`。

| 模块 | 职责 |
| --- | --- |
| `pages/chat/index.vue` | 聊天主界面、会话抽屉、消息列表、追问卡片、商品卡、收藏和购物车面板 |
| `composables/useChat.ts` | 发送消息、停止生成、重试、会话管理、自动滚动 |
| `api/shopguide.ts` | H5 SSE 与小程序 JSON 请求适配 |
| `components/product/ProductCard.vue` | 商品卡片展示和操作 |
| `components/comparison/ComparisonCard.vue` | 结构化对比结果 |
| `pages/product-detail/index.vue` | 商品详情和 SKU 选择 |
| `pages/checkout/index.vue` | 模拟确认订单 |

前端只消费后端结构化字段，不从模型自然语言里反向解析商品事实。

## 后端模块

后端位于 `server/src`。

| 模块 | 职责 |
| --- | --- |
| `index.js` | 服务启动入口，加载配置、商品和检索器 |
| `http.js` | Express 路由、SSE 输出、主链路编排 |
| `config.js` | 读取 `.env`，集中管理模型、向量库和持久化配置 |
| `data/loader.js` | 读取商品 JSON，拼接可信检索文本 |
| `services/intent.js` | LLM Planner + Validator |
| `services/memory.js` | 多轮记忆、商品指代、跨需求恢复 |
| `services/clarify.js` | 主动追问卡片 |
| `services/retriever.js` | 硬过滤与向量排序 |
| `services/answer.js` | 回答、商品卡、详情和对比卡构造 |
| `services/llm.js` | LLM 调用与流式解析 |
| `vectordb/qdrant.js` | Qdrant collection、入库、检索 |
| `vectordb/local.js` | 本地检索兜底 |

## 主链路数据流

```text
1. 用户在 H5/小程序输入购物需求
2. 前端发送 deviceId / conversationId / message
3. 后端恢复或创建会话
4. intent 解析本轮意图和结构化条件
5. Validator 校验 LLM 输出，防止越权生成硬约束
6. memory 更新当前需求和候选上下文
7. clarify 判断是否先追问
8. retriever 按类目、商品类型、预算、排除词过滤商品
9. Qdrant 或 local 检索在合规候选中排序
10. answer/LLM 基于候选商品生成回答
11. 后端返回 token、clarify、comparison、products、done
12. 前端渲染聊天、追问卡、商品卡、详情页和购物闭环
13. 后端在成功回答后持久化会话
```

## 受控 RAG Agent

项目没有把所有判断交给 LLM，而是采用受控链路：

| 层 | 负责内容 |
| --- | --- |
| LLM Planner | 理解自然语言，输出结构化计划 |
| Validator | 校验计划字段，丢弃不可信或越界信息 |
| Retriever | 执行类目、预算、排除词等硬过滤 |
| Vector Store | 在合规候选中做语义排序 |
| Answer | 基于同一批候选生成文本、商品卡和对比卡 |

这样做是因为电商导购有强事实边界：商品、价格、图片、库存、优惠和功效不能让模型自由发挥，必须以商品库结构化数据为准。

## 多轮记忆

会话状态包含：

- `state`：当前可复用约束，例如类目、商品类型、预算、排除词、偏好词。
- `turns`：最近对话轮次。
- `lastProducts`：上一轮实际展示的商品。
- `referenceProducts`：当前需求的候选基准，用于“第二款怎么样”。
- `comparisonProducts`：最近一次对比范围，用于“哪款更健康/不那么甜”。
- `needs[]`：同一会话里的多个购物需求。
- `summary`：由结构化需求派生的长期摘要。

会话按 `deviceId + conversationId` 隔离。`deviceId` 是客户端本地生成的匿名 ID，不是真实设备号。

## 向量检索

项目支持两种检索模式：

```text
VECTOR_STORE=local
VECTOR_STORE=qdrant
```

`local` 适合无外部依赖的本地兜底；`qdrant` 适合展示真实 RAG 架构。Embedding 也支持本地哈希向量和 Ark/Doubao embedding。

Qdrant collection 建议按 embedding 方案命名，例如：

```text
shopguide_products_local
shopguide_products_ark
```

collection 的向量维度必须和 embedding 方案一致。

## 防幻觉边界

- 检索结果不足时，不硬凑商品。
- 商品价格、图片、类目、详情来自结构化商品数据。
- Prompt 明确禁止编造商品、价格、库存、优惠和功效。
- 本地兜底回答只使用候选商品字段。
- `products` 和 `comparison` 由后端结构化生成，不从 LLM 文本反解析。
- Validator 会阻止 LLM 凭空添加预算、排除词或扩大对比范围。

## 框架取舍

当前没有引入 LangChain / LlamaIndex。原因是本项目规模较小，而且核心价值在于展示“受控 Agent 编排”和“商品事实边界”。轻量自研更容易解释每一步，也更适合作为简历项目讲清楚。
