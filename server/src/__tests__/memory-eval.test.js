// 记忆系统专项评测：
// 这组测试不评价回答文案是否优美，而是用确定性断言检查“多轮上下文是否记对了”。
// 覆盖 active need 切换、旧需求恢复、新需求隔离、预算继承、摘要记忆和商品卡片一致性。
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
    vectorStore: "local"
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
  const tokenText = events
    .filter((item) => item.event === "token")
    .map((item) => item.data?.content || "")
    .join("");
  const products = events.find((item) => item.event === "products")?.data.products || [];
  return { events, tokenText, products };
}

async function debugRetrieve(baseUrl, conversationId, message, limit = 6) {
  const response = await fetch(`${baseUrl}/api/debug/retrieve`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ conversationId, message, limit })
  });
  assert(response.ok, `/api/debug/retrieve should return 2xx for: ${message}`);
  return response.json();
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    return true;
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    console.error(error);
    return false;
  }
}

async function run() {
  const { server, baseUrl } = await createTestServer();
  const results = [];

  try {
    results.push(
      await runCase("预算继承：笔记本追加 1 万预算后只保留预算内候选", async () => {
        const conversationId = "memory-budget";
        await chat(baseUrl, conversationId, "想买一台办公轻薄笔记本");
        const budget = await chat(baseUrl, conversationId, "1万预算");
        assert(budget.products.length > 0, "budget follow-up should keep matching notebook products");
        assert(budget.products.every((product) => Number(product.price) <= 10000), "all notebook products should be <= 10000");

        const debug = await debugRetrieve(baseUrl, conversationId, "这些里面怎么选");
        const activeNeed = debug.session.needs.find((need) => need.needId === debug.session.activeNeedId);
        assert(activeNeed?.itemType === "笔记本", "active need should remain notebook");
        assert(activeNeed?.maxPrice === 10000, "active need should remember maxPrice=10000");
        assert(debug.session.summary.includes("笔记本"), "summary should mention notebook need");
      })
    );

    results.push(
      await runCase("新需求隔离：切到防晒霜时不继承笔记本预算", async () => {
        const conversationId = "memory-isolation";
        await chat(baseUrl, conversationId, "想买一台办公轻薄笔记本");
        await chat(baseUrl, conversationId, "1万预算");
        const sunscreen = await chat(baseUrl, conversationId, "推荐一款适合油皮的防晒霜");

        assert(sunscreen.products.length > 0, "new sunscreen need should return products");
        assert(sunscreen.products.every((product) => product.category === "美妆护肤"), "new need should switch to skincare category");

        const debug = await debugRetrieve(baseUrl, conversationId, "这些能作为备选吗");
        const activeNeed = debug.session.needs.find((need) => need.needId === debug.session.activeNeedId);
        assert(activeNeed?.itemType === "防晒", "active need should switch to sunscreen");
        assert(activeNeed?.maxPrice === null, "sunscreen need should not inherit notebook budget");
        assert(debug.session.summary.includes("笔记本"), "summary should retain previous notebook need");
        assert(debug.session.summary.includes("防晒"), "summary should retain current sunscreen need");
      })
    );

    results.push(
      await runCase("跨需求恢复：防晒后回问刚才笔记本第三款", async () => {
        const conversationId = "memory-recover-old-need";
        await chat(baseUrl, conversationId, "想买一台办公轻薄笔记本");
        const budget = await chat(baseUrl, conversationId, "1万预算");
        assert(budget.products.length >= 3, "budgeted notebook need should keep at least three candidates");

        await chat(baseUrl, conversationId, "推荐一款适合油皮的防晒霜");
        const returned = await chat(baseUrl, conversationId, "刚才笔记本第三款呢");

        assert(returned.products.length === 1, "cross-need reference should focus on one product");
        assert(returned.products[0].productId === budget.products[2].productId, "should restore the old notebook candidate list");

        const debug = await debugRetrieve(baseUrl, conversationId, "刚才笔记本还有哪些");
        const activeNeed = debug.session.needs.find((need) => need.needId === debug.session.activeNeedId);
        assert(activeNeed?.itemType === "笔记本", "active need should switch back to notebook");
      })
    );

    results.push(
      await runCase("当前候选元问题：这些能作为备选吗不触发新搜索", async () => {
        const conversationId = "memory-meta-question";
        await chat(baseUrl, conversationId, "想买一台办公轻薄笔记本");
        const budget = await chat(baseUrl, conversationId, "1万预算");
        const meta = await chat(baseUrl, conversationId, "这些能作为备选吗");

        assert(meta.products.length > 0, "meta question should reuse current candidate set");
        assert(meta.products.every((product) => Number(product.price) <= 10000), "meta question should preserve budget filter");
        assert(
          meta.products.every((product) => budget.products.some((candidate) => candidate.productId === product.productId)),
          "meta question products should come from current budgeted candidates"
        );
      })
    );

    results.push(
      await runCase("价格方向：太便宜了应切到更高价候选", async () => {
        const conversationId = "memory-price-direction";
        await chat(baseUrl, conversationId, "推荐一款适合油皮的防晒霜");
        const pricier = await chat(baseUrl, conversationId, "太便宜了");

        assert(pricier.products.length > 0, "pricier follow-up should keep products");
        assert(pricier.products.every((product) => Number(product.price) > 170), "太便宜了 should exclude the cheapest previous product");
      })
    );

    results.push(
      await runCase("长期摘要参与追问检索但不制造硬约束", async () => {
        const conversationId = "memory-summary";
        await chat(baseUrl, conversationId, "想买一台办公轻薄笔记本");
        await chat(baseUrl, conversationId, "1万预算");
        await chat(baseUrl, conversationId, "推荐一款适合油皮的防晒霜");
        const debug = await debugRetrieve(baseUrl, conversationId, "刚才笔记本还有哪些");

        assert(debug.session.summary.includes("笔记本"), "summary should include old notebook need");
        assert(debug.session.summary.includes("防晒"), "summary should include sunscreen need");
        assert(debug.retrievalQuery.includes("会话长期摘要"), "retrieval query should contain long-term summary for follow-up");
        assert(debug.retrieval.products.every((product) => product.subCategory === "笔记本电脑"), "summary should help recover notebook scope");
      })
    );

    const passed = results.filter(Boolean).length;
    assert(passed === results.length, `Memory eval passed ${passed}/${results.length}`);
    console.log(`Memory eval passed: ${passed}/${results.length}`);
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error("Memory eval failed.");
  console.error(error);
  process.exit(1);
});
