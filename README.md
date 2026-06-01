# ShopGuide Agent

基于 RAG 的多模态电商智能导购 AI Agent 课题项目。当前仓库重点完成并打磨了“Android 原生客户端对话 -> Node.js 后端检索 -> 模型或本地兜底生成 -> SSE 流式返回 -> 商品卡片/详情页展示”的端到端闭环。

## 当前项目状态

项目已经可以作为可运行 Demo 演示：

- Android 原生 App：Kotlin + Jetpack Compose。
- 后端服务：Node.js + Express。
- 商品数据：`ecommerce_agent_dataset/` 下 4 个类目、约 100 个商品 JSON 与图片。
- RAG 检索：支持本地向量检索，也可接入 Qdrant。
- 模型生成：支持 DeepSeek 或 Doubao/Ark；没有 API Key 时使用本地确定性回答兜底，保证最小闭环可演示。
- 客户端体验：SSE 流式文字、商品卡片、商品详情页、结构化对比卡、多会话本地历史。

项目的核心约束是：回答、卡片和详情必须基于商品库结构化数据，不能编造商品、价格、库存、优惠、销量或功效。

## 目录结构

```text
ShopGuide-Agent/
├─ client/                    # Android 原生客户端，Kotlin + Jetpack Compose
├─ server/                    # Node.js 后端，负责 RAG、SSE、商品接口和模型调用
├─ docs/                      # 架构、API、Qdrant、Demo 验收和学习文档
├─ ecommerce_agent_dataset/   # 商品 JSON 和图片数据
├─ qdrant_storage/            # 本地 Qdrant 持久化目录，不提交
├─ docker-compose.yml         # 本地 Qdrant 服务配置
└─ README.md                  # 项目总览
```

## 端到端链路

```text
Android App
  -> POST /api/chat
  -> 后端恢复 conversationId 对应的会话记忆
  -> 解析本轮意图：新搜索 / 追问细化 / 指代 / 对比
  -> 商品硬过滤：类目、商品类型、预算、排除词
  -> 本地向量或 Qdrant 排序
  -> 构造只包含候选商品的 RAG Prompt
  -> LLM 流式生成，或本地确定性回答兜底
  -> SSE 返回 token / meta / comparison / products / done
  -> 客户端展示回答、对比卡、商品卡片和详情页
```

## 主要能力

### 客户端

- 原生 Android App，不是 Web/H5。
- 聊天页支持文字输入、快捷问题、流式回答和错误提示。
- 商品卡片横向展示，卡片数据来自 `products` SSE 事件。
- 点击卡片进入商品详情页，展示主图、价格、规格、官方问答和用户评价。
- 支持结构化对比卡，适合“第二款和第三款对比一下”“哪个更适合通勤”等问题。
- 支持多会话本地持久化、会话切换、重命名、删除和批量管理。
- 客户端会把最近历史随请求带给后端，帮助后端重启后恢复多轮上下文。

### 后端

- 加载并标准化商品 JSON，构造检索文本和商品卡片。
- `/api/chat` 提供 SSE 流式导购接口。
- `/api/products`、`/api/products/:productId`、`/api/products/:productId/image` 提供商品列表、详情和图片。
- `/api/debug/retrieve` 返回意图解析、过滤、排序和候选商品调试信息。
- `/api/performance` 返回热门查询缓存统计。
- 支持本地向量检索和 Qdrant 检索。
- 支持本地 embedding 兜底和 Doubao/Ark embedding。
- 支持 DeepSeek 或 Doubao/Ark 聊天模型。
- 支持热门新搜索缓存，降低重复检索和模型生成成本。

### RAG 与多轮记忆

- 识别类目、商品类型、预算、排除词、偏好词。
- 区分 `new_search`、`refine`、`refer`、`compare` 等对话意图。
- 追问中继承合理上下文，例如“1 万预算”“再便宜点”“第二款怎么样”。
- 新需求会隔离旧需求，避免“笔记本预算”污染“防晒霜推荐”。
- 对比问题只围绕被点名或上一轮候选商品，不重新从全库插入无关商品。
- 结构化商品卡片由后端可信数据生成，不从模型自然语言反向解析。
- 无匹配结果时明确说明商品库没有满足条件的商品，不硬编推荐。

## 快速启动

### 1. 安装后端依赖

```bash
cd server
npm install
```

### 2. 配置环境变量

复制 `server/.env.example` 为 `server/.env`，按需填写模型 Key。没有模型 Key 也能使用本地兜底回答跑通 Demo。

```bash
cd server
copy .env.example .env
```

敏感信息只放在本地 `.env`，不要写入源码、README 或提交记录。

### 3. 启动后端

```bash
cd server
npm run dev
```

默认地址：

```text
http://localhost:3001
```

健康检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3001/api/health
```

### 4. 可选：启动 Qdrant

本地检索不依赖 Qdrant。如果需要验证向量数据库链路：

```powershell
docker compose up -d qdrant
```

```bash
cd server
npm run qdrant:health
npm run qdrant:ingest
npm run qdrant:test
```

### 5. 启动 Android 客户端

用 Android Studio 打开 `client/` 目录并运行。

客户端后端地址在：

```text
client/app/src/main/java/com/shopguide/agent/network/ApiConfig.kt
```

常见配置：

- Android 模拟器访问电脑本机后端：`http://10.0.2.2:3001`
- 真机访问电脑后端：改为电脑局域网 IP，例如 `http://192.168.x.x:3001`

当前代码中的 `BASE_URL` 可能是本机调试 IP，换机器运行时需要先检查这里。

## 常用后端配置

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

`EMBEDDING_PROVIDER` 和 `LLM_PROVIDER` 是两套独立开关，可以使用 Ark 做 embedding，同时使用 DeepSeek 做聊天生成。

## 测试与自检

后端主要自检命令：

```bash
cd server
npm run test:answer
npm run test:retrieval
npm run test:retrieval-quality
npm run test:embedding
npm run test:performance
npm run test:smoke
npm run demo:retrieve
```

当前仓库还包含专项测试文件：

```bash
cd server
node src/__tests__/intent.test.js
node src/__tests__/memory-eval.test.js
```

推荐日常开发至少跑：

```bash
cd server
npm run test:answer
npm run test:retrieval-quality
npm run test:smoke
```

如果改动了多轮记忆、指代、对比或追问逻辑，再额外运行：

```bash
cd server
node src/__tests__/memory-eval.test.js
node src/__tests__/intent.test.js
```

## Demo 推荐问题

可以用这些问题验证核心链路：

- 推荐一款适合油皮的防晒霜
- 推荐防晒霜，但不要含酒精
- 送女生的口红
- 想买一台办公用轻薄笔记本
- 1 万预算
- 第二款和第三款对比一下
- 我主要通勤，偶尔出差，选哪个？
- 推荐无糖饮料
- 推荐通勤背包
- 推荐一款手机，拍照好一点

## 文档入口

- [后端说明](server/README.md)
- [客户端说明](client/README.md)
- [API 文档](docs/api.md)
- [系统架构](docs/architecture.md)
- [Qdrant 配置](docs/qdrant.md)
- [Demo 验收清单](docs/demo-checklist.md)
- [项目进度](docs/progress.md)
- [项目背景与要求](docs/project-background-requirements.md)

## 提交注意

以下内容不要提交到 GitHub：

- `server/.env`
- `AGENTS.md`
- `client/local.properties`
- `qdrant_storage/`
- API Key、SDK 本地路径、个人环境配置
