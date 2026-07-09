# Demo 验收清单

这份清单用于本地演示或录屏前快速确认项目状态。当前主线是 `app/` H5/小程序前端和 `server/` RAG 后端。

## 1. 启动服务

在仓库根目录运行：

```powershell
.\scripts\start-all.ps1
```

确认输出里包含：

```text
App H5:  http://127.0.0.1:5174
Backend: http://localhost:3001
Qdrant:  http://localhost:6333
```

健康检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3001/api/health
```

重点看：

- `vectorStore` 是否为期望值，当前推荐演示用 `qdrant`。
- `embeddingProvider` 是否为 `ark` 或期望的本地兜底。
- `llmProvider` / `llmModel` 是否和 `.env` 一致。

## 2. Qdrant 检查

```powershell
cd server
npm run qdrant:health
npm run qdrant:test
```

如果 collection 不存在或维度不匹配，重新入库：

```powershell
cd server
npm run qdrant:ingest
```

## 3. 前端检查

打开：

```text
http://127.0.0.1:5174/#/
```

检查：

- 会话抽屉可以打开、切换、新建和删除会话。
- 输入栏固定在底部，长回答后能滚动到底。
- 商品卡片能打开详情。
- 收藏、购物车、SKU、确认订单流程可用。
- 宽屏和窄屏下头像、气泡、侧边抽屉不互相遮挡。

## 4. 推荐演示问题

主动追问：

```text
推荐上衣
```

预期：先出现追问卡片，例如日常通勤、运动训练、户外防护。

追问后推荐：

```text
户外防护
```

预期：返回服饰运动类商品卡片，不触发多需求边界。

护肤：

```text
推荐一款防晒霜
```

预期：出现护肤场景追问，选择后返回防晒商品。

饮料：

```text
推荐无糖饮料
```

预期：出现低糖低卡、茶感清爽、提神补能等追问或返回饮料候选。

多需求边界：

```text
想买笔记本和防晒霜
```

预期：提示拆开聊，不把两个品类混成一组商品卡片。

对比：

```text
推荐无糖饮料
```

选择两款商品后点击对比，预期返回结构化对比卡。

## 5. 回归测试

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

## 6. 常见问题

如果前端打开但后端无响应，检查 3001 端口：

```powershell
Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
```

如果 Qdrant 没启动，重新运行：

```powershell
.\scripts\start-qdrant.ps1
```

如果 npm 不可用，优先用仓库 `.tools` 中的 Node，或直接运行 `scripts/start-all.ps1`，脚本会把本地 Node 加入当前进程环境。
