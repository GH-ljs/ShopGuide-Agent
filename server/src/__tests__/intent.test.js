// 意图解析测试：验证没有模型 Key 时会稳定回退到规则解析。
// 这样比赛演示或本地开发即使没有配置外部 LLM，也不会影响 RAG 主链路。
import { parseTurnIntent } from "../services/intent.js";
import { getSession, resetSession, TURN_INTENTS, updateSessionState } from "../services/memory.js";
import { shouldUseDeterministicAnswer } from "../http.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const config = { llmApiKey: "" };
  const session = resetSession("intent-test");
  updateSessionState(session, "推荐一款适合油皮的防晒霜");

  const budgetIntent = await parseTurnIntent(config, getSession("intent-test"), "1万预算");
  assert(budgetIntent.source === "rules", "intent parser should use rules when LLM key is absent");
  assert(budgetIntent.type === TURN_INTENTS.REFINE, "budget follow-up should refine previous need");
  assert(budgetIntent.parsed.price.maxPrice === 10000, "1万预算 should parse to maxPrice=10000");

  const pricierIntent = await parseTurnIntent(config, getSession("intent-test"), "太便宜了");
  assert(pricierIntent.source === "rules", "price direction fallback should stay rule-based without key");
  assert(pricierIntent.type === TURN_INTENTS.REFINE, "太便宜了 should continue the current conversation");

  assert(
    shouldUseDeterministicAnswer({ llmApiKey: "mock-key" }, { type: TURN_INTENTS.REFINE, source: "llm" }, { maxPrice: 10000 }, "1万预算"),
    "budget follow-up should use deterministic answer even when intent parser used LLM"
  );

  const explicitBudgetSession = resetSession("intent-explicit-budget-priority");
  explicitBudgetSession.lastProducts = [
    { productId: "a", title: "170元防晒", category: "美妆护肤", subCategory: "防晒", basePrice: 170 },
    { productId: "b", title: "268元防晒", category: "美妆护肤", subCategory: "防晒", basePrice: 268 },
    { productId: "c", title: "298元防晒", category: "美妆护肤", subCategory: "防晒", basePrice: 298 }
  ];
  updateSessionState(explicitBudgetSession, "不要超过200", {
    price: { maxPrice: 200 },
    priceDirection: "lower",
    negativeTerms: [],
    preferences: []
  });
  assert(
    explicitBudgetSession.state.maxPrice === 200,
    "explicit numeric budget should not be overwritten by LLM priceDirection=lower"
  );

  const compareIntent = await parseTurnIntent(config, getSession("intent-test"), "第二款和第三款对比一下");
  assert(compareIntent.source === "rules", "compare fallback should stay rule-based without key");
  assert(compareIntent.type === TURN_INTENTS.COMPARE, "comparison question should use compare intent");

  const nameReferIntent = await parseTurnIntent(config, getSession("intent-test"), "安热沙这款如何");
  assert(nameReferIntent.type === TURN_INTENTS.REFER, "named product follow-up should refer to previous candidates");

  const mockConfig = {
    llmApiKey: "mock-key",
    llmProvider: "ark",
    arkApiKey: "mock-key",
    arkBaseUrl: "http://mock.local",
    arkModel: "mock-model"
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    body: {},
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              turn_type: "new_search",
              category: "数码电子",
              item_type: "办公用轻薄笔记本",
              max_price: 0,
              negative_terms: ["品牌", "配置"],
              preferences: ["办公", "轻薄"]
            })
          }
        }
      ]
    })
  });

  try {
    const llmSession = resetSession("intent-llm-normalize-test");
    const llmIntent = await parseTurnIntent(mockConfig, llmSession, "想买一台办公用轻薄笔记本");
    assert(llmIntent.source === "llm", "mocked parser should exercise LLM intent path");
    assert(llmIntent.plan.scope === "full_catalog", "new search plan should be constrained to full catalog scope");
    assert(llmIntent.parsed.itemIntent?.itemType === "笔记本", "LLM item_type should normalize to catalog item intent");
    assert(!Number.isFinite(llmIntent.parsed.price.maxPrice), "LLM should not invent a hard budget without price signal");
    assert(llmIntent.parsed.negativeTerms.length === 0, "LLM should not invent negative filters without negative signal");
    assert(llmIntent.plan.hardFilters.negativeTerms.length === 0, "validated plan should drop hallucinated negative filters");

    globalThis.fetch = async () => ({
      ok: true,
      body: {},
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                turn_type: "refine",
                category: "",
                item_type: "",
                max_price: null,
                min_price: null,
                price_direction: "none",
                negative_terms: [],
                preferences: []
              })
            }
          }
        ]
      })
    });
    const nullPriceIntent = await parseTurnIntent(mockConfig, llmSession, "预算多少合适");
    assert(nullPriceIntent.parsed.price.maxPrice !== 0, "LLM null max_price should not become 0");
    assert(nullPriceIntent.parsed.price.minPrice !== 0, "LLM null min_price should not become 0");

    const guardedSession = resetSession("intent-plan-validator-test");
    guardedSession.lastProducts = [
      { productId: "a", title: "候选1", category: "美妆护肤", subCategory: "防晒", basePrice: 100 },
      { productId: "b", title: "候选2", category: "美妆护肤", subCategory: "防晒", basePrice: 120 }
    ];
    guardedSession.referenceProducts = guardedSession.lastProducts;
    globalThis.fetch = async () => ({
      ok: true,
      body: {},
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                turn_type: "refine",
                scope: "full_catalog",
                target_refs: [1, 9],
                focus: ["控油"],
                preferences: ["控油"]
              })
            }
          }
        ]
      })
    });
    const comparePlanIntent = await parseTurnIntent(mockConfig, guardedSession, "哪个控油些");
    assert(comparePlanIntent.type === TURN_INTENTS.COMPARE, "rule-confirmed comparison should not be downgraded by LLM plan");
    assert(comparePlanIntent.plan.scope !== "full_catalog", "comparison plan should not be allowed to expand to full catalog");
    assert(comparePlanIntent.plan.targetRefs.length === 1, "validator should drop target refs outside current candidates");

    globalThis.fetch = async () => ({
      ok: true,
      body: {},
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                turn_type: "compare",
                scope: "last_compared_products",
                preferences: ["清爽"],
                reason: "模型误以为用户仍在比较上一轮防晒候选"
              })
            }
          }
        ]
      })
    });
    const newSearchGuardSession = resetSession("intent-new-search-guard-test");
    updateSessionState(newSearchGuardSession, "推荐一款适合油皮的防晒霜");
    const guardedNewSearchIntent = await parseTurnIntent(mockConfig, newSearchGuardSession, "想买一台办公轻薄笔记本");
    assert(guardedNewSearchIntent.type === TURN_INTENTS.NEW_SEARCH, "rule-confirmed new search should not be downgraded by LLM context");
    assert(guardedNewSearchIntent.plan.scope === "full_catalog", "new search should reset retrieval scope to full catalog");
    assert(guardedNewSearchIntent.parsed.itemIntent?.itemType === "笔记本", "new search should keep the notebook item boundary");

    globalThis.fetch = async () => ({
      ok: true,
      body: {},
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                turn_type: "compare",
                scope: "last_compared_products",
                preferences: ["无糖", "清爽"],
                reason: "模型误把上一轮防晒清爽追问带到无糖饮料"
              })
            }
          }
        ]
      })
    });
    const beverageGuardSession = resetSession("intent-beverage-new-search-guard-test");
    updateSessionState(beverageGuardSession, "推荐一款适合油皮的防晒霜");
    const guardedBeverageIntent = await parseTurnIntent(mockConfig, beverageGuardSession, "推荐无糖饮料");
    assert(guardedBeverageIntent.type === TURN_INTENTS.NEW_SEARCH, "beverage new search should not inherit old comparison intent");
    assert(guardedBeverageIntent.parsed.itemIntent?.itemType === "饮料", "beverage new search should keep beverage item boundary");
    assert(guardedBeverageIntent.parsed.preferences.includes("无糖"), "current beverage preference should be preserved");
    assert(!guardedBeverageIntent.parsed.preferences.includes("清爽"), "stale freshness preference from history should be dropped");

    globalThis.fetch = async () => ({
      ok: true,
      body: {},
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                turn_type: "compare",
                scope: "last_compared_products",
                preferences: ["清爽"],
                max_price: 50
              })
            }
          }
        ]
      })
    });
    const budgetGuardSession = resetSession("intent-budget-refine-guard-test");
    updateSessionState(budgetGuardSession, "推荐无糖饮料");
    const guardedBudgetIntent = await parseTurnIntent(mockConfig, budgetGuardSession, "50预算");
    assert(guardedBudgetIntent.type === TURN_INTENTS.REFINE, "explicit budget follow-up should not be downgraded to compare");
    assert(guardedBudgetIntent.parsed.price.maxPrice === 50, "explicit 50 budget should be preserved");
    assert(!guardedBudgetIntent.parsed.preferences.includes("清爽"), "budget follow-up should not inherit stale freshness preference");

    globalThis.fetch = async () => ({
      ok: true,
      body: {},
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                turn_type: "new_search",
                scope: "full_catalog",
                category: "数码电子",
                item_type: "手机"
              })
            }
          }
        ]
      })
    });
    const referPlanIntent = await parseTurnIntent(mockConfig, guardedSession, "第二款怎么样");
    assert(referPlanIntent.type === TURN_INTENTS.REFER, "refer intent should not be upgraded to new search by LLM plan");
    assert(referPlanIntent.plan.scope === "referenced_products", "refer plan should stay inside referenced products");
    assert(!referPlanIntent.parsed.category, "refer validator should ignore hallucinated category from LLM plan");
    assert(!referPlanIntent.parsed.itemIntent, "refer validator should ignore hallucinated item type from LLM plan");

    globalThis.fetch = async () => ({
      ok: true,
      body: {},
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                turn_type: "out_of_scope",
                is_shopping_guidance: false,
                boundary_reason: "用户要点外卖，这是外卖/订餐服务，不是当前商品库导购"
              })
            }
          }
        ]
      })
    });
    const llmBoundaryIntent = await parseTurnIntent(mockConfig, resetSession("intent-llm-boundary-test"), "给我点外卖");
    assert(llmBoundaryIntent.source === "llm", "boundary cases should go through LLM planner when a key exists");
    assert(llmBoundaryIntent.type === TURN_INTENTS.OUT_OF_SCOPE, "LLM should be allowed to plan out_of_scope");
    assert(llmBoundaryIntent.plan.isShoppingGuidance === false, "out_of_scope plan should mark non-shopping guidance");

    globalThis.fetch = async () => ({
      ok: true,
      body: {},
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                turn_type: "new_search",
                scope: "full_catalog",
                category: "食品饮料",
                item_type: "饮料"
              })
            }
          }
        ]
      })
    });
    const guardedBoundaryIntent = await parseTurnIntent(mockConfig, resetSession("intent-boundary-validator-test"), "给我点外卖");
    assert(guardedBoundaryIntent.type === TURN_INTENTS.OUT_OF_SCOPE, "validator should recover when LLM misplans food delivery as product search");
    assert(guardedBoundaryIntent.plan.validator.boundaryFallbackApplied === true, "boundary validator should expose fallback application");

    globalThis.fetch = async () => ({
      ok: true,
      body: {},
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                turn_type: "multi_need",
                needs_clarification: true,
                clarification_reason: "用户同时提出笔记本和防晒霜两个品类"
              })
            }
          }
        ]
      })
    });
    const llmMultiNeedIntent = await parseTurnIntent(mockConfig, resetSession("intent-llm-multi-need-test"), "想买笔记本和防晒霜");
    assert(llmMultiNeedIntent.type === TURN_INTENTS.MULTI_NEED, "LLM should be allowed to plan multi_need");
    assert(llmMultiNeedIntent.plan.needsClarification === true, "multi_need should request clarification");
  } finally {
    globalThis.fetch = originalFetch;
  }

  updateSessionState(resetSession("intent-meta-reference-test"), "想买一台办公轻薄笔记本");
  const metaIntent = await parseTurnIntent(config, getSession("intent-meta-reference-test"), "整个系列都不推荐吗");
  assert(metaIntent.type === TURN_INTENTS.REFER, "candidate meta question should refer to previous candidates");

  console.log("Intent tests passed.");
}

run().catch((error) => {
  console.error("Intent tests failed.");
  console.error(error);
  process.exit(1);
});
