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
    vectorStore: "local",
    // 记忆评测使用固定 conversationId。这里禁用持久化，避免本地 .env 的 SQLite 旧状态污染回归结果。
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
  const tokenText = events
    .filter((item) => item.event === "token")
    .map((item) => item.data?.content || "")
    .join("");
  const products = events.find((item) => item.event === "products")?.data.products || [];
  const comparison = events.find((item) => item.event === "comparison")?.data.comparison || null;
  return { events, tokenText, products, comparison };
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
      await runCase("缺少候选边界：新会话直接问第二款怎么样不应触发商品检索", async () => {
        const conversationId = "memory-missing-context";
        const response = await chat(baseUrl, conversationId, "第二款怎么样");

        assert(response.products.length === 0, "missing-context question should not return product cards");
        assert(response.tokenText.includes("还没有可参考的候选商品"), "answer should explain missing candidate context");

        const debug = await debugRetrieve(baseUrl, conversationId, "2和3哪个好");
        assert(debug.turnIntent.type === "missing_context", "debug intent should expose missing_context");
        assert(debug.retrievalScope === "missing_context", "debug retrieval scope should explain why retrieval is skipped");

        const explicitNeed = await chat(baseUrl, "memory-missing-context-new-search", "哪款防晒好");
        assert(explicitNeed.products.length > 0, "explicit product type question should still start a new search");
        assert(explicitNeed.products.every((product) => product.subCategory === "防晒"), "explicit product type should return sunscreen products");
      })
    );

    results.push(
      await runCase("非购物边界：明显无关问题不应触发商品检索", async () => {
        const conversationId = "memory-out-of-scope";
        const response = await chat(baseUrl, conversationId, "天气怎么样");

        assert(response.products.length === 0, "out-of-scope question should not return product cards");
        assert(response.tokenText.includes("商品导购"), "answer should explain the shopping-assistant boundary");

        const debug = await debugRetrieve(baseUrl, conversationId, "帮我写论文");
        assert(debug.turnIntent.type === "out_of_scope", "debug intent should expose out_of_scope");
        assert(debug.retrievalScope === "out_of_scope", "debug retrieval scope should explain why retrieval is skipped");

        await chat(baseUrl, conversationId, "推荐一款防晒霜");
        const contextualDebug = await debugRetrieve(baseUrl, conversationId, "天气怎么样");
        assert(contextualDebug.turnIntent.type === "out_of_scope", "out-of-scope should not be swallowed by existing product context");
      })
    );

    results.push(
      await runCase("多需求边界：同一句多个品类先澄清而不是混合检索", async () => {
        const conversationId = "memory-multi-need";
        const response = await chat(baseUrl, conversationId, "想买笔记本和防晒霜");

        assert(response.products.length === 0, "multi-need question should not return a mixed product-card list");
        assert(response.tokenText.includes("多个商品需求"), "answer should ask the user to split product categories");

        const debug = await debugRetrieve(baseUrl, conversationId, "想买笔记本和防晒霜");
        assert(debug.turnIntent.type === "multi_need", "debug intent should expose multi_need");
        assert(debug.retrievalScope === "multi_need", "debug retrieval scope should explain why retrieval is skipped");
      })
    );

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
      await runCase("结构化对比：第二款和第三款只比较被点名候选", async () => {
        const conversationId = "memory-compare";
        const setup = await chat(baseUrl, conversationId, "想买一台办公轻薄笔记本", 6);
        assert(setup.products.length >= 3, "compare setup should keep at least three candidates");

        const compared = await chat(baseUrl, conversationId, "第二款和第三款对比一下", 6);
        assert(compared.products.length === 2, "comparison should only return two referenced products");
        assert(compared.products[0].productId === setup.products[1].productId, "comparison should use original second candidate first");
        assert(compared.products[1].productId === setup.products[2].productId, "comparison should use original third candidate second");
        assert(compared.tokenText.includes("对比卡"), "comparison text should stay short and point to comparison card");
        assert(!compared.tokenText.includes("逐款取舍"), "comparison text should not duplicate comparison card rows");
        assert(compared.comparison?.columns?.length === 2, "comparison event should expose two compared columns");
        assert(
          compared.comparison.columns.map((column) => column.productId).join(",") === compared.products.map((product) => product.productId).join(","),
          "comparison event columns should align with product cards"
        );

        const debug = await debugRetrieve(baseUrl, conversationId, "这两款哪个更适合通勤", 6);
        assert(debug.turnIntent.type === "compare", "follow-up comparison should keep compare intent");
        assert(debug.retrievalScope === "comparison_candidates", "debug scope should show comparison candidates");
      })
    );

    results.push(
      await runCase("对比决策：用户补充通勤场景后给出明确推荐", async () => {
        const conversationId = "memory-compare-decision";
        const setup = await chat(baseUrl, conversationId, "想买一台办公轻薄笔记本", 6);
        assert(setup.products.length >= 3, "decision setup should keep at least three candidates");

        await chat(baseUrl, conversationId, "第二款和第三款对比一下", 6);
        const decision = await chat(baseUrl, conversationId, "我主要通勤，偶尔出差，选哪个？", 6);

        assert(decision.products.length === 2, "decision follow-up should keep the compared pair");
        assert(decision.tokenText.trim().startsWith("明确结论"), "decision answer should put conclusion first");
        assert(decision.tokenText.includes("明确结论"), "decision answer should give explicit conclusion");
        assert(decision.tokenText.includes("更推荐第"), "decision answer should name a recommended index");
        assert(decision.tokenText.includes("通勤"), "decision answer should explain the scenario focus");
        assert(!decision.tokenText.includes("评价："), "decision answer should not expose raw review snippets");
        assert(!decision.tokenText.includes("匹配到"), "decision answer should not describe retrieval implementation details");
      })
    );

    results.push(
      await runCase("序号对比：比较1和3、前两款都能解析正确范围", async () => {
        const conversationId = "memory-compare-ordinal-variants";
        const setup = await chat(baseUrl, conversationId, "推荐一款适合油皮的防晒霜", 6);
        assert(setup.products.length >= 3, "ordinal variant setup should keep at least three candidates");

        const firstAndThird = await chat(baseUrl, conversationId, "比较1和3", 6);
        assert(firstAndThird.products.length === 2, "bare ordinal comparison should return two products");
        assert(firstAndThird.products[0].productId === setup.products[0].productId, "bare ordinal comparison should use first candidate");
        assert(firstAndThird.products[1].productId === setup.products[2].productId, "bare ordinal comparison should use third candidate");

        const firstTwo = await chat(baseUrl, conversationId, "比较下前两款", 6);
        assert(firstTwo.products.length === 2, "front-two comparison should return two products");
        assert(firstTwo.products[0].productId === setup.products[0].productId, "front-two comparison should use first candidate");
        assert(firstTwo.products[1].productId === setup.products[1].productId, "front-two comparison should use second candidate");
      })
    );

    results.push(
      await runCase("数字指代：2怎么样、2和3哪个好能解析到候选序号", async () => {
        const conversationId = "memory-bare-number-reference";
        const setup = await chat(baseUrl, conversationId, "想买一台办公轻薄笔记本", 6);
        assert(setup.products.length >= 3, "bare number setup should keep at least three candidates");

        const second = await chat(baseUrl, conversationId, "2怎么样", 6);
        assert(second.products.length === 1, "bare number refer should return one product");
        assert(second.products[0].productId === setup.products[1].productId, "bare number refer should resolve product 2");

        const compared = await chat(baseUrl, conversationId, "2和3哪个好", 6);
        assert(compared.products.length === 2, "bare number comparison should return two products");
        assert(compared.products[0].productId === setup.products[1].productId, "bare number comparison should use product 2 first");
        assert(compared.products[1].productId === setup.products[2].productId, "bare number comparison should use product 3 second");
      })
    );

    results.push(
      await runCase("数字多指代：2和3如何应比较两个候选而不是单品解释", async () => {
        const conversationId = "memory-bare-number-how";
        const setup = await chat(baseUrl, conversationId, "推荐一款适合油皮的防晒霜", 6);
        assert(setup.products.length >= 3, "bare number how setup should keep at least three candidates");

        const compared = await chat(baseUrl, conversationId, "2和3如何", 6);

        assert(compared.products.length === 2, "2和3如何 should return two compared products");
        assert(compared.products[0].productId === setup.products[1].productId, "2和3如何 should use product 2 first");
        assert(compared.products[1].productId === setup.products[2].productId, "2和3如何 should use product 3 second");
        assert(compared.comparison?.columns?.length === 2, "2和3如何 should emit comparison component data");
      })
    );

    results.push(
      await runCase("对比后偏好：更健康追问应沿用上一轮对比卡片", async () => {
        const conversationId = "memory-healthy-decision";
        const setup = await chat(baseUrl, conversationId, "推荐无糖饮料", 6);
        assert(setup.products.length >= 5, "healthy decision setup should keep at least five beverage candidates");

        const compared = await chat(baseUrl, conversationId, "比较2和5", 6);
        assert(compared.products.length === 2, "setup comparison should return two products");

        const healthy = await chat(baseUrl, conversationId, "我想更健康", 6);

        assert(healthy.products.length === 2, "health preference should keep the compared pair instead of all original candidates");
        assert(healthy.products[0].productId === compared.products[0].productId, "health preference should keep compared product 1");
        assert(healthy.products[1].productId === compared.products[1].productId, "health preference should keep compared product 2");
        assert(healthy.comparison?.columns?.length === 2, "health preference should emit comparison component data");
        assert(healthy.tokenText.includes("明确结论"), "health preference should give a decision answer");
        assert(healthy.tokenText.includes("健康"), "health preference should explain the health-oriented focus");

        const healthyQuestion = await chat(baseUrl, conversationId, "哪个更健康", 6);
        assert(healthyQuestion.products.length === 2, "哪个更健康 should keep the compared pair instead of all original candidates");
        assert(healthyQuestion.products[0].productId === compared.products[0].productId, "哪个更健康 should keep compared product 1");
        assert(healthyQuestion.products[1].productId === compared.products[1].productId, "哪个更健康 should keep compared product 2");
        assert(healthyQuestion.comparison?.columns?.length === 2, "哪个更健康 should emit comparison component data");

        const colloquialHealthy = await chat(baseUrl, conversationId, "哪个健康些", 6);
        assert(colloquialHealthy.products.length === 2, "哪个健康些 should keep the compared pair instead of all original candidates");
        assert(colloquialHealthy.products[0].productId === compared.products[0].productId, "哪个健康些 should keep compared product 1");
        assert(colloquialHealthy.products[1].productId === compared.products[1].productId, "哪个健康些 should keep compared product 2");
        assert(colloquialHealthy.comparison?.columns?.length === 2, "哪个健康些 should emit comparison component data");
      })
    );

    results.push(
      await runCase("对比后单品追问：再问哪款不那么甜仍沿用刚才对比范围", async () => {
        const conversationId = "memory-compare-after-refer-sweetness";
        const setup = await chat(baseUrl, conversationId, "推荐无糖饮料", 6);
        assert(setup.products.length >= 3, "sweetness setup should keep at least three beverage candidates");

        const compared = await chat(baseUrl, conversationId, "比较2和3", 6);
        assert(compared.products.length === 2, "sweetness setup comparison should return two products");

        const namedProduct = compared.products.find((product) => product.brand.includes("农夫山泉")) || compared.products[0];
        const detail = await chat(baseUrl, conversationId, `${namedProduct.brand}这款好像还行`, 6);
        assert(detail.products.length === 1, "name refer after comparison should focus on one product");

        const lessSweet = await chat(baseUrl, conversationId, "哪款不那么甜", 6);
        assert(lessSweet.products.length === 2, "sweetness follow-up should keep the compared pair instead of all original candidates");
        assert(lessSweet.products[0].productId === compared.products[0].productId, "sweetness follow-up should keep compared product 1");
        assert(lessSweet.products[1].productId === compared.products[1].productId, "sweetness follow-up should keep compared product 2");
        assert(lessSweet.comparison?.columns?.length === 2, "sweetness follow-up should emit comparison component data");
      })
    );

    results.push(
      await runCase("对比后维度追问：控油清爽舒适等偏好词不应重新扩大候选", async () => {
        const conversationId = "memory-preference-decision";
        const setup = await chat(baseUrl, conversationId, "推荐一款适合油皮的防晒霜", 6);
        assert(setup.products.length >= 3, "preference decision setup should keep at least three candidates");

        const compared = await chat(baseUrl, conversationId, "比较2和3", 6);
        assert(compared.products.length === 2, "setup comparison should return two products");

        for (const message of ["哪个控油些", "哪款更清爽", "谁更舒适"]) {
          const decision = await chat(baseUrl, conversationId, message, 6);
          assert(decision.products.length === 2, `${message} should keep the compared pair instead of all original candidates`);
          assert(decision.products[0].productId === compared.products[0].productId, `${message} should keep compared product 1`);
          assert(decision.products[1].productId === compared.products[1].productId, `${message} should keep compared product 2`);
          assert(decision.comparison?.columns?.length === 2, `${message} should emit comparison component data`);
        }
      })
    );

    results.push(
      await runCase("商品名指代：对比后追问安热沙这款只返回安热沙", async () => {
        const conversationId = "memory-name-reference";
        const setup = await chat(baseUrl, conversationId, "推荐一款适合油皮的防晒霜", 6);
        const anessa = setup.products.find((product) => product.title.includes("安热沙"));
        assert(anessa, "setup should include Anessa sunscreen candidate");

        await chat(baseUrl, conversationId, "比较下前两款", 6);
        const detail = await chat(baseUrl, conversationId, "安热沙这款如何", 6);

        assert(detail.products.length === 1, "name reference should focus on one product");
        assert(detail.products[0].productId === anessa.productId, "name reference should resolve Anessa from original candidates");
      })
    );

    results.push(
      await runCase("跨需求对比：防晒后能回到笔记本候选做对比", async () => {
        const conversationId = "memory-cross-need-compare";
        const notebooks = await chat(baseUrl, conversationId, "想买一台办公轻薄笔记本", 6);
        assert(notebooks.products.length >= 3, "notebook setup should keep at least three candidates");

        await chat(baseUrl, conversationId, "推荐一款适合油皮的防晒霜", 6);
        const compared = await chat(baseUrl, conversationId, "刚才笔记本第二款和第三款对比一下", 6);

        assert(compared.products.length === 2, "cross-need comparison should return two products");
        assert(compared.products[0].productId === notebooks.products[1].productId, "cross-need comparison should restore notebook second candidate");
        assert(compared.products[1].productId === notebooks.products[2].productId, "cross-need comparison should restore notebook third candidate");
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
