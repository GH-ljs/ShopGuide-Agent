// 文件职责：
// 构建本地文本向量索引，并用余弦相似度完成商品召回。

import { tokenizeForVector } from "../utils/nlp.js";

function buildTermFrequency(tokens) {
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
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [term, value] of small.entries()) {
    dot += value * (large.get(term) || 0);
  }

  return dot / (aNorm * bNorm);
}

export function createVectorIndex(products) {
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
