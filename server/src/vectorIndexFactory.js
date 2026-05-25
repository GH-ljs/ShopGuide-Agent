// 文件职责：
// 根据配置创建向量检索器，当前默认 local，后续可切换到 Qdrant/Chroma。

import { createQdrantIndex } from "./qdrantStore.js";
import { createVectorIndex } from "./vectorStore.js";

export function createSearchIndex(config, products) {
  if (config.vectorStore === "local") {
    return createVectorIndex(products);
  }

  if (config.vectorStore === "qdrant") {
    return createQdrantIndex(config, products);
  }

  throw new Error(`Unsupported VECTOR_STORE: ${config.vectorStore}`);
}
