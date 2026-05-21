import { buildLocalAnswer, buildProductCards } from "./answer.js";
import { streamModelAnswer } from "./llm.js";
import { retrieveProducts } from "./retriever.js";

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
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

export function createHandler({ config, products }) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        productCount: products.length,
        modelEnabled: Boolean(config.arkApiKey)
      });
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
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
        return sendJson(res, 400, { error: "Invalid JSON body" });
      }

      const message = String(body.message || "").trim();
      if (!message) return sendJson(res, 400, { error: "message is required" });

      const matchedProducts = retrieveProducts(products, message, 4);
      const cards = buildProductCards(matchedProducts);

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });

      try {
        if (config.arkApiKey) {
          for await (const token of streamModelAnswer(config, message, matchedProducts)) {
            writeSse(res, "token", { content: token });
          }
        } else {
          await streamText(res, buildLocalAnswer(message, matchedProducts));
        }

        writeSse(res, "products", { products: cards });
        writeSse(res, "done", { ok: true });
      } catch (error) {
        writeSse(res, "error", { message: error.message });
      } finally {
        res.end();
      }

      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  };
}
