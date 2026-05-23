// 文件职责：
// 构建本地文本向量索引，并用余弦相似度完成商品召回。

const STOP_WORDS = new Set([
  "推荐",
  "一款",
  "有没有",
  "哪些",
  "适合",
  "帮我",
  "一下",
  "这个",
  "那个",
  "比较",
  "以内",
  "以下",
  "以上"
]);

const SYNONYMS = {
  洗面奶: ["洁面", "洁面乳", "清洁"],
  蓝牙耳机: ["耳机", "真无线耳机", "降噪"],
  跑鞋: ["跑步鞋", "训练鞋", "公路跑鞋"],
  油皮: ["控油", "混合性皮肤", "油性"],
  轻量: ["轻薄", "轻盈", "轻"]
};

export function tokenizeForVector(text) {
  const normalized = String(text || "").toLowerCase();
  const latin = normalized.match(/[a-z0-9]+/g) || [];
  const chinese = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const tokens = [];

  // 中文商品描述没有天然空格，这里用 2-4 字滑窗近似分词，保证零依赖可运行。
  for (const phrase of chinese) {
    if (!STOP_WORDS.has(phrase)) tokens.push(phrase);
    for (let size = 2; size <= 4; size += 1) {
      for (let i = 0; i <= phrase.length - size; i += 1) {
        const token = phrase.slice(i, i + size);
        if (!STOP_WORDS.has(token)) tokens.push(token);
      }
    }
  }

  tokens.push(...latin);
  for (const [word, synonyms] of Object.entries(SYNONYMS)) {
    if (normalized.includes(word)) tokens.push(...synonyms);
  }

  return tokens;
}

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
