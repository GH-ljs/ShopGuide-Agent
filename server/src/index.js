// 文件职责：
// 后端服务启动入口：读取配置，加载商品数据，创建向量检索器，并启动 Express 服务。
// 这里只做依赖组装，不承载具体业务逻辑，便于后续替换 HTTP 框架或检索实现。

import { config } from "./config.js";
import { loadProducts } from "./data/loader.js";
import { createApp } from "./http.js";
import { createSearchIndex } from "./vectordb/factory.js";

// 服务启动时一次性加载商品库。当前数据量小，内存加载最简单也最稳定。
const products = loadProducts(config.datasetDir);
const vectorIndex = createSearchIndex(config, products);

// Express app 只负责协议和路由，商品加载、检索器创建等启动期依赖仍在入口统一组装。
const app = createApp({ config, products, vectorIndex });

app.listen(config.port, () => {
  console.log(`ShopGuide Agent server listening on http://localhost:${config.port}`);
  console.log(`Loaded ${products.length} products from ${config.datasetDir}`);
  console.log(`Vector store: ${config.vectorStore}`);
  console.log(`LLM provider: ${config.llmProvider}`);
  console.log(`Model streaming: ${config.llmApiKey ? "enabled" : "disabled, using local fallback"}`);
});
