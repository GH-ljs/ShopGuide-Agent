// 文件职责：
// 调用 Doubao/Ark 的 OpenAI-compatible 流式接口，解析模型返回的 token。

import { buildModelMessages } from "./answer.js";

// 调用 Doubao/Ark 的 OpenAI-compatible chat completions，并把流式 token 逐个 yield 出去。
export async function* streamModelAnswer(config, message, products) {
  const response = await fetch(`${config.arkBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.arkApiKey}`
    },
    body: JSON.stringify({
      model: config.arkModel,
      messages: buildModelMessages(message, products),
      stream: true,
      temperature: 0.3
    })
  });

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new Error(`Model request failed: ${response.status} ${body}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  // SSE 数据可能被网络切成半行，所以用 buffer 累积，按行解析 data: payload。
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      const json = JSON.parse(payload);
      // OpenAI-compatible 流式响应的正文增量通常放在 choices[0].delta.content。
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
