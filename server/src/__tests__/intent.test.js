// 意图解析测试：验证没有模型 Key 时会稳定回退到规则解析。
// 这样比赛演示或本地开发即使没有配置外部 LLM，也不会影响 RAG 主链路。
import { parseTurnIntent } from "../services/intent.js";
import { getSession, resetSession, TURN_INTENTS, updateSessionState } from "../services/memory.js";

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
    assert(llmIntent.parsed.itemIntent?.itemType === "笔记本", "LLM item_type should normalize to catalog item intent");
    assert(!Number.isFinite(llmIntent.parsed.price.maxPrice), "LLM should not invent a hard budget without price signal");
    assert(llmIntent.parsed.negativeTerms.length === 0, "LLM should not invent negative filters without negative signal");
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
