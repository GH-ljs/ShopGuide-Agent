# ShopGuide App

`app/` 是当前用户侧主前端，使用 Taro + React + TypeScript + Zustand。一套代码优先服务 H5 调试，同时定期构建微信小程序，避免跨端能力退化。

## 运行

```powershell
cd app
npm run dev:h5
```

浏览器打开：

```text
http://127.0.0.1:5174/
```

构建检查：

```powershell
npm run build:h5
npm run build:mp-weixin
npm run typecheck
```

## 目录职责

| 路径 | 说明 |
| --- | --- |
| `src/pages/chat/` | 主聊天页，组合会话抽屉、消息流、输入栏、收藏和购物车面板 |
| `src/pages/product-detail/` | 商品详情、SKU 选择、收藏和加入购物车 |
| `src/pages/checkout/` | 模拟确认订单和提交订单 |
| `src/components/` | 商品卡、对比卡、轻量富文本等复用展示组件 |
| `src/store/chat.ts` | 聊天状态机：会话、发送、停止、SSE、追问、对比 |
| `src/store/shop.ts` | 收藏、购物车和本地持久化 |
| `src/api/shopguide.ts` | 后端通信层：H5 使用 SSE，小程序使用一次性 JSON |
| `src/types/shopguide.ts` | 前后端结构化协议类型 |
| `src/utils/` | 购物车意图、SKU、价格等纯工具函数 |

## 学习顺序

1. 先看 `src/types/shopguide.ts`，理解后端会返回哪些结构化事件和商品字段。
2. 再看 `src/api/shopguide.ts`，理解 H5 流式和小程序稳定返回为什么分开。
3. 然后看 `src/store/chat.ts`，这是前端业务核心，负责把后端事件写入会话消息。
4. 最后看 `src/pages/chat/index.tsx` 和组件，理解状态如何渲染成聊天 UI、商品卡和对比卡。

## 前端边界

- 前端不从模型自然语言里解析商品名、价格、图片或 SKU。
- 商品事实只来自后端 `products`、`comparison`、详情接口和本地购物车状态。
- H5 是主要开发调试入口；小程序端优先保证构建和核心链路稳定。
