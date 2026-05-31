// 文件职责：
// 意图解析层位于“用户输入”和“商品检索”之间。它优先让 LLM 把自然语言追问解析成结构化 JSON，
// 再由后端校验并执行硬过滤；如果没有 API Key 或模型返回异常，则回退到 memory.js 里的规则解析。
import { completeModelText } from "./llm.js";
import { CATEGORY_HINTS, ITEM_INTENTS } from "../utils/nlp.js";
import { classifyTurnIntent, snapshotSession, TURN_INTENTS } from "./memory.js";

const VALID_TURN_TYPES = new Set(Object.values(TURN_INTENTS));
const VALID_CATEGORIES = new Set(CATEGORY_HINTS.map((item) => item.category));

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
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
        "你只负责解析，不负责推荐商品；商品是否符合条件必须交给后端检索和硬过滤。",
        "字段：turn_type 只能是 new_search/refine/refer；category、item_type 使用已有商品库里的中文类目和商品类型；price_direction 只能是 lower/higher/none。",
        "如果用户只是问第几款或刚才那款，turn_type=refer；如果换了新品类或新商品类型，turn_type=new_search；如果在上一轮需求上加预算、偏好、排除条件，turn_type=refine。",
        "输出 JSON 结构：{\"turn_type\":\"refine\",\"category\":\"\",\"item_type\":\"\",\"max_price\":null,\"min_price\":null,\"price_direction\":\"none\",\"negative_terms\":[],\"preferences\":[],\"refer_index\":null,\"reason\":\"\"}"
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
            preferences: fallbackIntent.parsed.preferences || []
          }
        },
        null,
        2
      )
    }
  ];
}

function mergeModelIntent(modelJson, fallbackIntent, message) {
  const turnType =
    fallbackIntent.type === TURN_INTENTS.REFER
      ? TURN_INTENTS.REFER
      : VALID_TURN_TYPES.has(modelJson?.turn_type)
        ? modelJson.turn_type
        : fallbackIntent.type;
  const category = VALID_CATEGORIES.has(modelJson?.category) ? modelJson.category : fallbackIntent.parsed.category;
  const itemIntent = findItemIntent(modelJson?.item_type) || fallbackIntent.parsed.itemIntent || null;
  const canUseModelPrice = hasPriceSignal(message);
  const maxPrice = canUseModelPrice ? normalizeNumber(modelJson?.max_price) : null;
  const minPrice = canUseModelPrice ? normalizeNumber(modelJson?.min_price) : null;
  const priceDirection = canUseModelPrice && ["lower", "higher"].includes(modelJson?.price_direction) ? modelJson.price_direction : "none";
  const modelNegativeTerms = hasNegativeSignal(message) ? normalizeStringArray(modelJson?.negative_terms) : [];
  const modelPreferences = normalizeStringArray(modelJson?.preferences);

  return {
    type: turnType,
    source: "llm",
    reason: normalizeString(modelJson?.reason) || fallbackIntent.reason,
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
      preferences: modelPreferences.length ? modelPreferences : fallbackIntent.parsed.preferences
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
    return mergeModelIntent(modelJson, fallbackIntent, message);
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
