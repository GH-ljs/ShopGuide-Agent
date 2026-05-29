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

function createEmptySession(conversationId) {
  return {
    conversationId,
    // state 保存“可复用的购物约束”，turns 保存原始对话；两者分开后，检索不必反复猜历史意图。
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

function uniqueMerge(current, incoming) {
  return [...new Set([...(current || []), ...incoming])];
}

function resolveCheaperBudget(session, message) {
  if (!/(再|更)?便宜|低价|预算低|省钱/.test(message)) return null;
  const prices = session.lastProducts.map((product) => product.basePrice).filter(Number.isFinite);
  if (prices.length === 0) return null;

  // "再便宜点"通常表示从上一轮候选里往低价收敛，而不是必须低于最低价。
  return Math.max(...prices) - 1;
}

export function updateSessionState(session, message) {
  const category = inferCategory(message);
  const itemIntent = inferItemIntent(message);
  const price = extractPriceConstraint(message);
  const cheaperBudget = resolveCheaperBudget(session, message);
  const excludeTerms = extractNegativeTerms(message);
  const preferences = extractPreferences(message);

  // 只在本轮明确提到时覆盖核心约束，未提到的条件继续沿用，形成多轮导购记忆。
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

  // 检索 query 合并最近需求、结构化状态和上一轮商品摘要，让省略式追问能继承上下文。
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
