// 文件职责：
// 递归读取商品 JSON，把原始数据整理成后端统一商品结构。

import fs from "node:fs";
import path from "node:path";

// 递归扫描数据集目录，找到所有商品 JSON 文件。
function walkJsonFiles(dir) {
  const result = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      result.push(...walkJsonFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith(".json")) {
      result.push(fullPath);
    }
  }
  return result;
}

// SKU 信息会参与检索，比如容量、颜色、不同规格价格等。
function flattenSkuText(skus = []) {
  return skus
    .map((sku) => {
      const props = Object.entries(sku.properties || {})
        .map(([key, value]) => `${key}:${value}`)
        .join(" ");
      return `${props} 价格:${sku.price}`;
    })
    .join("；");
}

// FAQ 和评价都是 RAG 知识的一部分，先压成普通文本用于本地检索。
function flattenFaqText(faq = []) {
  return faq.map((item) => `${item.question} ${item.answer}`).join(" ");
}

function flattenReviewText(reviews = []) {
  return reviews
    .slice(0, 8)
    .map((item) => `${item.rating}星 ${item.content}`)
    .join(" ");
}

// 把原始 JSON 字段转成后端统一商品结构，避免接口层直接依赖原始数据格式。
function normalizeProduct(raw, filePath, datasetDir) {
  const knowledge = raw.rag_knowledge || {};
  const imagePath = raw.image_path ? path.join(datasetDir, raw.image_path) : "";
  const minSkuPrice = Math.min(...(raw.skus || []).map((sku) => Number(sku.price)).filter(Number.isFinite));

  // searchableText 是当前 MVP 的检索文本。后续接向量库时也可以基于这部分内容生成 embedding。
  const searchableText = [
    raw.title,
    raw.brand,
    raw.category,
    raw.sub_category,
    knowledge.marketing_description,
    flattenSkuText(raw.skus),
    flattenFaqText(knowledge.official_faq),
    flattenReviewText(knowledge.user_reviews)
  ]
    .filter(Boolean)
    .join(" ");

  return {
    productId: raw.product_id,
    title: raw.title,
    brand: raw.brand,
    category: raw.category,
    subCategory: raw.sub_category,
    basePrice: Number(raw.base_price || minSkuPrice || 0),
    imagePath,
    skus: raw.skus || [],
    marketingDescription: knowledge.marketing_description || "",
    officialFaq: knowledge.official_faq || [],
    userReviews: knowledge.user_reviews || [],
    sourceFile: path.relative(datasetDir, filePath),
    searchableText
  };
}

export function loadProducts(datasetDir) {
  if (!fs.existsSync(datasetDir)) {
    throw new Error(`Dataset directory not found: ${datasetDir}`);
  }

  const files = walkJsonFiles(datasetDir);
  const products = files.map((filePath) => {
    // 数据集是中文内容，必须用 utf8 读取，否则会出现乱码。
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return normalizeProduct(raw, filePath, datasetDir);
  });

  return products.sort((a, b) => a.productId.localeCompare(b.productId));
}
