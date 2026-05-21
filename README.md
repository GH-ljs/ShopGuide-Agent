# ShopGuide Agent

基于 RAG 的多模态电商智能导购 AI Agent 课题项目。

## Current Status

已完成后端 MVP 起步版本：

- Node.js 服务骨架
- 商品数据加载
- 基础检索
- SSE 流式聊天接口
- 结构化商品卡片返回
- 无模型 Key 时的本地兜底回答
- 配置 Doubao/Ark Key 后可走大模型流式生成

## Structure

```text
ShopGuide-Agent/
├─ client/                       # Android 原生客户端，下一阶段创建
├─ docs/                         # 技术文档
├─ ecommerce_agent_dataset/       # 商品 JSON + 图片数据
├─ server/                       # Node.js 后端
└─ README.md
```

## Run Server

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

## Test

```bash
cd server
node src/retrieval.test.js
```

## API

- `GET /api/health`: 服务健康检查
- `GET /api/products`: 商品列表
- `POST /api/chat`: SSE 流式导购对话

## Next Milestones

1. 把当前关键词检索替换为向量检索。
2. 接入 Doubao 模型 Key，生成更自然的导购回复。
3. 创建 Android Kotlin 客户端。
4. 在客户端展示流式文字和商品卡片。
5. 增加多轮上下文、反选约束、购物车等加分项。
