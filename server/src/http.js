// 文件职责：
// 定义 Express 应用和后端 HTTP API：健康检查、商品列表/详情/图片、导购对话、会话重置和检索调试。
// /api/chat 在这里串联 memory -> retriever -> answer/llm，并把 token、products、done/error 流式返回客户端。
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { buildComparisonPayload, buildLocalAnswer, buildProductCards, buildProductDetail } from "./services/answer.js";
import { buildError, ERROR_CODES } from "./utils/errors.js";
import { streamModelAnswer } from "./services/llm.js";
import { parseTurnIntent } from "./services/intent.js";
import { buildHotQueryCacheKey, createHotQueryCache } from "./services/hotCache.js";
import {
  appendTurn,
  buildConversationMemorySummary,
  buildRetrievalQuery,
  classifyTurnIntent,
  configureSessionPersistence,
  getRecentTurns,
  getSession,
  getSessionPersistenceSnapshot,
  persistSession,
  rememberProducts,
  resetSession,
  resetSessionStateForNewSearch,
  resolveComparisonProducts,
  resolveReferencedProducts,
  selectNeedForTurn,
  restoreSessionFromHistory,
  snapshotSession,
  TURN_INTENTS,
  updateSessionState
} from "./services/memory.js";
import { retrieveProductsWithDebug, retrieveProductsWithState } from "./services/retriever.js";

const DEFAULT_CHAT_PRODUCT_LIMIT = 4;
const MAX_CHAT_PRODUCT_LIMIT = 8;
const hotQueryCache = createHotQueryCache({
  maxEntries: Number(process.env.HOT_QUERY_CACHE_MAX_ENTRIES || 80),
  ttlMs: Number(process.env.HOT_QUERY_CACHE_TTL_MS || 10 * 60 * 1000)
});

function shouldUseDeterministicAnswer(config, turnIntent, state, message) {
  if (!config.llmApiKey) return true;
  if (turnIntent.type === TURN_INTENTS.REFER || turnIntent.type === TURN_INTENTS.COMPARE) return true;
  if (turnIntent.source === "llm") return false;
  const hasPriceBoundary = Number.isFinite(state.maxPrice) || Number.isFinite(state.minPrice);
  const isPriceFollowUp = /(便宜|贵|预算|以内|以下|不超过|不要超过|最多|控制在|\d+\s*万)/.test(message);

  // 预算和价格方向属于后端可验证的硬约束，优先使用确定性回答可以保证“文字列出的商品”和
  // products 事件里的卡片完全一致，避免模型被历史回答里的旧候选污染后继续展示不符合条件的商品。
  return hasPriceBoundary || isPriceFollowUp;
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function writeSse(res, event, data) {
  // SSE 的基本格式是 event/data 两行加一个空行；客户端按事件名区分 token、products、done。
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function resolveChatProductLimit(rawLimit) {
  const limit = Number(rawLimit);
  if (!Number.isFinite(limit)) return DEFAULT_CHAT_PRODUCT_LIMIT;
  // 聊天接口允许客户端按展示形态调整卡片数量，但仍设置上限，避免一次返回太多商品让回答失焦。
  return Math.max(1, Math.min(MAX_CHAT_PRODUCT_LIMIT, Math.floor(limit)));
}

function resolveRequestDeviceId(body = {}) {
  // deviceId 是客户端本地生成的匿名身份，不代表真实设备号。后端只用它做会话隔离和持久化 key，
  // 没有传时继续落到 anonymous，保证旧客户端和测试脚本不需要立刻改造。
  const deviceId = String(body.deviceId || "anonymous").trim();
  return deviceId || "anonymous";
}

function parsedRetrievalInput(turnIntent) {
  const parsed = turnIntent?.parsed || {};
  return {
    price: parsed.price || {},
    negativeTerms: parsed.negativeTerms || [],
    inferredCategory: parsed.category || "",
    itemIntent: parsed.itemIntent || null
  };
}

async function streamText(res, text, onFirstToken = null) {
  // 没有真实模型 Key 时，用本地答案模拟逐 token 输出，让客户端仍能验证流式渲染闭环。
  const parts = text.split(/(\s+|\n)/).filter(Boolean);
  let firstTokenWritten = false;
  for (const part of parts) {
    if (!firstTokenWritten) {
      firstTokenWritten = true;
      onFirstToken?.();
    }
    writeSse(res, "token", { content: part });
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
}

function writeSseHeaders(res) {
  // text/event-stream 告诉客户端这是长连接流式响应，而不是一次性 JSON。
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  res.flushHeaders?.();
}

function contentTypeForImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function findProduct(products, productId) {
  return products.find((item) => item.productId === productId);
}

function sendImageFile(res, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    sendJson(res, 404, buildError(ERROR_CODES.NOT_FOUND, "商品图片不存在"));
    return;
  }

  res.status(200);
  res.set({
    "Content-Type": contentTypeForImage(filePath),
    "Cache-Control": "public, max-age=3600"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleChat({ body, config, products, vectorIndex, res }) {
  const message = String(body.message || "").trim();
  if (!message) {
    sendJson(res, 400, buildError(ERROR_CODES.VALIDATION_ERROR, "message 不能为空"));
    return;
  }

  writeSseHeaders(res);
  const requestStartedAt = Date.now();
  let firstTokenMs = null;
  const productLimit = resolveChatProductLimit(body.limit);

  function markFirstToken(meta = {}) {
    if (firstTokenMs !== null) return;
    firstTokenMs = Date.now() - requestStartedAt;
    // meta 事件是给性能评测和调试用的轻量协议，客户端可忽略。
    // 它不承载商品事实，因此不会影响 RAG 回答和商品卡片的一致性。
    writeSse(res, "meta", {
      type: "first_token",
      firstTokenMs,
      ...meta
    });
  }

  try {
    const conversationId = String(body.conversationId || "default").trim() || "default";
    const deviceId = resolveRequestDeviceId(body);
    const session = getSession(conversationId, deviceId);
    // 多会话列表在客户端持久化历史；后端上下文只在内存中。若后端刚重启或该会话未命中内存，
    // 就用当前会话随请求带来的最近历史恢复 turns/state/lastProducts，避免“再便宜点”这类追问失去参照。
    restoreSessionFromHistory(session, body.history, products);
    const ruleIntent = classifyTurnIntent(session, message);
    const canTryHotCache = config.hotQueryCacheEnabled && ruleIntent.type === TURN_INTENTS.NEW_SEARCH;
    const preParseCacheKey = canTryHotCache
      ? buildHotQueryCacheKey({ turnIntent: ruleIntent, state: {}, message, limit: productLimit })
      : "";
    const cached = preParseCacheKey ? hotQueryCache.get(preParseCacheKey, products) : null;

    if (cached) {
      resetSessionStateForNewSearch(session);
      const state = updateSessionState(session, message, ruleIntent.parsed);
      const answerProducts = cached.products.slice(0, productLimit);
      const cards = buildProductCards(answerProducts);

      writeSse(res, "meta", {
        type: "cache",
        cacheHit: true,
        cacheScope: "hot_query",
        firstTokenTargetMs: 1000
      });
      await streamText(res, cached.answerText, () => markFirstToken({ cacheHit: true }));

      appendTurn(session, "user", message);
      appendTurn(session, "assistant", cached.answerText);
      rememberProducts(session, answerProducts, { updateReference: true });
      persistSession(session);

      writeSse(res, "products", { products: cards });
      writeSse(res, "done", { ok: true, conversationId, deviceId, cacheHit: true });
      return;
    }

    if (preParseCacheKey) {
      writeSse(res, "meta", {
        type: "cache",
        cacheHit: false,
        cacheScope: "hot_query",
        firstTokenTargetMs: 1000
      });
    }

    const turnIntent = await parseTurnIntent(config, session, message);
    if (turnIntent.type === TURN_INTENTS.NEW_SEARCH) {
      resetSessionStateForNewSearch(session);
    } else {
      selectNeedForTurn(session, turnIntent);
    }
    // 会话状态先吸收本轮用户输入，后面的检索和 Prompt 都会使用这些结构化约束。
    const state = updateSessionState(session, message, turnIntent.parsed);
    const answerState = {
      ...state,
      memorySummary: buildConversationMemorySummary(session)
    };
    const history = getRecentTurns(session);
    // 检索 query 不只用当前 message，还会拼入最近对话和上一轮商品，支撑“再便宜点”这类省略式追问。
    const retrievalQuery = buildRetrievalQuery(session, message, {
      includeHistory: turnIntent.type !== TURN_INTENTS.NEW_SEARCH,
      includeProducts: turnIntent.type !== TURN_INTENTS.NEW_SEARCH
    });
    const retrievalProducts =
      turnIntent.type === TURN_INTENTS.COMPARE
        ? resolveComparisonProducts(session, message)
        : turnIntent.type === TURN_INTENTS.REFER
          ? resolveReferencedProducts(session, message)
          : products;

    // RAG 第一步：从可信商品库检索候选商品。聊天回答和商品卡片必须使用同一组候选，
    // 否则会出现“模型讲了 3 个商品，但客户端展示 4 张卡片”的体验不一致。
    let matchedProducts;
    try {
      // turnIntent 决定检索范围：refine/new_search 面向全库，refer 只围绕上一轮候选或指定序号商品。
      // 这样既能在“不要超过200”时从全库补找低价商品，也能在“第二个怎么样”时不突然跳到新商品。
      // retrievalQuery 会拼入摘要和历史文本，只适合做语义排序；硬约束必须来自结构化解析结果和 state。
      // 否则“预算不低于 171 元”这类摘要文字可能被二次正则误读成预算上限，导致候选被错误过滤空。
      if (turnIntent.type === TURN_INTENTS.COMPARE) {
        // 对比问题的可信边界是“上一轮候选/用户点名的序号商品”，不是全库重新召回。
        // 这里直接使用结构化记忆里的候选，避免向量排序把未被点名的商品插进对比答案和卡片。
        matchedProducts = retrievalProducts.slice(0, productLimit);
      } else {
        matchedProducts = await retrieveProductsWithState(
          retrievalProducts,
          retrievalQuery,
          state,
          productLimit,
          vectorIndex,
          parsedRetrievalInput(turnIntent)
        );
      }
    } catch (error) {
      // 检索层异常单独标成 RETRIEVAL_ERROR，方便区分 Qdrant/Embedding/索引问题和模型生成问题。
      throw Object.assign(new Error(error.message), {
        code: ERROR_CODES.RETRIEVAL_ERROR,
        userMessage: "商品检索暂时不可用"
      });
    }
    const answerMode =
      turnIntent.type === TURN_INTENTS.COMPARE ? "compare" : turnIntent.type === TURN_INTENTS.REFER ? "refer" : "";
    const answerProducts = matchedProducts.slice(0, productLimit);
    const cards = buildProductCards(answerProducts);
    const finalAnswerState = { ...answerState, answerMode };

    let answerText = "";
    let fallbackUsed = false;
    let fallbackReason = "";
    let fallbackMessage = "";
    if (!shouldUseDeterministicAnswer(config, turnIntent, state, message)) {
      // 有模型 Key 时直接把模型增量 token 转发给客户端；模型看到的候选与卡片候选保持一致。
      try {
        for await (const token of streamModelAnswer(config, message, answerProducts, history, answerState)) {
          answerText += token;
          markFirstToken({ cacheHit: false });
          writeSse(res, "token", { content: token });
        }
      } catch (error) {
        fallbackUsed = true;
        fallbackReason = ERROR_CODES.MODEL_ERROR;
        fallbackMessage = "当前 AI 生成服务暂时不可用，已使用本地导购规则完成推荐。";
        console.warn("[/api/chat] model generation failed, fallback to local answer:", error.message);
        writeSse(res, "meta", {
          type: "fallback",
          fallback: true,
          reason: fallbackReason,
          message: fallbackMessage
        });

        // 模型生成是增强层，检索到的商品候选才是可信事实来源。模型失败时改用同一批 answerProducts
        // 生成本地确定性回答，保证“回答文本、对比组件、商品卡片”仍然来自同一组可校验商品。
        const localAnswer = buildLocalAnswer(message, answerProducts, history, finalAnswerState);
        if (answerText.trim()) answerText += "\n\n";
        answerText += localAnswer;
        await streamText(res, localAnswer, () => markFirstToken({ cacheHit: false, fallback: true }));
      }
    } else {
      // 本地兜底回答也使用同一组候选，确保文本编号和商品卡片一一对应。
      // 价格/预算/指代追问使用后端确定性回答：这类问题的正确性主要取决于硬过滤结果，
      // 由模板列出同一批 answerProducts，可以避免模型把上一轮已淘汰的商品重新写进回答。
      answerText = buildLocalAnswer(message, answerProducts, history, finalAnswerState);
      await streamText(res, answerText, () => markFirstToken({ cacheHit: false }));
    }

    if (config.hotQueryCacheEnabled && turnIntent.type === TURN_INTENTS.NEW_SEARCH && answerMode === "" && !fallbackUsed) {
      const cacheKey = buildHotQueryCacheKey({ turnIntent, state, message, limit: productLimit });
      // 只在成功生成完整回答后写缓存。这样缓存里永远是“文本、卡片、结构化约束已对齐”的结果，
      // 不会把检索异常、半截模型输出或失败响应复用给后续用户。
      hotQueryCache.set(cacheKey, {
        answerText,
        products: answerProducts
      });
    }

    // 只有成功生成答案后才写入会话，避免失败请求污染后续多轮上下文。
    appendTurn(session, "user", message);
    appendTurn(session, "assistant", answerText);
    rememberProducts(session, answerProducts, {
      updateReference: turnIntent.type !== TURN_INTENTS.REFER && turnIntent.type !== TURN_INTENTS.COMPARE,
      updateComparison: turnIntent.type === TURN_INTENTS.COMPARE
    });
    persistSession(session);

    const comparison = buildComparisonPayload(message, answerProducts, finalAnswerState);
    if (comparison) {
      // comparison 是比自然语言更稳定的结构化对比结果，供客户端渲染对比组件；
      // 它必须和 products 使用同一批 answerProducts，保证文字、对比表和卡片三者不打架。
      writeSse(res, "comparison", { comparison });
    }

    // 文本流结束后再发送结构化商品卡片，客户端据此渲染可点击商品列表。
    writeSse(res, "products", { products: cards });
    writeSse(res, "done", {
      ok: true,
      conversationId,
      deviceId,
      fallback: fallbackUsed,
      fallbackReason,
      fallbackMessage
    });
  } catch (error) {
    console.error("[/api/chat] failed:", error);
    const code = error.code || ERROR_CODES.INTERNAL_ERROR;
    const message = error.userMessage || "服务内部错误";
    writeSse(
      res,
      "error",
      buildError(code, message, error.message)
    );
  } finally {
    res.end();
  }
}

function installCommonMiddleware(app) {
  app.use((req, res, next) => {
    // 统一 CORS 响应头，保持客户端和调试脚本跨源访问方式不变。
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  });

  // Express 帮我们解析 JSON 请求体；解析失败会进入下面的错误处理中间件。
  app.use(express.json({ limit: "1mb", type: "application/json" }));
}

function installRoutes(app, { config, products, vectorIndex }) {
  app.get("/api/health", (req, res) => {
    sendJson(res, 200, {
      ok: true,
      productCount: products.length,
      vectorStore: config.vectorStore,
      qdrantUrl: config.qdrantUrl,
      qdrantCollection: config.qdrantCollection,
      embeddingProvider: config.embeddingProvider,
      embeddingDimension: config.embeddingDimension,
      modelEnabled: Boolean(config.llmApiKey),
      llmProvider: config.llmProvider,
      llmModel: config.llmProvider === "deepseek" ? config.deepseekModel : config.arkModel,
      hotQueryCache: config.hotQueryCacheEnabled ? hotQueryCache.snapshot() : { enabled: false },
      sessionPersistence: getSessionPersistenceSnapshot()
    });
  });

  app.get("/api/performance", (req, res) => {
    sendJson(res, 200, {
      ok: true,
      hotQueryCache: {
        enabled: config.hotQueryCacheEnabled,
        ...hotQueryCache.snapshot()
      }
    });
  });

  app.get("/api/products", (req, res) => {
    sendJson(res, 200, buildProductCards(products));
  });

  app.get("/api/products/:productId/image", (req, res) => {
    const product = findProduct(products, req.params.productId);
    if (!product) return sendJson(res, 404, buildError(ERROR_CODES.NOT_FOUND, "商品不存在"));
    return sendImageFile(res, product.imagePath);
  });

  app.get("/api/products/:productId", (req, res) => {
    const product = findProduct(products, req.params.productId);
    if (!product) return sendJson(res, 404, buildError(ERROR_CODES.NOT_FOUND, "商品不存在"));
    return sendJson(res, 200, buildProductDetail(product));
  });

  app.post("/api/conversations/reset", (req, res) => {
    const conversationId = String(req.body?.conversationId || "default").trim() || "default";
    const deviceId = resolveRequestDeviceId(req.body);
    const session = resetSession(conversationId, deviceId);
    sendJson(res, 200, {
      ok: true,
      deviceId,
      conversationId,
      session: snapshotSession(session)
    });
  });

  app.post("/api/debug/retrieve", async (req, res, next) => {
    try {
      const message = String(req.body?.message || "").trim();
      if (!message) return sendJson(res, 400, buildError(ERROR_CODES.VALIDATION_ERROR, "message 不能为空"));

      const conversationId = String(req.body?.conversationId || "debug").trim() || "debug";
      const deviceId = resolveRequestDeviceId(req.body);
      const includeMemory = req.body?.includeMemory !== false;
      const session = includeMemory ? getSession(conversationId, deviceId) : resetSession(`debug:${conversationId}:${Date.now()}`, deviceId);
      const turnIntent = await parseTurnIntent(config, session, message);
      if (turnIntent.type === TURN_INTENTS.NEW_SEARCH) {
        resetSessionStateForNewSearch(session);
      } else {
        selectNeedForTurn(session, turnIntent);
      }
      const state = updateSessionState(session, message, turnIntent.parsed);
      const retrievalQuery = buildRetrievalQuery(session, message, {
        includeHistory: turnIntent.type !== TURN_INTENTS.NEW_SEARCH,
        includeProducts: turnIntent.type !== TURN_INTENTS.NEW_SEARCH
      });
      const retrievalProducts =
        turnIntent.type === TURN_INTENTS.COMPARE
          ? resolveComparisonProducts(session, message)
          : turnIntent.type === TURN_INTENTS.REFER
            ? resolveReferencedProducts(session, message)
            : products;
      const debugLimit = Number(req.body?.limit || 4);
      // 调试接口返回解析结果、候选数量和向量分数，方便定位“为什么推荐了这些商品”。
      // compare 意图不走全库向量召回，而是展示从结构化记忆里解析出的对比候选，便于确认“第几款”有没有选对。
      const debug =
        turnIntent.type === TURN_INTENTS.COMPARE
          ? {
              products: retrievalProducts.slice(0, debugLimit),
              counts: {
                totalProducts: products.length,
                filteredCandidates: retrievalProducts.length,
                returned: retrievalProducts.slice(0, debugLimit).length
              },
              parsed: parsedRetrievalInput(turnIntent),
              usedVectorStore: false,
              note: "compare intent reuses referenced candidates instead of full-catalog retrieval"
            }
          : await retrieveProductsWithDebug(
              retrievalProducts,
              retrievalQuery,
              state,
              debugLimit,
              vectorIndex,
              parsedRetrievalInput(turnIntent)
            );

      return sendJson(res, 200, {
        ok: true,
        deviceId,
        conversationId,
        includeMemory,
        turnIntent,
        retrievalScope:
          turnIntent.type === TURN_INTENTS.COMPARE
            ? "comparison_candidates"
            : turnIntent.type === TURN_INTENTS.REFER
              ? "last_products"
              : "full_catalog",
        session: snapshotSession(session),
        originalMessage: message,
        retrievalQuery,
        retrieval: {
          ...debug,
          products: buildProductCards(debug.products)
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/chat", async (req, res) => {
    await handleChat({ body: req.body || {}, config, products, vectorIndex, res });
  });
}

function installErrorHandlers(app) {
  app.use((req, res) => {
    sendJson(res, 404, buildError(ERROR_CODES.NOT_FOUND, "接口不存在"));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof SyntaxError && "body" in error) {
      sendJson(res, 400, buildError(ERROR_CODES.INVALID_JSON, "请求体不是合法 JSON"));
      return;
    }

    console.error("[express] unhandled error:", error);
    sendJson(res, 500, buildError(ERROR_CODES.INTERNAL_ERROR, "服务内部错误", error.message));
  });
}

export function createApp({ config, products, vectorIndex }) {
  configureSessionPersistence({
    enabled: config.sessionPersistenceEnabled,
    path: config.sessionStorePath
  });
  const app = express();
  installCommonMiddleware(app);
  installRoutes(app, { config, products, vectorIndex });
  installErrorHandlers(app);
  return app;
}

// 兼容旧测试或旧入口里 createHandler 这个命名；现在返回的是 Express app，本质仍可传给 http.createServer。
export const createHandler = createApp;
