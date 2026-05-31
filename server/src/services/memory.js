// 文件职责：
// 多轮会话记忆层：按 conversationId 在内存中保存对话历史、结构化购物约束和上一轮商品。
// 支持“再便宜点”“不要这个”等省略式追问，让后续检索能继承上下文。

import {
  extractNegativeTerms,
  extractPreferences,
  extractPriceConstraint,
  inferCategory,
  inferItemIntent
} from "../utils/nlp.js";

const MAX_TURNS = 6;
const sessions = new Map();
export const TURN_INTENTS = {
  REFINE: "refine",
  REFER: "refer",
  NEW_SEARCH: "new_search"
};

function createEmptyState() {
  return {
    category: "",
    itemIntent: null,
    maxPrice: null,
    minPrice: null,
    excludeTerms: [],
    preferences: [],
    lastProductIds: []
  };
}

function createEmptySession(conversationId) {
  return {
    conversationId,
    // state 保存“可复用的购物约束”，turns 保存原始对话；两者分开后，检索不必反复猜历史意图。
    state: createEmptyState(),
    turns: [],
    lastProducts: [],
    referenceProducts: []
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
    lastProductIds: session.lastProducts.map((product) => product.productId),
    referenceProductIds: (session.referenceProducts || []).map((product) => product.productId)
  };
}

function normalizeHistoryTurn(raw) {
  const role = raw?.role === "assistant" ? "assistant" : raw?.role === "user" ? "user" : "";
  const content = String(raw?.content || raw?.text || "").trim();
  const productIds = Array.isArray(raw?.productIds)
    ? raw.productIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  if (!role || !content) return null;
  return { role, content, productIds };
}

function restoreProductsByIds(products, productIds) {
  if (!productIds.length) return [];
  const productMap = new Map(products.map((product) => [product.productId, product]));
  return productIds.map((id) => productMap.get(id)).filter(Boolean);
}

function historyAlreadyCovered(session, history) {
  if (history.length === 0) return true;
  if (session.turns.length < history.length) return false;

  const recentTurns = session.turns.slice(-history.length);
  return history.every((turn, index) => {
    const existing = recentTurns[index];
    return existing?.role === turn.role && existing?.content === turn.content;
  });
}

function uniqueMerge(current, incoming) {
  return [...new Set([...(current || []), ...incoming])];
}

function hasReusableContext(session) {
  return Boolean(session.state.category || session.state.itemIntent || session.lastProducts.length > 0 || session.referenceProducts?.length > 0);
}

function isDifferentItemIntent(current, incoming) {
  if (!incoming) return false;
  return current?.itemType !== incoming.itemType;
}

function isDifferentCategory(current, incoming) {
  if (!incoming) return false;
  return current && current !== incoming;
}

function looksLikeReference(message) {
  return /(第[一二三四五六七八九十\d]+[个款]?|这几个|这几款|这两|刚才|上面|前面|上一轮|哪个|哪款|哪一个|对比|比较|不要第|去掉第)/.test(message);
}

function looksLikeRefinement(message, parsed) {
  return Boolean(
    Number.isFinite(parsed.price.maxPrice) ||
      Number.isFinite(parsed.price.minPrice) ||
      parsed.negativeTerms.length > 0 ||
      parsed.preferences.length > 0 ||
      /(再|更|便宜|贵|预算|以内|以下|不超过|不要超过|换个|换一款|轻薄|控油|防水|无糖)/.test(message)
  );
}

export function classifyTurnIntent(session, message) {
  const parsed = {
    category: inferCategory(message),
    itemIntent: inferItemIntent(message),
    price: extractPriceConstraint(message),
    negativeTerms: extractNegativeTerms(message),
    preferences: extractPreferences(message)
  };
  const hasContext = hasReusableContext(session);

  if (hasContext && looksLikeReference(message)) {
    return { type: TURN_INTENTS.REFER, parsed, reason: "用户提到了上一轮商品或候选序号" };
  }

  if (
    !hasContext ||
    isDifferentCategory(session.state.category, parsed.category) ||
    isDifferentItemIntent(session.state.itemIntent, parsed.itemIntent)
  ) {
    return { type: TURN_INTENTS.NEW_SEARCH, parsed, reason: "用户提出了新的商品类目或商品类型" };
  }

  if (looksLikeRefinement(message, parsed)) {
    return { type: TURN_INTENTS.REFINE, parsed, reason: "用户在上一轮需求上追加预算、偏好或排除条件" };
  }

  return { type: TURN_INTENTS.REFINE, parsed, reason: "默认沿用当前导购上下文继续筛选" };
}

export function resetSessionStateForNewSearch(session) {
  // 新品类/新商品需求不能继承上一轮的预算、排除词和偏好，否则会出现“防晒霜条件污染耳机搜索”的问题。
  // 只清空可复用购物约束和上一轮商品，原始 turns 保留给模型理解对话语气，但不再参与硬过滤状态。
  session.state = createEmptyState();
  session.lastProducts = [];
  session.referenceProducts = [];
}

function resolveCheaperBudget(session, message) {
  if (!/(太贵|贵了|再便宜|更便宜|便宜点|便宜的|便宜些|便宜一点|低价|预算低|省钱)/.test(message)) return null;
  const prices = session.lastProducts.map((product) => product.basePrice).filter(Number.isFinite).sort((a, b) => a - b);
  if (prices.length === 0) return null;

  // “便宜点/便宜的”应该明显收窄到上一轮候选的低价区间，而不是只去掉最贵一款。
  // 取低价半区的上界，可以让 6 个笔记本候选收敛到大约 3 个更便宜的候选。
  const lowerHalfMaxIndex = Math.max(0, Math.floor((prices.length - 1) / 2));
  return prices[lowerHalfMaxIndex];
}

function resolvePricierBudget(session, message) {
  if (!/(太便宜|便宜了|贵一点|高端一点|好一点|档次高一点)/.test(message)) return null;
  const prices = session.lastProducts.map((product) => product.basePrice).filter(Number.isFinite);
  if (prices.length === 0) return null;

  // “太便宜了”不是继续降价，而是希望推荐更高价/更高档的候选。
  // 用上一轮最低价作为下限，既能排除最便宜款，又不会把价格门槛抬得过高导致无结果。
  return Math.min(...prices) + 1;
}

export function updateSessionState(session, message) {
  const category = inferCategory(message);
  const itemIntent = inferItemIntent(message);
  const price = extractPriceConstraint(message);
  const cheaperBudget = resolveCheaperBudget(session, message);
  const pricierBudget = resolvePricierBudget(session, message);
  const excludeTerms = extractNegativeTerms(message);
  const preferences = extractPreferences(message);

  // 只在本轮明确提到时覆盖核心约束，未提到的条件继续沿用，形成多轮导购记忆。
  if (category) session.state.category = category;
  if (itemIntent) session.state.itemIntent = itemIntent;
  if (Number.isFinite(price.maxPrice)) session.state.maxPrice = price.maxPrice;
  if (Number.isFinite(price.minPrice)) session.state.minPrice = price.minPrice;
  if (Number.isFinite(cheaperBudget)) {
    session.state.maxPrice = Math.max(0, cheaperBudget);
    session.state.minPrice = null;
  }
  if (Number.isFinite(pricierBudget)) {
    session.state.minPrice = pricierBudget;
    session.state.maxPrice = null;
  }
  session.state.excludeTerms = uniqueMerge(session.state.excludeTerms, excludeTerms);
  session.state.preferences = uniqueMerge(session.state.preferences, preferences);

  return session.state;
}

function ordinalToIndex(text) {
  const map = {
    一: 0,
    二: 1,
    两: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    七: 6,
    八: 7,
    九: 8,
    十: 9
  };
  const match = String(text || "").match(/第\s*([一二两三四五六七八九十]|\d+)\s*[个款]?/);
  if (!match) return null;
  if (/^\d+$/.test(match[1])) return Number(match[1]) - 1;
  return map[match[1]] ?? null;
}

export function resolveReferencedProducts(session, message) {
  const referenceProducts = session.referenceProducts?.length ? session.referenceProducts : session.lastProducts;
  const index = ordinalToIndex(message);
  const shouldExcludeOrdinal = /(不要|去掉|排除|删掉)\s*第/.test(message);
  if (shouldExcludeOrdinal && Number.isInteger(index)) {
    // “不要第一个”属于对上一轮候选的局部排除，只在 lastProducts 里移除对应商品，
    // 而不是把“第一个”当成全库检索条件。
    return referenceProducts.filter((_, itemIndex) => itemIndex !== index);
  }
  if (Number.isInteger(index) && index >= 0 && index < referenceProducts.length) {
    return [referenceProducts[index]];
  }
  return referenceProducts;
}

export function restoreSessionFromHistory(session, rawHistory = [], products = []) {
  if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
    return false;
  }

  const history = rawHistory.map(normalizeHistoryTurn).filter(Boolean).slice(-MAX_TURNS * 2);
  if (history.length === 0) return false;
  if (historyAlreadyCovered(session, history)) return false;

  session.state = createEmptyState();
  session.turns = [];
  session.lastProducts = [];
  session.referenceProducts = [];

  for (const turn of history) {
    // 客户端当前会话历史是多会话切换后的事实来源；当后端内存缺失或与客户端历史不一致时，
    // 用 user 文本重建可复用约束，用 assistant 商品 ID 重建 lastProducts/referenceProducts，避免省略式追问失去参照物。
    if (turn.role === "user") updateSessionState(session, turn.content);

    const restoredProducts = restoreProductsByIds(products, turn.productIds);
    if (restoredProducts.length > 0) {
      const shouldRefreshReference = restoredProducts.length >= (session.referenceProducts?.length || 0);
      rememberProducts(session, restoredProducts, { updateReference: shouldRefreshReference });
    }

    appendTurn(session, turn.role, turn.content);
  }

  return true;
}

export function buildRetrievalQuery(session, message, options = {}) {
  const includeHistory = options.includeHistory !== false;
  const includeProducts = options.includeProducts !== false;
  const recentUserMessages = includeHistory
    ? session.turns
        .filter((turn) => turn.role === "user")
        .slice(-3)
        .map((turn) => turn.content)
    : [];

  const previousProducts = includeProducts
    ? (session.referenceProducts?.length ? session.referenceProducts : session.lastProducts)
        .slice(0, 4)
        .map((product) => `${product.title} ${product.category} ${product.subCategory} ${product.basePrice}元`)
    : [];

  const stateText = [
    session.state.category,
    session.state.itemIntent?.itemType,
    ...(session.state.preferences || []),
    ...(session.state.excludeTerms || []).map((term) => `不要${term}`),
    session.state.maxPrice ? `${session.state.maxPrice}元以下` : "",
    session.state.minPrice ? `${session.state.minPrice}元以上` : ""
  ];

  // 检索 query 合并最近需求、结构化状态和上一轮商品摘要，让省略式追问能继承上下文；
  // new_search 会关闭历史和上一轮商品摘要，避免旧品类污染新需求。
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

export function rememberProducts(session, products, options = {}) {
  const updateReference = options.updateReference !== false;
  session.lastProducts = products;
  if (updateReference) {
    // referenceProducts 是“第几个/这几款”追问的候选基准。普通搜索或继续筛选会刷新它；
    // 单个商品解释这类 refer 回答不会覆盖它，避免用户问完第二款后再问第三款时丢失原始候选列表。
    session.referenceProducts = products;
  }
  session.state.lastProductIds = products.map((product) => product.productId);
}
