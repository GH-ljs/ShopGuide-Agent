// 文件职责：
// 封装 Qdrant collection 创建、商品向量写入，以及基于用户问题的向量检索。

import { buildProductEmbeddingText, embedText } from "./embedding.js";

function qdrantBaseUrl(config) {
  return config.qdrantUrl.replace(/\/$/, "");
}

function collectionUrl(config, suffix = "") {
  const collection = encodeURIComponent(config.qdrantCollection);
  return `${qdrantBaseUrl(config)}/collections/${collection}${suffix}`;
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error(`Qdrant 连接失败：${error.message}`);
  }

  if (response.status === 404) return { response, body: null };

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Qdrant request failed: ${response.status} ${text}`);
  }

  return { response, body };
}

function pointIdForProduct(product, index) {
  // Qdrant 的 point id 需要是数字或 UUID；这里用稳定排序后的序号，商品真实 ID 放在 payload 中。
  return index + 1;
}

function buildPayload(product) {
  return {
    productId: product.productId,
    title: product.title,
    brand: product.brand,
    category: product.category,
    subCategory: product.subCategory,
    price: product.basePrice,
    sourceFile: product.sourceFile
  };
}

function getCollectionVectorSize(collectionInfo) {
  return collectionInfo?.result?.config?.params?.vectors?.size;
}

export async function ensureQdrantCollection(config) {
  const dimension = config.embeddingDimension;
  const existing = await requestJson(collectionUrl(config));

  if (existing.response.status !== 404) {
    const existingSize = getCollectionVectorSize(existing.body);
    if (existingSize && existingSize !== dimension) {
      throw new Error(
        `Qdrant collection ${config.qdrantCollection} 的向量维度是 ${existingSize}，当前配置是 ${dimension}。请换一个 collection 名称，或清空旧 collection 后重新入库。`
      );
    }
    return existing.body;
  }

  // collection 不存在时创建；Cosine 距离适合归一化后的文本向量相似度。
  const created = await requestJson(collectionUrl(config), {
    method: "PUT",
    body: JSON.stringify({
      vectors: {
        size: dimension,
        distance: "Cosine"
      }
    })
  });

  return created.body;
}

export async function upsertProductsToQdrant(config, products) {
  await ensureQdrantCollection(config);

  const batchSize = 64;
  let written = 0;
  for (let i = 0; i < products.length; i += batchSize) {
    const batchProducts = products.slice(i, i + batchSize);
    const batch = await Promise.all(
      batchProducts.map(async (product, offset) => ({
        id: pointIdForProduct(product, i + offset),
        vector: await embedText(config, buildProductEmbeddingText(product)),
        payload: buildPayload(product)
      }))
    );

    // wait=true 保证脚本结束时数据已经写入，可立即执行检索验证。
    await requestJson(collectionUrl(config, "/points?wait=true"), {
      method: "PUT",
      body: JSON.stringify({ points: batch })
    });
    written += batch.length;
  }

  return written;
}

export function createQdrantIndex(config, products) {
  const productById = new Map(products.map((product) => [product.productId, product]));

  return {
    async search(query, candidates, limit = 4) {
      const candidateIds = candidates.map((product) => product.productId);
      if (candidateIds.length === 0) return [];

      const { body } = await requestJson(collectionUrl(config, "/points/search"), {
        method: "POST",
        body: JSON.stringify({
          vector: await embedText(config, query),
          limit,
          with_payload: true,
          filter: {
            must: [
              {
                key: "productId",
                match: {
                  any: candidateIds
                }
              }
            ]
          }
        })
      });

      return (body?.result || [])
        .map((item) => ({
          product: productById.get(item.payload?.productId),
          score: item.score || 0
        }))
        .filter((item) => item.product);
    }
  };
}
