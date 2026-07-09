import { computed, nextTick, ref } from "vue";
import { fetchProductDetail, sendChat, sendChatOnce } from "../api/shopguide";
import { useShopActions } from "./useShopActions";
import type { ChatMessage, ChatRequestPayload, ChatSession, ProductCard } from "../types/shopguide";
import { parseCartIntent, extractRecentProducts } from "../utils/cartIntent";
import { createId } from "../utils/format";
import { formatPrice } from "../utils/format";
import { normalizeSkuOptions } from "../utils/sku";

const DEVICE_ID_KEY = "shopguide-agent-device-id";
const CHAT_STATE_KEY = "shopguide-agent-chat-sessions";
const NEW_SESSION_TITLE = "新会话";
const AUTO_SCROLL_BOTTOM_THRESHOLD = 140;
const PROGRAMMATIC_SCROLL_GUARD_MS = 650;
const GENERIC_EMPTY_ANSWER = "我找到了这些商品，你可以点开卡片查看详情。";

function createWelcomeMessage(): ChatMessage {
  return {
    id: createId("assistant"),
    role: "assistant",
    content: "你好，我是 ShopGuide Agent。告诉我预算、场景或偏好，我会基于商品库推荐合适的商品。",
    status: "done",
    products: []
  };
}

function createSession(title = NEW_SESSION_TITLE): ChatSession {
  const id = `app_${createId("conversation")}`;
  return {
    id,
    title,
    updatedAt: Date.now(),
    messages: [createWelcomeMessage()]
  };
}

export function useChat() {
  const { cartItems, cartTotal, addToCart, setCartQuantity, removeFromCart, clearCart } = useShopActions();
  const input = ref("");
  const isSending = ref(false);
  const streamStatus = ref("");
  const scrollTop = ref(0);
  const shouldAutoScroll = ref(true);
  const deviceId = ref(getOrCreateDeviceId());
  const sessions = ref<ChatSession[]>([createSession()]);
  const activeSessionId = ref(sessions.value[0].id);
  const activeController = ref<AbortController | null>(null);
  let stoppedByUser = false;
  let lastScrollTop = 0;
  let programmaticScrollUntil = 0;

  restoreChatState();

  const activeSession = computed(() => {
    return sessions.value.find((session) => session.id === activeSessionId.value) || sessions.value[0];
  });
  const messages = computed(() => activeSession.value.messages);

  async function sendMessage(text = input.value) {
    const content = text.trim();
    if (!content || isSending.value) return;

    const session = activeSession.value;
    if (await handleLocalCartIntent(session, content)) return;

    const history = buildRequestHistory(session.messages);
    const payload: ChatRequestPayload = {
      message: content,
      conversationId: session.id,
      deviceId: deviceId.value,
      history
    };
    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      content,
      status: "done"
    };
    const assistantMessage: ChatMessage = {
      id: createId("assistant"),
      role: "assistant",
      content: "正在连接导购模型...",
      status: "streaming",
      statusText: "正在连接",
      products: [],
      retryText: content
    };

    input.value = "";
    isSending.value = true;
    stoppedByUser = false;
    streamStatus.value = "正在连接";
    activeController.value = new AbortController();
    session.messages.push(userMessage, assistantMessage);
    if (session.title === NEW_SESSION_TITLE) session.title = buildSessionTitle(content);
    touchSession(session);
    // 用户主动发起新一轮对话时，应该强制把视线带到最新问题和回答。
    forceScrollToBottom();
    persistChatState();

    try {
      let hasToken = false;
      await sendChat(
        payload,
        {
          onToken(token) {
            if (!hasToken) {
              assistantMessage.content = "";
              assistantMessage.statusText = "正在生成";
              streamStatus.value = "正在生成";
              hasToken = true;
            }
            assistantMessage.content += token;
            scrollToBottom();
          },
          onAnswer(answer) {
            assistantMessage.content = answer || GENERIC_EMPTY_ANSWER;
            scrollToBottom();
          },
          onProducts(products) {
            assistantMessage.products = products;
            scrollToBottom();
          },
          onComparison(comparison) {
            assistantMessage.comparison = comparison;
            scrollToBottom();
          },
          onClarify(clarify) {
            assistantMessage.clarify = clarify;
            if (clarify && !assistantMessage.content.trim()) {
              assistantMessage.content = "可以，我先帮你把需求收窄一点，这样推荐会更准。";
            }
            scrollToBottom();
          },
          onDone() {
            assistantMessage.statusText = "";
            streamStatus.value = "";
          }
        },
        {
          signal: activeController.value.signal,
          firstTokenTimeoutMs: 15000,
          totalTimeoutMs: 90000
        }
      );

      if (!assistantMessage.content.trim()) {
        assistantMessage.content = GENERIC_EMPTY_ANSWER;
      }
      assistantMessage.status = "done";
      assistantMessage.statusText = "";
      assistantMessage.error = "";
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (stoppedByUser || reason === "user_stop") {
        assistantMessage.status = "done";
        assistantMessage.statusText = "已停止";
        if (!assistantMessage.content.trim()) assistantMessage.content = "已停止生成。";
      } else if (reason === "first_token_timeout" || reason === "total_timeout") {
        await fallbackToFastAnswer(payload, assistantMessage, reason);
      } else {
        assistantMessage.content = "";
        assistantMessage.products = [];
        assistantMessage.comparison = null;
        assistantMessage.statusText = "";
        assistantMessage.error = toUserFacingError(reason);
        assistantMessage.status = "error";
      }
    } finally {
      isSending.value = false;
      activeController.value = null;
      streamStatus.value = "";
      touchSession(session);
      scrollToBottom();
      persistChatState();
    }
  }

  function stopGeneration() {
    if (!activeController.value) return;
    stoppedByUser = true;
    streamStatus.value = "正在停止";
    activeController.value.abort("user_stop");
  }

  async function fallbackToFastAnswer(payload: ChatRequestPayload, assistantMessage: ChatMessage, reason: string) {
    const status = reason === "first_token_timeout" ? "模型响应较慢，已切换快速回答" : "生成超时，已切换快速回答";
    assistantMessage.statusText = status;
    streamStatus.value = status;
    assistantMessage.content = "正在切换为快速回答...";
    scrollToBottom();

    try {
      const response = await sendChatOnce(payload);
      assistantMessage.content = response.answer || GENERIC_EMPTY_ANSWER;
      assistantMessage.products = response.products ?? [];
      assistantMessage.comparison = response.comparison ?? null;
      assistantMessage.clarify = response.clarify ?? null;
      assistantMessage.status = "done";
      assistantMessage.statusText = "";
      assistantMessage.error = "";
      scrollToBottom();
    } catch (error) {
      const fallbackReason = error instanceof Error ? error.message : "";
      assistantMessage.content = "";
      assistantMessage.products = [];
      assistantMessage.comparison = null;
      assistantMessage.clarify = null;
      assistantMessage.status = "error";
      assistantMessage.statusText = "";
      assistantMessage.error = toUserFacingError(fallbackReason || reason);
      scrollToBottom();
    }
  }

  function retryMessage(message: ChatMessage) {
    if (!message.retryText) return;
    sendMessage(message.retryText);
  }

  function selectClarifyOption(message: ChatMessage, value: string) {
    if (!message.clarify || isSending.value) return;
    const baseQuery = message.clarify.baseQuery;
    message.clarify = null;
    sendMessage(`${baseQuery}，${value}`);
  }

  async function handleLocalCartIntent(session: ChatSession, content: string): Promise<boolean> {
    const intent = parseCartIntent(content, extractRecentProducts(session.messages));
    if (intent.type === "none") return false;

    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      content,
      status: "done"
    };
    const assistantMessage: ChatMessage = {
      id: createId("assistant"),
      role: "assistant",
      content: "正在处理购物车操作...",
      status: "streaming",
      statusText: "正在处理",
      products: []
    };

    input.value = "";
    session.messages.push(userMessage, assistantMessage);
    if (session.title === NEW_SESSION_TITLE) session.title = buildSessionTitle(content);
    touchSession(session);
    forceScrollToBottom();
    persistChatState();
    try {
      assistantMessage.content = await resolveCartIntentAnswer(intent);
      assistantMessage.status = "done";
      assistantMessage.statusText = "";
    } catch {
      assistantMessage.content = "这次购物车操作没处理成功，请稍后再试，或直接点商品卡片操作。";
      assistantMessage.status = "error";
      assistantMessage.statusText = "";
    }
    touchSession(session);
    forceScrollToBottom();
    persistChatState();
    return true;
  }

  async function resolveCartIntentAnswer(intent: ReturnType<typeof parseCartIntent>): Promise<string> {
    if (intent.type === "view_cart") return buildCartSummary();
    if (intent.type === "checkout") {
      if (!cartItems.value.length) return "购物车还是空的，先把想买的商品加入购物车吧。";
      uni.navigateTo({ url: "/pages/checkout/index" });
      return `已为你打开确认订单页。当前购物车共 ${cartItems.value.length} 个条目，合计 ${formatPrice(cartTotal.value)}。`;
    }
    if (intent.type === "clear_cart") {
      if (!cartItems.value.length) return "购物车已经是空的。";
      clearCart();
      return "已清空购物车。";
    }
    if (intent.type === "add") {
      if (intent.product) {
        return addProductFromIntent(intent.product);
      }
      return "我还不能确定你想加购哪一款。可以说“加入第 1 款”或点商品卡片里的加入购物车。";
    }
    if (intent.type === "remove") {
      const item = resolveCartItem(intent.itemIndex);
      if (!item) return "我还不能确定要删除哪一项。可以说“删除第 1 个”，或在购物车面板里点删除。";
      removeFromCart(item.itemKey);
      return `已将「${item.title}${item.skuLabel ? `（${item.skuLabel}）` : ""}」从购物车移除。`;
    }
    if (intent.type === "change_qty") {
      if (!intent.quantity) return "我还没识别到要改成几件。可以说“把第 1 个数量改成 2”。";
      const item = resolveCartItem(intent.itemIndex);
      if (!item) return "我还不能确定要修改哪一项。可以说“把第 1 个数量改成 2”。";
      setCartQuantity(item.itemKey, intent.quantity);
      return `已将「${item.title}${item.skuLabel ? `（${item.skuLabel}）` : ""}」数量改成 ${intent.quantity}。`;
    }
    return "";
  }

  async function addProductFromIntent(product: ProductCard): Promise<string> {
    let detail;
    try {
      detail = await fetchProductDetail(product.productId);
    } catch {
      return "我需要先确认这款商品的规格信息，但详情接口暂时不可用。你可以点商品卡片进入详情页后再加入购物车。";
    }
    const skuOptions = normalizeSkuOptions(detail.skus);
    if (skuOptions.length > 1) {
      setTimeout(() => {
        uni.navigateTo({
          url: `/pages/product-detail/index?productId=${encodeURIComponent(product.productId)}`
        });
      }, 900);
      return `「${detail.title}」有多个规格，需要先选规格。马上为你打开商品详情页，选好规格后再加入购物车。`;
    }
    addToCart(detail, skuOptions[0]);
    const skuText = skuOptions[0]?.label ? `（${skuOptions[0].label}）` : "";
    return `已将「${detail.title}${skuText}」加入购物车。`;
  }

  function resolveCartItem(index?: number) {
    if (typeof index === "number") return cartItems.value[index];
    if (cartItems.value.length === 1) return cartItems.value[0];
    return undefined;
  }

  function buildCartSummary(): string {
    if (!cartItems.value.length) return "购物车是空的，去对话里挑几件合适的商品吧。";
    const lines = cartItems.value.map((item, index) => {
      const sku = item.skuLabel ? `（${item.skuLabel}）` : "";
      return `${index + 1}. ${item.title}${sku} × ${item.quantity}，${formatPrice((item.price ?? 0) * item.quantity)}`;
    });
    return `购物车里有：\n${lines.join("\n")}\n合计：${formatPrice(cartTotal.value)}。`;
  }

  function createNewConversation() {
    if (!hasStartedConversation(activeSession.value)) {
      activeSessionId.value = activeSession.value.id;
      input.value = "";
      forceScrollToBottom();
      persistChatState();
      return;
    }

    // 用户可能在真正发送第一句话前连续点“新对话”。这时复用现有空会话，
    // 避免侧边栏堆出一排没有任何消息的占位会话。
    const reusableEmptySession = sessions.value.find((session) => !hasStartedConversation(session));
    if (reusableEmptySession) {
      activeSessionId.value = reusableEmptySession.id;
      input.value = "";
      forceScrollToBottom();
      persistChatState();
      return;
    }

    const session = createSession();
    sessions.value.unshift(session);
    activeSessionId.value = session.id;
    input.value = "";
    forceScrollToBottom();
    persistChatState();
  }

  function selectConversation(sessionId: string) {
    if (isSending.value) return;
    activeSessionId.value = sessionId;
    input.value = "";
    forceScrollToBottom();
    persistChatState();
  }

  function deleteConversation(sessionId: string) {
    if (sessions.value.length === 1) {
      sessions.value = [createSession()];
      activeSessionId.value = sessions.value[0].id;
      forceScrollToBottom();
      persistChatState();
      return;
    }
    sessions.value = sessions.value.filter((session) => session.id !== sessionId);
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[0].id;
    }
    forceScrollToBottom();
    persistChatState();
  }

  function handleMessagesScroll(event: { detail?: { scrollTop?: number; scrollHeight?: number; height?: number } }) {
    const detail = event.detail ?? {};
    const nextTop = Number(detail.scrollTop ?? 0);
    const scrollHeight = Number(detail.scrollHeight ?? 0);
    const viewHeight = Number(detail.height ?? 0);

    if (Date.now() < programmaticScrollUntil && nextTop >= lastScrollTop - 80) {
      lastScrollTop = nextTop;
      return;
    }

    if (scrollHeight > 0 && viewHeight > 0) {
      // 只有用户接近底部时才自动跟随 token 输出；如果用户正在翻历史，保持当前位置。
      // 这是聊天产品里很关键的体验边界，否则长回答生成时会打断用户阅读旧内容。
      shouldAutoScroll.value = scrollHeight - nextTop - viewHeight < AUTO_SCROLL_BOTTOM_THRESHOLD;
    } else if (nextTop < lastScrollTop - 24) {
      // 小程序端部分版本不稳定返回 scrollHeight，这里用“明显向上滚”兜底判断用户正在看历史内容。
      shouldAutoScroll.value = false;
    }
    lastScrollTop = nextTop;
  }

  function handleMessagesScrollToLower() {
    shouldAutoScroll.value = true;
  }

  function jumpToBottom() {
    forceScrollToBottom();
  }

  function restoreChatState() {
    const raw = uni.getStorageSync(CHAT_STATE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(String(raw)) as {
        activeSessionId?: string;
        sessions?: ChatSession[];
      };
      if (Array.isArray(parsed.sessions) && parsed.sessions.length) {
        sessions.value = parsed.sessions;
        activeSessionId.value = parsed.activeSessionId || parsed.sessions[0].id;
      }
    } catch {
      uni.removeStorageSync(CHAT_STATE_KEY);
    }
  }

  function persistChatState() {
    let hasKeptEmptySession = false;
    const normalizedSessions = sessions.value
      .filter((session) => {
        if (hasStartedConversation(session)) return true;
        if (hasKeptEmptySession) return false;
        hasKeptEmptySession = true;
        return true;
      })
      .map((session) => ({
        ...session,
        messages: session.messages.slice(-40)
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12);

    sessions.value = normalizedSessions;
    uni.setStorageSync(
      CHAT_STATE_KEY,
      JSON.stringify({
        activeSessionId: activeSessionId.value,
        sessions: normalizedSessions
      })
    );
  }

  function scrollToBottom() {
    if (!shouldAutoScroll.value) return;
    forceScrollToBottom();
  }

  function forceScrollToBottom() {
    shouldAutoScroll.value = true;
    programmaticScrollUntil = Date.now() + PROGRAMMATIC_SCROLL_GUARD_MS;
    nextTick(() => {
      // uni-app H5 的 scroll-view 内部还有一层真实滚动容器；持续给一个更大的目标值比锚点更稳定。
      scrollTop.value += 1000000;
      scrollH5ContainerToBottom();
      setTimeout(() => {
        if (!shouldAutoScroll.value) return;
        scrollTop.value += 1000000;
        scrollH5ContainerToBottom();
      }, 80);
      setTimeout(() => {
        if (!shouldAutoScroll.value) return;
        scrollTop.value += 1000000;
        scrollH5ContainerToBottom();
      }, 240);
      setTimeout(() => {
        if (!shouldAutoScroll.value) return;
        scrollTop.value += 1000000;
        scrollH5ContainerToBottom();
      }, 700);
    });
  }

  return {
    input,
    isSending,
    streamStatus,
    messages,
    sessions,
    activeSessionId,
    scrollTop,
    shouldAutoScroll,
    sendMessage,
    stopGeneration,
    retryMessage,
    selectClarifyOption,
    createNewConversation,
    selectConversation,
    deleteConversation,
    handleMessagesScroll,
    handleMessagesScrollToLower,
    jumpToBottom
  };
}

function scrollH5ContainerToBottom() {
  // #ifdef H5
  const shell = document.querySelector(".messages .uni-scroll-view");
  if (shell instanceof HTMLElement) {
    shell.scrollTop = shell.scrollHeight;
  }
  // #endif
}

function toUserFacingError(reason: string): string {
  const normalized = reason.toLowerCase();

  // 这里把浏览器、后端、模型服务抛出的技术错误压成稳定文案，避免把栈信息或供应商细节暴露给普通用户。
  if (!reason || normalized.includes("failed to fetch") || normalized.includes("network") || normalized.includes("err_connection")) {
    return "暂时连接不上导购服务，请确认后端已启动后再重试。";
  }
  if (normalized.includes("timeout") || reason.includes("超时")) {
    return "这次响应时间太长了，请稍后重试，或把需求说得更具体一点。";
  }
  if (reason.includes("请求失败：400")) {
    return "这次请求内容不太完整，请换一种说法再试。";
  }
  if (reason.includes("请求失败：404")) {
    return "导购接口暂时不可用，请确认服务地址配置正确。";
  }
  if (reason.includes("请求失败：401") || reason.includes("请求失败：403")) {
    return "模型或检索服务鉴权失败，请检查本地环境变量配置。";
  }
  if (/请求失败：5\d\d/.test(reason)) {
    return "导购服务刚刚处理失败了，请稍后重试。";
  }
  if (normalized.includes("json") || normalized.includes("sse") || reason.includes("流式")) {
    return "回答数据解析失败，请重新发送一次。";
  }
  return "这次导购回答失败了，请重试一次。";
}

function touchSession(session: ChatSession) {
  session.updatedAt = Date.now();
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
  const cached = uni.getStorageSync(DEVICE_ID_KEY);
  if (cached) return String(cached);
  const next = `app-device-${createId("device")}`;
  uni.setStorageSync(DEVICE_ID_KEY, next);
  return next;
}
