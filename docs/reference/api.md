# 后端 API 文档

服务默认地址：

```text
http://localhost:3001
```

## 1. 统一错误格式

普通 JSON 接口错误返回：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "message 不能为空"
  }
}
```

SSE 流中的错误事件：

```text
event: error
data: {"error":{"code":"MODEL_ERROR","message":"模型服务暂时不可用","details":"..."}}
```

错误码：

| 错误码 | 常见原因 |
| --- | --- |
| `INVALID_JSON` | 请求体不是合法 JSON |
| `VALIDATION_ERROR` | 请求参数缺失，例如 `message` 为空 |
| `NOT_FOUND` | 商品或图片不存在 |
| `RETRIEVAL_ERROR` | 商品检索失败，例如 Qdrant 未启动、Embedding 异常 |
| `MODEL_ERROR` | 模型调用失败，例如 API Key、模型名、余额、权限或网络问题 |
| `INTERNAL_ERROR` | 未预期服务端异常 |

说明：`NETWORK_ERROR` 是前端本地归类，客户端连不上后端时收不到后端响应。

## 2. GET `/api/health`

健康检查接口。

响应示例：

```json
{
  "ok": true,
  "productCount": 100,
  "vectorStore": "qdrant",
  "qdrantUrl": "http://localhost:6333",
  "qdrantCollection": "shopguide_products_ark",
  "embeddingProvider": "ark",
  "embeddingDimension": 1024,
  "modelEnabled": true,
  "llmProvider": "ark",
  "llmModel": "ep-xxx",
  "hotQueryCache": {
    "size": 2,
    "hits": 1,
    "misses": 3,
    "writes": 2,
    "ttlMs": 1800000
  },
  "sessionPersistence": {
    "type": "sqlite",
    "path": "D:\\code\\agent\\ShopGuide-Agent\\server\\.data\\shopguide_sessions.db"
  }
}
```

## 3. GET `/api/performance`

查看热门查询缓存统计。

```json
{
  "ok": true,
  "hotQueryCache": {
    "enabled": true,
    "size": 2,
    "hits": 1,
    "misses": 3,
    "writes": 2,
    "ttlMs": 1800000
  }
}
```

缓存只用于不依赖上下文的新搜索，不用于“第二款怎么样”“比较2和3”等多轮追问。

## 4. GET `/api/products`

返回简化商品卡片列表，主要用于调试或预览。

```json
[
  {
    "productId": "p_beauty_011",
    "title": "珊珂洗颜专科绵润泡沫洁面乳细腻丰富泡沫温和清洁洁面120g",
    "brand": "珊珂",
    "category": "美妆护肤",
    "subCategory": "洁面",
    "price": 52,
    "imageUrl": "/api/products/p_beauty_011/image",
    "reason": "..."
  }
]
```

## 5. GET `/api/products/:productId`

返回商品详情页数据，包括描述、SKU、FAQ、用户评价和图片地址。

## 6. GET `/api/products/:productId/image`

返回商品图片文件。

## 7. POST `/api/chat`

导购对话接口。响应类型是 `text/event-stream`。

请求示例：

```json
{
  "deviceId": "demo-device",
  "conversationId": "demo-user-1",
  "message": "推荐一款防晒霜",
  "limit": 6,
  "history": []
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `deviceId` | 匿名设备 ID，用于后端会话隔离和持久化。旧客户端不传时默认为 `anonymous` |
| `conversationId` | 会话 ID，和 `deviceId` 组合后定位一段会话记忆 |
| `message` | 用户本轮输入，不能为空 |
| `limit` | 最多返回多少个商品卡片，服务端仍有上限保护 |
| `history` | 客户端最近历史，用于数据库不可用或旧数据缺失时兜底恢复上下文 |

### SSE 事件

#### `token`

流式文本片段。

```text
event: token
data: {"content":"根据你的需求"}
```

#### `meta`

调试信息，客户端可以忽略。当前主要用于缓存命中、首 token 统计和模型降级提示。

```text
event: meta
data: {"type":"first_token","firstTokenMs":214,"cacheHit":false}
```

当模型生成失败但检索链路可用时，后端会降级为本地导购规则回答，并额外发送：

```text
event: meta
data: {"type":"fallback","fallback":true,"reason":"MODEL_ERROR","message":"当前 AI 生成服务暂时不可用，已使用本地导购规则完成推荐。"}
```

#### `comparison`

结构化商品对比卡。只有对比/决策类问题会返回。

```json
{
  "comparison": {
    "title": "商品对比",
    "conclusion": "明确结论：更推荐第 1 款 ...",
    "recommendedProductId": "p_food_014",
    "columns": [
      {
        "productId": "p_food_014",
        "label": "第 1 款",
        "title": "农夫山泉 东方树叶 无糖茉莉花茶饮料...",
        "brand": "农夫山泉"
      }
    ],
    "rows": [
      {
        "label": "价格",
        "values": [
          { "productId": "p_food_014", "value": "75 元" }
        ]
      }
    ]
  }
}
```

#### `products`

结构化商品卡片。

```text
event: products
data: {"products":[{"productId":"p_beauty_023","title":"...","brand":"理肤泉","category":"美妆护肤","subCategory":"防晒","price":268,"imageUrl":"/api/products/p_beauty_023/image","reason":"..."}]}
```

#### `done`

本轮完成。

```text
event: done
data: {"ok":true,"conversationId":"demo-user-1","deviceId":"demo-device","fallback":false,"fallbackReason":"","fallbackMessage":""}
```

#### `error`

本轮发生错误。

```text
event: error
data: {"error":{"code":"MODEL_ERROR","message":"AI 生成暂时不可用","details":"..."}}
```

## 8. POST `/api/conversations/reset`

重置指定 `deviceId + conversationId` 的后端会话记忆。

请求示例：

```json
{
  "deviceId": "demo-device",
  "conversationId": "demo-user-1"
}
```

响应示例：

```json
{
  "ok": true,
  "deviceId": "demo-device",
  "conversationId": "demo-user-1",
  "session": {
    "deviceId": "demo-device",
    "conversationId": "demo-user-1",
    "turnCount": 0,
    "lastProductIds": [],
    "referenceProductIds": [],
    "comparisonProductIds": []
  }
}
```

## 9. POST `/api/debug/retrieve`

检索调试接口，用于查看意图、会话状态、过滤范围和最终候选。不建议作为正式用户功能展示。

请求示例：

```json
{
  "deviceId": "demo-device",
  "conversationId": "debug-1",
  "message": "比较2和3",
  "limit": 4,
  "includeMemory": true
}
```

响应中包含：

- `turnIntent`：本轮意图和解析结果。
- `retrievalScope`：检索范围，例如 `full_catalog`、`last_products`、`comparison_candidates`。
- `session`：当前会话记忆快照。
- `retrievalQuery`：实际用于语义检索的 query。
- `retrieval.products`：本轮候选商品卡片。

## 10. PowerShell 调试示例

```powershell
$body = @{
  deviceId = "demo-device"
  conversationId = "demo-1"
  message = "推荐一款防晒霜"
  limit = 6
} | ConvertTo-Json -Compress

$r = Invoke-WebRequest `
  -Uri "http://localhost:3001/api/chat" `
  -Method POST `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))

$r.Content | Set-Content -Encoding UTF8 response.txt
notepad response.txt
```

## 11. curl.exe 调试示例

```powershell
curl.exe -N -X POST "http://localhost:3001/api/chat" `
  -H "Content-Type: application/json; charset=utf-8" `
  -d "{\"deviceId\":\"demo-device\",\"conversationId\":\"demo-1\",\"message\":\"推荐一款防晒霜\",\"limit\":6}"
```
