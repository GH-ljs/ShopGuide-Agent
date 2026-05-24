# Architecture

## Goal

先完成课题要求的最小闭环：

```text
Android 原生 App
  -> Node.js 后端 SSE 接口
  -> 商品检索/RAG
  -> OpenAI-compatible 大模型生成
  -> 流式文本 + 商品卡片
```

## Backend MVP

当前后端位于 `server/`，暂时使用零依赖 Node.js 实现，方便在没有 npm 依赖安装的环境中先跑通链路。

### Modules

- `src/index.js`: 服务入口
- `src/config.js`: 环境变量和 `.env` 配置
- `src/dataLoader.js`: 读取并标准化商品 JSON
- `src/retriever.js`: 检索入口与基础约束过滤
- `src/vectorStore.js`: 本地文本向量索引与余弦相似度排序
- `src/embedding.js`: embedding 入口，支持本地哈希向量和 Doubao/Ark embedding API
- `src/answer.js`: 本地兜底回答、商品卡片、模型 Prompt
- `src/llm.js`: OpenAI-compatible 流式模型调用
- `src/http.js`: HTTP 路由和 SSE 输出
- `src/memory.js`: 内存多轮会话记忆与结构化导购状态
- `src/vectorIndexFactory.js`: 向量检索器工厂，按配置选择 local/qdrant
- `src/vectorStore.js`: 本地文本向量检索器
- `src/qdrantStore.js`: Qdrant collection 创建、商品向量写入和向量检索
- `src/qdrant.ingest.js`: 商品数据写入 Qdrant 的脚本
- `src/qdrant.search.test.js`: Qdrant 检索验证脚本

## Data Flow

1. 服务启动时读取 `ecommerce_agent_dataset` 下所有商品 JSON。
2. 用户请求 `/api/chat`。
3. 后端根据 `conversationId` 读取最近会话历史、上一轮商品和结构化导购状态。
4. 后端把本轮输入更新到结构化状态，例如类目、商品类型、预算、排除词、偏好。
5. 后端根据结构化状态做候选过滤。
6. 向量检索器把用户问题、历史需求、结构化状态和商品文本转成向量，用相似度排序；默认走本地检索，也可以切到 Qdrant。
7. 如果配置了聊天模型 Key，把候选商品、最近对话和结构化状态作为上下文发给 Ark 或 DeepSeek。
8. 如果没有聊天模型 Key，使用本地规则生成兜底回复。
9. SSE 先返回 `token` 流式文本，再返回 `products` 商品卡片。
10. 回答结束后，把用户消息、助手回复和本轮商品写入内存会话。

## Anti-Hallucination Rule

模型 Prompt 中要求只能基于检索到的商品上下文回答，不允许编造不存在的商品、价格、库存、优惠券或功能。

商品卡片价格来自原始 JSON，而不是模型自由生成。

## Recommended Next Backend Upgrade

当前已经有本地文本向量检索 MVP，并完成了 Qdrant 入库/检索闭环：

```text
商品 JSON -> chunk -> embedding -> vector DB -> topK recall -> rerank/filter -> LLM
```

优先选择：

- Qdrant: 工程感更强，适合答辩讲解
- Chroma: 上手最快，适合快速 Demo

当前已预留可切换配置：

```text
VECTOR_STORE=local
VECTOR_STORE=qdrant
```

默认 `local` 不依赖外部服务；`qdrant` 需要先启动 Docker 服务并执行入库脚本。正式语义检索可以配置 `EMBEDDING_PROVIDER=ark`，用 Doubao/Ark embedding 生成商品向量和查询向量。

Qdrant Docker 配置文件位于项目根目录 `docker-compose.yml`，本地启动说明见 `docs/qdrant.md`。
