// 工程质量与性能专项测试：
// 验证热门查询缓存能复用高频相似问题，同时不会把缓存误用于“第二款怎么样”这类多轮指代问题。
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
  const testConfig = {
    ...config,
    port: 0,
    arkApiKey: "",
    deepseekApiKey: "",
    llmApiKey: "",
    vectorStore: "local",
    hotQueryCacheEnabled: true,
    sessionPersistenceEnabled: false
  };
  const vectorIndex = createSearchIndex(testConfig, products);
  const app = createApp({ config: testConfig, products, vectorIndex });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  return { server, baseUrl: `http://localhost:${server.address().port}` };
}

async function chat(baseUrl, conversationId, message, limit = 6) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ conversationId, message, limit })
  });
  assert(response.ok, `/api/chat should return 2xx for: ${message}`);
  const events = parseSseEvents(await response.text());
  const products = events.find((item) => item.event === "products")?.data.products || [];
  const done = events.find((item) => item.event === "done")?.data || {};
  const cacheMeta = events.find((item) => item.event === "meta" && item.data?.type === "cache")?.data || null;
  const firstTokenMeta = events.find((item) => item.event === "meta" && item.data?.type === "first_token")?.data || null;
  return { events, products, done, cacheMeta, firstTokenMeta };
}

async function requestJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert(response.ok, `${path} should return 2xx`);
  return response.json();
}

async function run() {
  const { server, baseUrl } = await createTestServer();

  try {
    const first = await chat(baseUrl, "perf-cache-a", "帮我推荐适合油皮的防晒霜");
    assert(first.products.length > 0, "first hot query should return products");
    assert(first.cacheMeta?.cacheHit === false, "first hot query should be a cache miss");
    assert(Number(first.firstTokenMeta?.firstTokenMs) < 1000, "first response should expose sub-1s first-token metric");

    const second = await chat(baseUrl, "perf-cache-b", "推荐一款适合油皮的防晒霜");
    assert(second.cacheMeta?.cacheHit === true, "similar hot query should hit cache");
    assert(second.done.cacheHit === true, "done event should expose cache hit");
    assert(Number(second.firstTokenMeta?.firstTokenMs) < 1000, "cached response should emit first token quickly");
    assert(
      second.products.map((product) => product.productId).join(",") === first.products.map((product) => product.productId).join(","),
      "cached similar query should reuse the same trusted product set"
    );

    const setup = await chat(baseUrl, "perf-refer", "推荐一款适合油皮的防晒霜");
    assert(setup.products.length >= 2, "refer setup should return multiple products");
    const refer = await chat(baseUrl, "perf-refer", "第二款怎么样");
    assert(refer.products.length === 1, "refer turn should still resolve current candidate instead of using hot cache");
    assert(refer.cacheMeta?.cacheHit !== true, "refer turn must not hit hot query cache");

    const perf = await requestJson(baseUrl, "/api/performance");
    assert(perf.hotQueryCache.enabled === true, "performance endpoint should expose cache status");
    assert(perf.hotQueryCache.hits >= 1, "performance endpoint should count cache hits");
    assert(perf.hotQueryCache.writes >= 1, "performance endpoint should count cache writes");

    console.log("Performance tests passed.");
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error("Performance tests failed.");
  console.error(error);
  process.exit(1);
});
