// 文件职责：
// Qdrant 检索验证脚本：用示例用户问题查询 Qdrant，检查 collection 入库结果和召回质量。
// 适合在调整 embedding、collection 或商品数据后快速确认向量检索链路。

import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { retrieveProducts } from "../services/retriever.js";
import { createSearchIndex } from "../vectordb/factory.js";

const products = loadProducts(config.datasetDir);
const qdrantConfig = { ...config, vectorStore: "qdrant" };
const vectorIndex = createSearchIndex(qdrantConfig, products);
const cases = ["推荐防晒霜", "推荐一款适合油皮的防晒霜", "推荐一款适合油皮的洗面奶"];

for (const query of cases) {
  const result = await retrieveProducts(products, query, 3, vectorIndex);
  if (result.length === 0) throw new Error(`Qdrant search returned no products for: ${query}`);
  console.log(`\nQuery: ${query}`);
  for (const product of result) {
    console.log(`- ${product.productId} ${product.title} ${product.basePrice}元`);
  }
}
