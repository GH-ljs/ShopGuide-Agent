// 文件职责：
// 读取 .env 和环境变量，集中管理服务端口、数据集路径、向量库、Embedding 和 LLM Provider 配置。
// API Key 等敏感信息只从本地环境读取，业务代码统一依赖 config，避免配置读取逻辑散落各处。

import fs from "node:fs";
import path from "node:path";

// 轻量读取 .env，避免为了早期 MVP 引入 dotenv 依赖。
function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

const embeddingProvider = process.env.EMBEDDING_PROVIDER || "local";
const defaultEmbeddingDimension = embeddingProvider === "ark" ? 1024 : 384;
const llmProvider = process.env.LLM_PROVIDER || "ark";
const deepseekApiKey = process.env.DEEPSEEK_API_KEY || "";
const arkApiKey = process.env.ARK_API_KEY || "";
const arkEmbeddingApiKey = process.env.ARK_EMBEDDING_API_KEY || arkApiKey;

// 全局配置集中放在这里，其他模块只读取 config，不直接散落读取环境变量。
export const config = {
  port: Number(process.env.PORT || 3001),
  datasetDir: path.resolve(process.cwd(), process.env.DATASET_DIR || "../ecommerce_agent_dataset"),
  vectorStore: process.env.VECTOR_STORE || "local",
  qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
  qdrantCollection: process.env.QDRANT_COLLECTION || "shopguide_products",
  embeddingProvider,
  embeddingDimension: Number(process.env.EMBEDDING_DIMENSION || defaultEmbeddingDimension),
  arkEmbeddingApiKey,
  arkEmbeddingModel: process.env.ARK_EMBEDDING_MODEL || "doubao-embedding-vision-250615",
  arkEmbeddingPath: process.env.ARK_EMBEDDING_PATH || "/embeddings/multimodal",
  llmProvider,
  llmApiKey: llmProvider === "deepseek" ? deepseekApiKey : arkApiKey,
  arkBaseUrl: process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
  arkApiKey,
  // Ark endpoint 属于账号资源标识，必须由本地环境显式配置，不能把个人 endpoint 写进源码默认值。
  arkModel: process.env.ARK_MODEL || "",
  deepseekApiKey,
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  hotQueryCacheEnabled: process.env.HOT_QUERY_CACHE_ENABLED !== "false",
  hotQueryCacheMaxEntries: Number(process.env.HOT_QUERY_CACHE_MAX_ENTRIES || 80),
  hotQueryCacheTtlMs: Number(process.env.HOT_QUERY_CACHE_TTL_MS || 10 * 60 * 1000),
  sessionPersistenceEnabled: process.env.SESSION_PERSISTENCE_ENABLED !== "false",
  sessionStorePath: path.resolve(process.cwd(), process.env.SESSION_STORE_PATH || ".data/shopguide_sessions.db")
};
