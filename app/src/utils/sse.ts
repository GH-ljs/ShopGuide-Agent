import type { ChatTransportHandlers } from "../types/shopguide";

/**
 * SSE chunk 可能在任意字符处被拆开，并且代理可能使用 LF 或 CRLF。
 * 只有读到完整空行边界后才分发事件，剩余半包留给下一次读取。
 */
export function consumeSseBuffer(buffer: string, handlers: ChatTransportHandlers): string {
  let cursor = 0;
  const boundaryPattern = /\r?\n\r?\n/g;
  let match = boundaryPattern.exec(buffer);

  while (match) {
    const block = buffer.slice(cursor, match.index).trim();
    if (block) dispatchSseBlock(block, handlers);
    cursor = match.index + match[0].length;
    boundaryPattern.lastIndex = cursor;
    match = boundaryPattern.exec(buffer);
  }

  return buffer.slice(cursor);
}

function dispatchSseBlock(block: string, handlers: ChatTransportHandlers) {
  const lines = block.split(/\r?\n/);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  const event = eventLine?.slice("event:".length).trim() || "message";
  const rawData = dataLines.map((line) => line.slice("data:".length).trimStart()).join("\n");
  const data = parseEventData(rawData);

  if (event === "meta") handlers.onMeta?.(data);
  if (event === "answer_reset") handlers.onAnswerReset?.();
  if (event === "token") handlers.onToken?.(String(data.content || ""));
  if (event === "products") handlers.onProducts?.(data.products || []);
  if (event === "comparison") handlers.onComparison?.(data.comparison || null);
  if (event === "clarify") handlers.onClarify?.(data.clarify || data || null);
  if (event === "done") handlers.onDone?.(data);
  if (event === "error") throw new Error(data?.error?.message || data?.message || "流式问答失败");
}

function parseEventData(rawData: string): Record<string, any> {
  if (!rawData) return {};
  try {
    return JSON.parse(rawData) as Record<string, any>;
  } catch {
    throw new Error("SSE 事件数据不是合法 JSON");
  }
}
