# ShopGuide Agent

ShopGuide Agent 是一个面向秋招简历展示的跨端智能导购项目。当前主线是 `uni-app + Vue3 + TypeScript` 前端，以及 `Node.js + RAG + Qdrant + Doubao Embedding + DeepSeek` 后端。

项目重点不是做一个普通商品搜索页，而是做一个可控的导购 Agent：LLM 负责理解和表达，后端负责意图校验、商品检索、事实边界和结构化卡片，避免推荐不存在的商品、价格、库存或功能。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 跨端前端 | uni-app、Vue3、TypeScript、Vite |
| H5 体验 | 流式文字、停止生成、智能滚动、会话列表、商品卡片 |
| 小程序路径 | 同一套 `app/` 代码构建微信小程序 |
| 后端服务 | Node.js、Express |
| Agent 编排 | LLM Planner + Validator、多轮记忆、主动追问、结构化对比 |
| RAG 检索 | Qdrant、Doubao Embedding、本地检索兜底 |
| 生成模型 | DeepSeek 流式生成、本地规则兜底 |
| 本地状态 | 会话、收藏、购物车、订单模拟 |

## 目录结构

| 目录 | 说明 |
| --- | --- |
| `app/` | 当前唯一用户侧主前端，一套代码覆盖 H5 和微信小程序 |
| `server/` | Node.js RAG 后端，负责意图、检索、生成和结构化返回 |
| `ecommerce_agent_dataset/` | 商品 JSON 和图片，所有商品事实的来源 |
| `docs/` | 架构、代码导读、运行、RAG 和质量记录 |
| `scripts/` | 本地启动脚本 |
| `client/` | Android 历史实现，仅作演进参考，当前不继续维护 |

## 快速启动

在仓库根目录运行：

```powershell
.\scripts\start-all.ps1
```

默认启动：

```text
App H5:  http://127.0.0.1:5174
Backend: http://localhost:3001
Qdrant:  http://localhost:6333
```

也可以分开启动：

```powershell
.\scripts\start-qdrant.ps1
.\scripts\start-backend.ps1
.\scripts\start-all.ps1
```

## 前端开发

```powershell
cd app
npm run dev:h5
```

构建 H5：

```powershell
cd app
npm run build:h5
```

构建微信小程序：

```powershell
cd app
npm run build:mp-weixin
```

当前节奏：主要用 H5 开发和调试，完成一组跨端功能后跑一次小程序构建确认不坏。

## 后端链路

```text
用户自然语言需求
  -> LLM Planner 解析 intent/category/item_type/preferences/clarify_dimensions
  -> Validator 校验类目、商品类型、边界和硬约束
  -> 主动追问或进入 RAG 检索
  -> Qdrant + Doubao Embedding 召回候选
  -> 后端硬过滤预算、排除词、商品类型
  -> DeepSeek 或本地规则生成回答
  -> 返回 token / clarify / comparison / products / done
  -> 前端渲染聊天气泡、追问卡、商品卡、对比卡和购物闭环
```

## 核心功能

- 多轮导购问答：支持推荐、追问、预算收窄、商品指代和跨需求恢复。
- 主动追问卡片：宽泛需求先问场景/偏好，例如“推荐上衣”会先问日常通勤、运动训练或户外防护。
- 可信商品卡片：商品名、价格、图片、类目和详情都来自商品库，不从模型自然语言里反向解析。
- 结构化商品对比：支持选择 2-3 款商品发起对比，由后端返回对比表和结论。
- 购物闭环：收藏、购物车、SKU 选择、确认订单、模拟提交。
- 质量验证：用固定测试覆盖意图解析、主动追问、检索质量、多轮会话和 SSE/JSON 协议。

## 验证命令

后端核心回归：

```powershell
cd server
npm run test:clarify
npm run test:answer
npm run test:session
npm run test:smoke
```

前端构建：

```powershell
cd app
npm run build:h5
npm run build:mp-weixin
```

## 简历描述

```text
ShopGuide Agent：基于 Vue3/TypeScript/uni-app 与 Node.js RAG 的跨端智能导购项目，支持 H5 与微信小程序。实现流式聊天、主动追问卡片、结构化商品推荐/对比、收藏购物车与订单模拟闭环；后端采用 LLM Planner + Validator 的受控 Agent 编排，结合 Qdrant 与 Doubao Embedding 完成商品召回，并用硬过滤保证回答、卡片和详情页均基于真实商品数据，降低模型幻觉。
```

短版：

```text
跨端 RAG 导购 Agent：Vue3 + TypeScript + uni-app 前端，Node.js + Qdrant + Doubao Embedding 后端；实现流式问答、主动追问、结构化商品推荐/对比和购物车闭环，并通过 Planner/Validator 控制商品事实边界。
```

## 文档入口

- [代码导读](docs/code-walkthrough.md)
- [跨端前端计划](docs/frontend-web-plan.md)
- [系统架构](docs/reference/architecture.md)
- [Agent 编排](docs/reference/agent-orchestration.md)
- [API 文档](docs/reference/api.md)
- [Qdrant 配置](docs/operations/qdrant.md)
- [进度记录](docs/quality/progress.md)

## 安全说明

- `.env`、模型 Key、本地数据库和缓存文件不要提交。
- 商品事实必须来自数据集或检索结果，不能在前端或模型回答中编造。
- `client/` 是历史 Android 实现，当前主线不再维护 Android。
