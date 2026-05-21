import http from "node:http";
import { config } from "./config.js";
import { loadProducts } from "./dataLoader.js";
import { createHandler } from "./http.js";

const products = loadProducts(config.datasetDir);
const server = http.createServer(createHandler({ config, products }));

server.listen(config.port, () => {
  console.log(`ShopGuide Agent server listening on http://localhost:${config.port}`);
  console.log(`Loaded ${products.length} products from ${config.datasetDir}`);
  console.log(`Model streaming: ${config.arkApiKey ? "enabled" : "disabled, using local fallback"}`);
});
