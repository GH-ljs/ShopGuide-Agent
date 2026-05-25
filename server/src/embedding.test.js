// 文件职责：
// 快速验证当前 embedding 配置是否能生成指定维度的向量。

import { config } from "./config.js";
import { embedText } from "./embedding.js";

const vector = await embedText(config, "推荐一款适合油皮的防晒霜");

if (!Array.isArray(vector) || vector.length !== config.embeddingDimension) {
  throw new Error(`Embedding dimension mismatch: expected ${config.embeddingDimension}, got ${vector.length}`);
}

console.log(`Embedding provider: ${config.embeddingProvider}`);
console.log(`Embedding model: ${config.embeddingProvider === "ark" ? config.arkEmbeddingModel : "local-hash"}`);
console.log(`Embedding dimension: ${vector.length}`);
console.log("Embedding test passed.");
