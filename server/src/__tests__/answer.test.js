// 文件职责：
// 回答构造测试：直接检查本地兜底回答和模型 Prompt 的防幻觉边界。
// 这类测试不调用外部大模型，目的是保证“无商品不硬推、有商品只基于证据回答”的规则不会被后续改坏。
import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { buildComparisonPayload, buildLocalAnswer, buildModelMessages, buildProductCards, buildProductDetail } from "../services/answer.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const products = loadProducts(config.datasetDir);
  const first = products[0];

  const cards = buildProductCards([first]);
  assert(cards[0].productId === first.productId, "product card should keep productId");
  assert(cards[0].imageUrl.includes(encodeURIComponent(first.productId)), "product card should expose imageUrl");

  const detail = buildProductDetail(first);
  assert(detail.officialFaq.length === first.officialFaq.length, "product detail should include FAQ evidence");
  assert(detail.userReviews.length === first.userReviews.length, "product detail should include review evidence");

  const emptyAnswer = buildLocalAnswer("防晒霜但不要含酒精", [], [], {
    category: "美妆护肤",
    itemIntent: { itemType: "防晒" },
    excludeTerms: ["酒精"]
  });
  assert(emptyAnswer.includes("没有找到"), "empty local answer should say no matching product");
  assert(emptyAnswer.includes("不会推荐"), "empty local answer should not force recommendations");

  const productAnswer = buildLocalAnswer("推荐护肤品", [first]);
  assert(productAnswer.includes(first.title), "local answer should mention retrieved product title");
  assert(productAnswer.includes(`**${first.title}**`), "local answer should bold product names for chat rendering");
  assert(productAnswer.includes(String(first.basePrice)), "local answer should use retrieved product price");
  assert(productAnswer.includes("不会额外编造"), "local answer should include anti-hallucination guardrail");

  const compareAnswer = buildLocalAnswer("这几款有什么区别", products.slice(0, 2), [], { answerMode: "compare" });
  assert(compareAnswer.includes("明确结论"), "compare answer should keep a short decision summary");
  assert(compareAnswer.includes("对比卡"), "compare answer should point users to the structured comparison card");
  assert(!compareAnswer.includes("核心差异"), "compare answer should not duplicate comparison card sections");
  assert(!compareAnswer.includes("逐款取舍"), "compare answer should not duplicate comparison card rows");
  assert(!compareAnswer.includes("评价："), "compare answer should not expose raw review snippets");
  assert(!compareAnswer.includes("..."), "compare answer should avoid truncated evidence fragments");

  const decisionAnswer = buildLocalAnswer("我主要通勤，偶尔出差，选哪个？", products.slice(0, 2), [], {
    answerMode: "compare",
    preferences: ["通勤", "出差"]
  });
  assert(decisionAnswer.trim().startsWith("明确结论"), "decision question should put conclusion first");
  assert(decisionAnswer.includes("明确结论"), "decision comparison should give an explicit conclusion");
  assert(decisionAnswer.includes("更推荐第"), "decision comparison should name a recommended candidate index");
  assert(decisionAnswer.includes("通勤"), "decision comparison should explain the user-focused decision dimension");
  assert(!decisionAnswer.includes("匹配到"), "decision reason should read like user-facing advice instead of retrieval implementation");

  const comparisonPayload = buildComparisonPayload("我主要通勤，偶尔出差，选哪个？", products.slice(0, 2), {
    answerMode: "compare",
    preferences: ["通勤", "出差"]
  });
  assert(comparisonPayload?.columns.length === 2, "comparison payload should expose compared product columns");
  assert(comparisonPayload?.rows.length >= 3, "comparison payload should expose stable comparison rows");
  assert(comparisonPayload?.recommendedProductId, "comparison payload should expose recommended product id");
  assert(comparisonPayload?.rows.some((row) => row.label === "价格"), "comparison payload should include price row");

  const beveragePair = products.filter((product) => product.productId === "p_food_014" || product.productId === "p_food_004");
  const beverageComparison = buildComparisonPayload("哪款不那么甜", beveragePair, {
    answerMode: "compare",
    preferences: ["不甜", "低糖"]
  });
  const beverageTradeoff = beverageComparison.rows.find((row) => row.label === "取舍点");
  const beverageScenario = beverageComparison.rows.find((row) => row.label === "适合场景");
  const beverageText = JSON.stringify(beverageComparison);
  assert(!beverageText.includes("肤感"), "beverage comparison should not reuse skincare tags");
  assert(!beverageText.includes("通勤"), "beverage comparison should not reuse commute tags");
  assert(
    beverageTradeoff.values.some((item, index) => item.value !== beverageScenario.values[index].value),
    "comparison tradeoffs and scenarios should not duplicate the same values"
  );

  const sunscreenPair = products.filter((product) => product.productId === "p_beauty_023" || product.productId === "p_beauty_010");
  const priceSafeDecision = buildLocalAnswer("比较2和3", sunscreenPair, [], {
    answerMode: "compare",
    preferences: ["油皮", "控油", "清爽"]
  });
  assert(!priceSafeDecision.includes("如果你更在意价格，第 2 款"), "decision should not call a more expensive product a price backup");

  const referAnswer = buildLocalAnswer("这款具体怎么样", [first], [], { answerMode: "refer" });
  assert(referAnswer.includes("你问的是"), "refer answer should directly explain the referenced product");
  assert(!referAnswer.includes("筛出了"), "refer answer should not sound like a new product search");

  const emptyMessages = buildModelMessages("防晒霜但不要含酒精", [], [], {
    category: "美妆护肤",
    itemIntent: { itemType: "防晒" },
    excludeTerms: ["酒精"]
  });
  const emptyPrompt = emptyMessages.map((item) => item.content).join("\n");
  assert(emptyPrompt.includes("禁止推荐任何商品"), "empty prompt should forbid product recommendation");
  assert(emptyPrompt.includes("不得编造"), "prompt should include anti-hallucination rule");

  const productMessages = buildModelMessages("推荐护肤品", [first]);
  const productPrompt = productMessages.map((item) => item.content).join("\n");
  assert(productPrompt.includes(first.productId), "prompt should include product evidence");
  assert(productPrompt.includes("只使用提供的商品上下文"), "prompt should constrain answer to product context");
  assert(productPrompt.includes("本轮商品卡片会展示 1 个候选商品"), "prompt should bind answer count to product cards");
  assert(productPrompt.includes("不要跳过、不要新增候选之外的商品"), "prompt should forbid extra or skipped products");
  assert(productPrompt.includes("商品名称必须用 Markdown **加粗**"), "prompt should require bold product names");

  const historyMessages = buildModelMessages("1万预算", [first], [
    { role: "user", content: "OLD_USER_NEED" },
    { role: "assistant", content: "SHOULD_NOT_LEAK_OLD_PRODUCTS" }
  ]);
  const historyPrompt = historyMessages.map((item) => item.content).join("\n");
  assert(historyPrompt.includes("OLD_USER_NEED"), "prompt should keep recent user context");
  assert(!historyPrompt.includes("SHOULD_NOT_LEAK_OLD_PRODUCTS"), "prompt should not reuse old assistant product lists as facts");

  const memoryMessages = buildModelMessages("刚才笔记本第三款呢", [first], [], {
    memorySummary: "历史需求；数码电子；笔记本；预算不超过10000元"
  });
  const memoryPrompt = memoryMessages.map((item) => item.content).join("\n");
  assert(memoryPrompt.includes("会话长期摘要"), "prompt should expose long-term memory summary");
  assert(memoryPrompt.includes("预算不超过10000元"), "prompt should include structured long-term memory details");

  console.log("Answer tests passed.");
}

try {
  run();
} catch (error) {
  console.error("Answer tests failed.");
  console.error(error);
  process.exit(1);
}
