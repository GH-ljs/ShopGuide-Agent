// 文件职责：
// 对 RAG 检索链路做可量化评测，输出 Recall@K、Precision@K、HitRate@K 和 MRR@K。
// 这里复用真实 retriever，而不是单独写一套检索逻辑，避免“评测通过但线上链路没通过”的偏差。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { retrieveProductsWithDebug } from "../services/retriever.js";
import { createSearchIndex } from "../vectordb/factory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultCasesPath = path.resolve(__dirname, "../eval/retrieval-cases.json");
const topKs = [1, 3, 4, 5, 6, 8];

function readCases(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const cases = JSON.parse(raw);

  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`Retrieval eval cases must be a non-empty array: ${filePath}`);
  }

  for (const item of cases) {
    if (!item.id || !item.query || !Array.isArray(item.relevantProductIds) || item.relevantProductIds.length === 0) {
      throw new Error(`Invalid retrieval eval case: ${JSON.stringify(item)}`);
    }
  }

  return cases;
}

function scoreAtK(resultIds, relevantIds, k) {
  const topIds = resultIds.slice(0, k);
  const relevantSet = new Set(relevantIds);
  const hitCount = topIds.filter((id) => relevantSet.has(id)).length;
  const firstHitIndex = topIds.findIndex((id) => relevantSet.has(id));

  return {
    hit: hitCount > 0 ? 1 : 0,
    recall: hitCount / relevantSet.size,
    precision: hitCount / k,
    reciprocalRank: firstHitIndex >= 0 ? 1 / (firstHitIndex + 1) : 0
  };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function formatMetric(value) {
  return value.toFixed(3);
}

async function run() {
  const casesPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultCasesPath;
  const cases = readCases(casesPath);
  const products = loadProducts(config.datasetDir);
  const productIds = new Set(products.map((product) => product.productId));

  for (const item of cases) {
    for (const productId of item.relevantProductIds) {
      if (!productIds.has(productId)) {
        throw new Error(`Case ${item.id} references unknown productId: ${productId}`);
      }
    }
  }

  const maxK = Math.max(...topKs);
  // 评测默认固定使用 local 检索，保证离线可复现；如果要评 Qdrant，可先把 config 改为 qdrant 再单独扩展对比脚本。
  const vectorIndex = createSearchIndex({ ...config, vectorStore: "local" }, products);
  const details = [];

  for (const item of cases) {
    const debug = await retrieveProductsWithDebug(products, item.query, {}, maxK, vectorIndex);
    const resultIds = debug.products.map((product) => product.productId);
    const scores = Object.fromEntries(topKs.map((k) => [k, scoreAtK(resultIds, item.relevantProductIds, k)]));

    details.push({
      ...item,
      parsed: debug.parsed,
      resultIds,
      scores
    });
  }

  console.log("RAG Retrieval Evaluation");
  console.log(`Cases: ${cases.length}`);
  console.log(`Dataset: ${config.datasetDir}`);
  console.log("");

  for (const detail of details) {
    console.log(`Case: ${detail.id}`);
    console.log(`Query: ${detail.query}`);
    console.log(`Expected: ${detail.relevantProductIds.join(", ")}`);
    console.log(`Actual:   ${detail.resultIds.join(", ") || "(empty)"}`);
    console.log(`Parsed:   ${detail.parsed.category || "-"} / ${detail.parsed.itemIntent || "-"}`);
    console.log(
      topKs
        .map((k) => {
          const score = detail.scores[k];
          return `@${k} R=${formatMetric(score.recall)} P=${formatMetric(score.precision)} Hit=${score.hit}`;
        })
        .join(" | ")
    );
    console.log("");
  }

  console.log("Summary");
  for (const k of topKs) {
    const scores = details.map((detail) => detail.scores[k]);
    console.log(
      `@${k} Recall=${formatMetric(average(scores.map((score) => score.recall)))} ` +
        `Precision=${formatMetric(average(scores.map((score) => score.precision)))} ` +
        `HitRate=${formatMetric(average(scores.map((score) => score.hit)))} ` +
        `MRR=${formatMetric(average(scores.map((score) => score.reciprocalRank)))}`
    );
  }
}

run().catch((error) => {
  console.error("Retrieval evaluation failed.");
  console.error(error);
  process.exit(1);
});
