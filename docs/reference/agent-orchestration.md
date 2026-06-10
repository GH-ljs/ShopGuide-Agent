# Agent 编排说明

本文档整理 ShopGuide Agent 当前的整体 Agent 编排。它和 RAG 链路有较高重合度，但关注点不同：RAG 链路关注“如何检索并增强生成”，Agent 编排关注“如何把一次用户对话组织成可执行任务，并保证状态、边界、异常和展示一致”。

## 1. 和 RAG 链路的关系

两者关系可以这样理解：

```text
Agent 编排 = 对话状态 + 意图规划 + 边界控制 + RAG 检索 + 回答生成 + SSE 协议 + 客户端展示
RAG 链路   = Agent 编排中的“检索增强生成”核心子链路
```

所以它们重合度很高，但不完全一样。

RAG 文档重点回答：

```text
怎么从商品库找出可信候选，并让回答基于这些候选？
```

Agent 编排文档重点回答：

```text
用户发来一句话后，系统如何决定做什么、记住什么、何时检索、何时澄清、何时降级、如何把结果交给客户端？
```

## 2. 当前 Agent 角色

当前 Agent 是一个电商导购 Agent，不是通用聊天助手。

它的职责：

- 理解自然语言购物需求。
- 管理多轮上下文和多个购物需求。
- 从商品库中检索可信候选。
- 给出基于商品数据的推荐理由。
- 支持序号指代、商品名指代、对比决策和条件追加。
- 在边界外问题上明确说明能力范围。
- 把结构化商品卡片和对比卡交给客户端展示。

它不负责：

- 外卖/订餐服务。
- 天气、新闻、论文、代码等通用任务。
- 编造商品、价格、库存、优惠或功效。
- 真实购物车、支付和订单履约。

## 3. 编排主流程

```text
用户发送消息
  -> 客户端附带 deviceId / conversationId / history
  -> 后端恢复会话
  -> 热门查询缓存预判
  -> LLM Plan + Validator 解析本轮任务
  -> 分流：
       missing_context -> 提示缺少候选
       out_of_scope    -> 提示非导购边界
       multi_need      -> 提示拆开多个需求
       refer           -> 解析指代商品
       compare         -> 解析对比商品
       refine          -> 继承需求并追加条件
       new_search      -> 开始新需求
  -> 更新结构化记忆
  -> 检索或复用候选
  -> 生成回答
  -> 生成商品卡片 / 对比卡
  -> SSE 流式返回
  -> 客户端渲染并持久化历史
```

## 4. 规划层：LLM Plan + Validator

规划层位于 `server/src/services/intent.js`。

有模型 Key 时：

```text
规则产生 fallbackIntent
  -> LLM 根据当前消息、会话快照、上一轮商品和 fallback hint 输出 Plan
  -> Validator 合并和约束 Plan
```

Plan 包含：

- `turn_type`
- `is_shopping_guidance`
- `boundary_reason`
- `needs_clarification`
- `clarification_reason`
- `scope`
- `target_refs`
- `focus`
- `category`
- `item_type`
- `max_price / min_price`
- `negative_terms`
- `preferences`

Validator 负责：

- 防止 LLM 把 `refer / compare` 扩大到全库。
- 防止 LLM 生成不存在的类目和商品类型。
- 防止 LLM 凭空添加预算和排除词。
- 防止 LLM 漏判 `out_of_scope / multi_need / missing_context`。
- 防止序号指向不存在的候选。

## 5. 记忆层：多需求结构化状态

记忆层位于 `server/src/services/memory.js`。

当前会话保存：

- 最近对话 turns。
- 当前需求 state。
- 历史需求 needs。
- 当前候选 `lastProducts`。
- 指代参考 `referenceProducts`。
- 对比商品 `comparisonProducts`。
- 长期摘要 `summary`。

多需求不是互相覆盖，而是会暂停旧需求、创建新需求，并允许后续按品类或指代回到旧需求。

典型路径：

```text
想买办公轻薄笔记本
  -> 当前 active need = 笔记本
1万预算
  -> 更新笔记本 need
推荐防晒霜
  -> 暂停笔记本 need，新建防晒 need
刚才笔记本第三款呢
  -> 切回笔记本 need，解析第三款
```

## 6. 执行层：检索、回答和卡片

执行层主要在：

- `server/src/services/retriever.js`
- `server/src/services/answer.js`
- `server/src/http.js`

执行层不相信模型文本中的商品事实。可信商品来源只有商品库和检索结果。

```text
检索候选商品
  -> answerProducts
  -> 回答生成使用 answerProducts
  -> comparison 使用 answerProducts
  -> products 卡片使用 answerProducts
```

这样保证：

- 回答里提到的商品和卡片一致。
- 对比卡和商品卡片一致。
- 商品详情页和商品库一致。

## 7. 协议层：SSE 事件

协议层由 `/api/chat` 输出：

| 事件 | 用途 |
| --- | --- |
| `token` | AI 回复文本分片 |
| `meta` | 首 token、缓存、模型降级等辅助信息 |
| `comparison` | 结构化对比卡 |
| `products` | 商品卡片 |
| `done` | 本轮结束 |
| `error` | 结构化错误 |

客户端只按结构化事件渲染商品，不从文本里猜商品。

## 8. 异常与降级编排

当前异常策略：

- 输入非法：HTTP JSON 错误。
- 检索异常：SSE `error`。
- LLM 生成异常：本地规则回答兜底，并通过 `meta type=fallback` 提示。
- 客户端网络异常：本地显示错误气泡和重试按钮。
- 图片加载失败：显示“暂无图片”占位。

这让 Agent 不只在理想路径能跑，也能在 Demo 现场遇到服务波动时保持可解释。

## 9. 当前编排的取舍

当前设计偏保守：

- 商品事实交给后端和数据集。
- 语义理解尽量交给 LLM。
- 关键边界保留规则兜底。
- 对比、指代、预算等高风险链路优先保证卡片一致性。

这样做的好处是稳定、可测、适合比赛 Demo；代价是有些边界还需要规则补充，后续可以继续把更多边界判断前移到 LLM planner，再由 Validator 做最终验收。

