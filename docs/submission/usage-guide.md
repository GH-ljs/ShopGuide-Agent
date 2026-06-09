# ShopGuide Agent 说明文档

## 1. 快速体验方式

项目包含 Android 原生客户端和 Node.js 后端。推荐体验顺序：

```text
1. 启动后端服务
2. 用调试接口验证 RAG 检索
3. 打开 Android App
4. 输入 Demo 问题，观察流式回答、商品卡片、对比卡和详情页
```

客户端聊天列表使用 `LazyColumn` 虚拟列表滚动，长对话中只渲染可视区域附近的消息；商品卡片使用 `LazyRow` 横向虚拟列表，适合连续多轮演示。

## 2. 启动后端

进入后端目录：

```powershell
cd D:\code\agent\ShopGuide-Agent\server
```

安装依赖：

```powershell
npm install
```

复制环境配置：

```powershell
copy .env.example .env
```

默认可以使用本地向量检索和本地兜底回答，不填模型 Key 也能跑通 Demo。

启动服务：

```powershell
npm run dev
```

默认地址：

```text
http://localhost:3001
```

健康检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3001/api/health
```

## 3. 可选：启动 Qdrant

如果要展示真实向量数据库链路，在项目根目录运行：

```powershell
docker compose up -d qdrant
```

然后进入 `server` 目录执行：

```powershell
npm run qdrant:health
npm run qdrant:ingest
npm run qdrant:test
```

如果只想快速演示完整闭环，可以不启动 Qdrant，使用默认本地检索。

## 4. 启动 Android 客户端

用 Android Studio 打开：

```text
D:\code\agent\ShopGuide-Agent\client
```

等待 Gradle Sync 完成后运行 App。

后端地址配置文件：

```text
client/app/src/main/java/com/shopguide/agent/network/ApiConfig.kt
```

常见地址：

- Android 模拟器访问电脑本机：`http://10.0.2.2:3001`
- 真机访问电脑后端：改成电脑局域网 IP，例如 `http://192.168.x.x:3001`

## 5. 推荐演示问题

### 基础推荐

```text
推荐一款适合油皮的防晒霜
```

看点：

- 流式回答。
- 商品卡片展示。
- 商品详情页。
- 推荐理由来自商品库。

### 预算追问

```text
不要超过200
```

看点：

- 后端继承上一轮防晒需求。
- 新增预算硬过滤。
- 商品卡片不展示超预算商品。
- 当前数据中，油皮防晒霜加上 200 元预算后通常只剩 1 款，因此这条分支用于展示预算过滤，不继续接第 2/3 款对比。

### 商品对比

商品对比建议新开会话，或重新输入一次不带 200 元预算限制的基础推荐：

```text
推荐一款适合油皮的防晒霜
```

```text
第二款和第三款对比一下
```

看点：

- 只比较上一轮候选中的第 2、3 款。
- 返回结构化对比卡。
- 对比卡和商品卡片使用同一组 `productId`。
- 如果上一轮候选不足 3 款，应先换一个候选更多的问题，不要强行演示第 2/3 款对比。

### 对比后决策追问

```text
哪个更清爽
```

看点：

- 仍然限定在刚才对比过的商品中。
- 不回到全库重新搜索。
- 给出明确选择建议。

### 跨需求记忆

```text
想买一台办公轻薄笔记本
1万预算
推荐一款适合油皮的防晒霜
刚才笔记本第三款呢
```

看点：

- 笔记本和防晒是两个独立需求。
- 回问旧需求时可以恢复笔记本候选。
- 防止预算、类目和候选互相污染。

### 边界问题

```text
天气怎么样
给我点外卖
想买笔记本和防晒霜
```

看点：

- 非导购问题不触发商品检索。
- 外卖/订餐服务不混入商品库推荐。
- 多品类混合输入先澄清，不把两套商品揉成一组卡片。

## 6. 评审模式体验

调试接口：

```powershell
$body = @{
  message = "推荐一款适合油皮的防晒霜，不要超过200"
  includeMemory = $false
} | ConvertTo-Json -Compress

Invoke-WebRequest `
  -UseBasicParsing `
  -Uri "http://localhost:3001/api/debug/retrieve" `
  -Method POST `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

返回中的 `review` 字段会展示：

- `intent`：识别到的新搜索、追问、指代或对比。
- `filters`：类目、商品类型、预算、排除词、偏好。
- `retrieval`：检索范围、过滤后候选数、返回数。
- `evidence`：每个推荐商品对应的证据字段和命中关键词。
- `safety`：禁止编造库存、优惠、销量、功效等边界。

## 7. 自动化验证

后端建议至少运行：

```powershell
cd D:\code\agent\ShopGuide-Agent\server
npm run test:answer
npm run test:retrieval-quality
npm run test:smoke
```

如果改了多轮记忆或意图解析，额外运行：

```powershell
node src/__tests__/intent.test.js
node src/__tests__/memory-eval.test.js
```

Android 客户端改动后，建议在 Android Studio 里 Build/Run。协作过程中默认不运行 Gradle 命令，避免触发长时间下载或网络权限问题。

客户端体验检查点：

- 连续发送多轮 Demo 问题后，聊天历史仍能平滑上下滚动。
- 用户翻看历史时，新 token 不应强行把列表抢回底部。
- 用户回到底部后，流式回答和商品卡片应继续自动贴底。
- 长对话列表由 `LazyColumn` 虚拟化渲染，商品卡片由 `LazyRow` 渲染，避免一次性渲染全部历史节点。

## 8. 常见问题

### Android 请求失败

先确认后端启动成功，再检查客户端后端地址。模拟器不能直接访问 `localhost:3001`，需要使用 `10.0.2.2:3001`。

### 没有模型 Key

可以正常演示。后端会使用本地确定性回答，仍然能展示检索、流式返回、商品卡片、多轮记忆和对比卡。

### Qdrant 连接失败

可以先切回本地检索：

```env
VECTOR_STORE=local
EMBEDDING_PROVIDER=local
```

### 推荐结果为空

这是正常边界。如果商品库中没有同时满足条件的商品，系统应该提示用户放宽条件，而不是硬凑不存在的商品。
