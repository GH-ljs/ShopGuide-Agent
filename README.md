# ShopGuide Agent

基于 RAG 的电商智能导购 AI Agent。项目实现了从 Android 原生客户端到 Node.js 后端 RAG 服务的端到端闭环：

```text
用户自然语言购物需求
-> Android 原生聊天界面
-> Node.js 后端意图解析与多轮记忆
-> 商品检索、硬过滤、排序
-> LLM 或本地兜底生成回答
-> SSE 流式返回文本、商品卡片、结构化对比卡
-> 客户端展示商品卡片和详情页
```

项目核心原则：**回答、商品卡片、对比结果和详情页必须基于商品库真实数据，不能编造不存在的商品、价格、库存、优惠、销量或功效。**

## 当前完成度

当前仓库已经可以作为可运行 Demo 演示，覆盖课程要求中的最小闭环，并实现了部分加分点。

| 模块 | 完成情况 |
| --- | --- |
| Android 原生客户端 | Kotlin + Jetpack Compose，支持聊天、流式回答、商品卡片、详情页、多会话 |
| 后端 RAG 服务 | Node.js + Express，支持商品加载、检索、过滤、SSE 流式接口 |
| 商品数据 | `ecommerce_agent_dataset/` 下约 100 个商品，含 JSON 与图片 |
| 模型接入 | 支持 DeepSeek 或 Doubao/Ark；无 Key 时可用本地确定性回答兜底 |
| 向量检索 | 支持本地向量检索，也可接入 Qdrant |
| 多轮上下文 | 支持结构化需求记忆、跨需求恢复、指代、预算继承与隔离 |
| 对比决策 | 支持多商品结构化对比卡，能处理“2 和 3 哪个好”等追问 |
| 工程质量 | 有热门查询缓存、首 token 指标、专项自动化测试 |

## 功能亮点

### 1. 受控 RAG Agent 链路

项目不是简单的“检索后把内容塞给 LLM”，而是采用更可控的 Agent 编排：

```text
LLM Plan / 规则兜底
-> 后端 Validator 校验
-> memory 确定上下文和候选范围
-> retriever 执行商品检索、硬过滤、排序
-> LLM 或本地模板基于候选商品回答
-> products / comparison 结构化事件返回客户端
```

LLM 负责语义理解和自然语言表达，后端负责可信边界、状态管理和商品集合控制。

### 2. LLM Plan + 后端 Validator

有模型 Key 时，后端会让 LLM 输出结构化 Plan，例如：

```json
{
  "turn_type": "compare",
  "scope": "last_compared_products",
  "target_refs": [2, 5],
  "focus": ["控油", "清爽"],
  "max_price": null,
  "negative_terms": [],
  "preferences": ["控油"]
}
```

后端不会直接执行原始 Plan，而是先校验：

- `turn_type` 只能是 `new_search / refine / refer / compare`。
- `compare / refer` 不能被 LLM 扩大到全库。
- `target_refs` 必须指向当前候选中真实存在的序号。
- 用户没提预算时，LLM 不能凭空加预算硬约束。
- 用户没说“不要/不含/排除”时，LLM 不能凭空加排除词。
- `refer / compare` 场景下，LLM 不能凭空改写类目或商品类型。

### 3. 多轮上下文与结构化记忆

后端按 `deviceId + conversationId` 维护会话状态，并把同一会话里的不同购物需求拆成结构化 `needs`：

- 支持“再便宜点”“1 万预算”“不要含酒精”等补充条件。
- 支持“第二款怎么样”“第三款呢”等序号指代。
- 支持“比较 2 和 5”“哪个更控油”“哪款更清爽”等对比后追问。
- 支持同一会话中切换新品类后，再回到旧需求，例如先聊笔记本、再聊防晒、再问“刚才笔记本第三款呢”。
- 新需求不会继承旧需求预算，避免“笔记本 1 万预算”污染“防晒霜推荐”。
- 客户端生成匿名 `deviceId`，后端把会话快照持久化到本地 SQLite，服务重启后可恢复上下文；未传 `deviceId` 的旧请求会落到 `anonymous`。

### 4. 结构化对比卡

对比问题会返回 `comparison` SSE 事件，客户端用结构化组件展示：

- 明确推荐结论。
- 对比列与商品卡片使用同一批 `productId`。
- 行维度包括价格、取舍点、适合场景等。
- 避免从 LLM 文本里解析表格，保证文字、卡片、对比卡一致。

### 5. 工程质量与性能优化

- 热门新搜索缓存：相似热门查询可复用结果，降低重复检索和模型生成成本。
- `meta` SSE 事件：返回缓存命中和首 token 耗时。
- `/api/performance`：查看缓存 `size / hits / misses / writes / ttlMs`。
- 自动化测试覆盖回答、意图、记忆、检索质量、性能和后端端到端 smoke。

## 项目结构

```text
ShopGuide-Agent/
├─ client/                    # Android 原生客户端，Kotlin + Jetpack Compose
├─ server/                    # Node.js 后端，负责 RAG、SSE、商品接口和模型调用
├─ docs/                      # API、架构、Qdrant、Demo 验收和项目要求文档
├─ ecommerce_agent_dataset/   # 商品 JSON 和图片数据
├─ docker-compose.yml         # 本地 Qdrant 服务配置
└─ README.md                  # 项目总览
```

## 快速启动

### 1. 启动后端

进入后端目录并安装依赖：

```bash
cd server
npm install
```

复制本地配置：

```bash
copy .env.example .env
```

默认配置使用本地向量检索和本地兜底回答，不填模型 API Key 也能跑通 Demo。启动服务：

```bash
npm run dev
```

默认监听：

```text
http://localhost:3001
```

健康检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3001/api/health
```

### 2. 启动 Android 客户端

用 Android Studio 打开：

```text
D:\code\agent\ShopGuide-Agent\client
```

等待 Gradle Sync 完成后运行 App。

客户端后端地址在：

```text
client/app/src/main/java/com/shopguide/agent/network/ApiConfig.kt
```

常见配置：

- Android 模拟器访问电脑本机后端：`http://10.0.2.2:3001`
- 真机访问电脑后端：改为电脑局域网 IP，例如 `http://192.168.x.x:3001`

### 3. 可选：启动 Qdrant

本地检索不依赖 Qdrant。如果要演示向量数据库链路：

```powershell
docker compose up -d qdrant
```

```bash
cd server
npm run qdrant:health
npm run qdrant:ingest
npm run qdrant:test
```

## 常用配置

配置文件为 `server/.env`，敏感信息只放本地，不要提交。

### 本地检索

```env
VECTOR_STORE=local
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=384
```

### Qdrant + 本地 Embedding

```env
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=384
```

### Qdrant + Doubao/Ark Embedding

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
ARK_API_KEY=你的 Ark 聊天模型 API Key
```

`EMBEDDING_PROVIDER` 和 `LLM_PROVIDER` 是两套独立开关，可以使用 Ark 做 embedding，同时使用 DeepSeek 做聊天生成。

## API 概览

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/api/health` | GET | 健康检查，返回商品数量、向量库、模型和缓存状态 |
| `/api/chat` | POST | SSE 流式导购对话 |
| `/api/products` | GET | 商品卡片列表 |
| `/api/products/:productId` | GET | 商品详情 |
| `/api/products/:productId/image` | GET | 商品图片 |
| `/api/debug/retrieve` | POST | 检索调试，查看意图、过滤、排序和候选 |
| `/api/performance` | GET | 热门查询缓存和首 token 相关统计 |
| `/api/conversations/reset` | POST | 重置指定后端会话记忆 |

`/api/chat` SSE 事件：

| 事件 | 含义 |
| --- | --- |
| `token` | 流式文本片段 |
| `meta` | 缓存和首 token 调试信息，客户端可忽略 |
| `comparison` | 结构化商品对比卡 |
| `products` | 商品卡片数据 |
| `done` | 本轮完成 |
| `error` | 结构化错误 |

## 测试与自检

后端测试命令：

```bash
cd server
npm run test:answer
npm run test:retrieval
npm run test:retrieval-quality
npm run test:embedding
npm run test:performance
npm run test:session
npm run test:smoke
npm run demo:retrieve
```

专项测试：

```bash
cd server
node src/__tests__/intent.test.js
node src/__tests__/memory-eval.test.js
```

建议：

- 修改回答、Prompt 或对比逻辑：跑 `test:answer`。
- 修改检索、过滤或排序：跑 `test:retrieval-quality`。
- 修改多轮记忆、指代、预算、对比：跑 `memory-eval.test.js` 和 `intent.test.js`。
- 修改缓存或性能逻辑：跑 `test:performance`。
- 修改 `deviceId`、会话隔离或持久化：跑 `test:session`。
- 提交前至少跑 `test:smoke`。

当前多轮记忆专项覆盖的典型场景包括：

- 预算继承与新需求隔离。
- 防晒后回问旧笔记本需求。
- 数字指代 `2怎么样`、`2和3哪个好`。
- 对比后追问 `哪个控油些`、`哪款更清爽`、`谁更舒适`。
- `太便宜了` 应切到更高价候选。
- 长期摘要参与追问但不制造硬约束。

## Demo 演示脚本

推荐 3-5 分钟演示顺序：

1. **基础推荐**
   - 输入：`推荐一款适合油皮的防晒霜`
   - 展示：流式回答、商品卡片、点击详情页。

2. **预算与反选**
   - 输入：`不要超过200`
   - 展示：后端硬过滤预算，卡片只显示预算内商品。

3. **多商品对比**
   - 输入：`第二款和第三款对比一下`
   - 展示：结构化对比卡和对应商品卡片。

4. **对比后维度追问**
   - 输入：`哪个更控油` 或 `哪款更清爽`
   - 展示：只在刚才比较过的商品中决策，不回到全部候选。

5. **跨需求记忆**
   - 输入：`想买一台办公用轻薄笔记本`
   - 输入：`1万预算`
   - 输入：`推荐一款适合油皮的防晒霜`
   - 输入：`刚才笔记本第三款呢`
   - 展示：同一会话多需求隔离与恢复。

6. **性能观测**
   - 重复问热门查询。
   - 展示 `/api/performance` 中的缓存命中统计。

## 推荐验证问题

- `推荐一款适合油皮的防晒霜`
- `不要超过200`
- `太便宜了`
- `第二款怎么样`
- `第二款和第三款对比一下`
- `哪个控油些`
- `哪款更清爽`
- `想买一台办公用轻薄笔记本`
- `1万预算`
- `刚才笔记本第三款呢`
- `推荐无糖饮料`
- `比较2和5`
- `哪个更健康`

## 文档入口

- [后端说明](server/README.md)
- [客户端说明](client/README.md)
- [API 文档](docs/api.md)
- [系统架构](docs/architecture.md)
- [Qdrant 配置](docs/qdrant.md)
- [Demo 验收清单](docs/demo-checklist.md)
- [项目进度](docs/progress.md)
- [项目背景与要求](docs/project-background-requirements.md)

## 提交与安全

以下内容不要提交到公开仓库：

- `server/.env`
- `client/local.properties`
- `qdrant_storage/`
- API Key、SDK 本地路径、个人账号或机器环境配置
