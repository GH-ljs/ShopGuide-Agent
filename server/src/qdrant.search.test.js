// 文件职责：
// 验证 Qdrant collection 已入库，并能按用户问题召回商品。

import { config } from "./config.js";
import { loadProducts } from "./dataLoader.js";
import { retrieveProducts } from "./retriever.js";
import { createSearchIndex } from "./vectorIndexFactory.js";

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
