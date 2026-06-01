// 文件职责：
// 验证 LLM 生成失败时，/api/chat 不会把错误直接甩给用户，而是降级为本地规则回答。
// 这属于工程容错测试：检索结果仍可信时，模型只是增强层，失败不能阻断导购主链路。
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
    vectorStore: "local",
    hotQueryCacheEnabled: false,
    sessionPersistenceEnabled: false,
    llmProvider: "deepseek",
    llmApiKey: "test-key",
    deepseekApiKey: "test-key",
    deepseekBaseUrl: "http://127.0.0.1:1"
  };
  const vectorIndex = createSearchIndex(testConfig, products);
  const app = createApp({ config: testConfig, products, vectorIndex });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  return { server, baseUrl: `http://localhost:${server.address().port}` };
}

async function requestChat(baseUrl) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      deviceId: "fallback-test-device",
      conversationId: "fallback-test",
      message: "推荐一款适合油皮的防晒霜",
      limit: 4
    })
  });

  assert(response.ok, "/api/chat should return 2xx even when LLM is unavailable");
  return parseSseEvents(await response.text());
}

async function run() {
  const { server, baseUrl } = await createTestServer();

  try {
    const events = await requestChat(baseUrl);
    const fallbackMeta = events.find((item) => item.event === "meta" && item.data?.type === "fallback")?.data;
    const products = events.find((item) => item.event === "products")?.data.products || [];
    const done = events.find((item) => item.event === "done")?.data;

    assert(events.some((item) => item.event === "token"), "fallback should still stream token events");
    assert(fallbackMeta?.fallback === true, "fallback meta should tell client to show a notice");
    assert(fallbackMeta.reason === "MODEL_ERROR", "fallback meta should expose MODEL_ERROR reason");
    assert(products.length > 0, "fallback should still return product cards");
    assert(done?.ok === true, "fallback request should finish successfully");
    assert(done.fallback === true, "done event should preserve fallback flag");
    assert(!events.some((item) => item.event === "error"), "fallback should not emit SSE error");

    console.log("Fallback tests passed.");
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error("Fallback tests failed.");
  console.error(error);
  process.exit(1);
});
