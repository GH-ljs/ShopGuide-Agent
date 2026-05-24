// 文件职责：
// 基础检索逻辑，包括类目识别、商品类型识别、预算过滤、否定词过滤和本地向量相似度排序。

import { createVectorIndex } from "./vectorStore.js";

const CATEGORY_HINTS = [
  { category: "美妆护肤", words: ["护肤", "洗面奶", "面霜", "精华", "防晒", "油皮", "敏感肌", "保湿", "淡纹", "控油"] },
  { category: "数码电子", words: ["手机", "耳机", "蓝牙", "电脑", "平板", "拍照", "续航", "充电", "数码"] },
  { category: "服饰运动", words: ["跑鞋", "运动", "外套", "穿搭", "衣服", "鞋", "服饰", "轻量"] },
  { category: "食品生活", words: ["食品", "零食", "饮料", "生活", "家用", "厨房", "清洁"] }
];

// 明确商品类型时先收紧候选范围，避免“蓝牙耳机”误召回食品、服装等商品。
const ITEM_INTENTS = [
  { itemType: "洁面", trigger: ["洗面奶", "洁面"], terms: ["洗面奶", "洁面", "洁面乳"] },
  { itemType: "耳机", trigger: ["蓝牙耳机", "耳机"], terms: ["蓝牙耳机", "真无线耳机", "耳机"] },
  { itemType: "跑鞋", trigger: ["跑鞋", "跑步鞋"], terms: ["跑鞋", "跑步鞋", "训练鞋"] },
  { itemType: "防晒", trigger: ["防晒霜", "防晒"], terms: ["防晒霜", "防晒乳", "防晒"] }
];

// 提取预算条件，例如“200 元以下”“不超过 500 元”。
function extractPriceConstraint(message) {
  const under = message.match(/(\d+(?:\.\d+)?)\s*元?\s*(以内|以下|内|之内|以下的|以内的)/);
  if (under) return { max: Number(under[1]) };

  const belowBefore = message.match(/(低于|小于|不超过|不高于)\s*(\d+(?:\.\d+)?)\s*元?/);
  if (belowBefore) return { max: Number(belowBefore[2]) };

  const above = message.match(/(高于|大于|超过)\s*(\d+(?:\.\d+)?)\s*元?/);
  if (above) return { min: Number(above[2]) };

  return {};
}

// 提取否定约束，例如“不要含酒精”“除了耐克”。
function extractNegativeTerms(message) {
  const terms = [];
  const patterns = [/不要([^，。,.；;]+)/g, /不含([^，。,.；;]+)/g, /除了([^，。,.；;]+)/g, /排除([^，。,.；;]+)/g];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(message))) {
      terms.push(match[1].replace(/^含/, "").trim());
    }
  }

  return terms.filter(Boolean);
}

// 根据用户输入中的提示词粗略判断商品大类。
function inferCategory(message) {
  for (const item of CATEGORY_HINTS) {
    if (item.words.some((word) => message.includes(word))) return item.category;
  }
  return "";
}

function inferItemIntent(message) {
  return ITEM_INTENTS.find((item) => item.trigger.some((word) => message.includes(word))) || null;
}

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
  const negativeTerms = [...(state.excludeTerms || []), ...(parsed?.negativeTerms || extractNegativeTerms(message))];
  const inferredCategory = state.category || parsed?.inferredCategory || inferCategory(message);
  const itemIntent = state.itemIntent || parsed?.itemIntent || inferItemIntent(message);
  const maxPrice = Number.isFinite(state.maxPrice) ? state.maxPrice : price.max;
  const minPrice = Number.isFinite(state.minPrice) ? state.minPrice : price.min;
  const hasHardConstraint = Boolean(inferredCategory || itemIntent || maxPrice || minPrice || negativeTerms.length > 0);

  // 先按类目缩小范围，再做商品类型、预算、否定词过滤。
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

  // vectorIndex.search 在 local 模式是同步计算，在 Qdrant 模式是网络请求；await 可同时兼容两种实现。
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
  const selected = positive.length > 0 ? positive : candidates.slice(0, limit).map((product) => ({ product, score: 0 }));

  debug.products = selected.map((item) => item.product);
  debug.counts.finalProducts = debug.products.length;
  return debug;
}
