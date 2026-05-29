// 文件职责：
// 共享的中文分词、商品类目识别、价格/否定词解析，避免 retriever 和 memory 重复定义。

export const STOP_WORDS = new Set([
  "推荐","一款","有没有","哪些","适合","帮我","一下","这个","那个","比较","以内","以下","以上"
]);

export const SYNONYMS = {
  洗面奶: ["洁面", "洁面乳", "清洁"],
  蓝牙耳机: ["耳机", "真无线耳机", "降噪"],
  跑鞋: ["跑步鞋", "训练鞋", "公路跑鞋"],
  油皮: ["控油", "混合性皮肤", "油性"],
  轻量: ["轻薄", "轻盈", "轻"]
};

export const CATEGORY_HINTS = [
  { category: "美妆护肤", words: ["护肤", "洗面奶", "面霜", "精华", "防晒", "油皮", "敏感肌", "保湿", "淡纹", "控油"] },
  { category: "数码电子", words: ["手机", "耳机", "蓝牙", "电脑", "平板", "拍照", "续航", "充电", "数码"] },
  { category: "服饰运动", words: ["跑鞋", "运动", "外套", "穿搭", "衣服", "鞋", "服饰", "轻量"] },
  { category: "食品生活", words: ["食品", "零食", "饮料", "生活", "家用", "厨房", "清洁"] }
];

export const ITEM_INTENTS = [
  { itemType: "洁面", trigger: ["洗面奶", "洁面"], terms: ["洗面奶", "洁面", "洁面乳"] },
  { itemType: "耳机", trigger: ["蓝牙耳机", "耳机"], terms: ["蓝牙耳机", "真无线耳机", "耳机"] },
  { itemType: "跑鞋", trigger: ["跑鞋", "跑步鞋"], terms: ["跑鞋", "跑步鞋", "训练鞋"] },
  { itemType: "防晒", trigger: ["防晒霜", "防晒"], terms: ["防晒霜", "防晒乳", "防晒"] }
];

export const PREFERENCE_HINTS = ["清爽", "控油", "保湿", "轻量", "轻薄", "防水", "防汗", "敏感肌", "油皮", "通勤", "户外", "高性价比"];

export function tokenizeForVector(text) {
  const normalized = String(text || "").toLowerCase();
  const latin = normalized.match(/[a-z0-9]+/g) || [];
  const chinese = normalized.match(/[一-龥]{2,}/g) || [];
  const tokens = [];

  for (const phrase of chinese) {
    if (!STOP_WORDS.has(phrase)) tokens.push(phrase);
    for (let size = 2; size <= 4; size += 1) {
      for (let i = 0; i <= phrase.length - size; i += 1) {
        const token = phrase.slice(i, i + size);
        if (!STOP_WORDS.has(token)) tokens.push(token);
      }
    }
  }

  tokens.push(...latin);
  for (const [word, synonyms] of Object.entries(SYNONYMS)) {
    if (normalized.includes(word)) tokens.push(...synonyms);
  }

  return tokens;
}

export function extractPriceConstraint(message) {
  const under = message.match(/(\d+(?:\.\d+)?)\s*元?\s*(以内|以下|内|之内|以下的|以内的)/);
  if (under) return { maxPrice: Number(under[1]) };

  const belowBefore = message.match(/(低于|小于|不超过|不高于)\s*(\d+(?:\.\d+)?)\s*元?/);
  if (belowBefore) return { maxPrice: Number(belowBefore[2]) };

  const above = message.match(/(高于|大于|超过)\s*(\d+(?:\.\d+)?)\s*元?/);
  if (above) return { minPrice: Number(above[2]) };

  return {};
}

export function extractNegativeTerms(message) {
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

export function inferCategory(message) {
  for (const item of CATEGORY_HINTS) {
    if (item.words.some((word) => message.includes(word))) return item.category;
  }
  return "";
}

export function inferItemIntent(message) {
  return ITEM_INTENTS.find((item) => item.trigger.some((word) => message.includes(word))) || null;
}

export function extractPreferences(message) {
  return PREFERENCE_HINTS.filter((word) => message.includes(word));
}
