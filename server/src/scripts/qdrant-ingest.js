// 文件职责：
// 把本地商品数据生成向量并写入 Qdrant collection。

import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { upsertProductsToQdrant } from "../vectordb/qdrant.js";

async function main() {
  const products = loadProducts(config.datasetDir);

  console.log(`Loading ${products.length} products from ${config.datasetDir}`);
  console.log(`Writing vectors to ${config.qdrantUrl}/${config.qdrantCollection}`);
  console.log(`Embedding provider: ${config.embeddingProvider}`);
  if (config.embeddingProvider === "ark") console.log(`Ark embedding model: ${config.arkEmbeddingModel}`);
  console.log(`Embedding dimension: ${config.embeddingDimension}`);

  const written = await upsertProductsToQdrant(config, products);
  console.log(`Qdrant ingest completed. Upserted ${written} products.`);
}

main().catch((error) => {
  console.error("Qdrant ingest failed.");
  console.error(error.message);
  console.error("请确认 Qdrant 已启动：在项目根目录执行 docker compose up -d qdrant");
  process.exit(1);
});
