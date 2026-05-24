// 文件职责：
// 端到端冒烟测试：启动服务并验证核心 API 和 SSE 事件是否可用。

import http from "node:http";
import { config } from "./config.js";
import { loadProducts } from "./dataLoader.js";
import { createHandler } from "./http.js";
import { createSearchIndex } from "./vectorIndexFactory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseSseEvents(text) {
  return text
    .split(/\n\n/)
    .filter(Boolean)
    .map((block) => {
      const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      return {
        event: eventLine?.slice("event:".length).trim(),
        data: dataLine ? JSON.parse(dataLine.slice("data:".length).trim()) : null
      };
    });
}

async function createTestServer() {
  const products = loadProducts(config.datasetDir);
  const testConfig = { ...config, port: 0, arkApiKey: "", vectorStore: "local" };
  const vectorIndex = createSearchIndex(testConfig, products);
  const server = http.createServer(createHandler({ config: testConfig, products, vectorIndex }));

  await new Promise((resolve) => server.listen(0, resolve));
  return { server, port: server.address().port };
}

async function requestJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert(response.ok, `${path} should return 2xx`);
  return response.json();
}

async function requestChat(baseUrl, message, conversationId = "smoke-demo") {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ conversationId, message })
  });

  assert(response.ok, "/api/chat should return 2xx");
  const text = await response.text();
  return parseSseEvents(text);
}

async function run() {
  const { server, port } = await createTestServer();
  const baseUrl = `http://localhost:${port}`;

  try {
    const health = await requestJson(baseUrl, "/api/health");
    assert(health.ok === true, "health.ok should be true");
    assert(health.productCount === 100, "health.productCount should be 100");

    const products = await requestJson(baseUrl, "/api/products");
    assert(Array.isArray(products), "products should be an array");
    assert(products.length === 100, "products length should be 100");

    const first = await requestChat(baseUrl, "推荐一款防晒霜");
    assert(first.some((item) => item.event === "token"), "chat should emit token event");
    assert(first.some((item) => item.event === "products"), "chat should emit products event");
    assert(first.some((item) => item.event === "done"), "chat should emit done event");

    const productEvent = first.find((item) => item.event === "products");
    assert(productEvent.data.products.every((product) => product.category === "美妆护肤"), "防晒霜查询不应返回非美妆类商品");

    const second = await requestChat(baseUrl, "再便宜点");
    const done = second.find((item) => item.event === "done");
    assert(done.data.conversationId === "smoke-demo", "done event should include conversationId");

    const invalid = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json"
    });
    const invalidBody = await invalid.json();
    assert(invalid.status === 400, "invalid JSON should return 400");
    assert(invalidBody.error.code === "INVALID_JSON", "invalid JSON should use stable error code");

    console.log("Smoke tests passed.");
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error("Smoke tests failed.");
  console.error(error);
  process.exit(1);
});
