import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { TURN_INTENTS } from "../services/memory.js";
import { buildClarifyPayload } from "../services/clarify.js";
import { extractPreferences, extractPriceConstraint, inferCategory, inferItemIntent } from "../utils/nlp.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const products = loadProducts(config.datasetDir);

function buildIntent(message) {
  return {
    type: TURN_INTENTS.NEW_SEARCH,
    parsed: {
      category: inferCategory(message),
      itemIntent: inferItemIntent(message),
      price: extractPriceConstraint(message),
      negativeTerms: [],
      preferences: extractPreferences(message)
    }
  };
}

function expectDynamicClarify(message, expectedLabels) {
  const clarify = buildClarifyPayload(message, buildIntent(message), products);
  assert(clarify, `${message} should return clarify payload`);
  assert(clarify.source === "candidate_differences", `${message} should use candidate differences`);
  assert(clarify.candidateCount >= 3, `${message} should inspect a useful candidate set`);
  assert(Array.isArray(clarify.options), `${message} options should be an array`);
  assert(clarify.options.length >= 2, `${message} should expose at least two options`);

  for (const label of expectedLabels) {
    assert(
      clarify.options.some((option) => option.label === label),
      `${message} should include option ${label}; got ${clarify.options.map((item) => item.label).join(", ")}`
    );
  }
}

expectDynamicClarify("推荐一款防晒霜", ["油皮清爽"]);
expectDynamicClarify("推荐无糖饮料", ["低糖低卡"]);
expectDynamicClarify("推荐上衣", ["日常通勤"]);

const plannerClarify = buildClarifyPayload(
  "帮我看看上衣",
  {
    ...buildIntent("帮我看看上衣"),
    plan: {
      clarify: {
        needed: true,
        dimensions: ["clothing_scenario"]
      }
    }
  },
  products
);
assert(plannerClarify?.dimension === "clothing_scenario", "planner clarify dimension should guide candidate-difference question");

const pricePlannerClothingClarify = buildClarifyPayload(
  "推荐上衣",
  {
    ...buildIntent("推荐上衣"),
    plan: {
      clarify: {
        needed: true,
        dimensions: ["price"]
      }
    }
  },
  products
);
assert(
  pricePlannerClothingClarify?.dimension === "clothing_scenario",
  "product scenario should be preferred over budget when candidate traits are informative"
);

const narrowed = buildClarifyPayload("推荐一款适合油皮的防晒霜", buildIntent("推荐一款适合油皮的防晒霜"), products);
assert(narrowed === null, "specific preference query should skip clarify and retrieve directly");

console.log("clarify tests passed");
