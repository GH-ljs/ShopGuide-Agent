// 文件职责：
// RAG 检索编排层：先解析用户约束，再做业务过滤，最后交给向量索引排序。
// 这里是“推荐是否靠谱”的核心路径，因此调试信息会尽量暴露每一步的输入、输出和过滤原因。
import { createVectorIndex } from "../vectordb/local.js";
import {
  extractNegativeTerms,
  extractPreferences,
  extractPriceConstraint,
  inferCategory,
  inferItemIntent
} from "../utils/nlp.js";

function matchesItemIntent(product, itemIntent) {
  if (!itemIntent) return true;
  const itemText = `${product.title} ${product.subCategory}`.toLowerCase();
  return itemIntent.terms.some((term) => itemText.includes(term.toLowerCase()));
}

function summarizeProduct(product) {
  return {
    productId: product.productId,
    title: product.title,
    brand: product.brand,
    price: product.basePrice,
    category: product.category,
    subCategory: product.subCategory
  };
}

function collectFilterReasons(product, { itemIntent, maxPrice, minPrice, negativeTerms }) {
  const reasons = [];

  if (!matchesItemIntent(product, itemIntent)) {
    reasons.push(`商品类型不匹配：期望 ${itemIntent.itemType}`);
  }

  if (Number.isFinite(maxPrice) && product.basePrice > maxPrice) {
    reasons.push(`超过预算：${product.basePrice} > ${maxPrice}`);
  }

  if (Number.isFinite(minPrice) && product.basePrice < minPrice) {
    reasons.push(`低于最低价：${product.basePrice} < ${minPrice}`);
  }

  for (const term of negativeTerms) {
    if (term && product.searchableText.includes(term)) {
      reasons.push(`命中排除词：${term}`);
    }
  }

  return reasons;
}

function buildFilterTrace(products, scopedProducts, constraints) {
  const scopedIds = new Set(scopedProducts.map((product) => product.productId));
  const kept = [];
  const rejected = [];

  for (const product of products) {
    if (!scopedIds.has(product.productId)) {
      // 类目过滤是第一道硬边界，先单独记录，方便排查“防晒霜为什么跑到食品类”的问题。
      rejected.push({
        ...summarizeProduct(product),
        stage: "category",
        reasons: [`类目不匹配：${product.category}`]
      });
      continue;
    }

    const reasons = collectFilterReasons(product, constraints);
    if (reasons.length === 0) {
      kept.push({
        ...summarizeProduct(product),
        stage: "business-filter",
        reasons: ["通过类目、商品类型、预算和排除词过滤"]
      });
    } else {
      rejected.push({
        ...summarizeProduct(product),
        stage: "business-filter",
        reasons
      });
    }
  }

  return {
    keptPreview: kept.slice(0, 8),
    rejectedPreview: rejected.slice(0, 12)
  };
}

function textIncludesAny(product, words) {
  const text = `${product.title} ${product.subCategory} ${product.searchableText}`;
  return words.some((word) => word && text.includes(word));
}

function rerankMatches(matches, preferences) {
  return matches
    .map((item) => {
      const preferenceHits = preferences.filter((word) => textIncludesAny(item.product, [word]));
      const subCategoryHit = textIncludesAny(item.product, [item.product.subCategory]) ? 0.02 : 0;
      // 向量分数负责语义相关性，偏好命中负责“控油/轻薄/通勤/无糖”等导购条件。
      // 这里把加权结果单独保留为 rankScore，方便 debug 接口解释最终排序为什么变化。
      const preferenceBoost = preferenceHits.length * 0.06;
      const rankScore = item.score + preferenceBoost + subCategoryHit;
      return {
        ...item,
        preferenceHits,
        rankScore
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore || b.score - a.score || a.product.basePrice - b.product.basePrice);
}

export async function retrieveProducts(products, message, limit = 4, vectorIndex = createVectorIndex(products)) {
  const price = extractPriceConstraint(message);
  const negativeTerms = extractNegativeTerms(message);
  const inferredCategory = inferCategory(message);
  const itemIntent = inferItemIntent(message);

  return retrieveProductsWithState(products, message, {}, limit, vectorIndex, {
    price,
    negativeTerms,
    inferredCategory,
    itemIntent
  });
}

export async function retrieveProductsWithState(
  products,
  message,
  state = {},
  limit = 4,
  vectorIndex = createVectorIndex(products),
  parsed = null
) {
  const debug = await retrieveProductsWithDebug(products, message, state, limit, vectorIndex, parsed);
  return debug.products;
}

export async function retrieveProductsWithDebug(
  products,
  message,
  state = {},
  limit = 4,
  vectorIndex = createVectorIndex(products),
  parsed = null
) {
  const price = parsed?.price || extractPriceConstraint(message);
  // 当前轮的“不想要/不含/排除”会和会话记忆合并，让“不要酒精，便宜点”这类追问仍继承约束。
  const negativeTerms = [...(state.excludeTerms || []), ...(parsed?.negativeTerms || extractNegativeTerms(message))];
  const inferredCategory = state.category || parsed?.inferredCategory || inferCategory(message);
  const itemIntent = state.itemIntent || parsed?.itemIntent || inferItemIntent(message);
  const preferences = extractPreferences(message);
  const maxPrice = Number.isFinite(state.maxPrice) ? state.maxPrice : price.maxPrice;
  const minPrice = Number.isFinite(state.minPrice) ? state.minPrice : price.minPrice;
  const constraints = { itemIntent, maxPrice, minPrice, negativeTerms };
  const hasHardConstraint = Boolean(inferredCategory || itemIntent || maxPrice || minPrice || negativeTerms.length > 0);

  // 先按类目缩小范围，再做商品类型、预算、否定词过滤；这些是后端应当保证的“硬约束”，不能完全交给大模型自由判断。
  const categoryProducts = inferredCategory ? products.filter((product) => product.category === inferredCategory) : products;
  const scopedProducts = categoryProducts.length > 0 ? categoryProducts : products;
  const filterTrace = buildFilterTrace(products, scopedProducts, constraints);

  const candidates = scopedProducts
    .filter((product) => collectFilterReasons(product, constraints).length === 0)
    .sort((a, b) => a.basePrice - b.basePrice);

  const debug = {
    query: message,
    parsed: {
      category: inferredCategory,
      itemIntent: itemIntent?.itemType || "",
      itemIntentTerms: itemIntent?.terms || [],
      maxPrice: maxPrice ?? null,
      minPrice: minPrice ?? null,
      negativeTerms,
      preferences
    },
    counts: {
      totalProducts: products.length,
      categoryCandidates: scopedProducts.length,
      filteredCandidates: candidates.length,
      vectorMatches: 0,
      finalProducts: 0
    },
    filterTrace,
    candidatePreview: candidates.slice(0, 8).map(summarizeProduct),
    vectorMatches: [],
    finalSelection: [],
    products: []
  };

  if (candidates.length === 0) return debug;

  // 硬过滤后的候选再进入向量排序：业务规则保证“不越界”，向量相似度负责在合规商品里找最相关的。
  const ranked = await vectorIndex.search(message, candidates, Math.max(limit * 3, limit));
  const reranked = rerankMatches(ranked, preferences).slice(0, limit);
  const positive = reranked.filter((item) => item.score > 0 || item.rankScore > 0);
  debug.counts.vectorMatches = ranked.length;
  debug.vectorMatches = reranked.map((item) => ({
    ...summarizeProduct(item.product),
    score: Number(item.score.toFixed(6)),
    rankScore: Number(item.rankScore.toFixed(6)),
    preferenceHits: item.preferenceHits
  }));

  if (positive.length === 0 && !hasHardConstraint) return debug;
  // 如果用户给了明确约束但向量分数全为 0，仍返回过滤后的低价候选，避免“明明有符合预算的商品却空答”。
  const selected = positive.length > 0 ? positive : candidates.slice(0, limit).map((product) => ({ product, score: 0 }));

  debug.products = selected.map((item) => item.product);
  debug.finalSelection = selected.map((item) => ({
    ...summarizeProduct(item.product),
    score: Number(item.score.toFixed(6)),
    rankScore: Number((item.rankScore ?? item.score).toFixed(6)),
    preferenceHits: item.preferenceHits || [],
    reason:
      item.score > 0 || item.rankScore > 0
        ? "通过业务过滤，并由向量相似度和偏好命中综合排序选中"
        : "通过业务过滤，向量分数为 0 时按价格兜底选中"
  }));
  debug.counts.finalProducts = debug.products.length;
  return debug;
}
