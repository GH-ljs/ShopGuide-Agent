// 文件职责：
// Embedding 配置验证脚本：检查当前 EMBEDDING_PROVIDER 是否能生成指定维度的向量。
// 可用于区分本地 embedding 逻辑问题和外部 Ark embedding 网络/API 配置问题。

import { config } from "../config.js";
import { embedText } from "../vectordb/embedding.js";

const vector = await embedText(config, "推荐一款适合油皮的防晒霜");

if (!Array.isArray(vector) || vector.length !== config.embeddingDimension) {
  throw new Error(`Embedding dimension mismatch: expected ${config.embeddingDimension}, got ${vector.length}`);
}

console.log(`Embedding provider: ${config.embeddingProvider}`);
console.log(`Embedding model: ${config.embeddingProvider === "ark" ? config.arkEmbeddingModel : "local-hash"}`);
console.log(`Embedding dimension: ${vector.length}`);
console.log("Embedding test passed.");
