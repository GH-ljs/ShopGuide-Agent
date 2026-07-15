// 文件职责：
// 把一次导购请求中的意图、过滤、排序和商品证据整理成“评审模式”协议。
// 这层不参与推荐决策，只负责把后端已经执行过的可信链路解释清楚，方便评委和开发者验证系统没有编造商品事实。
import { buildAgentGraphTrace } from "../agent/graph.js";

function toNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function productEvidenceText(product) {
  return [
    product.title,
    product.brand,
    product.category,
    product.subCategory,
    product.marketingDescription,
    ...(product.userReviews || []).map((item) => item.content),
    ...(product.officialFaq || []).flatMap((item) => [item.question, item.answer]),
    ...(product.skus || []).flatMap((sku) => Object.values(sku.properties || {}))
  ]
    .filter(Boolean)
    .join(" ");
}

function collectEvidenceHits(product, keywords = []) {
  const evidence = productEvidenceText(product);
  return [...new Set(keywords.filter((keyword) => keyword && evidence.includes(keyword)))].slice(0, 8);
}

function buildFilters(state = {}, parsed = {}) {
  const negativeTerms = [...new Set([...(state.excludeTerms || []), ...(parsed.negativeTerms || [])])];
  return {
    category: state.category || parsed.category || "",
    itemType: state.itemIntent?.itemType || parsed.itemIntent || "",
    maxPrice: toNumberOrNull(state.maxPrice ?? parsed.maxPrice),
    minPrice: toNumberOrNull(state.minPrice ?? parsed.minPrice),
    negativeTerms,
    preferences: parsed.preferences || []
  };
}

function buildEvidence(products = [], finalSelection = [], parsed = {}) {
  const selectionMap = new Map(finalSelection.map((item) => [item.productId, item]));
  const keywords = [
    parsed.category,
    parsed.itemIntent,
    ...(parsed.itemIntentTerms || []),
    ...(parsed.negativeTerms || []),
    ...(parsed.preferences || [])
  ].filter(Boolean);

  return products.map((product, index) => {
    const selected = selectionMap.get(product.productId) || {};
    return {
      index: index + 1,
      productId: product.productId,
      title: product.title,
      price: product.basePrice,
      evidenceFields: ["title", "category", "subCategory", "marketingDescription", "officialFaq", "userReviews", "skus"],
      matchedKeywords: collectEvidenceHits(product, keywords),
      score: selected.score ?? null,
      rankScore: selected.rankScore ?? null,
      reason: selected.reason || "通过当前可信范围返回，供回答文本和商品卡片共同使用"
    };
  });
}

export function buildReviewTrace({
  message,
  turnIntent,
  retrievalScope,
  retrievalQuery = "",
  state = {},
  debug = {},
  products = [],
  totalProducts = 0,
  note = "",
  cacheHit = false,
  clarify = null,
  usedModel = false
}) {
  const parsed = debug.parsed || {};
  const counts = debug.counts || {};
  const filters = buildFilters(state, parsed);
  const safeProducts = Array.isArray(products) ? products : [];

  return {
    mode: "review",
    originalMessage: message,
    intent: {
      type: turnIntent?.type || "",
      source: turnIntent?.source || "",
      reason: turnIntent?.reason || "",
      scope: turnIntent?.plan?.scope || retrievalScope || "",
      targetRefs: turnIntent?.plan?.targetRefs || [],
      validatedPlan: turnIntent?.plan || null
    },
    filters,
    retrieval: {
      scope: retrievalScope,
      query: retrievalQuery,
      cacheHit,
      usedVectorStore: Boolean(debug.usedVectorStore ?? debug.vectorMatches?.length),
      totalProducts: counts.totalProducts ?? totalProducts,
      categoryCandidates: counts.categoryCandidates ?? null,
      filteredCandidates: counts.filteredCandidates ?? safeProducts.length,
      vectorMatches: counts.vectorMatches ?? 0,
      returned: counts.finalProducts ?? counts.returned ?? safeProducts.length,
      candidatePreview: debug.candidatePreview || [],
      finalSelection: debug.finalSelection || []
    },
    evidence: buildEvidence(safeProducts, debug.finalSelection || [], parsed),
    graph: buildAgentGraphTrace({
      turnIntent,
      retrievalScope,
      debug,
      clarify,
      usedModel
    }),
    safety: [
      "回答文本、商品卡片和对比卡只能使用本轮返回的 products 候选集合。",
      "商品名、价格、图片、类目和详情字段来自商品库结构化数据。",
      "没有商品库字段支持时，禁止编造库存、优惠券、销量、活动和未出现的功效。",
      "硬过滤由后端执行，LLM 只负责理解和表达，不能越过后端边界新增候选商品。"
    ],
    note
  };
}

export function buildBoundaryReviewTrace({ message, turnIntent, retrievalScope, totalProducts, note }) {
  return buildReviewTrace({
    message,
    turnIntent,
    retrievalScope,
    retrievalQuery: "",
    totalProducts,
    debug: {
      products: [],
      counts: {
        totalProducts,
        filteredCandidates: 0,
        finalProducts: 0
      },
      parsed: {
        category: turnIntent?.parsed?.category || "",
        itemIntent: turnIntent?.parsed?.itemIntent?.itemType || "",
        itemIntentTerms: turnIntent?.parsed?.itemIntent?.terms || [],
        maxPrice: turnIntent?.parsed?.price?.maxPrice ?? null,
        minPrice: turnIntent?.parsed?.price?.minPrice ?? null,
        negativeTerms: turnIntent?.parsed?.negativeTerms || [],
        preferences: turnIntent?.parsed?.preferences || []
      }
    },
    products: [],
    note
  });
}
