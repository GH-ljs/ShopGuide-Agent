# ShopGuide Agent Android Client

这是项目的 Android 原生客户端，使用 Kotlin 和 Jetpack Compose 开发。

## 当前状态

当前已经完成最小项目骨架和静态聊天界面：

- 顶部标题栏
- 消息列表
- 文本输入框
- 发送按钮
- 示例 AI 回复
- 示例商品卡片

下一步会接入后端 `POST /api/chat`，把模拟回复替换成 SSE 流式回答。

## 打开方式

1. 打开 Android Studio。
2. 选择 `Open`。
3. 打开本目录：

```text
D:\code\agent\ShopGuide-Agent\client
```

4. 等待 Gradle Sync 完成。
5. 选择模拟器或真机，点击 Run。

## SDK 路径

本机 SDK 路径配置在 `local.properties`：

```text
sdk.dir=D\:\\Application\\AndroidSDK
```

`local.properties` 是本地配置文件，已经加入 `.gitignore`，不要提交到 GitHub。

## 后续对接接口

客户端第一阶段主要对接：

- `GET /api/health`：检查后端是否可用。
- `POST /api/chat`：发送用户问题并接收 SSE 流式回答。
- `POST /api/conversations/reset`：新建对话或清空上下文。

后端默认地址：

```text
http://localhost:3001
```

Android 模拟器访问电脑本机服务时通常要改成：

```text
http://10.0.2.2:3001
```
