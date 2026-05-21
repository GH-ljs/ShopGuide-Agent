# ShopGuide Agent Server

这是多模态电商智能导购项目的 Node.js 后端 MVP。

## 当前能力

- 加载 `../ecommerce_agent_dataset` 下的商品 JSON。
- 使用轻量本地检索器搜索商品。
- 通过 SSE 流式返回导购回复。
- 返回结构化商品卡片。
- 没有模型 Key 时也可以离线运行。
- 配置 `ARK_API_KEY` 后，可以调用 Doubao/OpenAI-compatible 接口。

## 启动

```bash
cd server
node src/index.js
```

测试导购接口：

```bash
curl -N -X POST http://localhost:3001/api/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"推荐一款适合油皮的洗面奶\"}"
```

## API

### `GET /api/health`

返回服务状态和已加载商品数量。

### `GET /api/products`

返回简化商品列表。

### `POST /api/chat`

请求示例：

```json
{
  "message": "200元以下的蓝牙耳机有哪些？",
  "conversationId": "demo"
}
```

响应类型为 `text/event-stream`：

- `event: token`: 流式文本片段
- `event: products`: 商品卡片列表
- `event: done`: 完成标记

## 下一步

1. 将本地关键词检索替换为向量检索。
2. 增加多轮对话记忆。
3. 增加购物车相关 API。
4. 连接 Android 客户端，通过 SSE 展示流式回复。
