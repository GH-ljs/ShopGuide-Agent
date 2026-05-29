// 文件职责：
// 检查本地 Qdrant 服务是否可访问，方便确认 Docker 容器是否启动成功。

import { config } from "../config.js";

async function run() {
  const url = `${config.qdrantUrl.replace(/\/$/, "")}/collections`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Qdrant health check failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json();
  console.log(`Qdrant is reachable: ${config.qdrantUrl}`);
  console.log(`Collections: ${(body.result?.collections || []).map((item) => item.name).join(", ") || "(empty)"}`);
}

run().catch((error) => {
  console.error("Qdrant is not reachable.");
  console.error(error.message);
  console.error("请确认 Docker Desktop 已安装并运行，然后在项目根目录执行：docker compose up -d qdrant");
  process.exit(1);
});
