// 文件职责：
// Demo 检索自检脚本：批量运行比赛展示常用问题，输出解析结果、候选数量和最终商品。
// 它直接复用后端 RAG 检索链路，不依赖 HTTP 服务是否已启动，适合演示前快速确认推荐没有明显跑偏。
import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { retrieveProductsWithDebug } from "../services/retriever.js";
import { createSearchIndex } from "../vectordb/factory.js";

const demoCases = [
  {
    query: "推荐一款适合油皮的防晒霜",
    expectation: "美妆护肤 / 防晒，优先清爽控油相关商品"
  },
  {
    query: "推荐防晒霜，但不要含酒精",
    expectation: "如果库内没有不含酒精防晒，应返回空结果"
  },
  {
    query: "送女生的口红",
    expectation: "美妆护肤 / 唇妆，命中唇釉"
  },
  {
    query: "想买一台办公用轻薄笔记本",
    expectation: "数码电子 / 笔记本，优先轻薄办公"
  },
  {
    query: "推荐无糖饮料",
    expectation: "食品饮料 / 饮料，优先无糖、0糖、低糖"
  },
  {
    query: "推荐通勤背包",
    expectation: "服饰运动 / 背包"
  },
  {
    query: "推荐一款手机，拍照好一点",
    expectation: "数码电子 / 手机，优先拍照/影像相关商品"
  },
  {
    query: "推荐适合户外的鞋",
    expectation: "服饰运动 / 鞋，优先徒步鞋或户外相关商品"
  }
];

function printCase(debug, demoCase) {
  console.log("\n============================================================");
  console.log(`问题：${demoCase.query}`);
  console.log(`期望：${demoCase.expectation}`);
  console.log(`解析：${debug.parsed.category || "(未识别类目)"} / ${debug.parsed.itemIntent || "(未识别商品类型)"}`);
  console.log(
    `数量：总数 ${debug.counts.totalProducts}，类目候选 ${debug.counts.categoryCandidates}，过滤后 ${debug.counts.filteredCandidates}，最终 ${debug.counts.finalProducts}`
  );

  if (debug.parsed.negativeTerms.length > 0) {
    console.log(`排除词：${debug.parsed.negativeTerms.join("、")}`);
  }

  if (debug.parsed.preferences.length > 0) {
    console.log(`偏好词：${debug.parsed.preferences.join("、")}`);
  }

  if (debug.finalSelection.length === 0) {
    // 空结果不是一定错误；对强排除条件来说，这是防止编造推荐的正确表现。
    console.log("最终商品：无。请确认这是因为商品库确实没有满足硬约束的商品。");
    return;
  }

  console.log("最终商品：");
  for (const item of debug.finalSelection) {
    const hits = item.preferenceHits?.length ? `，偏好命中：${item.preferenceHits.join("、")}` : "";
    console.log(`- ${item.productId} | ${item.subCategory} | ${item.title} | ${item.price}元 | rank=${item.rankScore}${hits}`);
  }
}

async function run() {
  const products = loadProducts(config.datasetDir);
  const vectorIndex = createSearchIndex(config, products);

  console.log(`Dataset: ${config.datasetDir}`);
  console.log(`Vector store: ${config.vectorStore}`);

  for (const demoCase of demoCases) {
    const debug = await retrieveProductsWithDebug(products, demoCase.query, {}, 4, vectorIndex);
    printCase(debug, demoCase);
  }
}

run().catch((error) => {
  console.error("Demo retrieve check failed.");
  console.error(error);
  process.exit(1);
});
