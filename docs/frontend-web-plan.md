# ShopGuide Agent 跨端前端计划

本项目的用户侧前端只维护一套：`app/`。技术栈是 uni-app + Vue3 + TypeScript，用同一套业务代码覆盖 H5 和微信小程序。

## 当前边界

```text
ShopGuide-Agent/
├─ app/       # 唯一用户侧主前端：H5 + 微信小程序
├─ server/    # Node.js + Qdrant + Doubao Embedding + DeepSeek
├─ client/    # Android 历史实现，只作参考
└─ docs/
```

开发节奏：

- 日常主要用 H5 开发和调试：`http://127.0.0.1:5174`。
- 每完成一组跨端功能后，运行 `npm run build:mp-weixin` 确认小程序构建不坏。
- 小程序专项体验放到 H5 核心闭环稳定后集中处理。

## 已完成

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 跨端骨架 | 已完成 | `app/` uni-app + Vue3 + TypeScript 工程 |
| API 适配 | 已完成 | H5 支持 SSE；小程序优先使用稳定 JSON |
| 多会话 | 已完成 | 新建、切换、删除、本地持久化 |
| 聊天布局 | 已完成 | 左右气泡、底部固定输入栏、可收起会话抽屉 |
| 流式体验 | 已完成 | 停止生成、超时降级、状态提示、智能滚动 |
| 商品展示 | 已完成 | 商品卡、详情页、结构化对比卡 |
| 购物闭环 | 已完成 | 收藏、购物车、SKU、确认订单、模拟提交 |
| 主动追问 | 已完成 | 后端返回 `clarify`，前端只负责展示和继续追问 |
| 商品对比 | 已完成 | 商品卡选择 2-3 款后发起对比 |
| 展示细节 | 已完成 | 回答加粗/换行、窄屏商品卡压缩 |

## 接口策略

| 场景 | 接口 | 说明 |
| --- | --- | --- |
| H5 主前端 | `POST /api/chat` | SSE 流式 token，适合展示实时生成 |
| 小程序主前端 | `POST /api/chat/once` | JSON 一次性返回，避免平台流式差异影响主闭环 |
| 检索排查 | `POST /api/debug/retrieve` | 查看意图、过滤、候选、排序和证据链 |
| 商品详情 | `GET /api/products/:productId` | 商品详情数据 |
| 商品图片 | `GET /api/products/:productId/image` | 商品图片 |

首 token 耗时属于工程观测指标，不直接展示给普通用户。前端只展示“正在连接 / 正在生成 / 切换快速回答”等用户能理解的状态。

## 后续候选任务

这些不是当前必须项，后续按简历展示价值选择：

1. 增加订单记录页，展示模拟下单历史。
2. 补小程序真机/开发者工具专项适配。
3. 增加可选的 RAG 解释面板，用于展示 Planner/Validator/候选证据。
4. 丰富富文本展示，支持更稳定的列表、引用和表格。

## 验收

```powershell
cd app
npm run build:h5
npm run build:mp-weixin
```
