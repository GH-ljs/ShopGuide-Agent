# Demo 验收清单

这份清单用于比赛展示前快速确认项目是否能稳定演示。建议按顺序检查：后端服务、向量库、RAG 检索、真实对话、Android 客户端。

## 1. 启动前检查

### Qdrant

如果使用 Qdrant，先在项目根目录启动：

```powershell
docker compose up -d qdrant
```

确认服务可访问：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:6333/collections
```

期望看到 `shopguide_products` 或 `shopguide_products_ark` collection。

### 后端环境

进入后端目录：

```powershell
cd D:\code\agent\ShopGuide-Agent\server
```

常用配置组合：

```env
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products_ark
EMBEDDING_PROVIDER=ark
EMBEDDING_DIMENSION=1024
ARK_EMBEDDING_API_KEY=你的 Ark embedding Key
ARK_EMBEDDING_MODEL=doubao-embedding-vision-250615

LLM_PROVIDER=ark
ARK_API_KEY=你的 Ark 聊天模型 Key
ARK_MODEL=你的 Ark 聊天模型 endpoint id

HOT_QUERY_CACHE_ENABLED=true
SESSION_PERSISTENCE_ENABLED=true
```

注意：真实 API Key 只放在本地 `.env`，不要提交到 GitHub。

### 启动后端

```powershell
npm run dev
```

期望看到：

```text
ShopGuide Agent server listening on http://localhost:3001
Loaded 100 products ...
Vector store: qdrant
Model streaming: enabled
```

## 2. 后端自动验收

在 `server` 目录运行：

```powershell
npm run test:answer
npm run test:session
npm run test:performance
npm run test:retrieval-quality
npm run test:smoke
node src/__tests__/memory-eval.test.js
```

期望结果：

```text
Answer tests passed.
Session persistence tests passed.
Performance tests passed.
Retrieval quality baseline passed.
Smoke tests passed.
Memory eval passed: 16/16.
```

如果只想快速查看 Demo 问题的检索效果：

```powershell
npm run demo:retrieve
```

## 3. Demo 问题集

以下问题适合用于比赛演示，也适合用 `/api/debug/retrieve` 排查推荐效果。

| 问题 | 期望重点 |
| --- | --- |
| 推荐一款适合油皮的防晒霜 | 应识别美妆护肤/防晒，优先清爽控油相关商品 |
| 推荐防晒霜，但不要含酒精 | 当前库内无满足条件商品时，应明确说没有合适商品 |
| 送女生的口红 | 应识别口红为唇妆/唇釉，不应跑到服饰或食品 |
| 想买一台办公用轻薄笔记本 | 应识别数码电子/笔记本电脑 |
| 推荐无糖饮料 | 应优先无糖、0糖、低糖饮料 |
| 比较2和3 | 应只比较被点名的两个候选，并展示结构化对比卡 |
| 农夫山泉这款好像还行 | 应识别商品名指代，只解释这一款 |
| 哪款不那么甜 | 应继续在刚才对比的两款里决策，不回到第一轮全部候选 |
| 推荐通勤背包 | 应识别服饰运动/背包 |
| 推荐一款手机，拍照好一点 | 应识别数码电子/手机，并优先影像相关商品 |
| 推荐适合户外的鞋 | 应识别服饰运动/鞋，优先徒步鞋或户外相关商品 |

## 4. 真实聊天接口验收

使用 PowerShell 请求 `/api/chat`：

```powershell
$body = @{
  deviceId = "demo-device"
  conversationId = "demo-check"
  message = "推荐一款适合油皮的防晒霜"
  limit = 6
} | ConvertTo-Json -Compress

$r = Invoke-WebRequest `
  -UseBasicParsing `
  -Uri "http://localhost:3001/api/chat" `
  -Method POST `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))

$r.Content | Set-Content -Encoding UTF8 response.txt
notepad response.txt
```

期望 SSE 中包含：

```text
event: token
event: meta
event: products
event: done
```

检查重点：

- 回答是中文。
- 推荐理由能对应商品卡片。
- 商品价格、标题、类目不编造。
- 无结果场景不会硬推荐商品。
- 对比问题应包含 `comparison` 事件，且对比列和商品卡片数量一致。

## 5. Android 客户端验收

启动 Android Studio，运行 `client` 项目。

检查重点：

- 顶部显示后端已连接。
- 输入 Demo 问题后能看到流式回复。
- 回复下方出现横向滑动商品卡片。
- 点击商品卡片能进入详情页。
- 详情页能返回聊天页。
- 对比问题能看到结构化对比卡。
- 切换会话后历史消息仍在。
- 无结果问题不会展示错误商品卡片。

## 6. 常见问题

### Android 显示请求失败

先确认后端是否启动在：

```text
http://localhost:3001
```

Android 模拟器访问宿主机需要使用：

```text
http://10.0.2.2:3001
```

### Qdrant 连接失败

检查 Docker Desktop 是否正在运行，然后执行：

```powershell
docker compose up -d qdrant
npm run qdrant:health
```

### 模型服务不可用

如果 `/api/chat` 返回模型错误，先用本地兜底验证链路：

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
```

没有模型 Key 时，后端仍可用本地回答验证 SSE 和商品卡片闭环。

### 会话记忆看起来不对

如果刚修改了 memory 或对比逻辑，建议先重置测试会话：

```powershell
Invoke-WebRequest `
  -UseBasicParsing `
  -Uri "http://localhost:3001/api/conversations/reset" `
  -Method POST `
  -ContentType "application/json; charset=utf-8" `
  -Body '{"deviceId":"demo-device","conversationId":"demo-check"}'
```

如果使用持久化，会话快照会写入 `server/.data/shopguide_sessions.db`。这是运行产物，不要提交。
