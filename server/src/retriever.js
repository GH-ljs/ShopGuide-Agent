const CATEGORY_HINTS = [
  { category: "美妆护肤", words: ["护肤", "洗面奶", "面霜", "精华", "防晒", "油皮", "敏感肌", "保湿", "淡纹", "控油"] },
  { category: "数码电子", words: ["手机", "耳机", "蓝牙", "电脑", "平板", "拍照", "续航", "充电", "数码"] },
  { category: "服饰运动", words: ["跑鞋", "运动", "外套", "穿搭", "衣服", "鞋", "服饰", "轻量"] },
  { category: "食品生活", words: ["食品", "零食", "饮料", "生活", "家用", "厨房", "清洁"] }
];

const STOP_WORDS = new Set([
  "推荐",
  "一款",
  "有没有",
  "哪些",
  "适合",
  "帮我",
  "一下",
  "这个",
  "那个",
  "比较",
  "以内",
  "以下",
  "以上"
]);

const SYNONYMS = {
  洗面奶: ["洁面", "洁面乳", "清洁"],
  蓝牙耳机: ["耳机", "真无线耳机", "降噪"],
  跑鞋: ["跑步鞋", "训练鞋", "公路跑鞋"],
  油皮: ["控油", "混合性皮肤", "油性"],
  轻量: ["轻薄", "轻盈", "轻"]
};

const ITEM_INTENTS = [
  { trigger: ["洗面奶", "洁面"], terms: ["洗面奶", "洁面", "洁面乳"] },
  { trigger: ["蓝牙耳机", "耳机"], terms: ["蓝牙耳机", "真无线耳机", "耳机"] },
  { trigger: ["跑鞋", "跑步鞋"], terms: ["跑鞋", "跑步鞋", "训练鞋"] },
  { trigger: ["防晒霜", "防晒"], terms: ["防晒霜", "防晒乳", "防晒"] }
];

function tokenize(text) {
  const normalized = text.toLowerCase();
  const latin = normalized.match(/[a-z0-9]+/g) || [];
  const chinese = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const phraseTokens = [];

  for (const phrase of chinese) {
    if (!STOP_WORDS.has(phrase)) phraseTokens.push(phrase);
    for (let size = 2; size <= 4; size += 1) {
      for (let i = 0; i <= phrase.length - size; i += 1) {
        const token = phrase.slice(i, i + size);
        if (!STOP_WORDS.has(token)) phraseTokens.push(token);
      }
    }
  }

  const expanded = [...latin, ...phraseTokens];
  for (const [word, synonyms] of Object.entries(SYNONYMS)) {
    if (text.includes(word)) expanded.push(...synonyms);
  }

  return expanded;
}

function extractPriceConstraint(message) {
  const under = message.match(/(\d+(?:\.\d+)?)\s*元?\s*(以内|以下|内|之内|以下的|以内的)/);
  if (under) return { max: Number(under[1]) };

  const belowBefore = message.match(/(低于|小于|不超过|不高于)\s*(\d+(?:\.\d+)?)\s*元?/);
  if (belowBefore) return { max: Number(belowBefore[2]) };

  const above = message.match(/(高于|大于|超过)\s*(\d+(?:\.\d+)?)\s*元?/);
  if (above) return { min: Number(above[2]) };

  return {};
}

function extractNegativeTerms(message) {
  const terms = [];
  const patterns = [/不要([^，。,.；;]+)/g, /不含([^，。,.；;]+)/g, /除了([^，。,.；;]+)/g, /排除([^，。,.；;]+)/g];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(message))) {
      terms.push(match[1].trim());
    }
  }

  return terms;
}

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

function scoreProduct(product, tokens, inferredCategory) {
  const haystack = `${product.searchableText} ${product.title} ${product.brand}`.toLowerCase();
  let score = 0;

  if (inferredCategory && product.category === inferredCategory) score += 8;
  for (const token of tokens) {
    if (token.length < 2) continue;
    if (product.title.toLowerCase().includes(token)) score += 5;
    if (product.brand.toLowerCase().includes(token)) score += 3;
    if (haystack.includes(token)) score += 1;
  }

  return score;
}

export function retrieveProducts(products, message, limit = 4) {
  const tokens = tokenize(message);
  const price = extractPriceConstraint(message);
  const negativeTerms = extractNegativeTerms(message);
  const inferredCategory = inferCategory(message);
  const itemIntent = inferItemIntent(message);

  const categoryProducts = inferredCategory ? products.filter((product) => product.category === inferredCategory) : products;
  const scopedProducts = categoryProducts.length > 0 ? categoryProducts : products;

  const candidates = scopedProducts
    .filter((product) => {
      if (!matchesItemIntent(product, itemIntent)) return false;
      if (price.max && product.basePrice > price.max) return false;
      if (price.min && product.basePrice < price.min) return false;
      return !negativeTerms.some((term) => product.searchableText.includes(term));
    })
    .map((product) => ({
      product,
      score: scoreProduct(product, tokens, inferredCategory)
    }))
    .sort((a, b) => b.score - a.score || a.product.basePrice - b.product.basePrice);

  const positive = candidates.filter((item) => item.score > 0).slice(0, limit);
  const fallback = inferredCategory ? candidates.slice(0, limit) : candidates.slice(0, limit);
  const selected = positive.length > 0 ? positive : fallback;

  return selected.map((item) => item.product);
}
