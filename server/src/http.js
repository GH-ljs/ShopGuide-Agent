// 文件职责：
// 定义后端 API，包含健康检查、商品列表、商品详情、商品图片、导购对话和检索调试。
import fs from "node:fs";
import path from "node:path";
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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*"
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function streamText(res, text) {
  const parts = text.split(/(\s+|\n)/).filter(Boolean);
  for (const part of parts) {
    writeSse(res, "token", { content: part });
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
}

function writeSseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
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

  res.writeHead(200, {
    "Content-Type": contentTypeForImage(filePath),
    "Cache-Control": "public, max-age=3600",
    "Access-Control-Allow-Origin": "*"
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
    const state = updateSessionState(session, message);
    const history = getRecentTurns(session);
    const retrievalQuery = buildRetrievalQuery(session, message);

    // 检索属于 RAG 链路的一部分，也必须被 try/catch 包住。
    const matchedProducts = await retrieveProductsWithState(products, retrievalQuery, state, 4, vectorIndex);
    const cards = buildProductCards(matchedProducts);

    let answerText = "";
    if (config.llmApiKey) {
      for await (const token of streamModelAnswer(config, message, matchedProducts, history, state)) {
        answerText += token;
        writeSse(res, "token", { content: token });
      }
    } else {
      answerText = buildLocalAnswer(message, matchedProducts, history, state);
      await streamText(res, answerText);
    }

    appendTurn(session, "user", message);
    appendTurn(session, "assistant", answerText);
    rememberProducts(session, matchedProducts);

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

export function createHandler({ config, products, vectorIndex }) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        productCount: products.length,
        modelEnabled: Boolean(config.llmApiKey),
        llmProvider: config.llmProvider
      });
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
      return sendJson(res, 200, buildProductCards(products));
    }

    const imageMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/image$/);
    if (req.method === "GET" && imageMatch) {
      const product = findProduct(products, decodeURIComponent(imageMatch[1]));
      if (!product) return sendJson(res, 404, buildError(ERROR_CODES.NOT_FOUND, "商品不存在"));
      return sendImageFile(res, product.imagePath);
    }

    const detailMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
    if (req.method === "GET" && detailMatch) {
      const product = findProduct(products, decodeURIComponent(detailMatch[1]));
      if (!product) return sendJson(res, 404, buildError(ERROR_CODES.NOT_FOUND, "商品不存在"));
      return sendJson(res, 200, buildProductDetail(product));
    }

    if (req.method === "POST" && url.pathname === "/api/conversations/reset") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, buildError(ERROR_CODES.INVALID_JSON, "请求体不是合法 JSON"));
      }

      const conversationId = String(body.conversationId || "default").trim() || "default";
      const session = resetSession(conversationId);
      return sendJson(res, 200, {
        ok: true,
        conversationId,
        session: snapshotSession(session)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/debug/retrieve") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, buildError(ERROR_CODES.INVALID_JSON, "请求体不是合法 JSON"));
      }

      const message = String(body.message || "").trim();
      if (!message) return sendJson(res, 400, buildError(ERROR_CODES.VALIDATION_ERROR, "message 不能为空"));

      const conversationId = String(body.conversationId || "debug").trim() || "debug";
      const includeMemory = body.includeMemory !== false;
      const session = includeMemory ? getSession(conversationId) : resetSession(`debug:${conversationId}:${Date.now()}`);
      const state = updateSessionState(session, message);
      const retrievalQuery = buildRetrievalQuery(session, message);
      const debug = await retrieveProductsWithDebug(products, retrievalQuery, state, Number(body.limit || 4), vectorIndex);

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
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, buildError(ERROR_CODES.INVALID_JSON, "请求体不是合法 JSON"));
      }

      await handleChat({ body, config, products, vectorIndex, res });
      return;
    }

    sendJson(res, 404, buildError(ERROR_CODES.NOT_FOUND, "接口不存在"));
  };
}
