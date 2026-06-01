# RAG 检索评测说明

本文档说明 ShopGuide Agent 当前如何评测 RAG 检索效果，以及为什么建议默认只把 4 条商品候选交给 LLM。

## 1. 为什么要做 RAG 检索评测

导购 Agent 的回答必须基于商品库真实数据。RAG 链路如果检索结果不准，后面的 LLM 即使表达流畅，也可能围绕错误商品生成推荐理由。

因此评测重点不是“模型说得好不好听”，而是先验证：

- 用户问题能否解析到正确类目和商品类型。
- 相关商品能否排到靠前位置。
- 返回给 LLM 的候选商品是否足够干净。
- 预算、排除词、品类边界是否会被错误放宽。

当前项目保留两类检查：

- `test:retrieval-quality`：回归测试，主要防止类目、预算、排除词、商品类型等硬边界跑偏。
- `eval:retrieval`：量化评测，基于人工标注的相关商品集合计算 Recall@K、Precision@K、HitRate@K、MRR@K。

## 2. 评测入口

评测样本文件：

```text
server/src/eval/retrieval-cases.json
```

评测脚本：

```text
server/src/scripts/eval-retrieval.js
```

运行命令：

```bash
cd server
npm run eval:retrieval
```

如果本地 `npm` 不在 PATH 中，也可以直接用 Node 执行：

```bash
node src/scripts/eval-retrieval.js
```

## 3. 当前评测集

当前评测集包含 20 组典型导购问题，覆盖：

- 美妆护肤：防晒、洁面、唇釉、面霜、精华、蜜粉。
- 数码电子：耳机、手机、平板、笔记本。
- 服饰运动：跑鞋、背包、徒步鞋、速干短袖。
- 食品饮料：无糖饮料、咖啡、功能饮料、牛奶、方便面。

每个评测样本包含：

```json
{
  "id": "用例 ID",
  "query": "用户问题",
  "relevantProductIds": ["人工标注的相关商品 ID"],
  "notes": "这个用例考察什么"
}
```

这些 `relevantProductIds` 是人工根据商品库 JSON 标注的“应该被召回”的商品。评测脚本会把系统实际返回的前 K 个商品和这些标注结果做对比。

## 4. 指标含义

### Recall@K

前 K 个结果里，召回了多少人工标注的相关商品。

例如相关商品有 4 个，前 4 个结果命中 3 个：

```text
Recall@4 = 3 / 4 = 0.75
```

它衡量“该找回来的商品找回来多少”。

### Precision@K

前 K 个结果里，有多少是真的相关。

例如前 4 个结果里有 3 个相关、1 个不相关：

```text
Precision@4 = 3 / 4 = 0.75
```

它衡量“返回给 LLM 的候选有多干净”。

### HitRate@K

前 K 个结果里只要有至少 1 个相关商品，就算命中。

它适合观察用户第一屏是否至少能看到靠谱商品。

### MRR@K

第一个相关结果排得越靠前，分数越高。

如果第 1 个就是相关商品：

```text
MRR = 1.0
```

如果第 2 个才是相关商品：

```text
MRR = 0.5
```

## 5. 当前评测结果

20 组样本下，当前结果如下：

```text
@1 Recall=0.431 Precision=1.000 HitRate=1.000 MRR=1.000
@3 Recall=0.844 Precision=0.800 HitRate=1.000 MRR=1.000
@4 Recall=0.924 Precision=0.688 HitRate=1.000 MRR=1.000
@5 Recall=0.959 Precision=0.590 HitRate=1.000 MRR=1.000
@6 Recall=0.985 Precision=0.517 HitRate=1.000 MRR=1.000
@8 Recall=0.992 Precision=0.394 HitRate=1.000 MRR=1.000
```

可以读成：

- Top1 很稳定：每个问题的第一条结果都是相关商品。
- Top3 已经能召回大多数相关商品。
- Top4 是一个比较好的平衡点，召回率已经到 0.924，同时 Precision 仍有 0.688。
- Top6 的召回率更高，但 Precision 下降明显，说明候选里混入更多边缘相关商品。
- Top8 对召回提升很小，但噪声继续增加。

## 6. 为什么建议默认给 LLM 4 条

Android 客户端曾设置：

```kotlin
const val CHAT_PRODUCT_LIMIT = 6
```

后端默认值是：

```js
const DEFAULT_CHAT_PRODUCT_LIMIT = 4;
const MAX_CHAT_PRODUCT_LIMIT = 8;
```

结合评测结果，默认 4 条更适合作为导购问答的常规配置：

- 从 3 条增加到 4 条，Recall 从 0.844 提升到 0.924，收益明显。
- 从 4 条增加到 6 条，Recall 只从 0.924 提升到 0.985，但 Precision 从 0.688 降到 0.517。
- 给 LLM 的候选越多，越容易让回答变散，甚至把边缘商品写成重点推荐。
- 手机端默认展示 6 张卡片也会增加阅读负担。
- 导购场景更需要“少而准”的精选候选，而不是一次展示过多备选。

因此建议：

```text
默认推荐：4 条
用户明确说“多推荐几款 / 多给几个选择”：6 条
对比场景：只给用户点名的 2-3 条
```

## 7. 后续优化方向

后续可以继续增强评测：

- 把评测集扩展到 50 组以上。
- 按品类分别统计指标，例如美妆、数码、服饰、食品各自的 Recall@4。
- 增加预算、否定条件、多轮追问、对比问题的专项评测。
- 对比 local 检索和 Qdrant / 真实 embedding 的效果差异。
- 增加生成侧评测，检查 LLM 是否只基于候选商品回答，是否编造价格、库存、优惠或功效。
