// 文件职责：
// 意图解析层位于“用户输入”和“商品检索”之间。它优先让 LLM 把自然语言追问解析成结构化 JSON，
// 再由后端校验并执行硬过滤；如果没有 API Key 或模型返回异常，则回退到 memory.js 里的规则解析。
import { completeModelText } from "./llm.js";
import { CATEGORY_HINTS, ITEM_INTENTS } from "../utils/nlp.js";
import { classifyTurnIntent, snapshotSession, TURN_INTENTS } from "./memory.js";

const VALID_TURN_TYPES = new Set(Object.values(TURN_INTENTS));
const VALID_CATEGORIES = new Set(CATEGORY_HINTS.map((item) => item.category));
const VALID_SCOPES = new Set(["full_catalog", "current_need", "last_products", "last_compared_products", "referenced_products"]);
const VALID_CLARIFY_DIMENSIONS = new Set(["scenario", "preference", "budget", "skin_scenario", "beverage_scenario", "clothing_scenario", "digital_scenario", "price"]);
const BOUNDARY_TURN_TYPES = new Set([TURN_INTENTS.MISSING_CONTEXT, TURN_INTENTS.OUT_OF_SCOPE, TURN_INTENTS.MULTI_NEED]);

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function normalizeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeClarifyDimensions(value) {
  return normalizeStringArray(value).filter((item) => VALID_CLARIFY_DIMENSIONS.has(item));
}

function filterCurrentTurnPreferences(modelPreferences, fallbackPreferences, message) {
  const fallbackSet = new Set(fallbackPreferences || []);
  // 软偏好也必须有本轮用户输入作为依据。LLM 能看到 current_session，很容易把历史里的“清爽/控油”
  // 带到新的“无糖饮料”需求里；这里只保留规则层已识别或原文直接出现的偏好词。
  return modelPreferences.filter((item) => fallbackSet.has(item) || String(message || "").includes(item));
}

function isBoundaryTurnType(type) {
  return BOUNDARY_TURN_TYPES.has(type);
}

function findItemIntent(itemType) {
  const normalized = normalizeString(itemType);
  if (!normalized) return null;
  return (
    ITEM_INTENTS.find(
      (item) =>
        item.itemType === normalized ||
        normalized.includes(item.itemType) ||
        item.trigger.some((trigger) => trigger === normalized || normalized.includes(trigger) || trigger.includes(normalized))
    ) || null
  );
}

function hasPriceSignal(message) {
  return /(\d|万|元|预算|价格|价位|便宜|贵|高端|低价|以内|以下|不超过|最多|控制在)/.test(message);
}

function hasNegativeSignal(message) {
  return /(不要|不含|排除|除了|去掉|避开|别要)/.test(message);
}

function extractJsonObject(text) {
  const raw = normalizeString(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  }
}

function buildIntentParserMessages(session, message, fallbackIntent) {
  const referenceProducts = session.referenceProducts?.length ? session.referenceProducts : session.lastProducts;
  const productContext = referenceProducts.slice(0, 8).map((product, index) => ({
    index: index + 1,
    product_id: product.productId,
    title: product.title,
    category: product.category,
    sub_category: product.subCategory,
    price: product.basePrice
  }));

  return [
    {
      role: "system",
      content: [
        "你是电商导购 Agent 的意图解析器，只输出 JSON，不输出解释。",
        "你的任务是理解用户本轮话的真实含义，例如“太便宜了”表示想提高价位，“便宜点”表示想降低价位，“1万预算”表示 max_price=10000。",
        "你还要判断这句话是否仍属于商品导购边界：外卖/订餐服务、天气、写论文、写代码等不是商品库导购；一句话同时要两个无关品类时需要先澄清。",
        "你只负责解析和规划，不负责推荐商品；商品是否符合条件必须交给后端检索和硬过滤。",
        "字段：turn_type 只能是 new_search/refine/refer/compare/missing_context/out_of_scope/multi_need；category、item_type 使用已有商品库里的中文类目和商品类型；price_direction 只能是 lower/higher/none。",
        "multi_need 是语义判断：只有用户确实同时要多个商品需求时才为 true；像“防晒防风上衣”里的防晒是服饰功能偏好，不是防晒霜需求。",
        "clarify_needed 表示用户购物需求太宽泛、先追问会显著提升推荐准确性；clarify_dimensions 只能从 scenario/preference/budget/skin_scenario/beverage_scenario/clothing_scenario/digital_scenario/price 中选择。",
        "scope 只能是 full_catalog/current_need/last_products/last_compared_products/referenced_products；target_refs 是用户明确提到的候选序号，如“2和5”输出 [2,5]。",
        "如果用户只是问第几款或刚才那款，turn_type=refer；如果在比较当前候选的区别、优缺点、哪个更适合，turn_type=compare；如果换了新品类或新商品类型，turn_type=new_search；如果在上一轮需求上加预算、偏好、排除条件，turn_type=refine。",
        "如果没有候选商品却直接问“第二款怎么样/2和3哪个好”，turn_type=missing_context；如果是外卖、天气、论文、代码等非商品导购，turn_type=out_of_scope；如果同时要多个商品品类，turn_type=multi_need。",
        "输出 JSON 结构：{\"turn_type\":\"refine\",\"is_shopping_guidance\":true,\"multi_need\":false,\"boundary_reason\":\"\",\"needs_clarification\":false,\"clarify_needed\":false,\"clarify_dimensions\":[],\"clarification_reason\":\"\",\"scope\":\"current_need\",\"target_refs\":[],\"focus\":[],\"category\":\"\",\"item_type\":\"\",\"max_price\":null,\"min_price\":null,\"price_direction\":\"none\",\"negative_terms\":[],\"preferences\":[],\"reason\":\"\"}"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          current_message: message,
          current_session: snapshotSession(session),
          previous_products: productContext,
          rule_fallback: {
            turn_type: fallbackIntent.type,
            category: fallbackIntent.parsed.category || "",
            item_type: fallbackIntent.parsed.itemIntent?.itemType || "",
            max_price: fallbackIntent.parsed.price?.maxPrice ?? null,
            min_price: fallbackIntent.parsed.price?.minPrice ?? null,
            negative_terms: fallbackIntent.parsed.negativeTerms || [],
            preferences: fallbackIntent.parsed.preferences || [],
            multi_need: fallbackIntent.type === TURN_INTENTS.MULTI_NEED
          }
        },
        null,
        2
      )
    }
  ];
}

function mergeModelIntent(modelJson, fallbackIntent, message, session) {
  const rawPlan = modelJson?.plan && typeof modelJson.plan === "object" ? modelJson.plan : modelJson || {};
  const referenceProducts = session.referenceProducts?.length ? session.referenceProducts : session.lastProducts;
  const rawTurnType = rawPlan?.turn_type || rawPlan?.intent;
  const modelTurnType = VALID_TURN_TYPES.has(rawTurnType) ? rawTurnType : fallbackIntent.type;
  const modelMultiNeed = normalizeBoolean(rawPlan?.multi_need);
  const modelSaysSingleNeed = modelMultiNeed === false && [TURN_INTENTS.NEW_SEARCH, TURN_INTENTS.REFINE].includes(modelTurnType);
  const turnType =
    fallbackIntent.type === TURN_INTENTS.REFER
      ? TURN_INTENTS.REFER
      : fallbackIntent.type === TURN_INTENTS.MULTI_NEED && modelSaysSingleNeed
        ? modelTurnType
        : isBoundaryTurnType(fallbackIntent.type) && modelTurnType !== fallbackIntent.type
        ? fallbackIntent.type
        : modelTurnType;
  // 规则层已经识别出的 compare/new_search，以及“50预算”这类明确价格约束，属于会话边界判断，
  // 优先级高于模型自由规划。这样可以防止 LLM 因为历史里有“更清爽/第几款”而把新的需求或预算追问误合并进旧对比。
  const hasFallbackPriceBoundary = Number.isFinite(fallbackIntent.parsed.price?.maxPrice) || Number.isFinite(fallbackIntent.parsed.price?.minPrice);
  const protectedTurnType =
    fallbackIntent.type === TURN_INTENTS.COMPARE || fallbackIntent.type === TURN_INTENTS.NEW_SEARCH || hasFallbackPriceBoundary
      ? fallbackIntent.type
      : turnType;
  const canAcceptModelCatalogScope = protectedTurnType === TURN_INTENTS.NEW_SEARCH || protectedTurnType === TURN_INTENTS.REFINE;
  const category =
    canAcceptModelCatalogScope && VALID_CATEGORIES.has(rawPlan?.category)
      ? rawPlan.category
      : fallbackIntent.parsed.category;
  const itemIntent = canAcceptModelCatalogScope
    ? findItemIntent(rawPlan?.item_type) || fallbackIntent.parsed.itemIntent || null
    : fallbackIntent.parsed.itemIntent || null;
  const canUseModelPrice = hasPriceSignal(message);
  const maxPrice = canUseModelPrice ? normalizeNumber(rawPlan?.max_price ?? rawPlan?.hard_filters?.max_price) : null;
  const minPrice = canUseModelPrice ? normalizeNumber(rawPlan?.min_price ?? rawPlan?.hard_filters?.min_price) : null;
  const priceDirection = canUseModelPrice && ["lower", "higher"].includes(rawPlan?.price_direction) ? rawPlan.price_direction : "none";
  const modelNegativeTerms = hasNegativeSignal(message) ? normalizeStringArray(rawPlan?.negative_terms ?? rawPlan?.hard_filters?.negative_terms) : [];
  const fallbackPreferences = fallbackIntent.parsed.preferences || [];
  const modelPreferences = filterCurrentTurnPreferences(
    normalizeStringArray(rawPlan?.preferences ?? rawPlan?.soft_preferences),
    fallbackPreferences,
    message
  );
  const clarifyNeeded =
    normalizeBoolean(rawPlan?.clarify_needed) ??
    normalizeBoolean(rawPlan?.needs_clarification) ??
    false;
  const clarifyDimensions = normalizeClarifyDimensions(rawPlan?.clarify_dimensions ?? rawPlan?.clarification_dimensions);
  const focus = normalizeStringArray(rawPlan?.focus);
  const targetRefs = normalizeNumberArray(rawPlan?.target_refs).filter((index) => index <= referenceProducts.length);
  const requestedScope = normalizeString(rawPlan?.scope);
  const fallbackScope =
    fallbackIntent.type === TURN_INTENTS.NEW_SEARCH
      ? "full_catalog"
      : fallbackIntent.type === TURN_INTENTS.COMPARE
        ? "last_compared_products"
        : fallbackIntent.type === TURN_INTENTS.REFER
          ? "referenced_products"
          : "current_need";
  const modelScope = VALID_SCOPES.has(requestedScope) ? requestedScope : fallbackScope;
  const scope =
    protectedTurnType === TURN_INTENTS.NEW_SEARCH
      ? "full_catalog"
      : protectedTurnType === TURN_INTENTS.REFER
        ? "referenced_products"
        : protectedTurnType === TURN_INTENTS.COMPARE
          ? modelScope === "full_catalog"
            ? fallbackScope
            : modelScope
          : modelScope;

  return {
    type: protectedTurnType,
    source: "llm",
    reason: normalizeString(rawPlan?.reason) || fallbackIntent.reason,
    plan: {
      intent: protectedTurnType,
      scope,
      targetRefs,
      focus,
      // 这份 plan 是 LLM 原始理解经过后端 Validator 后的安全版本。
      // 边界类意图同样先允许 LLM 表达，再由这里校验：如果 LLM 把“点外卖/天气”错规划成商品搜索，fallbackType 会把它拉回边界。
      // 预算和排除词只有在用户本轮真的出现价格/否定信号时才会进入 hardFilters，避免模型凭空加硬约束。
      hardFilters: {
        maxPrice: maxPrice ?? fallbackIntent.parsed.price?.maxPrice ?? null,
        minPrice: minPrice ?? fallbackIntent.parsed.price?.minPrice ?? null,
        negativeTerms: modelNegativeTerms.length ? modelNegativeTerms : fallbackIntent.parsed.negativeTerms
      },
      softPreferences: modelPreferences.length ? modelPreferences : fallbackPreferences,
      isShoppingGuidance:
        protectedTurnType === TURN_INTENTS.OUT_OF_SCOPE ? false : typeof rawPlan?.is_shopping_guidance === "boolean" ? rawPlan.is_shopping_guidance : true,
      boundaryReason: normalizeString(rawPlan?.boundary_reason),
      multiNeed: protectedTurnType === TURN_INTENTS.MULTI_NEED,
      needsClarification: protectedTurnType === TURN_INTENTS.MULTI_NEED || clarifyNeeded,
      clarify: {
        needed: protectedTurnType === TURN_INTENTS.MULTI_NEED ? false : clarifyNeeded,
        dimensions: clarifyDimensions,
        reason: normalizeString(rawPlan?.clarification_reason)
      },
      clarificationReason: normalizeString(rawPlan?.clarification_reason),
      validator: {
        priceAccepted: canUseModelPrice,
        negativeTermsAccepted: hasNegativeSignal(message),
        fallbackType: fallbackIntent.type,
        modelType: modelTurnType,
        boundaryFallbackApplied: isBoundaryTurnType(fallbackIntent.type) && modelTurnType !== fallbackIntent.type,
        multiNeedAccepted: modelMultiNeed,
        clarifyDimensionsAccepted: clarifyDimensions.length,
        softPreferencesAccepted: modelPreferences.length,
        targetRefsAccepted: targetRefs.length === normalizeNumberArray(rawPlan?.target_refs).length
      }
    },
    parsed: {
      category,
      itemIntent,
      price: {
        maxPrice: maxPrice ?? fallbackIntent.parsed.price?.maxPrice,
        minPrice: minPrice ?? fallbackIntent.parsed.price?.minPrice
      },
      priceDirection,
      // LLM 解析层只做“理解”，不能凭空把用户没说的预算/排除条件升级成硬过滤条件；
      // 否则一句“办公轻薄笔记本”可能被模型误补“预算/品牌/配置”，导致检索阶段直接空结果。
      negativeTerms: modelNegativeTerms.length ? modelNegativeTerms : fallbackIntent.parsed.negativeTerms,
      preferences: modelPreferences.length ? modelPreferences : fallbackPreferences
    }
  };
}

export async function parseTurnIntent(config, session, message) {
  const fallbackIntent = classifyTurnIntent(session, message);
  if (!config.llmApiKey) {
    return {
      ...fallbackIntent,
      source: "rules"
    };
  }

  try {
    const content = await completeModelText(config, buildIntentParserMessages(session, message, fallbackIntent), {
      temperature: 0
    });
    const modelJson = extractJsonObject(content);
    if (!modelJson) throw new Error("intent parser returned empty JSON");
    return mergeModelIntent(modelJson, fallbackIntent, message, session);
  } catch (error) {
    // 解析层失败不能中断导购主链路：后端规则兜底虽然不如 LLM 灵活，但可测试、可复现，
    // 能保证“用户输入 -> 检索 -> 回答 -> 卡片”的最小闭环继续工作。
    return {
      ...fallbackIntent,
      source: "rules_fallback",
      parserError: error.message
    };
  }
}
