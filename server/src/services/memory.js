// 文件职责：
// 多轮会话记忆层：按 conversationId 在内存中保存对话历史、结构化购物约束和上一轮商品。
// 支持“再便宜点”“不要这个”等省略式追问，让后续检索能继承上下文。

import {
  extractNegativeTerms,
  extractPreferences,
  extractPriceConstraint,
  hasClothingContext,
  hasSunProtectionAsClothingFeature,
  inferCategory,
  inferItemIntent,
  ITEM_INTENTS,
  PREFERENCE_HINTS
} from "../utils/nlp.js";
import { createSessionStore } from "./sessionStore.js";

const MAX_TURNS = 6;
const sessions = new Map();
let sessionStore = createSessionStore({ enabled: false });
export const TURN_INTENTS = {
  REFINE: "refine",
  REFER: "refer",
  COMPARE: "compare",
  MISSING_CONTEXT: "missing_context",
  OUT_OF_SCOPE: "out_of_scope",
  MULTI_NEED: "multi_need",
  NEW_SEARCH: "new_search"
};

function normalizeDeviceId(deviceId) {
  return String(deviceId || "anonymous").trim() || "anonymous";
}

function normalizeConversationId(conversationId) {
  return String(conversationId || "default").trim() || "default";
}

function buildSessionKey(conversationId, deviceId = "anonymous") {
  return `${normalizeDeviceId(deviceId)}::${normalizeConversationId(conversationId)}`;
}

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
    referenceProducts: [],
    comparisonProducts: []
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

export function buildActiveNeedMemorySummary(session) {
  // 回答生成只需要当前 active need 的摘要；跨需求检索才需要完整 summary。
  // 这样“防晒对比 -> 无糖饮料”时，模型不会在新饮料回答里看到旧防晒的“清爽/第二三款”要求。
  return formatNeedSummary(getActiveNeed(session));
}

function refreshSessionSummary(session) {
  // summary 是从结构化 needs 派生出来的长期摘要，不直接相信模型自由生成。
  // 它用于给检索和 Prompt 提供长对话背景，但真正的预算、排除词和商品边界仍以 state/products 为准。
  session.summary = buildConversationMemorySummary(session);
}

function createEmptySession(conversationId, deviceId = "anonymous") {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const session = {
    deviceId: normalizedDeviceId,
    conversationId: normalizedConversationId,
    sessionKey: buildSessionKey(normalizedConversationId, normalizedDeviceId),
    // state 保存“可复用的购物约束”，turns 保存原始对话；两者分开后，检索不必反复猜历史意图。
    state: createEmptyState(),
    turns: [],
    lastProducts: [],
    referenceProducts: [],
    comparisonProducts: [],
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

function hydrateSession(rawSession, conversationId, deviceId) {
  if (!rawSession || typeof rawSession !== "object") return null;
  const normalizedConversationId = normalizeConversationId(conversationId || rawSession.conversationId);
  const normalizedDeviceId = normalizeDeviceId(deviceId || rawSession.deviceId);
  const session = {
    ...createEmptySession(normalizedConversationId, normalizedDeviceId),
    ...rawSession,
    deviceId: normalizedDeviceId,
    conversationId: normalizedConversationId,
    sessionKey: buildSessionKey(normalizedConversationId, normalizedDeviceId)
  };

  // 持久化快照可能来自旧版本。这里补齐默认字段，避免旧数据让多轮记忆链路崩掉。
  session.state = session.state || createEmptyState();
  session.turns = Array.isArray(session.turns) ? session.turns : [];
  session.lastProducts = Array.isArray(session.lastProducts) ? session.lastProducts : [];
  session.referenceProducts = Array.isArray(session.referenceProducts) ? session.referenceProducts : [];
  session.comparisonProducts = Array.isArray(session.comparisonProducts) ? session.comparisonProducts : [];
  session.needs = Array.isArray(session.needs) && session.needs.length ? session.needs : [];
  session.activeNeedId = session.activeNeedId || "";
  session.nextNeedSeq = Number(session.nextNeedSeq || 0);
  if (session.needs.length === 0) {
    const initialNeed = createNeed(session, session.state);
    session.needs.push(initialNeed);
    session.activeNeedId = initialNeed.needId;
  }
  refreshSessionSummary(session);
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
  session.comparisonProducts = need.comparisonProducts || [];
}

function persistSessionToActiveNeed(session) {
  const need = getActiveNeed(session);
  need.state = session.state;
  need.lastProducts = session.lastProducts || [];
  need.referenceProducts = session.referenceProducts || [];
  need.comparisonProducts = session.comparisonProducts || [];
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

export function configureSessionPersistence(options = {}) {
  sessionStore.close?.();
  sessionStore = createSessionStore(options);
  return sessionStore;
}

export function getSession(conversationId, deviceId = "anonymous") {
  const id = normalizeConversationId(conversationId);
  const scopedKey = buildSessionKey(id, deviceId);
  if (sessions.has(scopedKey)) return sessions.get(scopedKey);

  const restoredSession = hydrateSession(sessionStore.load(normalizeDeviceId(deviceId), id), id, deviceId);
  const session = restoredSession || createEmptySession(id, deviceId);
  sessions.set(scopedKey, session);
  return session;
}

export function resetSession(conversationId, deviceId = "anonymous") {
  const id = normalizeConversationId(conversationId);
  const scopedKey = buildSessionKey(id, deviceId);
  const session = createEmptySession(id, deviceId);
  sessions.set(scopedKey, session);
  sessionStore.remove(session.deviceId, session.conversationId);
  return session;
}

export function persistSession(session) {
  if (!session) return;
  // 回答成功后才持久化，避免失败请求污染下一轮上下文；数据库里保存的是结构化 session 快照。
  try {
    sessionStore.save(session);
  } catch (error) {
    // 持久化是“后端重启后恢复上下文”的增强能力，不应阻断本轮导购主链路。
    // 例如 SQLite 短暂被其他进程占用时，用户仍应收到已生成的回答和商品卡片。
    console.warn("[memory] failed to persist session:", error?.message || error);
  }
}

export function clearSessionMemoryForTests(options = {}) {
  sessions.clear();
  if (options.clearStore) sessionStore.clearAll();
}

export function closeSessionPersistenceForTests() {
  sessions.clear();
  sessionStore.close?.();
}

export function getSessionPersistenceSnapshot() {
  return {
    type: sessionStore.type,
    // 健康检查只需要暴露存储类型和文件名，绝对路径属于服务器内部实现细节。
    file: sessionStore.path ? String(sessionStore.path).split(/[\\/]/).pop() : ""
  };
}

export function snapshotSession(session) {
  return {
    deviceId: session.deviceId || "anonymous",
    conversationId: session.conversationId,
    state: session.state,
    turnCount: session.turns.length,
    lastProductIds: session.lastProducts.map((product) => product.productId),
    referenceProductIds: (session.referenceProducts || []).map((product) => product.productId),
    comparisonProductIds: (session.comparisonProducts || []).map((product) => product.productId),
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
      lastProductIds: (need.lastProducts || []).map((product) => product.productId),
      comparisonProductIds: (need.comparisonProducts || []).map((product) => product.productId)
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
  return /(第[一二三四五六七八九十\d]+[个款]?|这款|这一个|这个|这几个|这几款|这两|刚才|上面|前面|上一轮|哪个|哪款|哪一个|对比|比较|不要第|去掉第|如何|怎么样|具体看看)/.test(message);
}

function hasExplicitProductReference(message) {
  return /(第[一二三四五六七八九十\d]+[个款]?|这款|这一个|这个|这几个|这几款|这两|刚才|上面|前面|上一轮)/.test(message);
}

function findMentionedItemTypes(message) {
  const itemTypes = new Set();
  for (const itemIntent of ITEM_INTENTS) {
    if (itemIntent.trigger.some((word) => message.includes(word))) itemTypes.add(itemIntent.itemType);
  }
  if (hasClothingContext(message) && hasSunProtectionAsClothingFeature(message)) {
    itemTypes.delete("防晒");
  }
  return [...itemTypes];
}

function looksLikeMultiNeed(message) {
  const itemTypes = findMentionedItemTypes(message);
  // 同一句里命中两个以上商品类型，并且有“和/以及/顺便/同时”等并列信号时，先让用户拆开。
  // 自动拆成多次检索会让一条 SSE 同时承载多套候选卡片，当前客户端展示协议还不适合这样做。
  return itemTypes.length >= 2 && /(和|以及|还有|也想|顺便|同时|一起|跟|与|、|，)/.test(message);
}

const COMPARISON_DECISION_WORDS = [
  ...PREFERENCE_HINTS,
  "省钱",
  "划算",
  "性价比",
  "自然",
  "安全",
  "低负担",
  "防晒力",
  "性能",
  "音质",
  "便携",
  "甜",
  "甜度",
  "不甜",
  "清淡",
  "低糖"
];

function looksLikePreferenceDecision(message, parsed = {}) {
  const preferenceWords = [...new Set([...(parsed.preferences || []), ...COMPARISON_DECISION_WORDS])].filter(Boolean);
  const hasPreferenceWord = preferenceWords.some((word) => message.includes(word));
  if (!hasPreferenceWord) return false;

  const hasChoiceSubject = /(哪个|哪款|哪一个|谁|选哪|怎么选)/.test(message);
  const hasComparativeTone = /(更|些|一点|点|好|适合|推荐|不那么|没那么|低|少|淡)/.test(message);

  // 这类句子不是新筛选，而是在当前候选里按某个维度做取舍：
  // “哪个控油些 / 哪款更清爽 / 谁更舒适 / 哪个更适合通勤”都应继续走 compare。
  // 维度词来自偏好词表和少量通用取舍词，避免后续每出现一个“健康/控油/舒适”都写一次特判。
  return hasChoiceSubject && hasComparativeTone;
}

function looksLikeComparison(message, parsed = {}) {
  // 对比类问题讨论的是“当前候选之间的差异和取舍”，不是重新从全库找商品。
  // 单独拆成 compare 意图后，后续回答层可以输出更稳定的结构化对比，而不是普通推荐列表。
  return (
    /(对比|比较|区别|差别|不同|哪个更|哪款更|哪一个更|哪个好|哪款好|哪一个好|怎么选|选哪个|更适合|更健康|健康点|健康些|健康一点|哪个健康|哪款健康|哪一个健康|更天然|天然些|优缺点|利弊)/.test(message) ||
    looksLikePreferenceDecision(message, parsed) ||
    /([一二两三四五六七八九十]|\d+)\s*(?:和|跟|与|、|,|，)\s*([一二两三四五六七八九十]|\d+)\s*(?:如何|怎么样|呢)?/.test(message)
  );
}

function looksLikeCandidateMetaQuestion(message) {
  // “这些能不能作为备选/是不是都不推荐”是在讨论上一轮候选集合，不是新的商品检索需求。
  // 单独识别这类元问题，可以避免 LLM 把“系列、备选”等词误当成新品类或硬过滤条件。
  return /(这些|这几个|这几款|前面|上面|刚才|上一轮|候选|备选|作为备选|都不推荐|不推荐|推荐吗|能买吗|值得吗|怎么选|选哪个|哪款更好|哪款更合适)/.test(
    message
  );
}

function looksLikeOutOfScope(message) {
  // 只拦截明显非购物任务，避免误伤“送礼物/夏天用/上班通勤”这类没有明确品类但仍可能是导购需求的表达。
  return /(天气|气温|下雨|新闻|股票|写论文|论文|作业|翻译|写代码|编程|代码报错|讲个笑话|讲故事|考试题|数学题|简历|旅游攻略|外卖|点餐|订餐|叫餐|送餐)/.test(
    message
  );
}

function looksLikeRefinement(message, parsed) {
  return Boolean(
    Number.isFinite(parsed.price.maxPrice) ||
      Number.isFinite(parsed.price.minPrice) ||
      parsed.negativeTerms.length > 0 ||
      parsed.preferences.length > 0 ||
      /(再|更|便宜|贵|预算|以内|以下|不超过|不要超过|换个|换一款|轻薄|控油|防水|无糖|低糖|不甜|甜度|清淡)/.test(message)
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
  const hasNewSearchSignal = Boolean(parsed.category || parsed.itemIntent);

  if (looksLikeMultiNeed(message)) {
    return { type: TURN_INTENTS.MULTI_NEED, parsed, reason: "用户在同一句话中提出了多个商品品类需求" };
  }

  if (
    !hasNewSearchSignal &&
    looksLikeOutOfScope(message) &&
    !hasExplicitProductReference(message) &&
    !looksLikeComparison(message, parsed) &&
    !looksLikeCandidateMetaQuestion(message)
  ) {
    // 明显非购物问题不进入 RAG 检索，避免“天气/论文/代码”等请求被误当成模糊购物需求。
    // 但如果用户问的是“这款下雨能用吗”“第二款写代码够不够”这类仍指向商品的追问，就交给上下文链路继续处理。
    return { type: TURN_INTENTS.OUT_OF_SCOPE, parsed, reason: "用户提出了明显非购物导购问题" };
  }

  if (!hasContext && !hasNewSearchSignal && (looksLikeReference(message) || looksLikeComparison(message, parsed) || looksLikeCandidateMetaQuestion(message))) {
    // “第二款怎么样 / 哪个更好 / 这款呢”必须依赖上一轮候选。没有候选时不能把它误当成新品类搜索，
    // 但“哪款防晒好”这类带明确品类/商品类型的问题仍应作为 new_search 处理。
    // 否则系统会凭空生成一组与用户代词无关的商品，破坏多轮上下文的可信边界。
    return { type: TURN_INTENTS.MISSING_CONTEXT, parsed, reason: "用户在没有当前候选时发起了指代或对比追问" };
  }

  if (hasContext && hasExplicitProductReference(message) && looksLikeComparison(message, parsed)) {
    // “刚才笔记本第二款和第三款对比”同时包含旧商品类型和显式序号。
    // 这里应恢复旧 need 的候选做对比，而不是因为提到“笔记本”就开启一轮全库新搜索。
    return { type: TURN_INTENTS.COMPARE, parsed, reason: "用户明确指向历史候选并要求对比" };
  }

  if (hasContext && hasExplicitProductReference(message) && (looksLikeReference(message) || looksLikeCandidateMetaQuestion(message))) {
    // 显式指代词是比新品类词更强的“回看历史候选”信号，例如“刚才笔记本第三款呢”。
    // 它和“想买一台办公轻薄笔记本”不同：前者要恢复旧候选，后者才要创建新的 active need。
    return { type: TURN_INTENTS.REFER, parsed, reason: "用户明确提到了历史候选或候选序号" };
  }

  if (
    hasNewSearchSignal &&
    (!hasContext ||
      isDifferentCategory(session.state.category, parsed.category) ||
      isDifferentItemIntent(session.state.itemIntent, parsed.itemIntent))
  ) {
    // 明确出现新品类/新商品类型时，先切换到新的 active need，再处理“轻薄、清爽、更适合”等偏好词。
    // 这些词既可能是上一组候选的对比维度，也可能是新需求的普通偏好；商品类型是更强的边界信号，
    // 所以要优先隔离，避免“防晒霜里哪个更清爽”污染后续“办公轻薄笔记本”的检索和回答。
    return { type: TURN_INTENTS.NEW_SEARCH, parsed, reason: "用户提出了新的商品类目或商品类型" };
  }

  if (hasContext && looksLikeComparison(message, parsed)) {
    return { type: TURN_INTENTS.COMPARE, parsed, reason: "用户想比较当前候选商品的差异和适用场景" };
  }

  if (hasContext && (looksLikeReference(message) || looksLikeCandidateMetaQuestion(message))) {
    return { type: TURN_INTENTS.REFER, parsed, reason: "用户提到了上一轮商品或候选序号" };
  }

  if (!hasContext) {
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

  if (matchingNeed && (turnIntent.type === TURN_INTENTS.REFER || turnIntent.type === TURN_INTENTS.REFINE || turnIntent.type === TURN_INTENTS.COMPARE)) {
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
  const hasExplicitPriceBoundary = Number.isFinite(price.maxPrice) || Number.isFinite(price.minPrice);
  const cheaperBudget = hasExplicitPriceBoundary
    ? null
    : parsedOverride?.priceDirection === "lower"
      ? resolveCheaperBudget(session, "便宜点")
      : resolveCheaperBudget(session, message);
  const pricierBudget = hasExplicitPriceBoundary
    ? null
    : parsedOverride?.priceDirection === "higher"
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
    // “便宜点/太便宜了”这类相对价格才根据上一轮候选推导预算；
    // 如果本轮已经说了“不要超过200/1万预算”，明确数字必须优先，不能被 LLM 的 priceDirection 覆盖。
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

function tokenToOrdinalIndex(token) {
  if (/^\d+$/.test(token)) return Number(token) - 1;
  return ordinalToIndex(`第${token}款`);
}

function looksLikeBareOrdinalReference(text) {
  // “2 怎么样”“2和3哪个好”“选2”这类说法没有“第”，但在已有候选上下文里通常就是商品序号。
  // 这里只在带有追问/选择语义时启用，避免把预算、容量、型号里的普通数字误当成商品序号。
  return /(^|\s)([一二两三四五六七八九十]|\d+)\s*(个|款)?\s*(怎么样|如何|呢|好不好|可以吗|能买吗|值得吗|选|哪个好|哪款好|更好|更适合|对比|比较)|(?:选|要|看看|比较|对比)\s*([一二两三四五六七八九十]|\d+)/.test(
    text
  );
}

function ordinalIndexes(text) {
  const rawText = String(text || "");
  const prefixedMatches = [...rawText.matchAll(/第\s*([一二两三四五六七八九十]|\d+)\s*[个款]?/g)];
  const prefixedIndexes = prefixedMatches.map((match) => tokenToOrdinalIndex(match[1]));

  const bareIndexes = [];
  const comparisonPhrase = rawText.match(/(?:比较|对比)?\s*([一二两三四五六七八九十]|\d+)\s*(?:和|跟|与|、|,|，)\s*([一二两三四五六七八九十]|\d+)\s*(?:哪个好|哪款好|更好|更适合|对比|比较)?/);
  if (comparisonPhrase) {
    for (const token of comparisonPhrase.slice(1, 3)) {
      bareIndexes.push(tokenToOrdinalIndex(token));
    }
  }
  if (looksLikeBareOrdinalReference(rawText)) {
    const bareSingleMatches = [...rawText.matchAll(/(?:^|\s|选|要|看看|比较|对比)([一二两三四五六七八九十]|\d+)(?:\s*(?:个|款))?(?=\s|$|怎么样|如何|呢|好不好|可以吗|能买吗|值得吗|和|跟|与|、|,|，|哪个|哪款|更好|更适合|对比|比较)/g)];
    bareIndexes.push(...bareSingleMatches.map((match) => tokenToOrdinalIndex(match[1])));
  }

  const indexes = [...prefixedIndexes, ...bareIndexes]
    .filter((index) => Number.isInteger(index) && index >= 0);
  return [...new Set(indexes)];
}

function normalizeForMatch(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, "");
}

function resolveProductsByName(referenceProducts, message) {
  const normalizedMessage = normalizeForMatch(message);
  if (!normalizedMessage || referenceProducts.length === 0) return [];

  return referenceProducts.filter((product) => {
    const candidates = [
      product.brand,
      product.title,
      ...(product.title || "").split(/\s+/),
      ...(product.brand || "").split(/\s+/)
    ]
      .map(normalizeForMatch)
      .filter((item) => item.length >= 2);

    // 商品名/品牌指代是“安热沙这款”“苹果这款”的核心参照。只在上一轮候选里匹配，
    // 不把它当成全库搜索词，避免用户想看某个候选详情时又重新推荐一整组商品。
    return candidates.some((candidate) => normalizedMessage.includes(candidate) || candidate.includes(normalizedMessage));
  });
}

export function resolveReferencedProducts(session, message) {
  const referenceProducts = session.referenceProducts?.length ? session.referenceProducts : session.lastProducts;
  const [index] = ordinalIndexes(message);
  const shouldExcludeOrdinal = /(不要|去掉|排除|删掉)\s*第/.test(message);
  if (shouldExcludeOrdinal && Number.isInteger(index)) {
    // “不要第一个”属于对上一轮候选的局部排除，只在 lastProducts 里移除对应商品，
    // 而不是把“第一个”当成全库检索条件。
    return referenceProducts.filter((_, itemIndex) => itemIndex !== index);
  }
  if (Number.isInteger(index) && index >= 0 && index < referenceProducts.length) {
    return [referenceProducts[index]];
  }
  const nameMatchedProducts = resolveProductsByName(referenceProducts, message);
  if (nameMatchedProducts.length > 0) return nameMatchedProducts.slice(0, 1);
  return referenceProducts;
}

export function resolveComparisonProducts(session, message) {
  const referenceProducts = session.referenceProducts?.length ? session.referenceProducts : session.lastProducts;
  const recentComparisonProducts = session.comparisonProducts?.length ? session.comparisonProducts : [];
  if (/(前两|前2|前二)/.test(message)) {
    return referenceProducts.slice(0, 2);
  }
  const indexes = ordinalIndexes(message);
  if (indexes.length > 0) {
    // “第二款和第三款对比”应只拿被点名的商品，否则文字对比和卡片数量会不一致。
    // 如果用户只点了一个序号，就补上当前候选中前几个商品，保证仍能形成可比较对象。
    const selected = indexes.map((index) => referenceProducts[index]).filter(Boolean);
    if (selected.length >= 2) return selected;
    if (selected.length === 1) {
      return [selected[0], ...referenceProducts.filter((product) => product.productId !== selected[0].productId).slice(0, 2)];
    }
    return [];
  }

  if (/(这两|两款|两个|这两个)/.test(message) && (recentComparisonProducts.length >= 2 || session.lastProducts?.length >= 2)) {
    // 连续对比里用户常说“这两款哪个更适合通勤”，此时参照物应是上一轮已经收窄出的对比集合，
    // 而不是最初推荐列表的前三个，否则会把未参与上一轮对比的商品重新带进来。
    return (recentComparisonProducts.length >= 2 ? recentComparisonProducts : session.lastProducts).slice(0, 2);
  }

  if (
    (/(选哪个|哪个好|哪款好|哪个更|哪款更|更适合|更推荐|更健康|健康点|健康些|健康一点|哪个健康|哪款健康|哪一个健康|更天然|天然些)/.test(message) ||
      looksLikePreferenceDecision(message, { preferences: extractPreferences(message) })) &&
    (recentComparisonProducts.length >= 2 || session.lastProducts?.length >= 2) &&
    ((recentComparisonProducts.length >= 2 && recentComparisonProducts.length < referenceProducts.length) ||
      session.lastProducts.length < referenceProducts.length)
  ) {
    // 用户在对比之后可能先追问某一款，再补一句“哪款不那么甜/哪个更清爽”。
    // 单品追问会把 lastProducts 缩成 1 个，因此这里优先使用最近一次 comparisonProducts，
    // 保证后续取舍仍发生在刚比较过的商品之间，而不是退回第一轮全部候选。
    return recentComparisonProducts.length >= 2 ? recentComparisonProducts : session.lastProducts;
  }

  const nameMatchedProducts = resolveProductsByName(referenceProducts, message);
  if (nameMatchedProducts.length > 0) {
    return nameMatchedProducts.length >= 2
      ? nameMatchedProducts.slice(0, 3)
      : [nameMatchedProducts[0], ...referenceProducts.filter((product) => product.productId !== nameMatchedProducts[0].productId).slice(0, 2)];
  }

  // 未点名具体序号时，默认比较当前候选列表的前 3 个，既能覆盖“这几款怎么选”，又避免一次比较过多导致回答冗长。
  return referenceProducts.slice(0, 3);
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
  session.comparisonProducts = [];
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
  const updateComparison = options.updateComparison === true;
  session.lastProducts = products;
  if (updateReference) {
    // referenceProducts 是“第几个/这几款”追问的候选基准。普通搜索或继续筛选会刷新它；
    // 单个商品解释这类 refer 回答不会覆盖它，避免用户问完第二款后再问第三款时丢失原始候选列表。
    session.referenceProducts = products;
    session.comparisonProducts = [];
  }
  if (updateComparison) {
    // comparisonProducts 只记录最近一次结构化对比范围。它和 referenceProducts 分开保存，
    // 这样“比较2和3 -> 追问第2款 -> 哪款不那么甜”仍能回到刚比较过的两款里决策。
    session.comparisonProducts = products;
  }
  session.state.lastProductIds = products.map((product) => product.productId);
  persistSessionToActiveNeed(session);
  refreshSessionSummary(session);
}
