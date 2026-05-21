# ShopGuide Agent Server

Node.js backend MVP for the multimodal ecommerce shopping-guide agent.

## What Works Now

- Loads the product JSON files in `../ecommerce_agent_dataset`
- Searches products with a lightweight local retriever
- Streams chat responses through SSE
- Returns structured product cards
- Can run offline without a model key
- Can call the Doubao/OpenAI-compatible API when `ARK_API_KEY` is configured

## Run

```bash
cd server
node src/index.js
```

If Node is not in your global PATH, use the bundled runtime shown by Codex:

```bash
"C:\Users\pc\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" src/index.js
```

Then test:

```bash
curl -N -X POST http://localhost:3001/api/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"推荐一款适合油皮的洗面奶\"}"
```

## API

### `GET /api/health`

Returns service status and loaded product count.

### `GET /api/products`

Returns a compact product list.

### `POST /api/chat`

Request:

```json
{
  "message": "200元以下的蓝牙耳机有哪些？",
  "conversationId": "demo"
}
```

Response is `text/event-stream`:

- `event: token`: streamed answer text
- `event: products`: product cards
- `event: done`: completed marker

## Next Steps

1. Replace local retriever with vector search.
2. Add conversation memory.
3. Add cart APIs.
4. Connect Android client via SSE.
