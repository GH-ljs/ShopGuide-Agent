# 项目进度记录

本文只保留当前主线的高信号进度、验证结果和剩余风险。详细代码入口见 [代码导读](../code-walkthrough.md)。

## 当前主线

- 项目定位：面向秋招简历的跨端智能导购 Agent。
- 用户侧前端：`app/`，uni-app + Vue3 + TypeScript，一套代码覆盖 H5 和微信小程序。
- 后端：`server/`，Node.js + Express + RAG + Qdrant + Doubao/Ark embedding + DeepSeek。
- 历史实现：`client/` Android 代码仅保留参考，不作为默认维护和验证路径。

## 已完成能力

### 跨端前端

- H5 聊天页、左右气泡、底部固定输入栏、会话抽屉。
- 多会话新建、切换、删除和本地持久化。
- H5 SSE 流式输出、停止生成、超时降级、状态提示。
- 智能滚动：接近底部时跟随输出，用户查看历史时不强制拉回。
- 商品卡、商品详情、SKU 选择、收藏、购物车、确认订单和模拟提交。
- 商品卡选择 2-3 款后发起结构化对比。
- 助手回答支持轻量富文本：`**加粗**` 和段落换行。

### 后端 RAG

- 商品数据加载和可信字段标准化。
- Qdrant 向量库入库、健康检查、检索验证。
- Doubao/Ark embedding 与本地 embedding 兜底。
- DeepSeek 流式生成与本地规则兜底。
- LLM Planner + Validator：解析意图、类目、商品类型、预算、偏好、边界和追问维度。
- 多轮记忆：支持“再便宜点”“第二款怎么样”“2 和 3 哪个好”等追问。
- 检索硬过滤：类目、商品类型、预算、排除词先过滤，再交给向量排序。
- 防幻觉边界：回答文本、商品卡、对比卡都来自同一组候选商品。

### 主动追问

- 后端返回结构化 `clarify`，前端只负责展示和继续追问。
- 追问维度由 Planner 建议、Validator 校验，最终选项来自候选商品差异。
- 已覆盖上衣、护肤、饮料、数码等宽泛需求。
- 修复“推荐上衣，户外使用，防晒防风，耐用”被误判成多需求的问题。

## 重要验证命令

后端：

```powershell
cd server
npm run test:clarify
npm run test:answer
npm run test:session
npm run test:smoke
```

前端：

```powershell
cd app
npm run build:h5
npm run build:mp-weixin
```

Qdrant：

```powershell
cd server
npm run qdrant:health
npm run qdrant:test
```

## 最近一次整理

- 删除早期第二套 `web/` 前端，避免和 `app/` 主线重复。
- 删除旧课程/比赛提交材料 `docs/submission/`。
- 收敛 `scripts/start-all.ps1`，只启动 Qdrant、后端和 `app/` H5。
- 删除 `scripts/start-web.ps1`。
- 精简 README、后端 README 和 docs 导航。
- 新增 `docs/code-walkthrough.md`，方便后续学习项目链路。

## 剩余风险

- 小程序端已能构建，但仍建议在微信开发者工具中做一次模拟器/真机检查。
- 商品数据集字段不完全统一，详情页和 SKU 展示后续仍可能需要按真实数据继续兼容。
- 主动追问已从固定模板升级到候选差异策略，但类别增多后仍应补对应测试。
- 目前没有统一 lint/test runner，后续可以把常用测试收敛成一个 `test` 脚本。
