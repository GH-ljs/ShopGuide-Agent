# 项目完成情况

本文档用于交付前快速说明当前项目状态。结论：项目已经满足最小可演示闭环，并完成了“对话智能与 RAG 增强”“工程质量与性能优化”中的多个加分点。

## 1. 总体结论

当前项目可以作为比赛 Demo 交付：

```text
Android 原生 App
  -> Node.js 后端 SSE
  -> 意图解析 / 结构化记忆
  -> 商品检索 / 过滤 / 排序
  -> LLM 或本地兜底回答
  -> 流式文本 + 商品卡片 + 结构化对比卡
```

项目核心边界已经建立：回答、卡片、对比结果和详情页都以商品库数据为准，不让模型自由编造商品、价格、库存、优惠或功效。

## 2. 后端完成情况

### 已完成

- **商品数据加载**：约 100 条商品，覆盖美妆护肤、数码电子、服饰运动、食品饮料 4 个类目。
- **RAG 检索链路**：支持本地向量检索和 Qdrant 向量数据库。
- **Embedding**：支持本地哈希向量和 Ark embedding；Qdrant collection 建议按 embedding 方案区分。
- **模型接入与降级**：支持 DeepSeek 和 Doubao/Ark 聊天模型；无 Key 或模型生成失败时，可用本地确定性回答兜底，并通过 `fallback` meta 提示客户端。
- **LLM Plan + Validator**：LLM 负责语义解析和边界规划，后端校验意图、范围、序号、预算、排除词和边界 fallback，避免模型越界。
- **SSE 流式接口**：`/api/chat` 返回 `token`、`meta`、`comparison`、`products`、`done`、`error`。
- **多轮记忆**：按 `deviceId + conversationId` 管理结构化会话状态，支持多需求隔离、旧需求恢复、序号指代和对比后追问。
- **会话持久化**：默认写入本地 SQLite，后端重启后可恢复会话；客户端 `history` 作为兜底。
- **商品图片与详情接口**：支持商品图片加载和详情页数据返回。
- **结构化对比卡**：对比结果以 `comparison` 事件返回，和商品卡片使用同一批 `productId`。
- **热门查询缓存**：只缓存不依赖上下文的新搜索，降低重复检索和模型调用成本。
- **调试与性能接口**：`/api/debug/retrieve`、`/api/performance`、`/api/health`。

### 未做或暂不做

- 购物车与下单闭环。
- 拍照找货。
- 真实账号登录与跨设备同步。
- 服务端用户画像和长期个性化推荐。

这些属于后续扩展，不影响当前比赛最小闭环和已完成加分项展示。

## 3. 客户端完成情况

### 已完成

- **Android 原生客户端**：Kotlin + Jetpack Compose + Material3。
- **聊天界面**：消息列表、输入框、发送状态、后端连接状态。
- **SSE 客户端**：解析后端 `token`、`meta`、`comparison`、`products`、`done`、`error`，并展示模型降级轻提示。
- **流式渲染**：AI 回复分片显示。
- **商品卡片**：横向商品卡片，展示图片、标题、品牌、价格和类目。
- **图片失败占位**：商品图片加载失败时显示固定占位，不让卡片出现空白或布局跳动。
- **商品详情页**：点击卡片进入详情，查看描述、SKU、FAQ、评价等证据。
- **多会话列表**：支持新建、切换、重命名、删除和批量管理。
- **本地历史持久化**：聊天记录保存在 `SharedPreferences`。
- **匿名设备身份**：客户端生成 `deviceId`，用于后端会话隔离和持久化。
- **结构化对比卡**：客户端渲染后端 `comparison` 事件。
- **自动滚动优化**：用户在底部时自动滚动；用户翻历史时不强行抢滚动。
- **虚拟列表滚动**：聊天消息使用 Compose `LazyColumn`，商品卡片使用 `LazyRow`，并通过稳定 key / contentType 优化长对话下的列表复用和滚动性能。

### 未做或暂不做

- 语音输入 / TTS。
- 拍照找货。
- 完整登录页。
- 复杂动效和商业级 UI 打磨。

## 4. 自动化测试覆盖

当前后端测试覆盖：

- `answer.test.js`：回答边界、Prompt、防幻觉、对比卡字段。
- `intent.test.js`：LLM Plan 归一化、Validator 约束、指代/比较意图、边界规划与兜底。
- `memory-eval.test.js`：多轮记忆、预算继承、跨需求恢复、对比后追问、数字指代。
- `retrieval-quality.test.js`：检索质量基线。
- `performance.test.js`：热门查询缓存和首 token 指标。
- `session-persistence.test.js`：`deviceId + conversationId` 会话隔离和持久化恢复。
- `fallback.test.js`：模型生成失败时自动降级为本地导购回答，并保留商品卡片和降级提示。
- `smoke.test.js`：后端端到端 smoke。

交付前建议至少运行：

```bash
cd server
npm run test:answer
node src/__tests__/memory-eval.test.js
npm run test:session
npm run test:fallback
npm run test:performance
npm run test:smoke
```

## 5. 加分点完成情况

### 4.3 对话智能与 RAG 增强

- 多轮上下文记忆：已完成。
- 反选与排除：已完成，覆盖预算、否定词、价格方向等典型问题。
- 多商品结构化对比：已完成，支持对比后继续追问。
- Agent 对复杂语义的处理：已通过 LLM Plan + 后端 Validator 组合实现。

### 4.4 工程质量与性能优化

- 热门查询缓存：已完成。
- 首 token 可观测指标：已完成，`meta` SSE 和 `/api/performance` 可查看。
- 模型不可用自动降级：已完成，LLM 失败时后端退回本地规则回答，客户端展示轻提示，主推荐链路不中断。
- 边界体验：已补充图片失败占位、缺少候选上下文提示、明显非购物问题拒答、多品类混合输入澄清、500 字输入上限和发送失败重试。
- 端侧体验打磨：已完成商品卡片、详情页、多会话、自动滚动、虚拟列表滚动和对比卡；骨架屏未保留，因为实际体验割裂。

## 6. 交付风险与注意事项

- `server/.env`、API Key、`server/.data/` 不要提交。
- 如果使用 Qdrant + Ark embedding，需要先启动 Qdrant 并执行 `npm run qdrant:ingest`。
- 切换 embedding 方案时，需要换 Qdrant collection 名称或清空旧 collection 后重新入库。
- Android 编译由用户在 Android Studio 中执行；协作中默认不运行 Gradle 编译命令。
