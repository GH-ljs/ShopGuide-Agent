import { buildModelMessages } from "./answer.js";

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
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
