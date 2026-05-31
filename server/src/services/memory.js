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

function createNeed(session, state = createEmptyState()) {
  const sequence = (session.nextNeedSeq || 0) + 1;
  session.nextNeedSeq = sequence;
  return {
    needId: `need_${sequence}`,
    status: "active",
    state,
    lastProducts: [],
    referenceProducts: []
  };
}

function formatNeedSummary(need) {
  const state = need.state || {};
  const parts = [
    need.status === "active" ? "当前需求" : "历史需求",
    state.category,
    state.itemIntent?.itemType,
    state.maxPrice ? `预算不超过${state.maxPrice}元` : "",
    state.minPrice ? `预算不低于${state.minPrice}元` : "",
    state.preferences?.length ? `偏好:${state.preferences.join("/")}` : "",
    state.excludeTerms?.length ? `排除:${state.excludeTerms.join("/")}` : "",
    need.referenceProducts?.length ? `候选:${need.referenceProducts.slice(0, 3).map((product) => product.title).join("、")}` : ""
  ].filter(Boolean);

  return parts.join("；");
}

export function buildConversationMemorySummary(session) {
  const needSummaries = (session.needs || [])
    .filter((need) => need.state?.category || need.state?.itemIntent || need.referenceProducts?.length)
    .slice(-5)
    .map(formatNeedSummary)
    .filter(Boolean);

  return needSummaries.length ? needSummaries.join("\n") : "";
}

function refreshSessionSummary(session) {
  // summary 是从结构化 needs 派生出来的长期摘要，不直接相信模型自由生成。
  // 它用于给检索和 Prompt 提供长对话背景，但真正的预算、排除词和商品边界仍以 state/products 为准。
  session.summary = buildConversationMemorySummary(session);
}

function createEmptySession(conversationId) {
  const session = {
    conversationId,
    // state 保存“可复用的购物约束”，turns 保存原始对话；两者分开后，检索不必反复猜历史意图。
    state: createEmptyState(),
    turns: [],
    lastProducts: [],
    referenceProducts: [],
    needs: [],
    activeNeedId: "",
    nextNeedSeq: 0,
    summary: ""
  };
  const initialNeed = createNeed(session, session.state);
  session.needs.push(initialNeed);
  session.activeNeedId = initialNeed.needId;
  return session;
}

function getActiveNeed(session) {
  let need = session.needs?.find((item) => item.needId === session.activeNeedId);
  if (!need) {
    need = createNeed(session, session.state || createEmptyState());
    session.needs = [...(session.needs || []), need];
    session.activeNeedId = need.needId;
  }
  return need;
}

function syncSessionFromNeed(session, need = getActiveNeed(session)) {
  // 旧检索链路仍读取 session.state/lastProducts/referenceProducts；active need 是新的结构化记忆源。
  // 每次切换需求时做一次同步，既能逐步升级架构，又不会一次性改动 retriever/answer 的全部入参。
  session.state = need.state || createEmptyState();
  session.lastProducts = need.lastProducts || [];
  session.referenceProducts = need.referenceProducts || [];
}

function persistSessionToActiveNeed(session) {
  const need = getActiveNeed(session);
  need.state = session.state;
  need.lastProducts = session.lastProducts || [];
  need.referenceProducts = session.referenceProducts || [];
  need.status = "active";
  return need;
}

function activateNeed(session, need) {
  for (const item of session.needs || []) {
    item.status = item.needId === need.needId ? "active" : "paused";
  }
  session.activeNeedId = need.needId;
  syncSessionFromNeed(session, need);
  return need;
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
    referenceProductIds: (session.referenceProducts || []).map((product) => product.productId),
    activeNeedId: session.activeNeedId,
    summary: session.summary || buildConversationMemorySummary(session),
    needs: (session.needs || []).map((need) => ({
      needId: need.needId,
      status: need.status,
      category: need.state?.category || "",
      itemType: need.state?.itemIntent?.itemType || "",
      maxPrice: need.state?.maxPrice ?? null,
      minPrice: need.state?.minPrice ?? null,
      candidateProductIds: (need.referenceProducts || []).map((product) => product.productId),
      lastProductIds: (need.lastProducts || []).map((product) => product.productId)
    }))
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

function looksLikeCandidateMetaQuestion(message) {
  // “这些能不能作为备选/是不是都不推荐”是在讨论上一轮候选集合，不是新的商品检索需求。
  // 单独识别这类元问题，可以避免 LLM 把“系列、备选”等词误当成新品类或硬过滤条件。
  return /(这些|这几个|这几款|前面|上面|刚才|上一轮|候选|备选|作为备选|都不推荐|不推荐|推荐吗|能买吗|值得吗|怎么选|选哪个|哪款更好|哪款更合适)/.test(
    message
  );
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

  if (hasContext && (looksLikeReference(message) || looksLikeCandidateMetaQuestion(message))) {
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
  // 新品类/新商品需求不再覆盖旧需求，而是创建新的 active need。
  // 这样同一会话里先聊笔记本、再聊防晒霜、之后又回头问笔记本时，旧候选和预算仍有结构化记录可恢复。
  for (const need of session.needs || []) need.status = "paused";
  const need = createNeed(session, createEmptyState());
  session.needs = [...(session.needs || []), need];
  activateNeed(session, need);
}

function needMatchesParsed(need, parsed = {}) {
  const state = need?.state || {};
  const parsedCategory = parsed.category || "";
  const parsedItemType = parsed.itemIntent?.itemType || "";
  const categoryMatches = !parsedCategory || state.category === parsedCategory;
  const itemMatches = !parsedItemType || state.itemIntent?.itemType === parsedItemType;
  return Boolean((parsedCategory || parsedItemType) && categoryMatches && itemMatches);
}

export function selectNeedForTurn(session, turnIntent) {
  const parsed = turnIntent?.parsed || {};
  const matchingNeed = (session.needs || [])
    .filter((need) => need.needId !== session.activeNeedId)
    .reverse()
    .find((need) => needMatchesParsed(need, parsed));

  if (matchingNeed && (turnIntent.type === TURN_INTENTS.REFER || turnIntent.type === TURN_INTENTS.REFINE)) {
    // “刚才那个笔记本第三款”这类跨需求回看，要先把 active need 切回笔记本，
    // 再让 resolveReferencedProducts 从该 need 的 referenceProducts 中取序号。
    activateNeed(session, matchingNeed);
    return matchingNeed;
  }

  syncSessionFromNeed(session);
  return getActiveNeed(session);
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

export function updateSessionState(session, message, parsedOverride = null) {
  const category = parsedOverride?.category || inferCategory(message);
  const itemIntent = parsedOverride?.itemIntent || inferItemIntent(message);
  const price = parsedOverride?.price || extractPriceConstraint(message);
  const cheaperBudget =
    parsedOverride?.priceDirection === "lower"
      ? resolveCheaperBudget(session, "便宜点")
      : resolveCheaperBudget(session, message);
  const pricierBudget =
    parsedOverride?.priceDirection === "higher"
      ? resolvePricierBudget(session, "太便宜了")
      : resolvePricierBudget(session, message);
  const excludeTerms = parsedOverride?.negativeTerms || extractNegativeTerms(message);
  const preferences = parsedOverride?.preferences || extractPreferences(message);

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

  persistSessionToActiveNeed(session);
  refreshSessionSummary(session);
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
  session.needs = [];
  session.activeNeedId = "";
  session.nextNeedSeq = 0;
  session.summary = "";
  const restoredNeed = createNeed(session, session.state);
  session.needs.push(restoredNeed);
  session.activeNeedId = restoredNeed.needId;

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
  const memorySummary = includeHistory && session.summary ? [`会话长期摘要：${session.summary}`] : [];

  // 检索 query 合并最近需求、结构化状态和上一轮商品摘要，让省略式追问能继承上下文；
  // new_search 会关闭历史和上一轮商品摘要，避免旧品类污染新需求。
  return [...memorySummary, ...recentUserMessages, ...stateText, ...previousProducts, message].filter(Boolean).join(" ");
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
  persistSessionToActiveNeed(session);
  refreshSessionSummary(session);
}
