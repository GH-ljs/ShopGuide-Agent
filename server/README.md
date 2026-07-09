# ShopGuide Agent Server

这是 ShopGuide Agent 的 Node.js 后端。它负责把用户的自然语言购物需求转成可执行的导购链路：加载商品数据、解析意图、维护多轮记忆、做 RAG 检索、调用模型或本地兜底回答，并把文本、商品卡片、追问卡片和对比卡返回给跨端前端。

后端最重要的原则：商品事实以数据集 JSON 为准，模型只负责理解和表达，不能编造不存在的商品、价格、库存、优惠、销量或功效。

## 快速启动

```powershell
cd server
npm install
copy .env.example .env
npm run dev
```

健康检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3001/api/health
```

仓库根目录也提供一键启动：

```powershell
.\scripts\start-all.ps1
```

## 关键配置

配置入口是 `server/.env`。真实 API Key 只写本地 `.env`，不要提交。

常用配置：

```env
PORT=3001
DATASET_DIR=../ecommerce_agent_dataset
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products_ark
EMBEDDING_PROVIDER=ark
EMBEDDING_DIMENSION=1024
LLM_PROVIDER=deepseek
DEEPSEEK_MODEL=deepseek-chat
```

## 主链路

```text
/api/chat 或 /api/chat/once
  -> parseTurnIntent: LLM Planner + Validator
  -> memory: 更新多轮需求、候选、指代关系
  -> clarify: 宽泛需求先生成主动追问
  -> retriever: 类目/预算/排除词硬过滤 + 向量排序
  -> answer: 生成文本、商品卡、对比卡和详情字段
  -> http: 返回 SSE 事件或 JSON
```

`/api/chat` 面向 H5 流式体验，返回 SSE 事件；`/api/chat/once` 面向 H5/小程序稳定闭环，返回一次性 JSON。

## 后端脚本

| 命令 | 用途 |
| --- | --- |
| `npm run qdrant:health` | 检查 Qdrant 服务和 collection |
| `npm run qdrant:ingest` | 把商品向量写入 Qdrant |
| `npm run qdrant:test` | 用示例问题验证 Qdrant 检索 |
| `npm run demo:retrieve` | 不启动 HTTP，直接跑检索自检 |
| `npm run eval:retrieval` | 用标注用例计算检索指标 |

这些脚本保留是为了排查 RAG 质量，不是每天都要跑。

## 测试

```powershell
npm run test:clarify
npm run test:answer
npm run test:session
npm run test:smoke
```

更细的测试：

```powershell
npm run test:retrieval-quality
npm run test:embedding
npm run test:performance
npm run test:fallback
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/http.js` | Express API、SSE、JSON 问答、调试接口 |
| `src/services/intent.js` | LLM Planner + Validator |
| `src/services/memory.js` | 多轮会话记忆和指代解析 |
| `src/services/clarify.js` | 主动追问卡片生成 |
| `src/services/retriever.js` | RAG 检索编排 |
| `src/services/answer.js` | 回答、商品卡、对比卡构造 |
| `src/vectordb/qdrant.js` | Qdrant 适配 |
| `src/vectordb/local.js` | 本地检索兜底 |

更多阅读见 [../docs/code-walkthrough.md](../docs/code-walkthrough.md)。
