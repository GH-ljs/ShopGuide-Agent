# 文档导航

这里保留当前项目主线需要的说明：跨端前端、Node RAG 后端、Agent 编排、运行验证和质量记录。旧课程/比赛提交材料已经移除，避免和秋招项目定位混在一起。

## 推荐阅读顺序

1. [代码导读](code-walkthrough.md)：先看整体模块和关键文件，适合后续学习和改代码前快速回忆。
2. [项目转型方向](project-background-requirements.md)：说明为什么当前主线从 Android 转到跨端前端 + RAG Agent。
3. [跨端前端计划](frontend-web-plan.md)：`app/` 一套代码覆盖 H5/微信小程序。
4. [系统架构](reference/architecture.md)：前端、后端、数据集、向量库和模型之间如何协作。
5. [Agent 编排](reference/agent-orchestration.md)：Planner、Validator、多轮记忆、主动追问和 RAG 边界。
6. [API 文档](reference/api.md)：后端 HTTP/SSE 协议。
7. [Qdrant 配置](operations/qdrant.md)：向量库启动、入库和验证。
8. [验收清单](operations/demo-checklist.md)：本地演示前的检查步骤。
9. [进度记录](quality/progress.md)：已完成能力和验证记录。

## 文档维护原则

- 新功能完成后，同步更新对应计划或进度记录。
- 文档只写当前主线，历史 Android 或课程内容仅在必要背景中一笔带过。
- 涉及 API Key、`.env`、本地数据库路径的内容只写占位示例，不写真实值。
