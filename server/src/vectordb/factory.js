// 文件职责：
// 向量检索器工厂：根据 VECTOR_STORE 创建 local 或 Qdrant 实现。
// 上层只依赖统一的 search(query, candidates, limit) 接口，降低检索后端切换成本。

import { createQdrantIndex } from "./qdrant.js";
import { createVectorIndex } from "./local.js";

export function createSearchIndex(config, products) {
  if (config.vectorStore === "local") {
    return createVectorIndex(products);
  }

  if (config.vectorStore === "qdrant") {
    return createQdrantIndex(config, products);
  }

  throw new Error(`Unsupported VECTOR_STORE: ${config.vectorStore}`);
}
