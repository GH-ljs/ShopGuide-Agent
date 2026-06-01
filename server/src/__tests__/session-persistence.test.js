// 文件职责：
// 验证匿名 deviceId + conversationId 的会话隔离和持久化恢复。
// 这类测试能防止后续改动把多用户会话串线，或让后端重启后丢失结构化上下文。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { loadProducts } from "../data/loader.js";
import { createApp } from "../http.js";
import { clearSessionMemoryForTests, closeSessionPersistenceForTests } from "../services/memory.js";
import { createSearchIndex } from "../vectordb/factory.js";

function parseSseEvents(text) {
  return text
    .split(/\n\n/)
    .filter(Boolean)
    .map((block) => {
      const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      return {
        event: eventLine?.slice("event:".length).trim(),
        data: dataLine ? JSON.parse(dataLine.slice("data:".length).trim()) : null
      };
    });
}

async function createTestServer(sessionStorePath) {
  const products = loadProducts(config.datasetDir);
  const testConfig = {
    ...config,
    port: 0,
    arkApiKey: "",
    deepseekApiKey: "",
    llmApiKey: "",
    vectorStore: "local",
    sessionPersistenceEnabled: true,
    sessionStorePath
  };
  const vectorIndex = createSearchIndex(testConfig, products);
  const app = createApp({ config: testConfig, products, vectorIndex });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  return { server, baseUrl: `http://localhost:${server.address().port}` };
}

async function chat(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  });
  assert.equal(response.ok, true, "/api/chat should return 2xx");
  return parseSseEvents(await response.text());
}

async function debugRetrieve(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/api/debug/retrieve`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  });
  assert.equal(response.ok, true, "/api/debug/retrieve should return 2xx");
  return response.json();
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shopguide-session-"));
  const sessionStorePath = path.join(tmpDir, "sessions.db");
  let server;
  let baseUrl;

  try {
    ({ server, baseUrl } = await createTestServer(sessionStorePath));
    await chat(baseUrl, {
      deviceId: "device-a",
      conversationId: "same-conversation",
      message: "想买一台办公轻薄笔记本",
      limit: 4
    });
    await chat(baseUrl, {
      deviceId: "device-a",
      conversationId: "same-conversation",
      message: "1万预算",
      limit: 4
    });

    // 模拟后端进程内存丢失：只清内存，不清 SQLite。下一次请求应从持久化 store 恢复 state/needs。
    clearSessionMemoryForTests();
    const restored = await debugRetrieve(baseUrl, {
      deviceId: "device-a",
      conversationId: "same-conversation",
      message: "这些里面怎么选",
      limit: 4
    });
    assert.equal(restored.session.deviceId, "device-a");
    assert.equal(restored.session.conversationId, "same-conversation");
    assert.match(restored.session.summary, /笔记本|电脑/);
    assert.equal(restored.session.needs.some((need) => need.maxPrice === 10000), true);

    const isolated = await debugRetrieve(baseUrl, {
      deviceId: "device-b",
      conversationId: "same-conversation",
      message: "这些里面怎么选",
      limit: 4
    });
    assert.equal(isolated.session.deviceId, "device-b");
    assert.equal(isolated.session.turnCount, 0, "different deviceId should not reuse device-a memory");

    const legacy = await chat(baseUrl, {
      conversationId: "legacy-conversation",
      message: "推荐一款适合油皮的防晒霜",
      limit: 4
    });
    const done = legacy.find((item) => item.event === "done");
    assert.equal(done.data.deviceId, "anonymous", "old clients without deviceId should keep working");

    console.log("Session persistence tests passed.");
  } finally {
    await new Promise((resolve) => server?.close(resolve));
    closeSessionPersistenceForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
