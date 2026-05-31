# 后端 API 文档

服务默认地址：

```text
http://localhost:3001
```

## 统一错误格式

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

当前错误码：

```text
INVALID_JSON
VALIDATION_ERROR
NOT_FOUND
RETRIEVAL_ERROR
MODEL_ERROR
INTERNAL_ERROR
```

错误码含义：

| 错误码 | 常见原因 | 客户端用户提示 |
| --- | --- | --- |
| `NETWORK_ERROR` | Android 客户端连不上后端，例如后端没启动、地址错误 | 无法连接后端服务，请确认服务已启动。 |
| `VALIDATION_ERROR` | 请求参数缺失，例如 `message` 为空 | 请输入你的购物需求。 |
| `RETRIEVAL_ERROR` | 商品检索失败，例如 Qdrant 未启动、Embedding/向量索引异常 | 商品检索暂时不可用，请稍后再试。 |
| `MODEL_ERROR` | 模型调用失败，例如 API Key、模型名、权限、余额或网络问题 | AI 生成暂时不可用，请稍后再试。 |
| `NOT_FOUND` | 商品或图片不存在 | 没有找到对应资源。 |
| `INVALID_JSON` | 请求体不是合法 JSON | 请求格式异常，请稍后再试。 |
| `INTERNAL_ERROR` | 未预期服务端异常 | 服务暂时不可用，请稍后再试。 |

说明：`NETWORK_ERROR` 是客户端本地归类，后端不会返回这个错误码，因为客户端连不上后端时收不到后端响应。

## GET /api/health

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
  "llmProvider": "deepseek",
  "llmModel": "deepseek-chat"
}
```

字段说明：

- `ok`: 服务是否正常。
- `productCount`: 已加载商品数量。
- `vectorStore`: 当前向量检索模式，例如 `local` 或 `qdrant`。
- `qdrantUrl`: Qdrant 地址。
- `qdrantCollection`: Qdrant collection 名称。
- `embeddingProvider`: 当前 embedding provider，例如 `local` 或 `ark`。
- `embeddingDimension`: 当前 embedding 向量维度。
- `modelEnabled`: 是否已配置聊天模型 API Key。
- `llmProvider`: 当前聊天模型 provider，例如 `ark` 或 `deepseek`。
- `llmModel`: 当前聊天模型名称或 endpoint id。

注意：`/api/health` 是开发排障接口，普通客户端 UI 不直接展示 Qdrant、Embedding、LLM 等内部组件状态。

## GET /api/products

返回简化商品列表，主要用于调试或客户端预览。

响应示例：

```json
[
  {
    "productId": "p_beauty_011",
    "title": "珊珂洗颜专科绵润泡沫洁面乳细腻丰富泡沫温和清洁洁面120g",
    "brand": "珊珂",
    "category": "美妆护肤",
    "price": 52,
    "imagePath": "D:\\code\\agent\\ShopGuide-Agent\\ecommerce_agent_dataset\\1_美妆护肤\\images\\p_beauty_011_live.jpg"
  }
]
```

## POST /api/chat

导购对话接口。响应类型是 `text/event-stream`。

请求示例：

```json
{
  "conversationId": "demo-user-1",
  "message": "推荐一款防晒霜"
}
```

字段说明：

- `conversationId`: 会话 ID。相同 ID 会复用内存会话记忆。
- `message`: 用户输入，不能为空。

## SSE 事件

### token

流式文本片段。

```text
event: token
data: {"content":"根据你的需求"}
```

### products

结构化商品卡片。

```text
event: products
data: {"products":[{"productId":"p_beauty_023","title":"...","brand":"理肤泉","category":"美妆护肤","subCategory":"防晒","price":268,"imagePath":"...","reason":"..."}]}
```

### done

本轮对话完成。

```text
event: done
data: {"ok":true,"conversationId":"demo-user-1"}
```

### error

本轮对话发生错误。

```text
event: error
data: {"error":{"code":"MODEL_ERROR","message":"模型服务暂时不可用","details":"..."}}
```

## POST /api/conversations/reset

重置指定会话的内存状态。客户端新建对话、用户点击“重新开始”或调试时可以调用。

请求示例：

```json
{
  "conversationId": "demo-user-1"
}
```

响应示例：

```json
{
  "ok": true,
  "conversationId": "demo-user-1",
  "session": {
    "conversationId": "demo-user-1",
    "state": {
      "category": "",
      "itemIntent": null,
      "maxPrice": null,
      "minPrice": null,
      "excludeTerms": [],
      "preferences": [],
      "lastProductIds": []
    },
    "turnCount": 0,
    "lastProductIds": []
  }
}
```

## POST /api/debug/retrieve

检索调试接口。用于查看 RAG 检索链路，不建议作为正式客户端用户功能展示。

请求示例：

```json
{
  "conversationId": "debug-1",
  "message": "推荐一款适合油皮的防晒霜",
  "limit": 4,
  "includeMemory": false
}
```

字段说明：

- `conversationId`: 会话 ID。
- `message`: 要调试的用户问题。
- `limit`: 返回商品数量，默认 4。
- `includeMemory`: 是否使用该会话已有记忆。调试单轮检索时建议传 `false`。

响应示例：

```json
{
  "ok": true,
  "conversationId": "debug-1",
  "includeMemory": false,
  "originalMessage": "推荐一款适合油皮的防晒霜",
  "retrievalQuery": "美妆护肤 防晒 油皮 推荐一款适合油皮的防晒霜",
  "retrieval": {
    "parsed": {
      "category": "美妆护肤",
      "itemIntent": "防晒",
      "maxPrice": null,
      "minPrice": null,
      "negativeTerms": []
    },
    "counts": {
      "totalProducts": 100,
      "categoryCandidates": 25,
      "filteredCandidates": 3,
      "vectorMatches": 3,
      "finalProducts": 3
    },
    "candidatePreview": [],
    "vectorMatches": [],
    "products": []
  }
}
```

## PowerShell 调试示例

```powershell
$body = @{
  conversationId = "demo-1"
  message = "推荐一款防晒霜"
} | ConvertTo-Json -Compress

$r = Invoke-WebRequest `
  -Uri "http://localhost:3001/api/chat" `
  -Method POST `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))

$r.Content | Set-Content -Encoding UTF8 response.txt
notepad response.txt
```

## curl.exe 调试示例

```powershell
curl.exe -N -X POST "http://localhost:3001/api/chat" `
  -H "Content-Type: application/json; charset=utf-8" `
  -d "{\"conversationId\":\"demo-1\",\"message\":\"推荐一款防晒霜\"}"
```
