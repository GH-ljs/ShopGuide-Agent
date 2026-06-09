// 文件职责：
// 热门查询缓存层。它只缓存“新搜索”这类不依赖当前候选序号的请求结果，
// 用来降低高频相似问题的重复检索和重复模型生成成本。

const DEFAULT_MAX_ENTRIES = 80;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[，。！？、,.!?；;：:\s]/g, "")
    .replace(/(帮我|我想|想要|想买|给我|麻烦|推荐|找|看看|买|一款|一个|适合|的)/g, "")
    .replace(/^(帮我|我想|想要|想买|给我|麻烦)?(推荐|找|看看|买)?/, "")
    .replace(/(有吗|有哪些|哪个好|哪款好|推荐一下)$/, "");
}

function sortedList(value) {
  return [...new Set(value || [])].map((item) => String(item)).filter(Boolean).sort();
}

export function createHotQueryCache(options = {}) {
  const maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const store = new Map();
  const stats = {
    hits: 0,
    misses: 0,
    writes: 0
  };

  function prune(now = Date.now()) {
    for (const [key, entry] of store.entries()) {
      if (now - entry.createdAt > ttlMs) store.delete(key);
    }

    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      if (!oldestKey) break;
      store.delete(oldestKey);
    }
  }

  function get(key, products = []) {
    prune();
    const entry = store.get(key);
    if (!entry) {
      stats.misses += 1;
      return null;
    }

    const productMap = new Map(products.map((product) => [product.productId, product]));
    const restoredProducts = entry.productIds.map((id) => productMap.get(id)).filter(Boolean);
    if (restoredProducts.length !== entry.productIds.length) {
      // 数据集变更后旧缓存可能引用不存在的商品。这里直接失效，避免把过期商品展示给用户。
      store.delete(key);
      stats.misses += 1;
      return null;
    }

    stats.hits += 1;
    entry.lastHitAt = Date.now();
    entry.hitCount += 1;
    return {
      answerText: entry.answerText,
      products: restoredProducts
    };
  }

  function set(key, value) {
    prune();
    store.set(key, {
      answerText: value.answerText,
      productIds: value.products.map((product) => product.productId),
      createdAt: Date.now(),
      lastHitAt: null,
      hitCount: 0
    });
    stats.writes += 1;
  }

  function snapshot() {
    prune();
    return {
      size: store.size,
      maxEntries,
      ttlMs,
      ...stats
    };
  }

  return { get, set, snapshot };
}

export function buildHotQueryCacheKey({ turnIntent, state, message, limit }) {
  const parsed = turnIntent?.parsed || {};
  const itemIntent = state?.itemIntent || parsed.itemIntent || null;
  const category = state?.category || parsed.category || "";
  const maxPrice = Number.isFinite(state?.maxPrice) ? state.maxPrice : parsed.price?.maxPrice ?? null;
  const minPrice = Number.isFinite(state?.minPrice) ? state.minPrice : parsed.price?.minPrice ?? null;
  const negativeTerms = sortedList([...(state?.excludeTerms || []), ...(parsed.negativeTerms || [])]);
  const preferences = sortedList([...(state?.preferences || []), ...(parsed.preferences || [])]);

  // key 使用“结构化语义 + 轻量归一化文本”，让“推荐防晒霜”和“帮我推荐防晒霜”
  // 这类表达能复用结果，同时预算、排除词、偏好不同的问题不会串缓存。
  return JSON.stringify({
    version: 2,
    category,
    itemType: itemIntent?.itemType || "",
    maxPrice,
    minPrice,
    negativeTerms,
    preferences,
    text: normalizeText(message),
    limit
  });
}
