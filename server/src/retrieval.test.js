// 文件职责：
// 简单检索冒烟测试脚本，用来快速看检索结果是否合理。

import { config } from "./config.js";
import { loadProducts } from "./dataLoader.js";
import { retrieveProducts } from "./retriever.js";
import { createVectorIndex } from "./vectorStore.js";

// 这个文件不是单元测试框架，而是一个快速向量检索冒烟测试脚本。
const products = loadProducts(config.datasetDir);
const vectorIndex = createVectorIndex(products);
const cases = ["推荐一款适合油皮的洗面奶", "200元以下的蓝牙耳机有哪些？", "帮我推荐跑鞋，要轻量的，预算500以内", "推荐防晒霜，但不要含酒精"];

for (const query of cases) {
  const result = retrieveProducts(products, query, 3, vectorIndex);
  console.log(`\nQuery: ${query}`);
  for (const product of result) {
    console.log(`- ${product.productId} ${product.title} ${product.basePrice}元`);
  }
}
