// 文件职责：
// 检索效果冒烟脚本：用固定用户问题调用本地检索链路，快速观察候选商品是否符合预期。
// 它更偏人工检查输出，不是完整断言式单元测试。

import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { retrieveProducts } from "../services/retriever.js";
import { createSearchIndex } from "../vectordb/factory.js";

// 这个文件不是单元测试框架，而是一个快速向量检索冒烟测试脚本。
const products = loadProducts(config.datasetDir);
const vectorIndex = createSearchIndex({ ...config, vectorStore: "local" }, products);
const cases = ["推荐一款适合油皮的洗面奶", "200元以下的蓝牙耳机有哪些？", "帮我推荐跑鞋，要轻量的，预算500以内", "推荐防晒霜，但不要含酒精"];

for (const query of cases) {
  const result = await retrieveProducts(products, query, 3, vectorIndex);
  console.log(`\nQuery: ${query}`);
  for (const product of result) {
    console.log(`- ${product.productId} ${product.title} ${product.basePrice}元`);
  }
}
