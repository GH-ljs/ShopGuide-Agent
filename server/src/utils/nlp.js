// 文件职责：
// 轻量 NLP 工具层：负责把用户自然语言里的类目、商品类型、预算、排除词和偏好词解析成结构化条件。
// 这里不是要替代大模型，而是为 RAG 检索提供可控的“硬边界”，避免模型把明显不相关的商品也说成合适。

export const STOP_WORDS = new Set([
  "推荐",
  "一款",
  "有没有",
  "哪些",
  "适合",
  "帮我",
  "一个",
  "这个",
  "那个",
  "比较",
  "以内",
  "以下",
  "以上",
  "想买"
]);

export const SYNONYMS = {
  洗面奶: ["洁面", "洁面乳", "清洁"],
  蓝牙耳机: ["耳机", "真无线耳机", "降噪"],
  跑鞋: ["跑步鞋", "训练鞋", "公路跑鞋"],
  口红: ["唇釉", "唇部彩妆", "显色"],
  笔记本: ["笔记本电脑", "轻薄本", "电脑"],
  手机: ["智能手机", "拍照", "影像"],
  背包: ["双肩包", "通勤包", "户外包"],
  无糖: ["0糖", "零糖", "低糖"],
  油皮: ["控油", "混合性皮肤", "油性"],
  敏感肌: ["舒缓", "修护", "屏障"],
  轻量: ["轻薄", "轻盈", "轻"],
  户外: ["防水", "防风", "徒步"],
  通勤: ["日常", "办公", "便携"]
};

export const CATEGORY_HINTS = [
  {
    category: "美妆护肤",
    words: [
      "护肤",
      "护肤品",
      "洗面奶",
      "洁面",
      "面霜",
      "面膜",
      "精华",
      "化妆水",
      "眼霜",
      "卸妆",
      "粉底",
      "眉笔",
      "口红",
      "唇釉",
      "彩妆",
      "防晒",
      "油皮",
      "敏感肌",
      "保湿",
      "淡纹",
      "控油"
    ]
  },
  {
    category: "数码电子",
    words: ["手机", "耳机", "蓝牙", "电脑", "笔记本", "平板", "拍照", "续航", "充电", "数码", "办公"]
  },
  {
    category: "服饰运动",
    words: ["跑鞋", "跑步鞋", "篮球鞋", "徒步鞋", "运动", "外套", "穿搭", "衣服", "鞋", "服饰", "轻量", "背包", "通勤包"]
  },
  {
    category: "食品饮料",
    words: ["食品", "零食", "饮料", "无糖", "咖啡", "茶", "牛奶", "酸奶", "生活", "厨房", "清洁"]
  }
];

export const ITEM_INTENTS = [
  { itemType: "洁面", trigger: ["洗面奶", "洁面"], terms: ["洗面奶", "洁面", "洁面乳"] },
  { itemType: "防晒", trigger: ["防晒霜", "防晒"], terms: ["防晒霜", "防晒乳", "防晒"] },
  { itemType: "面霜", trigger: ["面霜", "特护霜", "修复霜"], terms: ["面霜", "特护霜", "修复霜"] },
  { itemType: "面膜", trigger: ["面膜"], terms: ["面膜"] },
  { itemType: "精华", trigger: ["精华", "精华液"], terms: ["精华", "精华液"] },
  { itemType: "唇妆", trigger: ["口红", "唇釉", "唇膏"], terms: ["口红", "唇釉", "唇膏", "唇部彩妆"] },
  { itemType: "耳机", trigger: ["蓝牙耳机", "耳机"], terms: ["蓝牙耳机", "真无线耳机", "耳机"] },
  { itemType: "手机", trigger: ["手机"], terms: ["智能手机", "手机"] },
  { itemType: "笔记本", trigger: ["笔记本", "电脑", "轻薄本"], terms: ["笔记本电脑", "笔记本", "轻薄本"] },
  { itemType: "平板", trigger: ["平板"], terms: ["平板电脑", "平板"] },
  { itemType: "跑鞋", trigger: ["跑鞋", "跑步鞋"], terms: ["跑鞋", "跑步鞋", "训练鞋"] },
  { itemType: "篮球鞋", trigger: ["篮球鞋"], terms: ["篮球鞋"] },
  { itemType: "徒步鞋", trigger: ["徒步鞋"], terms: ["徒步鞋", "户外鞋"] },
  { itemType: "鞋", trigger: ["鞋"], terms: ["跑步鞋", "跑鞋", "篮球鞋", "徒步鞋", "鞋"] },
  { itemType: "背包", trigger: ["背包", "通勤包", "双肩包"], terms: ["背包", "双肩包", "通勤包"] },
  { itemType: "饮料", trigger: ["饮料", "无糖饮料", "茶饮", "气泡水"], terms: ["饮料", "茶饮", "气泡水", "功能饮料", "碳酸饮料"] },
  { itemType: "咖啡", trigger: ["咖啡"], terms: ["咖啡"] },
  { itemType: "牛奶", trigger: ["牛奶"], terms: ["牛奶"] }
];

export const PREFERENCE_HINTS = [
  "清爽",
  "控油",
  "保湿",
  "轻量",
  "轻薄",
  "防水",
  "防汗",
  "敏感肌",
  "油皮",
  "通勤",
  "办公",
  "户外",
  "拍照",
  "影像",
  "续航",
  "无糖",
  "低糖",
  "0糖",
  "高性价比",
  "送女生"
];

export function tokenizeForVector(text) {
  const normalized = String(text || "").toLowerCase();
  const latin = normalized.match(/[a-z0-9]+/g) || [];
  const chinese = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const tokens = [];

  for (const phrase of chinese) {
    if (!STOP_WORDS.has(phrase)) tokens.push(phrase);
    // 中文没有天然空格，滑动窗口能让“推荐油皮防晒霜”拆出“油皮”“防晒”等局部词。
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

function parsePriceNumber(value, unit = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return unit === "万" ? number * 10000 : number;
}

export function extractPriceConstraint(message) {
  const normalized = String(message || "");
  const pricePattern = /(\d+(?:\.\d+)?)\s*(万|元)?/;

  const under = normalized.match(new RegExp(`${pricePattern.source}\\s*(以内|以下|内|之内|以内的|以下的|预算)`));
  if (under) return { maxPrice: parsePriceNumber(under[1], under[2]) };

  const belowBefore = normalized.match(new RegExp(`(低于|小于|不超过|不高于|不要超过|别超过|不能超过|最多|最高|预算不超过|控制在|预算)\\s*${pricePattern.source}`));
  if (belowBefore) return { maxPrice: parsePriceNumber(belowBefore[2], belowBefore[3]) };

  const budgetWan = normalized.match(/(\d+(?:\.\d+)?)\s*万\s*(左右|预算|以内|以下)?/);
  if (budgetWan && /预算|以内|以下|万/.test(normalized)) {
    return { maxPrice: parsePriceNumber(budgetWan[1], "万") };
  }

  const above = normalized.match(new RegExp(`(高于|大于|超过)\\s*${pricePattern.source}`));
  if (above) return { minPrice: parsePriceNumber(above[2], above[3]) };

  return {};
}

export function extractNegativeTerms(message) {
  const terms = [];
  const patterns = [/不要([^，。,.；;]+)/g, /不含([^，。,.；;]+)/g, /除了([^，。,.；;]+)/g, /排除([^，。,.；;]+)/g];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(message))) {
      const term = match[1].replace(/^含/, "").trim();
      // “不要超过200”是预算上限，不是要排除“超过200”这个商品词；否则会污染多轮状态，
      // 并和“超过200”最低价解析互相打架，导致 200 元以内商品反而被过滤掉。
      if (/^(超过|高于|大于|低于|小于|不超过|不高于|不低于|少于|多于)?\s*\d+(?:\.\d+)?\s*(元|万)?$/.test(term)) {
        continue;
      }
      terms.push(term);
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
  const preferences = new Set(PREFERENCE_HINTS.filter((word) => message.includes(word)));
  for (const [word, synonyms] of Object.entries(SYNONYMS)) {
    if (message.includes(word)) {
      for (const synonym of synonyms) preferences.add(synonym);
    }
  }
  return [...preferences];
}
