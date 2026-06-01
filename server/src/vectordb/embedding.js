// 文件职责：
// Embedding 统一入口：把商品文本或用户问题转成固定长度向量。
// 支持本地哈希 embedding 和 Ark 多模态 embedding，供 Qdrant 入库、查询和本地验证使用。

import { tokenizeForVector } from "../utils/nlp.js";

export const DEFAULT_LOCAL_EMBEDDING_DIMENSION = 384;

function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

// 本地哈希 embedding：零依赖、可离线运行，主要用于开发和 Qdrant 链路验证。
export function embedTextLocally(text, dimension = DEFAULT_LOCAL_EMBEDDING_DIMENSION) {
  const vector = Array.from({ length: dimension }, () => 0);
  const tokens = tokenizeForVector(text);

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % dimension;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  return normalizeVector(vector);
}

function arkEmbeddingUrl(config) {
  const baseUrl = config.arkBaseUrl.replace(/\/$/, "");
  const path = config.arkEmbeddingPath.startsWith("/") ? config.arkEmbeddingPath : `/${config.arkEmbeddingPath}`;
  return `${baseUrl}${path}`;
}

function pickEmbedding(body) {
  const candidates = [
    body?.data?.embedding,
    body?.data?.[0]?.embedding,
    body?.data?.[0]?.dense,
    body?.result?.data?.embedding,
    body?.result?.data?.[0]?.embedding,
    body?.result?.data?.[0]?.dense,
    body?.embedding,
    body?.result?.embedding
  ];

  return candidates.find((item) => Array.isArray(item) && item.length > 0);
}

function describeJsonShape(value, depth = 0) {
  if (depth > 2) return "...";
  if (Array.isArray(value)) {
    const first = value[0];
    return `Array(${value.length})${first === undefined ? "" : ` of ${describeJsonShape(first, depth + 1)}`}`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).slice(0, 8);
    return `{ ${entries.map(([key, item]) => `${key}: ${describeJsonShape(item, depth + 1)}`).join(", ")} }`;
  }
  return typeof value;
}

async function embedTextWithArk(config, text) {
  const apiKey = config.arkEmbeddingApiKey || config.arkApiKey;
  if (!apiKey) {
    throw new Error("EMBEDDING_PROVIDER=ark 需要配置 ARK_EMBEDDING_API_KEY，或使用 ARK_API_KEY 作为兼容兜底");
  }

  // doubao-embedding-vision 是多模态 embedding，文本输入用 type=text。
  // 如果后续接图片，可在 input 中追加 type=image_url 的内容。
  // Embedding 和聊天生成可以使用不同模型、不同 API Key；这里明确读取 embedding 专用 Key。
  let response;
  try {
    response = await fetch(arkEmbeddingUrl(config), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.arkEmbeddingModel,
        encoding_format: "float",
        dimensions: config.embeddingDimension,
        input: [
          {
            type: "text",
            text
          }
        ]
      })
    });
  } catch (error) {
    throw new Error(`Ark embedding 连接失败：${error.message}`);
  }

  const responseText = await response.text();
  const body = responseText ? JSON.parse(responseText) : null;
  if (!response.ok) {
    throw new Error(`Ark embedding request failed: ${response.status} ${responseText}`);
  }

  const embedding = pickEmbedding(body);
  if (!embedding) {
    throw new Error(`Ark embedding response does not contain embedding. Response shape: ${describeJsonShape(body)}`);
  }

  return embedding;
}

export async function embedText(config, text) {
  // 统一 embedding 入口：业务层不用关心当前是本地哈希向量，还是外部 Ark 多模态 embedding。
  if (config.embeddingProvider === "ark") {
    return embedTextWithArk(config, text);
  }

  return embedTextLocally(text, config.embeddingDimension);
}

export function buildProductEmbeddingText(product) {
  // 商品标题、类目、品牌和 RAG 知识一起参与向量化，让语义检索能覆盖导购场景。
  return [
    product.title,
    product.brand,
    product.category,
    product.subCategory,
    product.marketingDescription,
    product.searchableText
  ]
    .filter(Boolean)
    .join(" ");
}
