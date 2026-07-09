// 文件职责：
// RAG 检索质量基线测试：用固定问题检查“解析 -> 过滤 -> 排序 -> 最终商品”的关键结果。
// 它不是为了证明推荐已经完美，而是为了让后续优化有可重复对比的基准。
import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { retrieveProductsWithDebug } from "../services/retriever.js";
import { createSearchIndex } from "../vectordb/factory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cases = [
  {
    query: "推荐一款适合油皮的防晒霜",
    expectedCategory: "美妆护肤",
    expectedItemIntent: "防晒",
    minResults: 1
  },
  {
    query: "推荐一款适合油皮的洗面奶",
    expectedCategory: "美妆护肤",
    expectedItemIntent: "洁面",
    minResults: 1
  },
  {
    query: "2000元以内的蓝牙耳机有哪些？",
    expectedCategory: "数码电子",
    expectedItemIntent: "耳机",
    maxPrice: 2000,
    minResults: 1
  },
  {
    query: "帮我推荐跑鞋，要轻量的，预算1200以内",
    expectedCategory: "服饰运动",
    expectedItemIntent: "跑鞋",
    maxPrice: 1200,
    minResults: 1
  },
  {
    query: "推荐防晒霜，但不要含酒精",
    expectedCategory: "美妆护肤",
    expectedItemIntent: "防晒",
    excludedTerm: "酒精",
    minResults: 0,
    expectNoResults: true
  },
  {
    query: "推荐一款适合油皮的防晒霜 不要超过200",
    expectedCategory: "美妆护肤",
    expectedItemIntent: "防晒",
    maxPrice: 200,
    minResults: 1
  },
  {
    query: "送女生的口红",
    expectedCategory: "美妆护肤",
    expectedItemIntent: "唇妆",
    requiredSubCategory: "唇釉",
    minResults: 1
  },
  {
    query: "想买一台办公用轻薄笔记本",
    expectedCategory: "数码电子",
    expectedItemIntent: "笔记本",
    requiredSubCategory: "笔记本电脑",
    minResults: 1
  },
  {
    query: "推荐无糖饮料",
    expectedCategory: "食品饮料",
    expectedItemIntent: "饮料",
    topShouldContainAny: ["无糖", "0糖", "零糖", "低糖"],
    minResults: 1
  },
  {
    query: "推荐通勤背包",
    expectedCategory: "服饰运动",
    expectedItemIntent: "背包",
    requiredSubCategory: "背包",
    minResults: 1
  },
  {
    query: "推荐上衣",
    expectedCategory: "服饰运动",
    expectedItemIntent: "上衣",
    allowedSubCategories: ["短袖T恤", "速干T恤", "卫衣"],
    minResults: 1
  },
  {
    query: "推荐卫衣",
    expectedCategory: "服饰运动",
    expectedItemIntent: "卫衣",
    requiredSubCategory: "卫衣",
    minResults: 1
  },
  {
    query: "推荐运动裤",
    expectedCategory: "服饰运动",
    expectedItemIntent: "运动裤",
    allowedSubCategories: ["运动短裤", "运动长裤"],
    minResults: 1
  },
  {
    query: "推荐帽子",
    expectedCategory: "服饰运动",
    expectedItemIntent: "帽子",
    requiredSubCategory: "帽子",
    minResults: 1
  },
  {
    query: "推荐手机",
    expectedCategory: "数码电子",
    expectedItemIntent: "手机",
    requiredSubCategory: "智能手机",
    minResults: 1
  },
  {
    query: "推荐咖啡",
    expectedCategory: "食品饮料",
    expectedItemIntent: "咖啡",
    requiredSubCategory: "咖啡",
    minResults: 1
  },
  {
    query: "推荐方便面",
    expectedCategory: "食品饮料",
    expectedItemIntent: "方便面",
    requiredSubCategory: "方便食品",
    minResults: 1
  }
];

function assertCase(debug, testCase) {
  assert(debug.parsed.category === testCase.expectedCategory, `${testCase.query} should infer category ${testCase.expectedCategory}`);
  assert(debug.parsed.itemIntent === testCase.expectedItemIntent, `${testCase.query} should infer item intent ${testCase.expectedItemIntent}`);
  if (testCase.expectNoResults) {
    // 当商品库没有满足硬约束的商品时，正确行为是空结果，而不是为了回答而推荐不符合条件的商品。
    assert(debug.products.length === 0, `${testCase.query} should not force recommendations`);
    return;
  }

  assert(debug.products.length >= testCase.minResults, `${testCase.query} should return at least ${testCase.minResults} products`);

  for (const product of debug.products) {
    // 这些断言是比赛演示最关心的硬边界：类目、商品类型和预算不能靠模型“猜”。
    assert(product.category === testCase.expectedCategory, `${testCase.query} returned wrong category: ${product.title}`);
    if (testCase.requiredSubCategory) {
      assert(product.subCategory === testCase.requiredSubCategory, `${testCase.query} returned wrong subcategory: ${product.title}`);
    }
    if (testCase.allowedSubCategories) {
      assert(
        testCase.allowedSubCategories.includes(product.subCategory),
        `${testCase.query} returned wrong subcategory: ${product.title}`
      );
    }
    if (Number.isFinite(testCase.maxPrice)) {
      assert(product.basePrice <= testCase.maxPrice, `${testCase.query} returned product over budget: ${product.title}`);
    }
    if (testCase.excludedTerm) {
      assert(!product.searchableText.includes(testCase.excludedTerm), `${testCase.query} returned excluded term: ${product.title}`);
    }
  }

  if (testCase.topShouldContainAny) {
    // 对“无糖饮料”这类偏好需求，至少第一条结果要能在商品数据里找到对应证据。
    const top = debug.products[0];
    assert(
      testCase.topShouldContainAny.some((word) => top.searchableText.includes(word)),
      `${testCase.query} top result should contain one of ${testCase.topShouldContainAny.join(",")}`
    );
  }
}

async function run() {
  const products = loadProducts(config.datasetDir);
  const testConfig = { ...config, vectorStore: "local" };
  const vectorIndex = createSearchIndex(testConfig, products);

  for (const testCase of cases) {
    const debug = await retrieveProductsWithDebug(products, testCase.query, {}, 4, vectorIndex);
    assertCase(debug, testCase);

    console.log(`\nQuery: ${testCase.query}`);
    console.log(`Parsed: ${debug.parsed.category} / ${debug.parsed.itemIntent}`);
    console.log(`Counts: ${JSON.stringify(debug.counts)}`);
    for (const item of debug.finalSelection) {
      console.log(`- ${item.productId} ${item.title} ${item.price}元 score=${item.score}`);
    }
  }

  console.log("\nRetrieval quality baseline passed.");
}

run().catch((error) => {
  console.error("Retrieval quality baseline failed.");
  console.error(error);
  process.exit(1);
});
