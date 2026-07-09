import { TURN_INTENTS } from "./memory.js";

const SHOPPING_SEARCH_SIGNAL = /(推荐|挑|选|有没有|找)/;
const SPECIFIC_SIGNAL =
  /(预算|以内|以下|不超过|低于|高于|\d+|油皮|干皮|敏感|通勤|户外|办公室|学生|老人|儿童|对比|比较|低糖|低卡|清爽|不黏|降噪|轻薄|游戏|办公)/;

const CATEGORY_FALLBACK_OPTIONS = {
  美妆护肤: [
    { label: "通勤清爽", value: "通勤使用，清爽不黏" },
    { label: "户外高防护", value: "户外使用，高倍防护" },
    { label: "敏感肌可用", value: "敏感肌可用，温和不刺激" }
  ],
  食品饮料: [
    { label: "低卡控糖", value: "低卡控糖，适合日常喝" },
    { label: "茶感清爽", value: "茶感清爽，不要太甜" },
    { label: "整箱囤货", value: "整箱囤货，性价比高" }
  ],
  数码电子: [
    { label: "通勤办公", value: "通勤办公，便携稳定" },
    { label: "性能优先", value: "性能优先，配置更强" },
    { label: "预算友好", value: "预算友好，性价比高" }
  ],
  服饰运动: [
    { label: "日常通勤", value: "日常通勤，舒适百搭" },
    { label: "户外运动", value: "户外运动，耐用防护" },
    { label: "轻便透气", value: "轻便透气，长时间穿着舒服" }
  ]
};

const ITEM_FALLBACK_OPTIONS = [
  {
    pattern: /(防晒|防晒霜)/,
    question: "你更在意哪类使用场景？",
    options: CATEGORY_FALLBACK_OPTIONS.美妆护肤
  },
  {
    pattern: /(无糖饮料|饮料|茶饮|汽水)/,
    question: "你想优先按哪个方向挑？",
    options: CATEGORY_FALLBACK_OPTIONS.食品饮料
  },
  {
    pattern: /(耳机|蓝牙耳机|无线耳机)/,
    question: "你主要在什么场景用？",
    options: [
      { label: "通勤降噪", value: "通勤降噪，佩戴稳定" },
      { label: "运动佩戴", value: "运动使用，不容易掉" },
      { label: "音质优先", value: "音质优先，听歌细节好" }
    ]
  },
  {
    pattern: /(笔记本|电脑|轻薄本)/,
    question: "你这台电脑主要用来做什么？",
    options: [
      { label: "办公通勤", value: "办公通勤，轻薄续航好" },
      { label: "学习编程", value: "学习编程，性能稳定" },
      { label: "设计剪辑", value: "设计剪辑，屏幕和性能更强" }
    ]
  }
];

const TRAIT_GROUPS = [
  {
    id: "skin_scenario",
    categories: ["美妆护肤"],
    itemTypes: ["防晒", "洁面", "面霜", "面膜", "精华"],
    question: "你更希望它优先解决哪类使用需求？",
    traits: [
      { label: "油皮清爽", value: "适合油皮，清爽不黏", words: ["油皮", "控油", "清爽", "不黏", "轻薄"] },
      { label: "敏感修护", value: "敏感肌可用，温和修护", words: ["敏感", "修护", "舒缓", "屏障", "温和"] },
      { label: "户外防护", value: "户外使用，防水防汗，防护力强", words: ["户外", "防水", "防汗", "高倍", "SPF50", "PA++++"] }
    ]
  },
  {
    id: "beverage_scenario",
    categories: ["食品饮料"],
    itemTypes: ["饮料", "功能饮料", "咖啡", "牛奶"],
    question: "你想优先按哪个饮用场景筛？",
    traits: [
      { label: "低糖低卡", value: "低糖低卡，日常喝负担小", words: ["无糖", "0糖", "零糖", "低糖", "低卡", "控糖"] },
      { label: "茶感清爽", value: "茶感清爽，不要太甜", words: ["茶", "茉莉", "乌龙", "清爽", "不甜"] },
      { label: "提神补能", value: "提神补能，适合工作学习", words: ["咖啡因", "能量", "提神", "维生素", "功能"] }
    ]
  },
  {
    id: "clothing_scenario",
    categories: ["服饰运动"],
    itemTypes: ["上衣", "速干T恤", "卫衣", "运动裤", "帽子", "鞋", "跑鞋", "背包"],
    question: "你更想按哪个穿着场景挑？",
    traits: [
      { label: "日常通勤", value: "日常通勤，舒适百搭", words: ["通勤", "日常", "百搭", "休闲", "舒适"] },
      { label: "运动训练", value: "运动训练，透气速干", words: ["运动", "训练", "速干", "透气", "轻量"] },
      { label: "户外防护", value: "户外使用，防晒防风，耐用", words: ["户外", "防晒", "防风", "耐磨", "防泼水"] }
    ]
  },
  {
    id: "digital_scenario",
    categories: ["数码电子"],
    itemTypes: ["耳机", "手机", "平板", "笔记本"],
    question: "你主要用在什么场景？",
    traits: [
      { label: "通勤办公", value: "通勤办公，稳定便携", words: ["通勤", "办公", "轻薄", "便携", "降噪"] },
      { label: "性能体验", value: "性能优先，体验更流畅", words: ["性能", "处理器", "高刷", "旗舰", "游戏"] },
      { label: "续航耐用", value: "续航耐用，长时间使用更省心", words: ["续航", "电池", "耐用", "快充", "稳定"] }
    ]
  }
];

export function buildClarifyPayload(message, turnIntent, products = []) {
  if (!shouldClarify(message, turnIntent, products)) return null;

  const candidates = collectScopedProducts(products, turnIntent);
  // 主动追问的业务判断放在后端：前端只展示 clarify 结构，不需要知道“上衣/防晒/饮料”各自应该问什么。
  // 这里先看真实候选商品有哪些差异，再生成选项，避免把前端做成越来越大的品类 if-else 表。
  const dynamicClarify = buildCandidateDifferenceClarify(message, turnIntent, candidates);
  if (dynamicClarify) {
    return dynamicClarify;
  }

  const fallback = buildFallbackClarify(message, turnIntent);
  return fallback ? { ...fallback, source: "fallback_rules", candidateCount: candidates.length } : null;
}

function shouldClarify(message, turnIntent, products) {
  const plannerWantsClarify = turnIntent?.plan?.clarify?.needed === true;
  if (!plannerWantsClarify && !SHOPPING_SEARCH_SIGNAL.test(message)) return false;
  if (SPECIFIC_SIGNAL.test(message)) return false;
  if (![TURN_INTENTS.NEW_SEARCH, TURN_INTENTS.REFINE].includes(turnIntent.type)) return false;
  if (turnIntent.type === TURN_INTENTS.REFINE && !turnIntent?.parsed?.category && !turnIntent?.parsed?.itemIntent) {
    return false;
  }
  if (hasHardOrSoftConstraints(turnIntent)) return false;

  return collectScopedProducts(products, turnIntent).length >= 3;
}

function buildCandidateDifferenceClarify(message, turnIntent, candidates) {
  const plannerDimensions = turnIntent?.plan?.clarify?.dimensions || [];
  // LLM Planner 只提供“倾向问哪个维度”的建议；最终是否能问、问哪些选项，仍由候选商品差异决定。
  // 这样既能利用模型理解宽泛需求，又不会让模型直接编造商品库里不存在的筛选项。
  const traitClarify = buildTraitClarify(message, turnIntent, candidates);
  if (traitClarify) return traitClarify;

  if (plannerDimensions.includes("price") || plannerDimensions.includes("budget")) {
    const priceClarify = buildPriceClarify(message, candidates);
    if (priceClarify) return priceClarify;
  }

  const priceClarify = buildPriceClarify(message, candidates);
  if (priceClarify) return priceClarify;

  return null;
}

function buildTraitClarify(message, turnIntent, candidates) {
  const category = turnIntent?.parsed?.category || "";
  const itemType = turnIntent?.parsed?.itemIntent?.itemType || "";
  const plannerDimensions = turnIntent?.plan?.clarify?.dimensions || [];
  const matchedGroups = TRAIT_GROUPS.filter((item) => {
    const categoryMatched = !item.categories.length || item.categories.includes(category);
    const itemMatched = !itemType || item.itemTypes.includes(itemType);
    return categoryMatched && itemMatched;
  });
  const group =
    matchedGroups.find((item) => plannerDimensions.includes(item.id)) ||
    matchedGroups.find((item) => plannerDimensions.includes("scenario") || plannerDimensions.includes("preference")) ||
    matchedGroups[0];
  if (!group) return null;

  const options = group.traits
    .map((trait) => ({
      label: trait.label,
      value: trait.value,
      count: countTraitHits(candidates, trait.words)
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-Hans"))
    .slice(0, 3)
    .map(({ label, value }) => ({ label, value }));

  if (options.length < 2) return null;
  return {
    baseQuery: message,
    question: group.question,
    options,
    source: "candidate_differences",
    dimension: group.id,
    candidateCount: candidates.length
  };
}

function buildPriceClarify(message, candidates) {
  const prices = candidates.map((product) => Number(product.basePrice)).filter(Number.isFinite).sort((a, b) => a - b);
  if (prices.length < 3) return null;

  const min = prices[0];
  const max = prices[prices.length - 1];
  if (max - min < Math.max(80, max * 0.25)) return null;

  const lowMax = prices[Math.floor((prices.length - 1) / 3)];
  const midMax = prices[Math.floor(((prices.length - 1) * 2) / 3)];
  const options = [
    { label: `${formatPrice(lowMax)}内`, value: `预算不超过${formatPrice(lowMax)}` },
    { label: `${formatPrice(lowMax + 1)}-${formatPrice(midMax)}`, value: `预算在${formatPrice(lowMax + 1)}到${formatPrice(midMax)}之间` },
    { label: `${formatPrice(midMax + 1)}以上`, value: `预算可以高于${formatPrice(midMax)}` }
  ];

  return {
    baseQuery: message,
    question: "你想先按哪个预算区间筛？",
    options,
    source: "candidate_differences",
    dimension: "price",
    candidateCount: candidates.length
  };
}

function buildFallbackClarify(message, turnIntent) {
  const itemRule = ITEM_FALLBACK_OPTIONS.find((rule) => rule.pattern.test(message));
  if (itemRule) {
    return {
      baseQuery: message,
      question: itemRule.question,
      options: itemRule.options
    };
  }

  const category = turnIntent?.parsed?.category || "";
  const options = CATEGORY_FALLBACK_OPTIONS[category];
  if (!options) return null;

  return {
    baseQuery: message,
    question: "你更想按哪个方向筛选？",
    options
  };
}

function hasHardOrSoftConstraints(turnIntent) {
  const parsed = turnIntent?.parsed || {};
  return Boolean(
    Number.isFinite(parsed.price?.maxPrice) ||
      Number.isFinite(parsed.price?.minPrice) ||
      parsed.priceDirection === "lower" ||
      parsed.priceDirection === "higher" ||
      parsed.negativeTerms?.length
  );
}

function collectScopedProducts(products, turnIntent) {
  const category = turnIntent?.parsed?.category || "";
  const itemIntent = turnIntent?.parsed?.itemIntent || null;
  return products.filter((product) => {
    if (category && product.category !== category) return false;
    if (!itemIntent) return true;
    return matchesItemIntent(product, itemIntent);
  });
}

function matchesItemIntent(product, itemIntent) {
  const terms = [itemIntent.itemType, ...(itemIntent.terms || [])].filter(Boolean);
  if (!terms.length) return true;
  const text = `${product.title} ${product.subCategory} ${product.searchableText}`;
  return terms.some((term) => text.includes(term));
}

function countTraitHits(products, words) {
  return products.filter((product) => {
    const text = `${product.title} ${product.subCategory} ${product.searchableText}`;
    return words.some((word) => text.includes(word));
  }).length;
}

function formatPrice(value) {
  const number = Math.max(0, Math.round(Number(value) || 0));
  return `${number}元`;
}
