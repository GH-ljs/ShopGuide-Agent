import Taro from "@tarojs/taro";
import { create } from "zustand";
import { fetchProductDetail, sendChat, sendChatOnce } from "../api/shopguide";
import type { ChatMessage, ChatRequestPayload, ChatSession, ProductCard } from "../types/shopguide";
import { parseCartIntent, extractRecentProducts } from "../utils/cartIntent";
import { createId, formatPrice } from "../utils/format";
import { normalizeSkuOptions } from "../utils/sku";
import { useShopStore } from "./shop";

// 聊天 store 是前端业务状态机：
// 1. 管理本地多会话和匿名 deviceId。
// 2. 把后端 SSE/JSON 事件转换成消息、追问、商品卡和对比卡。
// 3. 处理停止生成、超时降级、重试和本地“加入购物车”意图。
interface ChatState {
  input: string;
  isSending: boolean;
  streamStatus: string;
  shouldAutoScroll: boolean;
  sessions: ChatSession[];
  activeSessionId: string;
  deviceId: string;
  setInput: (value: string) => void;
  sendMessage: (text?: string, context?: { selectedProductIds?: string[] }) => Promise<void>;
  stopGeneration: () => void;
  retryMessage: (message: ChatMessage) => void;
  selectClarifyOption: (message: ChatMessage, value: string) => void;
  createNewConversation: () => void;
  selectConversation: (sessionId: string) => void;
  deleteConversation: (sessionId: string) => void;
  setShouldAutoScroll: (value: boolean) => void;
  restore: () => void;
}

const DEVICE_ID_KEY = "shopguide-agent-device-id";
const CHAT_STATE_KEY = "shopguide-agent-chat-sessions";
const NEW_SESSION_TITLE = "新会话";
const GENERIC_EMPTY_ANSWER = "我找到了这些商品，你可以点开卡片查看详情。";

let restored = false;
let activeController: AbortController | null = null;
let stoppedByUser = false;

export const useChatStore = create<ChatState>((set, get) => ({
  input: "",
  isSending: false,
  streamStatus: "",
  shouldAutoScroll: true,
  sessions: [createSession()],
  activeSessionId: "",
  deviceId: getOrCreateDeviceId(),
  setInput(value) {
    set({ input: value });
  },
  async sendMessage(text, context) {
    const content = String(text ?? get().input).trim();
    if (!content || get().isSending) return;

    const session = getActiveSession(get());
    if (await handleLocalCartIntent(content, session, set, get)) return;

    const history = buildRequestHistory(session.messages);
    const payload: ChatRequestPayload = {
      message: content,
      conversationId: session.id,
      deviceId: get().deviceId,
      history,
      selectedProductIds: context?.selectedProductIds
    };
    const userMessage: ChatMessage = { id: createId("user"), role: "user", content, status: "done" };
    const assistantMessage: ChatMessage = {
      id: createId("assistant"),
      role: "assistant",
      content: "正在连接导购模型...",
      status: "streaming",
      statusText: "正在连接",
      products: [],
      retryText: content
    };

    stoppedByUser = false;
    activeController = new AbortController();
    updateSession(set, get, session.id, (draft) => {
      draft.messages.push(userMessage, assistantMessage);
      if (draft.title === NEW_SESSION_TITLE) draft.title = buildSessionTitle(content);
      draft.updatedAt = Date.now();
    });
    set({ input: "", isSending: true, streamStatus: "正在连接", shouldAutoScroll: true });
    persistChatState(get());

    try {
      let hasToken = false;
      await sendChat(
        payload,
        {
          // 后端通过结构化事件传回 token、商品、对比和追问；前端只渲染这些事实字段，不从自然语言里反解析商品信息。
          onToken(token) {
            if (!hasToken) {
              patchMessage(set, get, session.id, assistantMessage.id, { content: "", statusText: "正在生成" });
              set({ streamStatus: "正在生成" });
              hasToken = true;
            }
            appendMessageContent(set, get, session.id, assistantMessage.id, token);
          },
          onAnswerReset() {
            // 模型在半途失败时，后端会改用同一批候选生成本地答案；先清空不完整 token，
            // 避免把半截模型文本和完整兜底答案拼在一起并写进会话记忆。
            hasToken = false;
            patchMessage(set, get, session.id, assistantMessage.id, { content: "", statusText: "正在切换快速回答" });
          },
          onAnswer(answer) {
            patchMessage(set, get, session.id, assistantMessage.id, { content: answer || GENERIC_EMPTY_ANSWER });
          },
          onProducts(products) {
            patchMessage(set, get, session.id, assistantMessage.id, { products });
          },
          onComparison(comparison) {
            patchMessage(set, get, session.id, assistantMessage.id, { comparison });
          },
          onClarify(clarify) {
            patchMessage(set, get, session.id, assistantMessage.id, {
              clarify,
              content: clarify ? "可以，我先帮你把需求收窄一点，这样推荐会更准。" : getMessage(get, session.id, assistantMessage.id)?.content || ""
            });
          },
          onDone() {
            patchMessage(set, get, session.id, assistantMessage.id, { statusText: "" });
            set({ streamStatus: "" });
          }
        },
        { signal: activeController.signal, firstTokenTimeoutMs: 15000, totalTimeoutMs: 90000 }
      );

      const current = getMessage(get, session.id, assistantMessage.id);
      patchMessage(set, get, session.id, assistantMessage.id, {
        content: current?.content?.trim() ? current.content : GENERIC_EMPTY_ANSWER,
        status: "done",
        statusText: "",
        error: ""
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (stoppedByUser || reason === "user_stop") {
        patchMessage(set, get, session.id, assistantMessage.id, {
          status: "done",
          statusText: "已停止",
          content: getMessage(get, session.id, assistantMessage.id)?.content || "已停止生成。"
        });
      } else {
        // 流式接口失败时不直接让页面卡死，而是切到 /api/chat/once。
        // 这样 H5 首 token 超时、浏览器流式兼容问题或模型短暂波动时，导购闭环仍能返回商品卡。
        await fallbackToFastAnswer(payload, assistantMessage.id, session.id, reason, set, get);
      }
    } finally {
      activeController = null;
      set({ isSending: false, streamStatus: "", shouldAutoScroll: true });
      touchSession(set, get, session.id);
      persistChatState(get());
    }
  },
  stopGeneration() {
    if (!activeController) return;
    stoppedByUser = true;
    set({ streamStatus: "正在停止" });
    activeController.abort("user_stop");
  },
  retryMessage(message) {
    if (!message.retryText) return;
    get().sendMessage(message.retryText);
  },
  selectClarifyOption(message, value) {
    if (!message.clarify || get().isSending) return;
    const baseQuery = message.clarify.baseQuery;
    // clarify 选项由后端生成，前端点击后只把“原需求 + 用户选择”作为下一轮自然语言继续交给 Agent。
    get().sendMessage(`${baseQuery}，${value}`);
  },
  createNewConversation() {
    const current = getActiveSession(get());
    if (!hasStartedConversation(current)) {
      set({ activeSessionId: current.id, input: "", shouldAutoScroll: true });
      persistChatState(get());
      return;
    }

    // 避免用户在第一句话发送前连续点“新会话”时生成多个空会话。
    const reusableEmptySession = get().sessions.find((session) => !hasStartedConversation(session));
    if (reusableEmptySession) {
      set({ activeSessionId: reusableEmptySession.id, input: "", shouldAutoScroll: true });
      persistChatState(get());
      return;
    }

    const session = createSession();
    set({ sessions: [session, ...get().sessions], activeSessionId: session.id, input: "", shouldAutoScroll: true });
    persistChatState(get());
  },
  selectConversation(sessionId) {
    if (get().isSending) return;
    set({ activeSessionId: sessionId, input: "", shouldAutoScroll: true });
    persistChatState(get());
  },
  deleteConversation(sessionId) {
    const sessions = get().sessions;
    if (sessions.length === 1) {
      const session = createSession();
      set({ sessions: [session], activeSessionId: session.id, shouldAutoScroll: true });
      persistChatState(get());
      return;
    }
    const next = sessions.filter((session) => session.id !== sessionId);
    set({ sessions: next, activeSessionId: get().activeSessionId === sessionId ? next[0].id : get().activeSessionId, shouldAutoScroll: true });
    persistChatState(get());
  },
  setShouldAutoScroll(value) {
    set({ shouldAutoScroll: value });
  },
  restore() {
    if (restored) return;
    restored = true;
    const raw = Taro.getStorageSync(CHAT_STATE_KEY);
    if (!raw) {
      const session = get().sessions[0];
      set({ activeSessionId: session.id });
      return;
    }
    try {
      const parsed = JSON.parse(String(raw)) as { activeSessionId?: string; sessions?: ChatSession[] };
      if (Array.isArray(parsed.sessions) && parsed.sessions.length) {
        const sessions = parsed.sessions.map(normalizePersistedSession).filter((session): session is ChatSession => Boolean(session));
        if (!sessions.length) throw new Error("聊天记录格式无效");
        const activeSessionId = sessions.some((session) => session.id === parsed.activeSessionId)
          ? String(parsed.activeSessionId)
          : sessions[0].id;
        set({ sessions, activeSessionId });
      }
    } catch {
      Taro.removeStorageSync(CHAT_STATE_KEY);
    }
  }
}));

function createWelcomeMessage(): ChatMessage {
  return {
    id: createId("assistant"),
    role: "assistant",
    content: "你好，我是 ShopGuide Agent。告诉我预算、场景或偏好，我会基于商品库推荐合适的商品。",
    status: "done",
    products: []
  };
}

function normalizePersistedSession(session: ChatSession): ChatSession | null {
  if (!session || typeof session.id !== "string" || !Array.isArray(session.messages)) return null;
  const messages = session.messages
    .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
    .map((message) =>
      message.status === "streaming"
        ? { ...message, status: "error" as const, statusText: "", error: "上次生成被中断，请重试。" }
        : message
    );
  return {
    id: session.id,
    title: typeof session.title === "string" && session.title.trim() ? session.title : NEW_SESSION_TITLE,
    updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now(),
    messages: messages.length ? messages : [createWelcomeMessage()]
  };
}

function createSession(title = NEW_SESSION_TITLE): ChatSession {
  const id = `app_${createId("conversation")}`;
  return { id, title, updatedAt: Date.now(), messages: [createWelcomeMessage()] };
}

function getActiveSession(state: ChatState): ChatSession {
  return state.sessions.find((session) => session.id === state.activeSessionId) || state.sessions[0];
}

function updateSession(set: (partial: Partial<ChatState>) => void, get: () => ChatState, sessionId: string, updater: (session: ChatSession) => void) {
  const sessions = get().sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const draft = { ...session, messages: session.messages.map((message) => ({ ...message })) };
    updater(draft);
    return draft;
  });
  set({ sessions });
}

function patchMessage(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
  sessionId: string,
  messageId: string,
  patch: Partial<ChatMessage>
) {
  updateSession(set, get, sessionId, (session) => {
    session.messages = session.messages.map((message) => (message.id === messageId ? { ...message, ...patch } : message));
    session.updatedAt = Date.now();
  });
}

function appendMessageContent(set: (partial: Partial<ChatState>) => void, get: () => ChatState, sessionId: string, messageId: string, token: string) {
  updateSession(set, get, sessionId, (session) => {
    session.messages = session.messages.map((message) => (message.id === messageId ? { ...message, content: message.content + token } : message));
    session.updatedAt = Date.now();
  });
}

function getMessage(get: () => ChatState, sessionId: string, messageId: string) {
  return get()
    .sessions.find((session) => session.id === sessionId)
    ?.messages.find((message) => message.id === messageId);
}

function touchSession(set: (partial: Partial<ChatState>) => void, get: () => ChatState, sessionId: string) {
  updateSession(set, get, sessionId, (session) => {
    session.updatedAt = Date.now();
  });
}

async function fallbackToFastAnswer(
  payload: ChatRequestPayload,
  messageId: string,
  sessionId: string,
  reason: string,
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState
) {
  const status =
    reason === "first_token_timeout"
      ? "模型响应较慢，已切换快速回答"
      : reason === "total_timeout"
        ? "生成超时，已切换快速回答"
        : "流式连接不稳定，已切换快速回答";
  patchMessage(set, get, sessionId, messageId, { statusText: status, content: "正在切换为快速回答..." });
  set({ streamStatus: status });
  try {
    const response = await sendChatOnce(payload);
    patchMessage(set, get, sessionId, messageId, {
      content: response.answer || GENERIC_EMPTY_ANSWER,
      products: response.products ?? [],
      comparison: response.comparison ?? null,
      clarify: response.clarify ?? null,
      status: "done",
      statusText: "",
      error: ""
    });
  } catch (error) {
    const fallbackReason = error instanceof Error ? error.message : "";
    patchMessage(set, get, sessionId, messageId, {
      content: "",
      products: [],
      comparison: null,
      clarify: null,
      status: "error",
      statusText: "",
      error: toUserFacingError(fallbackReason || reason)
    });
  }
}

async function handleLocalCartIntent(
  content: string,
  session: ChatSession,
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState
): Promise<boolean> {
  const intent = parseCartIntent(content, extractRecentProducts(session.messages));
  if (intent.type === "none") return false;

  const userMessage: ChatMessage = { id: createId("user"), role: "user", content, status: "done" };
  const assistantMessage: ChatMessage = {
    id: createId("assistant"),
    role: "assistant",
    content: "正在处理购物车操作...",
    status: "streaming",
    statusText: "正在处理",
    products: []
  };

  updateSession(set, get, session.id, (draft) => {
    draft.messages.push(userMessage, assistantMessage);
    if (draft.title === NEW_SESSION_TITLE) draft.title = buildSessionTitle(content);
    draft.updatedAt = Date.now();
  });
  set({ input: "", shouldAutoScroll: true });
  persistChatState(get());

  try {
    const answer = await resolveCartIntentAnswer(intent);
    patchMessage(set, get, session.id, assistantMessage.id, { content: answer, status: "done", statusText: "" });
  } catch {
    patchMessage(set, get, session.id, assistantMessage.id, {
      content: "这次购物车操作没有处理成功，请稍后再试，或直接点商品卡片操作。",
      status: "error",
      statusText: ""
    });
  }
  persistChatState(get());
  return true;
}

async function resolveCartIntentAnswer(intent: ReturnType<typeof parseCartIntent>): Promise<string> {
  const shop = useShopStore.getState();
  if (intent.type === "view_cart") return buildCartSummary();
  if (intent.type === "checkout") {
    if (!shop.cartItems.length) return "购物车还是空的，先把想买的商品加入购物车吧。";
    Taro.navigateTo({ url: "/pages/checkout/index" });
    return `已为你打开确认订单页。当前购物车共 ${shop.cartItems.length} 个条目，合计 ${formatPrice(shop.cartTotal)}。`;
  }
  if (intent.type === "clear_cart") {
    if (!shop.cartItems.length) return "购物车已经是空的。";
    shop.clearCart();
    return "已清空购物车。";
  }
  if (intent.type === "add") {
    if (intent.product) return addProductFromIntent(intent.product);
    return "我还不能确定你想加购哪一款。可以说“加入第 1 款”或点击商品卡片里的加入购物车。";
  }
  if (intent.type === "remove") {
    const item = resolveCartItem(intent.itemIndex);
    if (!item) return "我还不能确定要删除哪一项。可以说“删除第 1 个”，或在购物车面板里点删除。";
    shop.removeFromCart(item.itemKey);
    return `已将「${item.title}${item.skuLabel ? `，${item.skuLabel}` : ""}」从购物车移除。`;
  }
  if (intent.type === "change_qty") {
    if (!intent.quantity) return "我还没识别到要改成几件。可以说“把第 1 个数量改成 2”。";
    const item = resolveCartItem(intent.itemIndex);
    if (!item) return "我还不能确定要修改哪一项。可以说“把第 1 个数量改成 2”。";
    shop.setCartQuantity(item.itemKey, intent.quantity);
    return `已将「${item.title}${item.skuLabel ? `，${item.skuLabel}` : ""}」数量改成 ${intent.quantity}。`;
  }
  return "";
}

async function addProductFromIntent(product: ProductCard): Promise<string> {
  const shop = useShopStore.getState();
  let detail;
  try {
    detail = await fetchProductDetail(product.productId);
  } catch {
    return "我需要先确认这款商品的规格信息，但详情接口暂时不可用。你可以点商品卡片进入详情页后再加入购物车。";
  }
  const skuOptions = normalizeSkuOptions(detail.skus);
  if (skuOptions.length > 1) {
    setTimeout(() => Taro.navigateTo({ url: `/pages/product-detail/index?productId=${encodeURIComponent(product.productId)}` }), 700);
    return `「${detail.title}」有多个规格，需要先选规格。马上为你打开商品详情页。`;
  }
  shop.addToCart(detail, skuOptions[0]);
  return `已将「${detail.title}${skuOptions[0]?.label ? `，${skuOptions[0].label}` : ""}」加入购物车。`;
}

function resolveCartItem(index?: number) {
  const items = useShopStore.getState().cartItems;
  if (typeof index === "number") return items[index];
  if (items.length === 1) return items[0];
  return undefined;
}

function buildCartSummary(): string {
  const { cartItems, cartTotal } = useShopStore.getState();
  if (!cartItems.length) return "购物车是空的，去对话里挑几件合适的商品吧。";
  const lines = cartItems.map((item, index) => {
    const sku = item.skuLabel ? `，${item.skuLabel}` : "";
    return `${index + 1}. ${item.title}${sku} × ${item.quantity}，${formatPrice((item.price ?? 0) * item.quantity)}`;
  });
  return `购物车里有：\n${lines.join("\n")}\n合计：${formatPrice(cartTotal)}。`;
}

function persistChatState(state: ChatState) {
  let hasKeptEmptySession = false;
  const normalizedSessions = state.sessions
    .filter((session) => {
      if (hasStartedConversation(session)) return true;
      if (hasKeptEmptySession) return false;
      hasKeptEmptySession = true;
      return true;
    })
    .map((session) => ({ ...session, messages: session.messages.slice(-40) }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 12);

  Taro.setStorageSync(CHAT_STATE_KEY, JSON.stringify({ activeSessionId: state.activeSessionId, sessions: normalizedSessions }));
}

function toUserFacingError(reason: string): string {
  const normalized = reason.toLowerCase();
  if (!reason || normalized.includes("failed to fetch") || normalized.includes("network") || normalized.includes("err_connection")) {
    return "暂时连接不上导购服务，请确认后端已启动后再重试。";
  }
  if (normalized.includes("timeout") || reason.includes("超时")) return "这次响应时间太长了，请稍后重试，或把需求说得更具体一点。";
  if (/请求失败：\d\d\d/.test(reason)) return "导购服务刚刚处理失败了，请稍后重试。";
  if (normalized.includes("json") || normalized.includes("sse") || reason.includes("流式")) return "回答数据解析失败，请重新发送一次。";
  return "这次导购回答失败了，请重试一次。";
}

function hasStartedConversation(session: ChatSession): boolean {
  return session.messages.some((message) => message.role === "user");
}

function buildSessionTitle(text: string): string {
  return text.length > 16 ? `${text.slice(0, 16)}...` : text;
}

function buildRequestHistory(messages: ChatMessage[]) {
  return messages
    .filter((item) => item.status !== "error" && item.status !== "streaming" && item.content.trim())
    .slice(-10)
    .map((item) => ({ role: item.role, content: item.content }));
}

function getOrCreateDeviceId(): string {
  const cached = Taro.getStorageSync(DEVICE_ID_KEY);
  if (cached) return String(cached);
  const next = `app-device-${createId("device")}`;
  Taro.setStorageSync(DEVICE_ID_KEY, next);
  return next;
}
