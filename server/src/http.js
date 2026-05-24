// 文件职责：
// 定义后端 API：/api/health、/api/products、/api/chat，并处理 SSE 流式输出。

import { buildLocalAnswer, buildProductCards } from "./answer.js";
import { buildError, ERROR_CODES } from "./errors.js";
import { streamModelAnswer } from "./llm.js";
import { appendTurn, buildRetrievalQuery, getRecentTurns, getSession, rememberProducts, updateSessionState } from "./memory.js";
import { retrieveProductsWithState } from "./retriever.js";

// 普通 JSON 响应工具，主要给 health/products/错误返回使用。
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

// 原生 Node HTTP 不会自动解析 JSON body，这里手动读取请求体。
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// SSE 格式：每个事件包含 event 和 data 两行，并用空行结束。
function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// 本地兜底模式也模拟逐段输出，让客户端可以先按真实流式体验开发。
async function streamText(res, text) {
  const parts = text.split(/(\s+|\n)/).filter(Boolean);
  for (const part of parts) {
    writeSse(res, "token", { content: part });
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
}

// 请求进来-->判断路径
export function createHandler({ config, products, vectorIndex }) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      // 健康检查也暴露是否已配置模型 Key，方便排查当前是不是本地兜底模式。
      return sendJson(res, 200, {
        ok: true,
        productCount: products.length,
        modelEnabled: Boolean(config.llmApiKey),
        llmProvider: config.llmProvider
      });
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
      // 给客户端调试用的轻量商品列表，不返回长详情和评价，避免响应过大。
      return sendJson(
        res,
        200,
        products.map((product) => ({
          productId: product.productId,
          title: product.title,
          brand: product.brand,
          category: product.category,
          price: product.basePrice,
          imagePath: product.imagePath
        }))
      );
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, buildError(ERROR_CODES.INVALID_JSON, "请求体不是合法 JSON"));
      }

      const message = String(body.message || "").trim();
      if (!message) return sendJson(res, 400, buildError(ERROR_CODES.VALIDATION_ERROR, "message 不能为空"));

      const conversationId = String(body.conversationId || "default").trim() || "default";
      const session = getSession(conversationId);
      const state = updateSessionState(session, message);
      const history = getRecentTurns(session);
      const retrievalQuery = buildRetrievalQuery(session, message);

      // 先检索商品，再把候选商品交给本地回答或大模型生成。
      const matchedProducts = await retrieveProductsWithState(products, retrievalQuery, state, 4, vectorIndex);
      const cards = buildProductCards(matchedProducts);

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });

      try {
        let answerText = "";
        if (config.llmApiKey) {
          // 配置 Key 后走真实模型流式输出。
          for await (const token of streamModelAnswer(config, message, matchedProducts, history, state)) {
            answerText += token;
            writeSse(res, "token", { content: token });
          }
        } else {
          // 未配置 Key 时走本地兜底，保证后端和客户端联调不被模型依赖阻塞。
          answerText = buildLocalAnswer(message, matchedProducts, history, state);
          await streamText(res, answerText);
        }

        appendTurn(session, "user", message);
        appendTurn(session, "assistant", answerText);
        rememberProducts(session, matchedProducts);

        // 文本流结束后，再单独发送商品卡片，客户端可据此渲染可点击卡片。
        writeSse(res, "products", { products: cards });
        writeSse(res, "done", { ok: true, conversationId });
      } catch (error) {
        writeSse(res, "error", buildError(ERROR_CODES.MODEL_ERROR, "模型服务暂时不可用", error.message));
      } finally {
        res.end();
      }

      return;
    }

    if (req.method === "OPTIONS") {
      // 预留 CORS 预检响应，后续 Android/Web 调试都更省事。
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    sendJson(res, 404, buildError(ERROR_CODES.NOT_FOUND, "接口不存在"));
  };
}
