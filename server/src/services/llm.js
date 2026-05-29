// 文件职责：
// LLM 调用层：封装 OpenAI-compatible 聊天补全接口，支持 Doubao/Ark 和 DeepSeek Provider。
// 以 async generator 形式逐 token 输出，供 http.js 直接转发为 SSE token 事件。

import { buildModelMessages } from "./answer.js";

function getChatModelConfig(config) {
  if (config.llmProvider === "deepseek") {
    return {
      provider: "deepseek",
      apiKey: config.deepseekApiKey,
      baseUrl: config.deepseekBaseUrl,
      model: config.deepseekModel
    };
  }

  return {
    provider: "ark",
    apiKey: config.arkApiKey,
    baseUrl: config.arkBaseUrl,
    model: config.arkModel
  };
}

function parseStreamDelta(payload) {
  const json = JSON.parse(payload);
  // DeepSeek 和 Ark 都兼容 OpenAI 流式响应，正文增量通常放在 choices[0].delta.content。
  return json.choices?.[0]?.delta?.content || "";
}

// 调用 OpenAI-compatible chat completions，并把流式 token 逐个 yield 出去。
export async function* streamModelAnswer(config, message, products, history = [], state = {}) {
  const modelConfig = getChatModelConfig(config);
  if (!modelConfig.apiKey) {
    throw new Error(`LLM_PROVIDER=${modelConfig.provider} 需要配置对应 API Key`);
  }

  let response;
  try {
    response = await fetch(`${modelConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${modelConfig.apiKey}`
      },
      body: JSON.stringify({
        model: modelConfig.model,
        messages: buildModelMessages(message, products, history, state),
        stream: true,
        temperature: 0.3
      })
    });
  } catch (error) {
    throw new Error(`${modelConfig.provider} 聊天模型连接失败：${error.message}`);
  }

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
      const delta = parseStreamDelta(payload);
      if (delta) yield delta;
    }
  }
}
