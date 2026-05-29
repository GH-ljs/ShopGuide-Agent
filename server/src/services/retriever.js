// 文件职责：
// RAG 检索编排层：解析用户约束，执行类目/商品类型/预算/否定词硬过滤，再调用向量索引排序。
// 对上返回候选商品，对调试接口返回解析结果、候选数量和向量分数，方便解释推荐来源。

import { createVectorIndex } from "../vectordb/local.js";
import {
  extractNegativeTerms,
  extractPriceConstraint,
  inferCategory,
  inferItemIntent
} from "../utils/nlp.js";

function matchesItemIntent(product, itemIntent) {
  if (!itemIntent) return true;
  const itemText = `${product.title} ${product.subCategory}`.toLowerCase();
  return itemIntent.terms.some((term) => itemText.includes(term.toLowerCase()));
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

export async function retrieveProductsWithState(products, message, state = {}, limit = 4, vectorIndex = createVectorIndex(products), parsed = null) {
  const debug = await retrieveProductsWithDebug(products, message, state, limit, vectorIndex, parsed);
  return debug.products;
}

export async function retrieveProductsWithDebug(products, message, state = {}, limit = 4, vectorIndex = createVectorIndex(products), parsed = null) {
  const price = parsed?.price || extractPriceConstraint(message);
  // 当前轮的“不要/排除”和历史会话里的排除词合并，避免用户追问时又推荐已排除的方向。
  const negativeTerms = [...(state.excludeTerms || []), ...(parsed?.negativeTerms || extractNegativeTerms(message))];
  const inferredCategory = state.category || parsed?.inferredCategory || inferCategory(message);
  const itemIntent = state.itemIntent || parsed?.itemIntent || inferItemIntent(message);
  const maxPrice = Number.isFinite(state.maxPrice) ? state.maxPrice : price.maxPrice;
  const minPrice = Number.isFinite(state.minPrice) ? state.minPrice : price.minPrice;
  const hasHardConstraint = Boolean(inferredCategory || itemIntent || maxPrice || minPrice || negativeTerms.length > 0);

  // 先按类目缩小范围，再做商品类型、预算、否定词过滤；这是后端检索里常见的“硬过滤”阶段。
  const categoryProducts = inferredCategory ? products.filter((product) => product.category === inferredCategory) : products;
  const scopedProducts = categoryProducts.length > 0 ? categoryProducts : products;

  const candidates = scopedProducts
    .filter((product) => {
      if (!matchesItemIntent(product, itemIntent)) return false;
      if (maxPrice && product.basePrice > maxPrice) return false;
      if (minPrice && product.basePrice < minPrice) return false;
      return !negativeTerms.some((term) => product.searchableText.includes(term));
    })
    .sort((a, b) => a.basePrice - b.basePrice);

  const debug = {
    query: message,
    parsed: {
      category: inferredCategory,
      itemIntent: itemIntent?.itemType || "",
      maxPrice: maxPrice ?? null,
      minPrice: minPrice ?? null,
      negativeTerms
    },
    counts: {
      totalProducts: products.length,
      categoryCandidates: scopedProducts.length,
      filteredCandidates: candidates.length,
      vectorMatches: 0,
      finalProducts: 0
    },
    candidatePreview: candidates.slice(0, 8).map((product) => ({
      productId: product.productId,
      title: product.title,
      price: product.basePrice,
      category: product.category,
      subCategory: product.subCategory
    })),
    vectorMatches: [],
    products: []
  };

  if (candidates.length === 0) return debug;

  // 硬过滤后的候选再进入向量排序；这样既尊重预算/类目，又让语义相似度决定最终顺序。
  const ranked = await vectorIndex.search(message, candidates, limit);
  const positive = ranked.filter((item) => item.score > 0);
  debug.counts.vectorMatches = ranked.length;
  debug.vectorMatches = ranked.map((item) => ({
    productId: item.product.productId,
    title: item.product.title,
    price: item.product.basePrice,
    score: Number(item.score.toFixed(6))
  }));

  if (positive.length === 0 && !hasHardConstraint) return debug;
  // 如果用户给了明确约束但向量分数为 0，仍返回按价格排序的候选，避免“有条件筛到商品却空答”。
  const selected = positive.length > 0 ? positive : candidates.slice(0, limit).map((product) => ({ product, score: 0 }));

  debug.products = selected.map((item) => item.product);
  debug.counts.finalProducts = debug.products.length;
  return debug;
}
