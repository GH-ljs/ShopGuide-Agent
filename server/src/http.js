// 文件职责：
// 定义 Express 应用和后端 HTTP API：健康检查、商品列表/详情/图片、导购对话、会话重置和检索调试。
// /api/chat 在这里串联 memory -> retriever -> answer/llm，并把 token、products、done/error 流式返回客户端。
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { buildLocalAnswer, buildProductCards, buildProductDetail } from "./services/answer.js";
import { buildError, ERROR_CODES } from "./utils/errors.js";
import { streamModelAnswer } from "./services/llm.js";
import {
  appendTurn,
  buildRetrievalQuery,
  getRecentTurns,
  getSession,
  rememberProducts,
  resetSession,
  snapshotSession,
  updateSessionState
} from "./services/memory.js";
import { retrieveProductsWithDebug, retrieveProductsWithState } from "./services/retriever.js";

const DEFAULT_CHAT_PRODUCT_LIMIT = 4;
const MAX_CHAT_PRODUCT_LIMIT = 8;

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

async function streamText(res, text) {
  // 没有真实模型 Key 时，用本地答案模拟逐 token 输出，让客户端仍能验证流式渲染闭环。
  const parts = text.split(/(\s+|\n)/).filter(Boolean);
  for (const part of parts) {
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

  try {
    const conversationId = String(body.conversationId || "default").trim() || "default";
    const session = getSession(conversationId);
    // 会话状态先吸收本轮用户输入，后面的检索和 Prompt 都会使用这些结构化约束。
    const state = updateSessionState(session, message);
    const history = getRecentTurns(session);
    // 检索 query 不只用当前 message，还会拼入最近对话和上一轮商品，支撑“再便宜点”这类省略式追问。
    const retrievalQuery = buildRetrievalQuery(session, message);

    const productLimit = resolveChatProductLimit(body.limit);
    // RAG 第一步：从可信商品库检索候选商品。聊天回答和商品卡片必须使用同一组候选，
    // 否则会出现“模型讲了 3 个商品，但客户端展示 4 张卡片”的体验不一致。
    const matchedProducts = await retrieveProductsWithState(products, retrievalQuery, state, productLimit, vectorIndex);
    const answerProducts = matchedProducts.slice(0, productLimit);
    const cards = buildProductCards(answerProducts);

    let answerText = "";
    if (config.llmApiKey) {
      // 有模型 Key 时直接把模型增量 token 转发给客户端；模型看到的候选与卡片候选保持一致。
      for await (const token of streamModelAnswer(config, message, answerProducts, history, state)) {
        answerText += token;
        writeSse(res, "token", { content: token });
      }
    } else {
      // 本地兜底回答也使用同一组候选，确保文本编号和商品卡片一一对应。
      answerText = buildLocalAnswer(message, answerProducts, history, state);
      await streamText(res, answerText);
    }

    // 只有成功生成答案后才写入会话，避免失败请求污染后续多轮上下文。
    appendTurn(session, "user", message);
    appendTurn(session, "assistant", answerText);
    rememberProducts(session, answerProducts);

    // 文本流结束后再发送结构化商品卡片，客户端据此渲染可点击商品列表。
    writeSse(res, "products", { products: cards });
    writeSse(res, "done", { ok: true, conversationId });
  } catch (error) {
    console.error("[/api/chat] failed:", error);
    writeSse(
      res,
      "error",
      buildError(ERROR_CODES.MODEL_ERROR, "模型服务或检索服务暂时不可用", error.message)
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
      modelEnabled: Boolean(config.llmApiKey),
      llmProvider: config.llmProvider
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
    const session = resetSession(conversationId);
    sendJson(res, 200, {
      ok: true,
      conversationId,
      session: snapshotSession(session)
    });
  });

  app.post("/api/debug/retrieve", async (req, res, next) => {
    try {
      const message = String(req.body?.message || "").trim();
      if (!message) return sendJson(res, 400, buildError(ERROR_CODES.VALIDATION_ERROR, "message 不能为空"));

      const conversationId = String(req.body?.conversationId || "debug").trim() || "debug";
      const includeMemory = req.body?.includeMemory !== false;
      const session = includeMemory ? getSession(conversationId) : resetSession(`debug:${conversationId}:${Date.now()}`);
      const state = updateSessionState(session, message);
      const retrievalQuery = buildRetrievalQuery(session, message);
      // 调试接口返回解析结果、候选数量和向量分数，方便定位“为什么推荐了这些商品”。
      const debug = await retrieveProductsWithDebug(products, retrievalQuery, state, Number(req.body?.limit || 4), vectorIndex);

      return sendJson(res, 200, {
        ok: true,
        conversationId,
        includeMemory,
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
  const app = express();
  installCommonMiddleware(app);
  installRoutes(app, { config, products, vectorIndex });
  installErrorHandlers(app);
  return app;
}

// 兼容旧测试或旧入口里 createHandler 这个命名；现在返回的是 Express app，本质仍可传给 http.createServer。
export const createHandler = createApp;
