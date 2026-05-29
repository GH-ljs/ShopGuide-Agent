// 文件职责：
// 后端入口，加载商品数据，创建 HTTP 服务，监听 3001 端口。

import http from "node:http";
import { config } from "./config.js";
import { loadProducts } from "./data/loader.js";
import { createHandler } from "./http.js";
import { createSearchIndex } from "./vectordb/factory.js";

// 服务启动时一次性加载商品库。当前数据量小，内存加载最简单也最稳定。
const products = loadProducts(config.datasetDir);
const vectorIndex = createSearchIndex(config, products);

// createHandler 注入配置和商品数据，方便后续替换成 Express/NestJS 时复用业务逻辑。
const server = http.createServer(createHandler({ config, products, vectorIndex }));

server.listen(config.port, () => {
  console.log(`ShopGuide Agent server listening on http://localhost:${config.port}`);
  console.log(`Loaded ${products.length} products from ${config.datasetDir}`);
  console.log(`Vector store: ${config.vectorStore}`);
  console.log(`LLM provider: ${config.llmProvider}`);
  console.log(`Model streaming: ${config.llmApiKey ? "enabled" : "disabled, using local fallback"}`);
});
