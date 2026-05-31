// 文件职责：
// 回答构造测试：直接检查本地兜底回答和模型 Prompt 的防幻觉边界。
// 这类测试不调用外部大模型，目的是保证“无商品不硬推、有商品只基于证据回答”的规则不会被后续改坏。
import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { buildLocalAnswer, buildModelMessages, buildProductCards, buildProductDetail } from "../services/answer.js";

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
  assert(productAnswer.includes(String(first.basePrice)), "local answer should use retrieved product price");
  assert(productAnswer.includes("不会额外编造"), "local answer should include anti-hallucination guardrail");

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

  const historyMessages = buildModelMessages("1万预算", [first], [
    { role: "user", content: "OLD_USER_NEED" },
    { role: "assistant", content: "SHOULD_NOT_LEAK_OLD_PRODUCTS" }
  ]);
  const historyPrompt = historyMessages.map((item) => item.content).join("\n");
  assert(historyPrompt.includes("OLD_USER_NEED"), "prompt should keep recent user context");
  assert(!historyPrompt.includes("SHOULD_NOT_LEAK_OLD_PRODUCTS"), "prompt should not reuse old assistant product lists as facts");

  console.log("Answer tests passed.");
}

try {
  run();
} catch (error) {
  console.error("Answer tests failed.");
  console.error(error);
  process.exit(1);
}
