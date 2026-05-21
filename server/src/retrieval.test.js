import { config } from "./config.js";
import { loadProducts } from "./dataLoader.js";
import { retrieveProducts } from "./retriever.js";

const products = loadProducts(config.datasetDir);
const cases = ["推荐一款适合油皮的洗面奶", "200元以下的蓝牙耳机有哪些？", "帮我推荐跑鞋，要轻量的，预算500以内", "推荐防晒霜，但不要含酒精"];

for (const query of cases) {
  const result = retrieveProducts(products, query, 3);
  console.log(`\nQuery: ${query}`);
  for (const product of result) {
    console.log(`- ${product.productId} ${product.title} ${product.basePrice}元`);
  }
}
