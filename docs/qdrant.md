# Qdrant 本地配置

Qdrant 是向量数据库，用来保存商品文本的 embedding 向量，并支持相似度检索。

当前项目有两层可切换机制：

```text
VECTOR_STORE        决定用不用 Qdrant 向量数据库
EMBEDDING_PROVIDER  决定向量由本地哈希生成，还是由 Doubao/Ark embedding 模型生成
```

默认 `VECTOR_STORE=local` 时，不使用 Qdrant，也不调用 embedding 模型，整个检索都在 Node.js 内存里完成。

## 1. 安装 Docker Desktop

Windows 上建议安装 Docker Desktop。

安装完成后，在 PowerShell 验证：

```powershell
docker --version
docker compose version
```

如果提示找不到 `docker`，说明 Docker Desktop 还没有安装、没有启动，或命令没有加入 PATH。

## 2. 启动 Qdrant

在项目根目录执行：

```powershell
cd D:\code\agent\ShopGuide-Agent
docker compose up -d qdrant
```

启动后 Qdrant HTTP API 地址是：

```text
http://localhost:6333
```

Web Dashboard 通常可以访问：

```text
http://localhost:6333/dashboard
```

## 3. 检查 Qdrant 是否可访问

```powershell
cd D:\code\agent\ShopGuide-Agent\server
node src/qdrant.health.js
```

或者：

```powershell
npm run qdrant:health
```

成功时会看到：

```text
Qdrant is reachable: http://localhost:6333
Collections: (empty)
```

## 4. 三种运行模式

复制环境变量模板：

```powershell
cd D:\code\agent\ShopGuide-Agent\server
copy .env.example .env
```

### 模式一：纯本地检索

适合刚启动项目、没有 Docker、没有模型 Key 的情况。

```text
VECTOR_STORE=local
```

这个模式不需要 Qdrant，也不需要 `ARK_API_KEY`。它使用 `server/src/vectorStore.js` 里的本地词频向量检索。

### 模式二：Qdrant + 本地 embedding

适合验证“商品向量写入 Qdrant -> Qdrant 检索召回”的工程链路。

```text
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=384
```

这个模式需要启动 Qdrant，但不需要模型 Key。向量由 `server/src/embedding.js` 里的本地哈希 embedding 生成。

### 模式三：Qdrant + Doubao/Ark embedding

适合正式验证 RAG 语义检索效果。你已经开启了 `doubao-embedding-vision` 服务，就用这个模式。

```text
VECTOR_STORE=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=shopguide_products_ark
EMBEDDING_PROVIDER=ark
EMBEDDING_DIMENSION=1024
ARK_EMBEDDING_MODEL=你的 doubao-embedding-vision endpoint id
ARK_EMBEDDING_PATH=/embeddings/multimodal
ARK_API_KEY=你的火山方舟 API Key
```

这个模式既需要启动 Qdrant，也需要可用的 `ARK_API_KEY` 和 embedding endpoint id。

不要把模式二和模式三写进同一个 collection。建议：

```text
shopguide_products      用于本地哈希 embedding，384 维
shopguide_products_ark  用于 Doubao/Ark embedding，1024 维
```

原因是不同 embedding 模型生成的向量不在同一个语义空间里，混用会导致检索结果失真。Qdrant collection 的向量维度也必须和当前 `EMBEDDING_DIMENSION` 一致。

## 5. 写入商品向量

每次修改下面这些配置后，都应该重新执行入库脚本：

```text
QDRANT_COLLECTION
EMBEDDING_PROVIDER
EMBEDDING_DIMENSION
ARK_EMBEDDING_MODEL
```

```powershell
cd D:\code\agent\ShopGuide-Agent\server
node src/qdrant.ingest.js
```

或者：

```powershell
npm run qdrant:ingest
```

成功时会看到：

```text
Qdrant ingest completed. Upserted 100 products.
```

当前项目支持两种 embedding：

- `EMBEDDING_PROVIDER=local`: 零依赖哈希 embedding，用于离线开发和链路验证。
- `EMBEDDING_PROVIDER=ark`: 调用 Doubao/Ark embedding API，适合正式 RAG 检索。

切换 embedding 模型或维度后，不要复用旧 collection。因为不同模型产生的向量不在同一个语义空间里，混用会导致检索结果失真。

可以先验证 embedding 是否能生成向量：

```powershell
cd D:\code\agent\ShopGuide-Agent\server
node src/embedding.test.js
```

如果这里报：

```text
Ark embedding response does not contain embedding
```

优先检查两件事：

- `ARK_EMBEDDING_MODEL` 是否应该填模型名 `doubao-embedding-vision-250615`，还是控制台里的 `ep-...` endpoint id。
- `ARK_EMBEDDING_PATH` 是否和你当前文档/API Explorer 的接口路径一致，当前项目默认是 `/embeddings/multimodal`。

## 6. 验证 Qdrant 检索

```powershell
cd D:\code\agent\ShopGuide-Agent\server
node src/qdrant.search.test.js
```

或者：

```powershell
npm run qdrant:test
```

## 7. 停止 Qdrant

```powershell
cd D:\code\agent\ShopGuide-Agent
docker compose down
```

数据会保存在：

```text
qdrant_storage/
```

该目录已加入 `.gitignore`，不会上传 GitHub。
