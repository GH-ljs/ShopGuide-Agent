# 评审模式：RAG 证据链

评审模式用于解释一次导购回答为什么可信。它面向评委、老师和开发者，不改变普通用户的聊天体验。

核心目标：

- 说明用户意图被解析成了哪些结构化条件。
- 展示后端执行了哪些硬过滤和检索排序。
- 证明回答文本、商品卡片和对比卡来自同一批商品候选。
- 明确系统不会编造商品库中不存在的价格、库存、优惠、销量和功效。

## 聊天流事件

`/api/chat` 现在会在 SSE 中额外返回 `review` 事件：

```text
event: review
data: {"review":{...}}
```

普通客户端可以忽略这个事件；如果 Android 后续要做“评审模式”开关，只需要在收到 `review` 后渲染其中的结构化字段。

## 调试接口

`/api/debug/retrieve` 会直接返回 `review` 字段，适合演示或截图。

示例请求：

```json
{
  "message": "推荐一款适合油皮的防晒霜，不要超过200",
  "includeMemory": false
}
```

示例字段：

```json
{
  "review": {
    "mode": "review",
    "intent": {
      "type": "new_search",
      "source": "rules",
      "scope": "full_catalog"
    },
    "filters": {
      "category": "美妆护肤",
      "itemType": "防晒",
      "maxPrice": 200,
      "negativeTerms": [],
      "preferences": ["油皮"]
    },
    "retrieval": {
      "scope": "full_catalog",
      "filteredCandidates": 1,
      "returned": 1,
      "finalSelection": []
    },
    "evidence": [
      {
        "index": 1,
        "productId": "p_beauty_006",
        "title": "巴黎欧莱雅新多重防护隔离露水感轻薄高倍防晒修护提亮30ml",
        "price": 170,
        "evidenceFields": ["title", "category", "subCategory", "marketingDescription", "officialFaq", "userReviews", "skus"],
        "matchedKeywords": ["防晒", "油皮"]
      }
    ],
    "safety": [
      "回答文本、商品卡片和对比卡只能使用本轮返回的 products 候选集合。",
      "商品名、价格、图片、类目和详情字段来自商品库结构化数据。",
      "没有商品库字段支持时，禁止编造库存、优惠券、销量、活动和未出现的功效。",
      "硬过滤由后端执行，LLM 只负责理解和表达，不能越过后端边界新增候选商品。"
    ]
  }
}
```

## 演示建议

推荐用这三类问题展示差异：

- 正常推荐：`推荐一款适合油皮的防晒霜，不要超过200`
- 边界拦截：`天气怎么样` 或 `给我点外卖`
- 多轮决策：先问 `推荐一款适合油皮的防晒霜`，再问 `第二款和第三款哪个更清爽`

第一类展示硬过滤和证据来源；第二类展示系统不会把非导购问题误写入商品记忆；第三类展示对比问题只在上下文候选中决策，不会回到全库乱搜。注意：`不要超过200` 会把油皮防晒候选缩到很少，预算过滤演示和第 2/3 款对比演示建议分成两条会话分支。
