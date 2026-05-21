import fs from "node:fs";
import path from "node:path";

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

function flattenFaqText(faq = []) {
  return faq.map((item) => `${item.question} ${item.answer}`).join(" ");
}

function flattenReviewText(reviews = []) {
  return reviews
    .slice(0, 8)
    .map((item) => `${item.rating}星 ${item.content}`)
    .join(" ");
}

function normalizeProduct(raw, filePath, datasetDir) {
  const knowledge = raw.rag_knowledge || {};
  const imagePath = raw.image_path ? path.join(datasetDir, raw.image_path) : "";
  const minSkuPrice = Math.min(...(raw.skus || []).map((sku) => Number(sku.price)).filter(Number.isFinite));

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
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return normalizeProduct(raw, filePath, datasetDir);
  });

  return products.sort((a, b) => a.productId.localeCompare(b.productId));
}
