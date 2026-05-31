// 文件职责：
// 后端最小闭环冒烟测试：临时启动 Express 服务，验证健康检查、商品接口、会话重置和 /api/chat SSE 事件。
// 测试默认关闭真实 LLM，使用本地兜底回答，确保无 API Key 环境也能验证端到端链路。

import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { createApp } from "../http.js";
import { createSearchIndex } from "../vectordb/factory.js";

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
  const testConfig = { ...config, port: 0, arkApiKey: "", deepseekApiKey: "", llmApiKey: "", vectorStore: "local" };
  const vectorIndex = createSearchIndex(testConfig, products);
  const app = createApp({ config: testConfig, products, vectorIndex });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  return { server, port: server.address().port };
}

async function requestJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert(response.ok, `${path} should return 2xx`);
  return response.json();
}

async function postJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  });
  assert(response.ok, `${path} should return 2xx`);
  return response.json();
}

async function requestChat(baseUrl, message, conversationId = "smoke-demo", history = []) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ conversationId, message, history })
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
    assert(productEvent.data.products.length <= 4, "chat should keep answer candidates and product cards aligned");

    const second = await requestChat(baseUrl, "再便宜点");
    const done = second.find((item) => item.event === "done");
    assert(done.data.conversationId === "smoke-demo", "done event should include conversationId");

    const referFirst = await requestChat(baseUrl, "推荐防晒霜", "refer-demo");
    const referFirstProducts = referFirst.find((item) => item.event === "products")?.data.products || [];
    assert(referFirstProducts.length > 0, "refer setup should return products");
    const referSecond = await requestChat(baseUrl, "第一个怎么样", "refer-demo");
    const referSecondProducts = referSecond.find((item) => item.event === "products")?.data.products || [];
    assert(referSecondProducts.length === 1, "refer turn should focus on the referenced product");
    assert(
      referSecondProducts[0].productId === referFirstProducts[0].productId,
      "refer turn should keep the first product instead of searching unrelated products"
    );

    await requestChat(baseUrl, "推荐防晒霜", "new-search-demo");
    const newSearch = await requestChat(baseUrl, "我想买蓝牙耳机", "new-search-demo");
    const newSearchProducts = newSearch.find((item) => item.event === "products")?.data.products || [];
    assert(newSearchProducts.length > 0, "new search should return products");
    assert(
      newSearchProducts.every((product) => product.category === "数码电子" && product.subCategory.includes("耳机")),
      "new search should reset previous skincare context"
    );

    const restored = await requestChat(baseUrl, "再便宜点", "history-restore-demo", [
      {
        role: "user",
        content: "想买一台办公用轻薄笔记本"
      },
      {
        role: "assistant",
        content: "我从商品库里筛出几台轻薄笔记本。",
        productIds: ["p_digital_023", "p_digital_004", "p_digital_022"]
      }
    ]);
    const restoredProducts = restored.find((item) => item.event === "products")?.data.products || [];
    assert(restoredProducts.length > 0, "history restore should keep enough context to retrieve products");
    assert(
      restoredProducts.every((product) => product.category === "数码电子" && product.subCategory === "笔记本电脑"),
      "history restore should keep the notebook intent for elliptical follow-up"
    );

    const debug = await postJson(baseUrl, "/api/debug/retrieve", {
      conversationId: "smoke-debug",
      message: "推荐一款适合油皮的防晒霜",
      includeMemory: false
    });
    assert(debug.ok === true, "debug retrieve should return ok");
    assert(debug.retrieval.counts.filteredCandidates > 0, "debug retrieve should expose candidate count");
    assert(debug.retrieval.products.length > 0, "debug retrieve should return product cards");

    const reset = await postJson(baseUrl, "/api/conversations/reset", { conversationId: "smoke-demo" });
    assert(reset.ok === true, "reset should return ok");
    assert(reset.session.turnCount === 0, "reset should clear turns");
    assert(reset.session.lastProductIds.length === 0, "reset should clear last products");

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
