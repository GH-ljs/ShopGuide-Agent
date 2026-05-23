# ShopGuide Agent

基于 RAG 的多模态电商智能导购 AI Agent 课题项目。

## 当前进度

目前完成的是**后端 MVP 起步版本**，还没有开始做 Android/iOS 原生客户端。

已完成任务：

- 搭建 Node.js 后端服务骨架。
- 读取 `ecommerce_agent_dataset` 中的 100 条商品 JSON 数据。
- 标准化商品字段，包括商品 ID、标题、品牌、类目、价格、SKU、图片路径、详情描述、FAQ、评价等。
- 实现本地文本向量检索 MVP，支持类目识别、商品类型识别、预算过滤、简单否定条件过滤和余弦相似度排序。
- 实现 `POST /api/chat` SSE 流式接口，可以逐段返回导购回复。
- 实现基于 `conversationId` 的内存多轮会话记忆，支持追问时继承最近上下文。
- 实现结构化商品卡片返回，方便后续客户端展示商品图、标题、价格和推荐理由。
- 实现无模型 Key 时的本地兜底回答，方便先跑通端到端链路。
- 预留 Doubao/Ark 大模型流式调用逻辑，配置 `ARK_API_KEY` 后可切换到真实模型生成。
- 编写基础架构文档和后端运行说明。

## 项目结构

```text
ShopGuide-Agent/
├─ client/                       # Android 原生客户端，下一阶段创建
├─ docs/                         # 技术文档
├─ ecommerce_agent_dataset/       # 商品 JSON + 图片数据
├─ server/                       # Node.js 后端
└─ README.md
```

## 启动后端

```bash
cd server
node src/index.js
```

如果本机全局 Node 不可用，可以先用 Codex 自带的 Node 验证：

```bash
"C:\Users\pc\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" src/index.js
```

服务默认启动在：

```text
http://localhost:3001
```

启动成功后会看到类似输出：

```text
ShopGuide Agent server listening on http://localhost:3001
Loaded 100 products from ...
Model streaming: disabled, using local fallback
```

其中 `Model streaming: disabled` 表示还没有配置大模型 Key，当前使用本地规则兜底回答，这是正常的。

## 测试

```bash
cd server
node src/retrieval.test.js
```

也可以访问健康检查接口：

```text
http://localhost:3001/api/health
```

## API

- `GET /api/health`: 服务健康检查
- `GET /api/products`: 商品列表
- `POST /api/chat`: SSE 流式导购对话

`POST /api/chat` 请求体示例：

```json
{
  "conversationId": "demo-user-1",
  "message": "推荐一款适合油皮的洗面奶"
}
```

同一个 `conversationId` 的最近对话会保存在内存中，服务重启后会清空。

## 后续里程碑

1. 将本地文本向量检索升级为 embedding + Qdrant/Chroma。
2. 强化反选约束、商品对比和购物车能力。
3. 创建 Android Kotlin 客户端。
4. 在客户端展示流式文字和商品卡片。
5. 增加图片找货、语音输入等多模态加分项。
