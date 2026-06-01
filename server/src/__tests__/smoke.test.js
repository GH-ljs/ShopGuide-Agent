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
  const testConfig = {
    ...config,
    port: 0,
    arkApiKey: "",
    deepseekApiKey: "",
    llmApiKey: "",
    vectorStore: "local",
    sessionPersistenceEnabled: false
  };
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

async function requestChat(baseUrl, message, conversationId = "smoke-demo", history = [], limit = undefined) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ conversationId, message, history, limit })
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

    const outOfScope = await requestChat(baseUrl, "天气怎么样", "out-of-scope-demo");
    const outOfScopeProducts = outOfScope.find((item) => item.event === "products")?.data.products || [];
    const outOfScopeDone = outOfScope.find((item) => item.event === "done")?.data;
    assert(outOfScopeProducts.length === 0, "out-of-scope request should not return product cards");
    assert(outOfScopeDone.outOfScope === true, "out-of-scope request should expose done.outOfScope");

    const multiNeed = await requestChat(baseUrl, "想买笔记本和防晒霜", "multi-need-boundary-demo");
    const multiNeedProducts = multiNeed.find((item) => item.event === "products")?.data.products || [];
    const multiNeedDone = multiNeed.find((item) => item.event === "done")?.data;
    assert(multiNeedProducts.length === 0, "multi-need request should ask for clarification instead of mixing products");
    assert(multiNeedDone.multiNeed === true, "multi-need request should expose done.multiNeed");

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

    const sequentialSetup = await requestChat(baseUrl, "推荐一款适合油皮的防晒霜", "sequential-refer-demo");
    const sequentialSetupProducts = sequentialSetup.find((item) => item.event === "products")?.data.products || [];
    assert(sequentialSetupProducts.length >= 3, "sequential refer setup should keep at least three candidates");
    const sequentialSecond = await requestChat(baseUrl, "第二款怎么样", "sequential-refer-demo");
    const sequentialSecondProducts = sequentialSecond.find((item) => item.event === "products")?.data.products || [];
    assert(sequentialSecondProducts[0].productId === sequentialSetupProducts[1].productId, "second refer should return original second candidate");
    const sequentialThird = await requestChat(baseUrl, "第三款呢", "sequential-refer-demo");
    const sequentialThirdProducts = sequentialThird.find((item) => item.event === "products")?.data.products || [];
    assert(sequentialThirdProducts[0].productId === sequentialSetupProducts[2].productId, "third refer should still return original third candidate after second refer");

    await requestChat(baseUrl, "推荐防晒霜", "new-search-demo");
    const newSearch = await requestChat(baseUrl, "我想买蓝牙耳机", "new-search-demo");
    const newSearchProducts = newSearch.find((item) => item.event === "products")?.data.products || [];
    assert(newSearchProducts.length > 0, "new search should return products");
    assert(
      newSearchProducts.every((product) => product.category === "数码电子" && product.subCategory.includes("耳机")),
      "new search should reset previous skincare context"
    );

    const laptopBeforeSwitch = await requestChat(baseUrl, "想买一台办公轻薄笔记本", "multi-need-demo", [], 6);
    const laptopBeforeSwitchProducts = laptopBeforeSwitch.find((item) => item.event === "products")?.data.products || [];
    assert(laptopBeforeSwitchProducts.length >= 3, "multi-need setup should keep notebook candidates");
    await requestChat(baseUrl, "推荐一款适合油皮的防晒霜", "multi-need-demo", [], 6);
    const returnToLaptop = await requestChat(baseUrl, "刚才笔记本第三款呢", "multi-need-demo", [], 6);
    const returnToLaptopProducts = returnToLaptop.find((item) => item.event === "products")?.data.products || [];
    assert(returnToLaptopProducts.length === 1, "cross-need reference should focus on the referenced old candidate");
    assert(
      returnToLaptopProducts[0].productId === laptopBeforeSwitchProducts[2].productId,
      "cross-need reference should restore notebook need instead of using sunscreen candidates"
    );
    const multiNeedDebug = await postJson(baseUrl, "/api/debug/retrieve", {
      conversationId: "multi-need-demo",
      message: "刚才笔记本还有哪些",
      limit: 6
    });
    assert(multiNeedDebug.session.summary.includes("笔记本"), "session summary should keep notebook need");
    assert(multiNeedDebug.session.summary.includes("防晒"), "session summary should keep sunscreen need");
    assert(multiNeedDebug.retrievalQuery.includes("会话长期摘要"), "retrieval query should include long-term memory for follow-ups");

    await requestChat(baseUrl, "推荐一款适合油皮的防晒霜", "price-direction-demo");
    const pricier = await requestChat(baseUrl, "太便宜了", "price-direction-demo");
    const pricierProducts = pricier.find((item) => item.event === "products")?.data.products || [];
    assert(pricierProducts.length > 0, "pricier follow-up should return products");
    assert(
      pricierProducts.every((product) => Number(product.price) > 170),
      "太便宜了 should move toward higher-priced candidates instead of cheaper ones"
    );

    const laptopSetup = await requestChat(baseUrl, "想买一台办公轻薄笔记本", "cheap-laptop-demo");
    const laptopSetupProducts = laptopSetup.find((item) => item.event === "products")?.data.products || [];
    assert(laptopSetupProducts.length >= 4, "laptop setup should return several candidates");
    const cheaperLaptop = await requestChat(baseUrl, "便宜的", "cheap-laptop-demo");
    const cheaperLaptopProducts = cheaperLaptop.find((item) => item.event === "products")?.data.products || [];
    assert(cheaperLaptopProducts.length > 0, "便宜的 should keep matching candidates");
    assert(
      cheaperLaptopProducts.every((product) => Number(product.price) <= 8499),
      "便宜的 should narrow laptop candidates to the lower price range"
    );

    await requestChat(baseUrl, "想买一台办公轻薄笔记本", "budget-laptop-demo");
    const budgetLaptop = await requestChat(baseUrl, "1万预算", "budget-laptop-demo");
    const budgetLaptopProducts = budgetLaptop.find((item) => item.event === "products")?.data.products || [];
    assert(budgetLaptopProducts.length > 0, "1万预算 should return matching products");
    assert(
      budgetLaptopProducts.every((product) => Number(product.price) <= 10000),
      "1万预算 should filter out products over 10000"
    );

    const appLimitSetup = await requestChat(baseUrl, "想买一台办公轻薄笔记本", "app-limit-budget-demo", [], 6);
    const appLimitSetupProducts = appLimitSetup.find((item) => item.event === "products")?.data.products || [];
    assert(appLimitSetupProducts.length >= 5, "app limit setup should reproduce the client-side six-card scenario");
    const appLimitCheaper = await requestChat(baseUrl, "便宜的", "app-limit-budget-demo", [], 6);
    const appLimitCheaperProducts = appLimitCheaper.find((item) => item.event === "products")?.data.products || [];
    assert(appLimitCheaperProducts.length > 0, "便宜的 should keep lower-price candidates with client limit");
    assert(
      appLimitCheaperProducts.every((product) => Number(product.price) <= 8499),
      "便宜的 with client limit should not keep the expensive half of the previous candidates"
    );
    const appLimitBudget = await requestChat(baseUrl, "1万预算", "app-limit-budget-demo", [], 6);
    const appLimitBudgetProducts = appLimitBudget.find((item) => item.event === "products")?.data.products || [];
    assert(appLimitBudgetProducts.length === 3, "1万预算 with client limit should count exactly the three matching notebook products");
    assert(
      appLimitBudgetProducts.every((product) => Number(product.price) <= 10000),
      "1万预算 with client limit should not display over-budget products"
    );
    const metaQuestion = await requestChat(baseUrl, "整个系列都不推荐吗", "app-limit-budget-demo", [], 6);
    const metaQuestionProducts = metaQuestion.find((item) => item.event === "products")?.data.products || [];
    assert(metaQuestionProducts.length > 0, "candidate meta question should reuse previous candidates instead of searching an empty new need");
    assert(
      metaQuestionProducts.every((product) => Number(product.price) <= 10000),
      "candidate meta question should keep the current filtered candidate set"
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

    const tooLong = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "防晒".repeat(260) })
    });
    const tooLongBody = await tooLong.json();
    assert(tooLong.status === 400, "too long message should return 400 before SSE starts");
    assert(tooLongBody.error.code === "VALIDATION_ERROR", "too long message should use stable validation error code");

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
