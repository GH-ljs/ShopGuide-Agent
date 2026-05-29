// 文件职责：
// 本地向量检索实现：用中文分词后的词频 Map 构建商品文本索引，并用余弦相似度排序候选商品。
// 适合 MVP、离线演示和无外部向量数据库环境；正式语义检索可切换到 Qdrant。

import { tokenizeForVector } from "../utils/nlp.js";

function buildTermFrequency(tokens) {
  // 用词频 Map 作为最小可用的“文本向量”，适合无外部依赖的 MVP 检索。
  const vector = new Map();
  for (const token of tokens) {
    if (token.length < 2) continue;
    vector.set(token, (vector.get(token) || 0) + 1);
  }
  return vector;
}

function vectorNorm(vector) {
  let sum = 0;
  for (const value of vector.values()) sum += value * value;
  return Math.sqrt(sum);
}

function cosineSimilarity(a, aNorm, b, bNorm) {
  if (aNorm === 0 || bNorm === 0) return 0;

  let dot = 0;
  // 遍历更短的 Map 可以减少无意义查找，商品数变多时这类小优化会更明显。
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [term, value] of small.entries()) {
    dot += value * (large.get(term) || 0);
  }

  return dot / (aNorm * bNorm);
}

export function createVectorIndex(products) {
  // 服务启动时预先把所有商品向量化，用户请求进来时只需要向量化 query 并计算相似度。
  const documents = products.map((product) => {
    const text = `${product.title} ${product.brand} ${product.category} ${product.subCategory} ${product.searchableText}`;
    const vector = buildTermFrequency(tokenizeForVector(text));

    return {
      product,
      vector,
      norm: vectorNorm(vector)
    };
  });

  return {
    search(query, candidates, limit = 4) {
      const queryVector = buildTermFrequency(tokenizeForVector(query));
      const queryNorm = vectorNorm(queryVector);
      // retriever 已经做过硬过滤，这里只对候选集合排序，避免被不符合预算/类目的商品抢占结果。
      const candidateIds = new Set(candidates.map((product) => product.productId));

      return documents
        .filter((doc) => candidateIds.has(doc.product.productId))
        .map((doc) => ({
          product: doc.product,
          score: cosineSimilarity(queryVector, queryNorm, doc.vector, doc.norm)
        }))
        .sort((a, b) => b.score - a.score || a.product.basePrice - b.product.basePrice)
        .slice(0, limit);
    }
  };
}
