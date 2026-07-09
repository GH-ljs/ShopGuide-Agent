# 代码导读

这份文档帮助你后续快速理解 ShopGuide Agent 的主链路。当前项目只把 `app/` 作为用户侧主前端，`server/` 作为 RAG 后端。

## 总览

```text
app/ 用户输入
  -> server /api/chat/once 或 /api/chat
  -> intent planner + validator
  -> memory 更新多轮状态
  -> clarify 主动追问或 retriever 检索
  -> answer 生成文本、商品卡、对比卡
  -> app 渲染聊天、追问、商品、购物车
```

## 前端关键文件

| 文件 | 职责 |
| --- | --- |
| `app/src/pages/chat/index.vue` | 聊天页 UI：会话抽屉、消息列表、追问卡片、商品卡片、收藏和购物车面板 |
| `app/src/composables/useChat.ts` | 聊天状态：会话管理、发送消息、停止生成、自动滚动、追问选项 |
| `app/src/api/shopguide.ts` | 后端 API 适配：H5 优先 SSE，小程序走稳定 JSON |
| `app/src/components/product/ProductCard.vue` | 商品卡片：详情、收藏、加入购物车、选择对比 |
| `app/src/components/comparison/ComparisonCard.vue` | 结构化对比卡 |
| `app/src/composables/useShopActions.ts` | 收藏、购物车和本地持久化 |
| `app/src/pages/product-detail/index.vue` | 商品详情、SKU 选择和加入购物车 |
| `app/src/pages/checkout/index.vue` | 模拟确认订单和提交 |

前端不要从模型自然语言里解析价格、商品名或图片。商品事实必须来自后端返回的 `products`、`comparison` 和详情接口。

## 后端关键文件

| 文件 | 职责 |
| --- | --- |
| `server/src/index.js` | 服务启动入口：读取配置、加载商品、创建向量索引、启动 Express |
| `server/src/http.js` | HTTP/SSE API：串起意图、记忆、检索、回答和结构化事件 |
| `server/src/config.js` | `.env` 和环境变量配置 |
| `server/src/data/loader.js` | 加载商品 JSON、图片路径和可检索文本 |
| `server/src/services/intent.js` | LLM Planner + Validator：把自然语言转成安全的结构化计划 |
| `server/src/services/memory.js` | 多轮会话记忆：支持“再便宜点”“第二款怎么样”这类省略追问 |
| `server/src/services/clarify.js` | 主动追问：根据候选商品差异生成追问卡片 |
| `server/src/services/retriever.js` | RAG 检索编排：类目/预算/排除词硬过滤 + 向量排序 |
| `server/src/services/answer.js` | 回答构造：本地兜底、模型 Prompt、商品卡、对比卡、详情字段 |
| `server/src/services/llm.js` | DeepSeek/Ark 风格接口适配和流式解析 |
| `server/src/vectordb/qdrant.js` | Qdrant collection、入库和向量搜索 |
| `server/src/vectordb/local.js` | 无外部依赖的本地检索兜底 |

## RAG 可信边界

后端把推荐拆成两层：

- 硬约束：类目、商品类型、预算、排除词、多需求边界，由后端规则和 Validator 保证。
- 软排序：场景、偏好、语义相似度，由向量召回和偏好加权决定。

这样做的目的，是让 LLM 可以灵活理解用户表达，但不能绕过商品库事实。即使模型失败，也会用同一组候选商品生成本地兜底回答。

## 主动追问

主动追问不是前端写死商品类别。流程是：

1. `intent.js` 让 LLM 判断宽泛需求是否值得追问，并给出可接受的 `clarify_dimensions`。
2. `clarify.js` 只在候选商品足够多、用户没有明确预算/偏好时触发。
3. 追问选项来自候选商品差异，例如服饰场景、饮料场景、护肤场景或价格区间。
4. 前端只展示后端返回的 `clarify`，用户点击后把原问题和选项拼成下一轮需求继续检索。

## 后端脚本说明

| 命令 | 用途 |
| --- | --- |
| `npm run qdrant:health` | 检查 Qdrant 服务和 collection 是否可用 |
| `npm run qdrant:ingest` | 把商品数据向量化并写入 Qdrant |
| `npm run qdrant:test` | 用示例问题验证 Qdrant 检索 |
| `npm run demo:retrieve` | 不启动 HTTP 服务，直接跑一组推荐检索自检 |
| `npm run eval:retrieval` | 用标注用例计算 Recall/Precision/HitRate/MRR |

这些脚本不是前端日常开发必须使用，但对排查“为什么没召回/为什么召回错”很有价值，所以保留。

## 修改建议

- 改聊天交互：先看 `useChat.ts`，再看 `chat/index.vue`。
- 改商品卡片：优先改 `ProductCard.vue` 和 `types/shopguide.ts`。
- 改推荐质量：先补测试，再改 `intent.js`、`memory.js`、`retriever.js` 或 `clarify.js`。
- 改 RAG 接入：先确认 `.env`、`config.js`、`vectordb/factory.js` 和 `qdrant.js`。
