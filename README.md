# ShopGuide Agent

基于 RAG 的多模态电商智能导购 AI Agent 课题项目。

项目当前已经完成基础闭环：Android 原生 App 发送文字需求，Node.js 后端进行商品检索和 RAG 生成，通过 SSE 流式返回回答，并展示可点击商品卡片和商品详情页。

## 项目结构

```text
ShopGuide-Agent/
├─ client/                    # Android 原生客户端，Kotlin + Jetpack Compose
├─ server/                    # Node.js 后端，负责 RAG、SSE、商品接口和模型调用
├─ docs/                      # 架构、API、Qdrant、Demo 验收文档
├─ ecommerce_agent_dataset/   # 商品 JSON 和图片数据
├─ docker-compose.yml         # 本地 Qdrant 配置
└─ README.md                  # 项目总览
```

## 端到端链路

```text
Android App
  -> POST /api/chat
  -> Node.js 后端
  -> 解析用户需求
  -> 商品过滤
  -> 向量检索 / Qdrant
  -> 构造 RAG Prompt
  -> LLM 流式生成
  -> SSE 返回 token / products / done
  -> 客户端展示回答和商品卡片
```

## 当前已完成能力

### 客户端

- Android 原生 App。
- 对话窗口，支持输入文字。
- 接收并渲染 SSE 流式回复。
- 横向滑动展示商品卡片。
- 点击商品卡片进入详情页。
- 详情页支持返回聊天页。

### 后端

- Node.js + Express。
- 商品数据加载和标准化。
- `/api/chat` SSE 流式接口。
- `/api/products` 商品列表接口。
- `/api/products/:productId` 商品详情接口。
- `/api/products/:productId/image` 商品图片接口。
- `/api/debug/retrieve` 检索调试接口。
- `/api/conversations/reset` 会话重置接口。
- 支持本地向量检索和 Qdrant 向量数据库。
- 支持本地 embedding 兜底和 Doubao/Ark embedding。
- 支持 DeepSeek 或 Doubao/Ark 聊天模型。

### RAG

- 用户意图解析：类目、商品类型、预算、排除词、偏好词。
- 业务硬过滤：类目、商品类型、预算、否定条件。
- 向量排序：本地向量检索或 Qdrant 检索。
- 偏好加权：无糖、轻薄、通勤、拍照、敏感肌、油皮等偏好会影响排序。
- 无结果处理：商品库没有满足硬约束的商品时，不硬编推荐。
- Prompt 约束：模型只能基于候选商品回答，禁止编造价格、库存、优惠、销量和功效。
- 商品卡片由结构化商品数据生成，不从模型文本中反向解析。
- 客户端请求 `/api/chat` 时会传 `limit`，当前默认请求 6 个候选，用于横向滑动卡片展示。

## 本轮 RAG 优化整理

这一轮重点优化了“推荐是否准确、是否可解释、是否可测试”。

### 1. 检索调试信息增强

后端现在能通过 `/api/debug/retrieve` 和 `npm run demo:retrieve` 查看完整检索过程：

- 用户原始问题。
- 识别出的类目。
- 识别出的商品类型。
- 预算条件。
- 排除词。
- 偏好词。
- 每一阶段候选数量。
- 被保留的商品。
- 被过滤的商品和原因。
- 向量分数。
- 综合排序分数 `rankScore`。
- 最终选中商品和推荐依据。

这样推荐结果不准时，可以定位问题出在意图识别、过滤、向量召回、排序还是模型表达。

### 2. 意图和同义词增强

新增或强化了常见电商说法的识别：

| 用户说法 | 后端理解 |
| --- | --- |
| 口红 | 唇妆 / 唇釉 |
| 轻薄笔记本 | 数码电子 / 笔记本电脑 |
| 无糖饮料 | 食品饮料 / 饮料 |
| 通勤背包 | 服饰运动 / 背包 |
| 拍照手机 | 数码电子 / 手机 / 影像偏好 |
| 敏感肌面霜 | 美妆护肤 / 面霜 / 敏感肌偏好 |
| 油皮防晒霜 | 美妆护肤 / 防晒 / 控油偏好 |

### 3. 排序策略增强

原来主要依赖向量相似度，现在改成：

```text
最终排序 = 向量相似度 + 偏好命中加权 + 商品字段匹配
```

例如用户问“推荐无糖饮料”，命中 `无糖`、`0糖`、`低糖` 的商品会排在更前面。

### 4. 无结果不编造

例如用户问：

```text
推荐防晒霜，但不要含酒精
```

如果商品库里的防晒商品都包含“酒精”相关描述，后端会返回空候选，回答会明确说明当前商品库没有满足条件的商品，而不是硬推荐不符合要求的商品。

### 5. Prompt 防幻觉

模型 Prompt 已强化这些约束：

- 只能使用传入的商品上下文。
- 不能编造不存在的商品。
- 不能编造价格、库存、优惠、销量、功效。
- 商品不完全匹配时要如实说明。
- 不输出 JSON。
- 不展示内部字段或检索分数。

### 6. 质量测试和 Demo 自检

新增了固定测试和 Demo 脚本：

```bash
cd server
npm run test:answer
npm run test:retrieval-quality
npm run test:smoke
npm run demo:retrieve
```

覆盖的典型问题包括：

- 推荐一款适合油皮的防晒霜
- 推荐防晒霜，但不要含酒精
- 送女生的口红
- 想买一台办公用轻薄笔记本
- 推荐无糖饮料
- 推荐通勤背包
- 推荐一款手机，拍照好一点
- 推荐适合户外的鞋

## 快速启动

### 1. 启动 Qdrant

如果使用 Qdrant：

```powershell
docker compose up -d qdrant
```

检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:6333/collections
```

### 2. 启动后端

```bash
cd server
npm run dev
```

后端默认地址：

```text
http://localhost:3001
```

### 3. 启动 Android 客户端

用 Android Studio 打开 `client/` 目录并运行。

模拟器访问本机后端使用：

```text
http://10.0.2.2:3001
```

该地址已经在客户端 `ApiConfig.kt` 中配置。

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

注意：`EMBEDDING_PROVIDER` 和 `LLM_PROVIDER` 是两套独立开关，可以使用 Ark 做 embedding，同时使用 DeepSeek 做聊天生成。

## 文档入口

- [后端说明](server/README.md)
- [API 文档](docs/api.md)
- [Qdrant 配置](docs/qdrant.md)
- [Demo 验收清单](docs/demo-checklist.md)
- [项目背景与要求](docs/project-background-requirements.md)

## 提交注意

以下内容不要提交到 GitHub：

- `server/.env`
- `AGENTS.md`
- `client/local.properties`
- `qdrant_storage/`
- API Key、SDK 本地路径、个人环境配置
