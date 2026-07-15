import Taro from "@tarojs/taro";
import type {
  ChatOnceResponse,
  ChatRequestPayload,
  ChatTransportHandlers,
  ChatTransportOptions,
  ProductDetail
} from "../types/shopguide";
import { consumeSseBuffer } from "../utils/sse";

// 前端通信层只处理“怎么和后端说话”，不承载导购业务判断。
// H5 使用 SSE 获得流式体验；小程序端先使用一次性 JSON，保证同一套业务代码在跨端环境里稳定可用。
const DEFAULT_BASE_URL = "http://127.0.0.1:3001";

export function getApiBaseUrl(): string {
  return Taro.getStorageSync("SHOPGUIDE_API_BASE_URL") || DEFAULT_BASE_URL;
}

export function resolveAssetUrl(path?: string): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function fetchProductDetail(productId: string): Promise<ProductDetail> {
  return request<ProductDetail>({
    url: `${getApiBaseUrl()}/api/products/${encodeURIComponent(productId)}`,
    method: "GET"
  });
}

export async function sendChat(
  params: ChatRequestPayload,
  handlers: ChatTransportHandlers = {},
  options: ChatTransportOptions = {}
) {
  // H5 可以用 fetch 读取 SSE 流；小程序端先走一次性 JSON，避免平台流式能力差异影响主闭环。
  if (process.env.TARO_ENV === "h5" && typeof fetch === "function") {
    return streamChat(params, handlers, options);
  }

  const response = await sendChatOnce(params);
  handlers.onAnswer?.(response.answer);
  handlers.onProducts?.(response.products ?? []);
  handlers.onComparison?.(response.comparison ?? null);
  handlers.onClarify?.(response.clarify ?? null);
  handlers.onDone?.({ ok: response.ok, conversationId: response.conversationId, deviceId: response.deviceId });
  return response;
}

export async function sendChatOnce(params: ChatRequestPayload & { useModel?: boolean }): Promise<ChatOnceResponse> {
  return request<ChatOnceResponse>({
    url: `${getApiBaseUrl()}/api/chat/once`,
    method: "POST",
    data: params
  });
}

async function streamChat(params: ChatRequestPayload, handlers: ChatTransportHandlers, options: ChatTransportOptions) {
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort("total_timeout"), options.totalTimeoutMs ?? 90000);
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort("first_token_timeout"),
    options.firstTokenTimeoutMs ?? 15000
  );

  const abortFromCaller = () => controller.abort("user_stop");
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`请求失败：${response.status}`);
    if (!response.body) throw new Error("当前浏览器不支持流式响应");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    // SSE 事件可能被浏览器拆成任意大小的 chunk，所以要累积到空行边界后再解析事件。
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = consumeSseBuffer(buffer, {
        ...handlers,
        onToken(token) {
          if (firstTokenTimer) {
            clearTimeout(firstTokenTimer);
            firstTokenTimer = null;
          }
          handlers.onToken?.(token);
        }
      });
    }

    buffer += decoder.decode();
    consumeSseBuffer(`${buffer}\n\n`, handlers);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(String(controller.signal.reason || "stream_aborted"));
    throw error;
  } finally {
    clearTimeout(totalTimer);
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function request<T>(options: Taro.request.Option): Promise<T> {
  // H5 下 fetch 的错误和超时更容易统一处理；非 H5 端用 Taro.request 适配小程序网络栈。
  if (process.env.TARO_ENV === "h5" && typeof fetch === "function") return requestWithFetch<T>(options);
  return requestWithTaro<T>(options);
}

async function requestWithFetch<T>(options: Taro.request.Option): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 60000);

  try {
    const response = await fetch(String(options.url), {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...((options.header as Record<string, string>) ?? {}) },
      body: options.method === "GET" ? undefined : JSON.stringify(options.data ?? {}),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`请求失败：${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("请求超时，请稍后再试");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function requestWithTaro<T>(options: Taro.request.Option): Promise<T> {
  return new Promise((resolve, reject) => {
    Taro.request({
      ...options,
      timeout: options.timeout ?? 60000,
      header: { "Content-Type": "application/json", ...(options.header ?? {}) },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data as T);
          return;
        }
        reject(new Error(`请求失败：${response.statusCode}`));
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络请求失败"));
      }
    });
  });
}
