# 当前 RAG 链路说明

本文档整理 ShopGuide Agent 当前的 RAG 链路。这里的 RAG 指的是：在生成回答前，从可信商品库中检索候选商品，并让回答、商品卡片、对比卡都基于同一批结构化商品数据。

## 1. 总览

`POST /api/chat` 是主入口，核心编排位于 `server/src/http.js`。

```text
客户端发送 message / deviceId / conversationId / history
  -> 后端校验输入
  -> 恢复会话记忆
  -> 热门查询缓存预判
  -> LLM Plan + Validator 解析意图
  -> 边界意图直接说明
  -> 更新结构化需求状态
  -> 构造检索 query
  -> 检索、过滤、排序商品
  -> LLM 或本地规则生成回答
  -> 输出 comparison / products / done
```

## 2. 输入与会话恢复

后端首先读取：

- `message`：用户本轮输入，最长 500 字。
- `deviceId`：客户端本地生成的匿名设备 ID。
- `conversationId`：客户端当前会话 ID。
- `history`：客户端最近历史，用于后端重启或内存缺失时兜底恢复。
- `limit`：本轮希望返回的商品卡片数量，后端仍有上限。

会话状态来自三层：

```text
内存 session
  -> SQLite / JSON 持久化快照
  -> 客户端 history 兜底恢复
```

## 3. 意图解析

意图解析由 `server/src/services/intent.js` 负责。

当前支持的 `turn_type`：

| 类型 | 含义 |
| --- | --- |
| `new_search` | 新商品需求 |
| `refine` | 在当前需求上追加预算、偏好或排除条件 |
| `refer` | 指向上一轮某个商品 |
| `compare` | 对比候选商品 |
| `missing_context` | 没有候选时的指代追问 |
| `out_of_scope` | 非商品导购问题 |
| `multi_need` | 同一句话包含多个商品品类 |

有 LLM Key 时，LLM 输出结构化 Plan，例如：

```json
{
  "turn_type": "compare",
  "is_shopping_guidance": true,
  "scope": "last_compared_products",
  "target_refs": [2, 3],
  "focus": ["健康", "甜度"],
  "max_price": null,
  "negative_terms": [],
  "preferences": ["健康"]
}
```

后端 Validator 会校验：

- `turn_type` 是否允许。
- `scope` 是否越界。
- `target_refs` 是否真实指向当前候选。
- 预算和排除词是否来自用户原话。
- `refer / compare` 是否被 LLM 错误扩大到全库。
- 边界类意图是否被 LLM 漏判。

## 4. 检索范围选择

不同意图对应不同检索范围：

| 意图 | 检索范围 |
| --- | --- |
| `new_search` | 全商品库 |
| `refine` | 全商品库，但继承当前结构化需求 |
| `refer` | 上一轮候选或点名商品 |
| `compare` | 被点名的候选商品 |
| `missing_context` | 不检索 |
| `out_of_scope` | 不检索 |
| `multi_need` | 不检索 |

这样可以同时解决两个问题：

- “不要超过 200”这类条件追加，可以从全库补找更合适商品。
- “第二款怎么样”“2 和 3 比较”这类追问，不会突然跳到新商品。

## 5. 检索与过滤

检索由 `server/src/services/retriever.js` 执行。

核心步骤：

```text
候选商品池
  -> 类目 / 商品类型过滤
  -> 预算、排除词等硬约束过滤
  -> 向量相似度召回
  -> 偏好词、场景词、商品字段加权排序
  -> 返回最终候选
```

当前支持两种向量检索方案：

- `VECTOR_STORE=local`：本地轻量向量检索，适合开发和兜底。
- `VECTOR_STORE=qdrant`：Qdrant 向量数据库，适合展示标准 RAG 工程链路。

Embedding 支持：

- `EMBEDDING_PROVIDER=local`
- `EMBEDDING_PROVIDER=ark`

Qdrant collection 需要和 embedding 维度匹配，例如：

```text
shopguide_products_local -> local embedding / 384 维
shopguide_products_ark   -> Ark embedding / 1024 维
```

## 6. 回答生成

检索完成后，系统得到 `answerProducts`。后续所有展示都基于这同一批商品。

生成方式有两种：

| 方式 | 使用场景 |
| --- | --- |
| `streamModelAnswer` | 有 LLM Key，且当前问题适合模型生成 |
| `buildLocalAnswer` | 无 Key、模型失败、价格/指代/对比等需要确定性的场景 |

模型生成失败时，后端会：

```text
发送 meta type=fallback
  -> 使用同一批 answerProducts 生成本地回答
  -> 继续返回 products / done
```

这保证模型服务短暂异常时，Demo 不会中断。

## 7. SSE 输出

聊天接口使用 SSE：

```text
token       -> 流式文本
meta        -> 首 token、缓存命中、模型降级等调试信息
comparison  -> 结构化对比卡
products    -> 商品卡片
done        -> 本轮完成
error       -> 结构化错误
```

关键约束：

- 商品卡片只来自 `products` 事件。
- 对比卡只来自 `comparison` 事件。
- 不能从模型自然语言文本中反向解析商品、价格或图片。
- 文本回答、商品卡片、详情页都必须基于商品库数据。

## 8. 缓存位置

热门查询缓存位于后端内存中，由 `server/src/services/hotCache.js` 管理。

只缓存不依赖上下文的新搜索，例如：

```text
推荐一款适合油皮的防晒霜
推荐无糖饮料
```

不缓存多轮指代和上下文问题，例如：

```text
第二款怎么样
2和3比较
哪款不那么甜
```

这是为了避免把某个会话里的上下文结果复用到另一个会话。

