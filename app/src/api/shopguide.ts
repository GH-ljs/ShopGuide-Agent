import type {
  ChatOnceResponse,
  ChatRequestPayload,
  ChatTransportHandlers,
  ChatTransportOptions,
  ProductDetail
} from "../types/shopguide";

const DEFAULT_BASE_URL = "http://127.0.0.1:3001";

export function getApiBaseUrl(): string {
  // H5 本地调试直连 127.0.0.1；小程序真机调试时可把这个值写成电脑局域网 IP。
  return uni.getStorageSync("SHOPGUIDE_API_BASE_URL") || DEFAULT_BASE_URL;
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
  // H5 使用 fetch 读取 SSE token；小程序先保留稳定 JSON，避免平台流式能力差异影响主闭环。
  // #ifdef H5
  return streamChat(params, handlers, options);
  // #endif

  // #ifndef H5
  const response = await sendChatOnce(params);
  handlers.onAnswer?.(response.answer);
  handlers.onProducts?.(response.products ?? []);
  handlers.onComparison?.(response.comparison ?? null);
  handlers.onClarify?.(response.clarify ?? null);
  handlers.onDone?.({ ok: response.ok, conversationId: response.conversationId, deviceId: response.deviceId });
  return response;
  // #endif
}

export async function sendChatOnce(params: ChatRequestPayload & { useModel?: boolean }): Promise<ChatOnceResponse> {
  return request<ChatOnceResponse>({
    url: `${getApiBaseUrl()}/api/chat/once`,
    method: "POST",
    data: params
  });
}

async function streamChat(
  params: ChatRequestPayload,
  handlers: ChatTransportHandlers,
  options: ChatTransportOptions
) {
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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`请求失败：${response.status}`);
    }
    if (!response.body) {
      throw new Error("当前浏览器不支持流式响应");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

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
    if (controller.signal.aborted) {
      throw new Error(String(controller.signal.reason || "stream_aborted"));
    }
    throw error;
  } finally {
    clearTimeout(totalTimer);
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function consumeSseBuffer(buffer: string, handlers: ChatTransportHandlers): string {
  let nextBuffer = buffer;
  let boundary = nextBuffer.indexOf("\n\n");
  while (boundary >= 0) {
    const block = nextBuffer.slice(0, boundary).trim();
    nextBuffer = nextBuffer.slice(boundary + 2);
    if (block) dispatchSseBlock(block, handlers);
    boundary = nextBuffer.indexOf("\n\n");
  }
  return nextBuffer;
}

function dispatchSseBlock(block: string, handlers: ChatTransportHandlers) {
  const lines = block.split(/\r?\n/);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  const event = eventLine?.slice("event:".length).trim() || "message";
  const rawData = dataLines.map((line) => line.slice("data:".length).trim()).join("\n");
  const data = rawData ? JSON.parse(rawData) : {};

  if (event === "meta") {
    handlers.onMeta?.(data);
    return;
  }
  if (event === "token") {
    handlers.onToken?.(String(data.content || ""));
    return;
  }
  if (event === "products") {
    handlers.onProducts?.(data.products || []);
    return;
  }
  if (event === "comparison") {
    handlers.onComparison?.(data.comparison || null);
    return;
  }
  if (event === "clarify") {
    handlers.onClarify?.(data.clarify || data || null);
    return;
  }
  if (event === "done") {
    handlers.onDone?.(data);
    return;
  }
  if (event === "error") {
    throw new Error(data?.error?.message || data?.message || "流式问答失败");
  }
}

function request<T>(options: UniApp.RequestOptions): Promise<T> {
  // 平台差异集中在 API 层：业务页面不用关心 H5 fetch 和小程序 uni.request 的差别。
  // #ifdef H5
  return requestWithFetch<T>(options);
  // #endif

  // #ifndef H5
  return requestWithUni<T>(options);
  // #endif
}

async function requestWithFetch<T>(options: UniApp.RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 60000);

  try {
    const response = await fetch(String(options.url), {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...((options.header as Record<string, string>) ?? {})
      },
      body: options.method === "GET" ? undefined : JSON.stringify(options.data ?? {}),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`请求失败：${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时，请稍后再试");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function requestWithUni<T>(options: UniApp.RequestOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    uni.request({
      ...options,
      timeout: options.timeout ?? 60000,
      header: {
        "Content-Type": "application/json",
        ...(options.header ?? {})
      },
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
