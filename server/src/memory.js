// 文件职责：
// 用内存保存多轮会话上下文，支持“再便宜点”“不要这个”等追问。

const MAX_TURNS = 6;
const sessions = new Map();

const CATEGORY_HINTS = [
  { category: "美妆护肤", words: ["护肤", "洗面奶", "面霜", "精华", "防晒", "油皮", "敏感肌", "保湿", "淡纹", "控油"] },
  { category: "数码电子", words: ["手机", "耳机", "蓝牙", "电脑", "平板", "拍照", "续航", "充电", "数码"] },
  { category: "服饰运动", words: ["跑鞋", "运动", "外套", "穿搭", "衣服", "鞋", "服饰", "轻量"] },
  { category: "食品生活", words: ["食品", "零食", "饮料", "生活", "家用", "厨房", "清洁"] }
];

const ITEM_INTENTS = [
  { itemType: "洁面", trigger: ["洗面奶", "洁面"], terms: ["洗面奶", "洁面", "洁面乳"] },
  { itemType: "耳机", trigger: ["蓝牙耳机", "耳机"], terms: ["蓝牙耳机", "真无线耳机", "耳机"] },
  { itemType: "跑鞋", trigger: ["跑鞋", "跑步鞋"], terms: ["跑鞋", "跑步鞋", "训练鞋"] },
  { itemType: "防晒", trigger: ["防晒霜", "防晒"], terms: ["防晒霜", "防晒乳", "防晒"] }
];

const PREFERENCE_HINTS = ["清爽", "控油", "保湿", "轻量", "轻薄", "防水", "防汗", "敏感肌", "油皮", "通勤", "户外", "高性价比"];

function createEmptySession(conversationId) {
  return {
    conversationId,
    state: {
      category: "",
      itemIntent: null,
      maxPrice: null,
      minPrice: null,
      excludeTerms: [],
      preferences: [],
      lastProductIds: []
    },
    turns: [],
    lastProducts: []
  };
}

export function getSession(conversationId) {
  const id = conversationId || "default";
  if (!sessions.has(id)) sessions.set(id, createEmptySession(id));
  return sessions.get(id);
}

export function resetSession(conversationId) {
  const id = conversationId || "default";
  sessions.set(id, createEmptySession(id));
  return sessions.get(id);
}

export function snapshotSession(session) {
  return {
    conversationId: session.conversationId,
    state: session.state,
    turnCount: session.turns.length,
    lastProductIds: session.lastProducts.map((product) => product.productId)
  };
}

function extractPriceConstraint(message) {
  const under = message.match(/(\d+(?:\.\d+)?)\s*元?\s*(以内|以下|内|之内|以下的|以内的)/);
  if (under) return { maxPrice: Number(under[1]) };

  const belowBefore = message.match(/(低于|小于|不超过|不高于)\s*(\d+(?:\.\d+)?)\s*元?/);
  if (belowBefore) return { maxPrice: Number(belowBefore[2]) };

  const above = message.match(/(高于|大于|超过)\s*(\d+(?:\.\d+)?)\s*元?/);
  if (above) return { minPrice: Number(above[2]) };

  return {};
}

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

function inferCategory(message) {
  for (const item of CATEGORY_HINTS) {
    if (item.words.some((word) => message.includes(word))) return item.category;
  }
  return "";
}

function inferItemIntent(message) {
  return ITEM_INTENTS.find((item) => item.trigger.some((word) => message.includes(word))) || null;
}

function extractPreferences(message) {
  return PREFERENCE_HINTS.filter((word) => message.includes(word));
}

function uniqueMerge(current, incoming) {
  return [...new Set([...(current || []), ...incoming])];
}

function resolveCheaperBudget(session, message) {
  if (!/(再|更)?便宜|低价|预算低|省钱/.test(message)) return null;
  const prices = session.lastProducts.map((product) => product.basePrice).filter(Number.isFinite);
  if (prices.length === 0) return null;

  // “再便宜点”通常表示从上一轮候选里往低价收敛，而不是必须低于最低价。
  return Math.max(...prices) - 1;
}

export function updateSessionState(session, message) {
  const category = inferCategory(message);
  const itemIntent = inferItemIntent(message);
  const price = extractPriceConstraint(message);
  const cheaperBudget = resolveCheaperBudget(session, message);
  const excludeTerms = extractNegativeTerms(message);
  const preferences = extractPreferences(message);

  if (category) session.state.category = category;
  if (itemIntent) session.state.itemIntent = itemIntent;
  if (Number.isFinite(price.maxPrice)) session.state.maxPrice = price.maxPrice;
  if (Number.isFinite(price.minPrice)) session.state.minPrice = price.minPrice;
  if (Number.isFinite(cheaperBudget)) session.state.maxPrice = Math.max(0, cheaperBudget);
  session.state.excludeTerms = uniqueMerge(session.state.excludeTerms, excludeTerms);
  session.state.preferences = uniqueMerge(session.state.preferences, preferences);

  return session.state;
}

export function buildRetrievalQuery(session, message) {
  const recentUserMessages = session.turns
    .filter((turn) => turn.role === "user")
    .slice(-3)
    .map((turn) => turn.content);

  const previousProducts = session.lastProducts
    .slice(0, 4)
    .map((product) => `${product.title} ${product.category} ${product.subCategory} ${product.basePrice}元`);

  const stateText = [
    session.state.category,
    session.state.itemIntent?.itemType,
    ...(session.state.preferences || []),
    ...(session.state.excludeTerms || []).map((term) => `不要${term}`),
    session.state.maxPrice ? `${session.state.maxPrice}元以下` : "",
    session.state.minPrice ? `${session.state.minPrice}元以上` : ""
  ];

  // 检索 query 合并最近需求和上一轮商品摘要，让省略式追问能继承上下文。
  return [...recentUserMessages, ...stateText, ...previousProducts, message].filter(Boolean).join(" ");
}

export function getRecentTurns(session) {
  return session.turns.slice(-MAX_TURNS);
}

export function appendTurn(session, role, content) {
  session.turns.push({
    role,
    content,
    createdAt: new Date().toISOString()
  });

  if (session.turns.length > MAX_TURNS * 2) {
    session.turns = session.turns.slice(-MAX_TURNS * 2);
  }
}

export function rememberProducts(session, products) {
  session.lastProducts = products;
  session.state.lastProductIds = products.map((product) => product.productId);
}
