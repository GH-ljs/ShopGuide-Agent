# ShopGuide Agent

基于 RAG 的多模态电商智能导购 AI Agent 课题项目。

Android 原生 App ← SSE → Node.js 后端 → 商品向量检索 → LLM 流式生成 → 商品卡片展示。

## 端到端架构

```text
┌─────────────────────┐     SSE (text/event-stream)     ┌──────────────────────┐
│   Android 原生 App   │ ◄─────────────────────────────► │   Node.js 后端       │
│  Kotlin + Compose    │    POST /api/chat               │   localhost:3001     │
│                      │    token / products / done      │                      │
│  流式渲染消息气泡     │                                  │  检索 → 过滤 → 排序   │
│  商品卡片展示         │                                  │  LLM 流式生成        │
└─────────────────────┘                                  └────────┬─────────────┘
                                                                  │
                                                    ┌─────────────┴─────────────┐
                                                    │  向量检索                  │
                                                    │  local（零依赖默认）        │
                                                    │  或 Qdrant（Docker）       │
                                                    └───────────────────────────┘
```

## 项目结构

```text
ShopGuide-Agent/
├─ client/                              # Android 原生客户端（Kotlin + Jetpack Compose）
│  ├─ app/src/main/java/com/shopguide/agent/
│  │  ├─ MainActivity.kt                # 入口 Activity
│  │  ├─ model/
│  │  │  ├─ ChatMessage.kt              # 聊天消息数据类
│  │  │  ├─ MessageRole.kt              # 消息角色枚举（User / Assistant）
│  │  │  └─ ProductCard.kt              # 商品卡片数据类
│  │  ├─ network/
│  │  │  ├─ ApiConfig.kt                # 后端地址配置（10.0.2.2:3001）
│  │  │  ├─ ChatApi.kt                  # SSE 流式聊天请求
│  │  │  └─ HealthApi.kt                # 健康检查
│  │  └─ ui/
│  │     ├─ ChatScreen.kt               # 主聊天界面
│  │     ├─ Header.kt                   # 顶栏（标题 + 后端连接状态）
│  │     ├─ InputBar.kt                 # 输入框 + 发送按钮
│  │     ├─ MessageBubble.kt            # 消息气泡组件
│  │     └─ ProductCardView.kt          # 商品卡片组件
│  ├─ build.gradle.kts                  # 根构建配置
│  ├─ settings.gradle.kts               # 项目设置
│  └─ app/build.gradle.kts              # App 模块构建配置
│
├─ server/                              # Node.js 后端
│  ├─ src/
│  │  ├─ index.js                       # 服务入口，监听 3001
│  │  ├─ config.js                      # .env 配置读取
│  │  ├─ http.js                        # HTTP 路由 + SSE 输出 + CORS
│  │  ├─ services/                      # 业务逻辑
│  │  │  ├─ answer.js                   #   商品卡片构建 + 本地兜底回答 + LLM Prompt
│  │  │  ├─ llm.js                      #   OpenAI-compatible 流式模型调用
│  │  │  ├─ memory.js                   #   内存多轮会话记忆 + 导购结构化状态
│  │  │  └─ retriever.js                #   检索入口：类目识别、预算过滤、否定词过滤
│  │  ├─ vectordb/                      # 向量数据库层
│  │  │  ├─ local.js                    #   本地文本向量索引 + 余弦相似度
│  │  │  ├─ embedding.js                #   Embedding 入口（本地哈希 / Ark API）
│  │  │  ├─ qdrant.js                   #   Qdrant collection 管理 + 向量检索
│  │  │  └─ factory.js                  #   向量检索器工厂（local / qdrant）
│  │  ├─ data/
│  │  │  └─ loader.js                   # 加载标准化商品 JSON
│  │  ├─ utils/
│  │  │  ├─ errors.js                   # 统一错误码和错误响应
│  │  │  └─ nlp.js                      # 共享分词、类目识别、价格/否定词解析
│  │  ├─ scripts/                       # CLI 工具脚本
│  │  │  ├─ qdrant-ingest.js            #   商品向量写入 Qdrant
│  │  │  ├─ qdrant-health.js            #   Qdrant 健康检查
│  │  │  └─ qdrant-search-test.js       #   Qdrant 检索验证
│  │  └─ __tests__/                     # 测试
│  │     ├─ retrieval.test.js           #   检索逻辑测试
│  │     ├─ embedding.test.js           #   Embedding 测试
│  │     └─ smoke.test.js               #   端到端冒烟测试
│  ├─ .env                              # 本地环境配置（不提交）
│  └─ README.md                         # 后端详细说明
│
├─ ecommerce_agent_dataset/             # 商品数据（JSON + 图片）
├─ docs/
│  ├─ architecture.md                   # 架构设计文档
│  ├─ api.md                            # 接口文档（含调试示例）
│  ├─ project-background-requirements.md # 课题背景与验收标准
│  └─ qdrant.md                         # Qdrant 本地部署说明
├─ docker-compose.yml                   # Qdrant Docker 配置
├─ AGENTS.md                            # 本地协作说明
└─ README.md
```

## 快速启动

### 后端

```bash
cd server
node src/index.js
```

启动成功输出：

```text
ShopGuide Agent server listening on http://localhost:3001
Loaded 100 products from ...\ecommerce_agent_dataset
Vector store: local
LLM provider: deepseek
Model streaming: enabled
```

服务默认地址：`http://localhost:3001`

### Android 客户端

1. 用 Android Studio 打开 `client/` 目录
2. 等待 Gradle Sync 完成
3. 选择模拟器或真机，点击 Run

> 模拟器通过 `http://10.0.2.2:3001` 访问本机后端，已在 `ApiConfig.kt` 中配置。如果使用真机调试，需将 `BASE_URL` 改为电脑局域网 IP。

## 配置说明

在 `server/.env` 中配置：

### 向量检索模式

| 模式 | 配置 | 说明 |
|------|------|------|
| 本地检索（默认） | `VECTOR_STORE=local` | 零依赖，使用本地哈希 embedding + 余弦相似度 |
| Qdrant 检索 | `VECTOR_STORE=qdrant` | 需要先启动 Docker Qdrant 并执行入库脚本 |

本地检索模式无需任何外部依赖，启动即可用。Qdrant 模式需要：

```bash
# 1. 启动 Qdrant
docker compose up -d

# 2. 写入商品向量
cd server
node src/scripts/qdrant-ingest.js
```

### Embedding 配置

| 提供方 | 配置 | 说明 |
|--------|------|------|
| 本地哈希（默认） | `EMBEDDING_PROVIDER=local` | 零依赖，适合快速验证 |
| Doubao/Ark | `EMBEDDING_PROVIDER=ark` | 需配置 `ARK_API_KEY` 和 endpoint ID |

### LLM 配置

| 提供方 | 配置 | 说明 |
|--------|------|------|
| DeepSeek | `LLM_PROVIDER=deepseek` | 需 `DEEPSEEK_API_KEY` |
| Doubao/Ark | `LLM_PROVIDER=ark` | 需 `ARK_API_KEY` 和 endpoint ID |

> `EMBEDDING_PROVIDER` 和 `LLM_PROVIDER` 是两套独立开关。例如可用 Ark 做 embedding、用 DeepSeek 做聊天生成。

未配置聊天模型 Key 时，后端自动使用本地规则生成兜底回答，可先跑通端到端链路。

## API 概览

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 + 商品数量 + 模型状态 |
| `/api/products` | GET | 简化商品列表 |
| `/api/chat` | POST | SSE 流式导购对话 |
| `/api/conversations/reset` | POST | 重置会话记忆 |
| `/api/debug/retrieve` | POST | 检索调试信息 |

### 导购对话示例

```bash
curl -N -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"conversationId\":\"demo\",\"message\":\"推荐一款适合油皮的洗面奶\"}"
```

SSE 事件顺序：

```text
event: token     → 流式文本片段
event: products  → 结构化商品卡片
event: done      → 本轮完成
```

> 商品展示以 `products` 事件的卡片数据为准，不要从模型自然语言里解析商品信息。

详细接口文档见 [docs/api.md](docs/api.md)。

## 核心流程

1. 服务启动时加载 `ecommerce_agent_dataset` 下所有商品 JSON
2. 用户发送消息 → 后端解析类目、预算、排除词等约束
3. 候选商品过滤（类目 → 商品类型 → 预算 → 否定词）
4. 向量检索排序（本地余弦距离或 Qdrant 向量搜索）
5. 候选商品 + 会话历史 → LLM Prompt → 流式生成回答
6. SSE 返回 `token` 文本 → `products` 商品卡片 → `done`

## 关键设计

- **反幻觉约束**：模型只能基于检索到的商品回答，禁止编造商品、价格、库存或优惠
- **商品卡片独立于模型文本**：卡片数据来自原始 JSON，不由模型生成
- **多轮记忆**：按 `conversationId` 保存内存会话，支持追问时继承上下文
- **结构化导购状态**：保存类目、商品类型、预算、排除词、偏好，支持"再便宜点""不要含酒精"等追问
- **错误码统一**：所有接口使用相同的错误响应格式

## 测试

```bash
cd server
node src/__tests__/retrieval.test.js    # 检索逻辑测试
node src/__tests__/embedding.test.js    # Embedding 测试
node src/__tests__/smoke.test.js        # 端到端冒烟测试
```
