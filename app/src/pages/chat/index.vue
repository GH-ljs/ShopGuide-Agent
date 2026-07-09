<script setup lang="ts">
import { ref } from "vue";
import ComparisonCard from "../../components/comparison/ComparisonCard.vue";
import ProductCard from "../../components/product/ProductCard.vue";
import { useChat } from "../../composables/useChat";
import { useShopActions } from "../../composables/useShopActions";
import type { ChatMessage, ProductCard as ProductCardType } from "../../types/shopguide";
import { formatPrice } from "../../utils/format";

const quickPrompts = ["预算200内的油皮防晒", "通勤用清爽不黏", "帮我对比无糖饮料"];
type RichTextNode =
  | { type: "text"; text: string }
  | { name: string; attrs?: Record<string, string>; children?: RichTextNode[] };

const isDrawerOpen = ref(false);
const isCartOpen = ref(false);
const isFavoritesOpen = ref(false);
const compareSelections = ref<Record<string, string[]>>({});
const {
  input,
  isSending,
  messages,
  sessions,
  activeSessionId,
  scrollTop,
  shouldAutoScroll,
  streamStatus,
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
} = useChat();
const {
  favorites,
  favoriteCount,
  cartItems,
  cartCount,
  cartTotal,
  isFavorite,
  cartQuantity,
  toggleFavorite,
  addToCart,
  setCartQuantity,
  removeFromCart
} = useShopActions();

function openProduct(product: ProductCardType) {
  uni.navigateTo({
    url: `/pages/product-detail/index?productId=${encodeURIComponent(product.productId)}`
  });
}

function openDrawer() {
  isDrawerOpen.value = true;
}

function closeDrawer() {
  isDrawerOpen.value = false;
}

function createConversationFromDrawer() {
  createNewConversation();
  closeDrawer();
}

function selectConversationFromDrawer(sessionId: string) {
  selectConversation(sessionId);
  closeDrawer();
}

function openCart() {
  isFavoritesOpen.value = false;
  isCartOpen.value = true;
}

function closeCart() {
  isCartOpen.value = false;
}

function openFavorites() {
  isCartOpen.value = false;
  isFavoritesOpen.value = true;
}

function closeFavorites() {
  isFavoritesOpen.value = false;
}

function addProductToCart(product: ProductCardType) {
  addToCart(product);
  uni.showToast({ title: "已加入购物车", icon: "none" });
}

function renderAssistantContent(content: string): RichTextNode[] {
  const lines = content.split(/\r?\n/);
  return lines.map((line) => ({
    name: "div",
    attrs: {
      class: line.trim() ? "md-line" : "md-line md-spacer",
      style: line.trim() ? "display:block;margin:0 0 7px;" : "display:block;height:6px;margin:0;line-height:6px;"
    },
    children: line.trim() ? renderInlineMarkdown(line) : [{ type: "text", text: " " }]
  }));
}

function renderInlineMarkdown(text: string): RichTextNode[] {
  const nodes: RichTextNode[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push({ type: "text", text: text.slice(cursor, match.index) });
    }
    nodes.push({
      name: "strong",
      attrs: { class: "md-strong", style: "font-weight:700;" },
      children: [{ type: "text", text: match[1] }]
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push({ type: "text", text: text.slice(cursor) });
  }

  return nodes.length ? nodes : [{ type: "text", text }];
}

function openCheckout() {
  if (!cartItems.value.length) return;
  uni.navigateTo({ url: "/pages/checkout/index" });
}

function isCompareSelected(messageId: string, productId: string) {
  return (compareSelections.value[messageId] || []).includes(productId);
}

function toggleCompareSelection(message: ChatMessage, product: ProductCardType) {
  const current = compareSelections.value[message.id] || [];
  if (current.includes(product.productId)) {
    compareSelections.value = {
      ...compareSelections.value,
      [message.id]: current.filter((id) => id !== product.productId)
    };
    return;
  }
  if (current.length >= 3) {
    uni.showToast({ title: "最多选择 3 款对比", icon: "none" });
    return;
  }
  compareSelections.value = {
    ...compareSelections.value,
    [message.id]: [...current, product.productId]
  };
}

function selectedCompareCount(messageId: string) {
  return compareSelections.value[messageId]?.length || 0;
}

function clearCompareSelection(messageId: string) {
  compareSelections.value = {
    ...compareSelections.value,
    [messageId]: []
  };
}

function startCompare(message: ChatMessage) {
  const products = message.products || [];
  const selectedIds = compareSelections.value[message.id] || [];
  if (selectedIds.length < 2) {
    uni.showToast({ title: "至少选择 2 款商品", icon: "none" });
    return;
  }

  const selectedIndexes = selectedIds
    .map((id) => products.findIndex((product) => product.productId === id))
    .filter((index) => index >= 0)
    .map((index) => index + 1);

  if (selectedIndexes.length < 2) {
    uni.showToast({ title: "这组商品已失效，请重新推荐后再对比", icon: "none" });
    clearCompareSelection(message.id);
    return;
  }

  const indexText = selectedIndexes.map((index) => `第${index}款`).join("、");
  clearCompareSelection(message.id);
  sendMessage(`${indexText}对比一下`);
}
</script>

<template>
  <view class="page" :class="{ 'drawer-open': isDrawerOpen }">
    <view v-if="isDrawerOpen" class="drawer-backdrop" @click="closeDrawer"></view>

    <view class="sidebar">
      <view class="sidebar-top">
        <view class="brand">
          <text class="brand-title">ShopGuide</text>
          <text class="brand-subtitle">智能导购 Agent</text>
        </view>
        <button class="drawer-close" aria-label="关闭会话抽屉" @click="closeDrawer">
          <text>×</text>
        </button>
      </view>

      <view class="sidebar-content">
        <button class="new-button" :disabled="isSending" @click="createConversationFromDrawer">新对话</button>
        <scroll-view class="session-list" scroll-y>
          <view
            v-for="session in sessions"
            :key="session.id"
            class="session-item"
            :class="{ active: session.id === activeSessionId }"
            @click="selectConversationFromDrawer(session.id)"
          >
            <text class="session-title">{{ session.title }}</text>
            <button class="delete-button" :disabled="isSending" @click.stop="deleteConversation(session.id)">
              删除
            </button>
          </view>
        </scroll-view>
      </view>
    </view>

    <view class="chat">
      <view class="chat-header">
        <button class="drawer-open-button" aria-label="打开会话抽屉" @click="openDrawer">
          <text class="drawer-open-icon"></text>
        </button>
        <view class="header-copy">
          <text class="chat-title">ShopGuide</text>
        </view>
        <view class="header-actions">
          <button class="header-action-button" aria-label="打开收藏" @click="openFavorites">
            <text>收藏</text>
            <text v-if="favoriteCount" class="action-badge">{{ favoriteCount }}</text>
          </button>
          <button class="header-action-button" aria-label="打开购物车" @click="openCart">
            <text>购物车</text>
            <text v-if="cartCount" class="action-badge">{{ cartCount }}</text>
          </button>
        </view>
      </view>

      <scroll-view
        class="messages"
        scroll-y
        :scroll-top="scrollTop"
        :lower-threshold="120"
        @scroll="handleMessagesScroll"
        @scrolltolower="handleMessagesScrollToLower"
      >
        <view v-for="message in messages" :key="message.id" class="message" :class="message.role">
          <view class="avatar">{{ message.role === "assistant" ? "S" : "你" }}</view>
          <view class="bubble">
            <rich-text
              v-if="message.content && message.role === 'assistant'"
              class="content rich-content"
              :nodes="renderAssistantContent(message.content)"
            />
            <text v-else-if="message.content" class="content">{{ message.content }}</text>
            <text v-if="message.statusText" class="status-text">{{ message.statusText }}</text>
            <text v-if="message.error" class="error">{{ message.error }}</text>
            <button
              v-if="message.status === 'error' && message.retryText"
              class="retry"
              :disabled="isSending"
              @click="retryMessage(message)"
            >
              重试
            </button>
            <view v-if="message.clarify" class="clarify-card">
              <text class="clarify-question">{{ message.clarify.question }}</text>
              <view class="clarify-options">
                <button
                  v-for="option in message.clarify.options"
                  :key="option.value"
                  class="clarify-option"
                  :disabled="isSending"
                  @click="selectClarifyOption(message, option.value)"
                >
                  {{ option.label }}
                </button>
              </view>
            </view>
            <ComparisonCard v-if="message.comparison" :comparison="message.comparison" />
            <view v-if="message.products?.length" class="products">
              <ProductCard
                v-for="product in message.products"
                :key="product.productId"
                :product="product"
                :favorite="isFavorite(product.productId)"
                :cart-quantity="cartQuantity(product.productId)"
                :compare-selected="isCompareSelected(message.id, product.productId)"
                @open="openProduct"
                @toggle-favorite="toggleFavorite"
                @add-to-cart="addProductToCart"
                @toggle-compare="toggleCompareSelection(message, product)"
              />
              <view v-if="selectedCompareCount(message.id)" class="compare-toolbar">
                <text class="compare-count">已选 {{ selectedCompareCount(message.id) }} 款</text>
                <view class="compare-actions">
                  <button
                    class="compare-action secondary"
                    :disabled="isSending"
                    @click="clearCompareSelection(message.id)"
                  >
                    清空
                  </button>
                  <button
                    class="compare-action primary"
                    :disabled="isSending || selectedCompareCount(message.id) < 2"
                    @click="startCompare(message)"
                  >
                    对比
                  </button>
                </view>
              </view>
            </view>
          </view>
        </view>
        <view class="bottom-spacer"></view>
      </scroll-view>

      <button v-if="!shouldAutoScroll" class="jump-bottom" aria-label="回到底部" @click="jumpToBottom">↓</button>

      <view class="composer-wrap">
        <text v-if="streamStatus" class="stream-status">{{ streamStatus }}</text>
        <scroll-view class="quick-prompts" scroll-x>
          <button
            v-for="prompt in quickPrompts"
            :key="prompt"
            class="prompt"
            :disabled="isSending"
            @click="sendMessage(prompt)"
          >
            {{ prompt }}
          </button>
        </scroll-view>
        <view class="composer">
          <textarea
            v-model="input"
            class="input"
            auto-height
            :maxlength="500"
            placeholder="输入购物需求，例如：油皮防晒、预算200以内"
          />
          <button
            class="send"
            :class="{ stop: isSending }"
            :disabled="!isSending && !input.trim()"
            @click="isSending ? stopGeneration() : sendMessage()"
          >
            {{ isSending ? "停止" : "发送" }}
          </button>
        </view>
      </view>

      <view v-if="isFavoritesOpen" class="side-panel favorites-panel">
        <view class="panel-header">
          <text class="panel-title">收藏</text>
          <button class="panel-close" aria-label="关闭收藏" @click="closeFavorites">×</button>
        </view>
        <view v-if="!favorites.length" class="panel-empty">
          <text>还没有收藏商品，可以在推荐卡片或详情页点收藏。</text>
        </view>
        <scroll-view v-else class="panel-list" scroll-y>
          <view v-for="item in favorites" :key="item.productId" class="favorite-item">
            <view class="favorite-main" @click="openProduct(item)">
              <text class="favorite-title">{{ item.title }}</text>
              <text class="favorite-price">{{ formatPrice(item.price) }}</text>
            </view>
            <view class="favorite-actions">
              <button class="small-action" @click="addProductToCart(item)">加入购物车</button>
              <button class="remove-button" @click="toggleFavorite(item)">取消</button>
            </view>
          </view>
        </scroll-view>
      </view>

      <view v-if="isCartOpen" class="side-panel cart-panel">
        <view class="cart-panel-header">
          <text class="cart-title">购物车</text>
          <button class="cart-close" aria-label="关闭购物车" @click="closeCart">×</button>
        </view>
        <view v-if="!cartItems.length" class="cart-empty">
          <text>购物车还是空的，可以先从推荐商品加入。</text>
        </view>
        <scroll-view v-else class="cart-list" scroll-y>
          <view v-for="item in cartItems" :key="item.productId" class="cart-item">
            <view class="cart-item-main">
              <text class="cart-item-title">{{ item.title }}</text>
              <text v-if="item.skuLabel" class="cart-item-sku">{{ item.skuLabel }}</text>
              <text class="cart-item-price">{{ formatPrice(item.price) }}</text>
            </view>
            <view class="cart-controls">
              <button class="qty-button" @click="setCartQuantity(item.itemKey, item.quantity - 1)">−</button>
              <text class="qty-text">{{ item.quantity }}</text>
              <button class="qty-button" @click="setCartQuantity(item.itemKey, item.quantity + 1)">+</button>
              <button class="remove-button" @click="removeFromCart(item.itemKey)">删除</button>
            </view>
          </view>
        </scroll-view>
        <view class="cart-footer">
          <text class="cart-total">合计 {{ formatPrice(cartTotal) }}</text>
          <button class="checkout-button" :disabled="!cartItems.length" @click="openCheckout">去结算</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  --app-header-height: 62px;
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #eef2f1;
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgba(22, 31, 28, 0.2);
}

.sidebar {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 30;
  display: flex;
  width: min(320px, 86vw);
  flex-direction: column;
  gap: 12px;
  padding: 18px 16px 14px 28px;
  border-right: 1px solid #d7dfdc;
  background: #f8faf9;
  box-shadow: none;
  transform: translateX(calc(-100% - 8px));
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.drawer-open .sidebar {
  box-shadow: 18px 0 34px rgba(28, 42, 37, 0.16);
  transform: translateX(0);
}

.sidebar-top {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 42px;
  min-height: 44px;
}

.brand {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.brand-title {
  color: #15231d;
  font-size: 20px;
  font-weight: 900;
}

.brand-subtitle {
  color: #66756f;
  font-size: 12px;
}

.header-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  margin-left: auto;
  overflow: visible;
}

.header-action-button {
  position: relative;
  display: flex;
  width: 82px;
  height: 36px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  color: #1f5f4f;
  border: 1px solid #bdd6ce;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  font-weight: 800;
  line-height: 36px;
  overflow: visible;
}

.header-action-button::after {
  border: 0;
}

.action-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  color: #fff;
  background: #a33d2c;
  font-size: 11px;
  line-height: 18px;
}

.drawer-close,
.drawer-open-button {
  display: flex;
  width: 34px;
  height: 32px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
}

.drawer-close:hover,
.drawer-open-button:hover {
  background: #edf3f1;
}

.drawer-close {
  position: absolute;
  top: 6px;
  right: 0;
  color: #52615c;
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
}

.drawer-close::after,
.drawer-open-button::after {
  border: 0;
}

.drawer-open-button {
  position: absolute;
  left: 18px;
  top: 15px;
  border: 1px solid #d5dedb;
  background: #fff;
}

.drawer-open-icon {
  position: relative;
  width: 18px;
  height: 16px;
  border: 2px solid #8a9691;
  border-radius: 5px;
}

.drawer-open-icon::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 6px;
  width: 2px;
  background: #8a9691;
  content: "";
}

.sidebar-content {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
}

.new-button {
  height: 38px;
  color: #fff;
  background: #1f7a63;
  font-size: 14px;
  font-weight: 800;
}

.session-list {
  flex: 1;
  height: 0;
}

.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid #d8e0dd;
  border-radius: 8px;
  background: #fff;
}

.session-item.active {
  border-color: #85b8a8;
  background: #e8f3ef;
}

.session-title {
  min-width: 0;
  flex: 1;
  color: #26342f;
  font-size: 13px;
  line-height: 1.4;
}

.delete-button {
  width: 44px;
  height: 28px;
  color: #7d4b42;
  border: 1px solid #e0cbc6;
  background: #fff7f5;
  font-size: 12px;
}

.chat {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.chat-header {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 62px;
  padding: 0 22px 0 70px;
  border-bottom: 1px solid #d7dfdc;
  background: #f8faf9;
  overflow: visible;
}

.header-copy {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
}

.chat-title {
  color: #15231d;
  font-size: 20px;
  font-weight: 900;
}

.messages {
  flex: 1;
  height: 0;
  padding: 22px 52px 0 22px;
}

.message {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 16px;
}

.message.user {
  flex-direction: row-reverse;
  margin-right: 76px;
  padding-left: 52px;
}

.message.assistant {
  padding-right: 52px;
}

.avatar {
  display: flex;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  background: #1f7a63;
  font-size: 13px;
  font-weight: 800;
}

.message.user .avatar {
  background: #395f8f;
}

.bubble {
  max-width: min(720px, 76%);
  padding: 12px 14px;
  border: 1px solid #d8e0dd;
  border-radius: 8px;
  background: #fff;
}

.message.user .bubble {
  border-color: #c6d8ee;
  background: #eaf2fb;
}

.content,
.status-text,
.error {
  display: block;
}

.content {
  color: #1d252c;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.rich-content {
  word-break: break-word;
}

.rich-content :deep(.md-line) {
  display: block;
  margin: 0 0 7px;
}

.rich-content :deep(.md-spacer) {
  height: 6px;
  margin: 0;
  line-height: 6px;
}

.rich-content :deep(.md-strong) {
  font-weight: 700;
}

.status-text {
  margin-top: 6px;
  color: #66756f;
  font-size: 12px;
}

.error {
  color: #a33d2c;
  line-height: 1.6;
}

.retry {
  width: 64px;
  height: 32px;
  margin-top: 8px;
  color: #fff;
  background: #a33d2c;
  font-size: 13px;
  font-weight: 800;
}

.clarify-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid #d8e0dd;
  border-radius: 8px;
  background: #f8faf9;
}

.clarify-question {
  color: #26342f;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.5;
}

.clarify-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.clarify-option {
  margin: 0;
  padding: 0 12px;
  color: #1f5f4f;
  border: 1px solid #bdd6ce;
  background: #fff;
  font-size: 13px;
  line-height: 32px;
}

.clarify-option::after {
  border: 0;
}

.products {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.compare-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #c9ddd6;
  border-radius: 8px;
  background: #f6fbf9;
}

.compare-count {
  color: #26342f;
  font-size: 13px;
  font-weight: 800;
}

.compare-actions {
  display: flex;
  gap: 8px;
}

.compare-action {
  display: flex;
  width: 58px;
  height: 30px;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  line-height: 30px;
}

.compare-action::after {
  border: 0;
}

.compare-action.primary {
  color: #fff;
  background: #1f7a63;
}

.compare-action.secondary {
  color: #52615c;
  border: 1px solid #d8e0dd;
  background: #fff;
}

.bottom-spacer {
  height: 176px;
}

.jump-bottom {
  position: absolute;
  left: 50%;
  bottom: 138px;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  color: #1f5f4f;
  border: 1px solid #b9d6cd;
  border-radius: 50%;
  background: #fff;
  font-size: 24px;
  font-weight: 800;
  line-height: 1;
  box-shadow: 0 8px 20px rgba(36, 52, 46, 0.16);
}

.jump-bottom::after {
  border: 0;
}

.composer-wrap {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 10px 22px 16px;
  border-top: 1px solid #d7dfdc;
  background: #f8faf9;
}

.side-panel {
  position: fixed;
  top: 76px;
  right: 18px;
  bottom: 132px;
  z-index: 12;
  display: flex;
  width: min(360px, calc(100vw - 36px));
  flex-direction: column;
  border: 1px solid #d7dfdc;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 18px 38px rgba(28, 42, 37, 0.16);
}

.panel-header,
.cart-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #e3e9e7;
}

.panel-title,
.cart-title {
  color: #15231d;
  font-size: 16px;
  font-weight: 900;
}

.panel-close,
.cart-close {
  width: 30px;
  height: 30px;
  color: #52615c;
  background: transparent;
  font-size: 22px;
  line-height: 1;
}

.panel-close::after,
.cart-close::after {
  border: 0;
}

.panel-empty,
.cart-empty {
  padding: 18px 14px;
  color: #66756f;
  font-size: 14px;
  line-height: 1.6;
}

.panel-list,
.cart-list {
  flex: 1;
  height: 0;
}

.favorite-item {
  padding: 12px 14px;
  border-bottom: 1px solid #edf1ef;
}

.favorite-main {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.favorite-title {
  color: #1d252c;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
}

.favorite-price {
  color: #9a4b21;
  font-weight: 800;
}

.favorite-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.small-action {
  width: 92px;
  height: 28px;
  color: #1f5f4f;
  border: 1px solid #bdd6ce;
  background: #fff;
  font-size: 12px;
}

.cart-item {
  padding: 12px 14px;
  border-bottom: 1px solid #edf1ef;
}

.cart-item-main {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.cart-item-title {
  color: #1d252c;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
}

.cart-item-price {
  color: #9a4b21;
  font-weight: 800;
}

.cart-item-sku {
  color: #66756f;
  font-size: 12px;
  line-height: 1.4;
}

.cart-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.qty-button {
  width: 28px;
  height: 28px;
  color: #26342f;
  border: 1px solid #d8e0dd;
  background: #fff;
  font-size: 16px;
  line-height: 1;
}

.qty-button::after,
.small-action::after,
.remove-button::after,
.checkout-button::after {
  border: 0;
}

.qty-text {
  min-width: 22px;
  text-align: center;
  color: #26342f;
  font-weight: 800;
}

.remove-button {
  width: 48px;
  height: 28px;
  margin-left: auto;
  color: #7d4b42;
  border: 1px solid #e0cbc6;
  background: #fff7f5;
  font-size: 12px;
}

.cart-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-top: 1px solid #e3e9e7;
}

.cart-total {
  flex: 1;
  color: #15231d;
  font-weight: 900;
}

.checkout-button {
  width: 86px;
  height: 34px;
  color: #fff;
  background: #1f7a63;
  font-size: 13px;
  font-weight: 800;
}

.checkout-button[disabled] {
  opacity: 0.55;
}

.stream-status {
  display: block;
  margin-bottom: 6px;
  color: #66756f;
  font-size: 12px;
}

.quick-prompts {
  width: 100%;
  white-space: nowrap;
  margin-bottom: 8px;
}

.prompt {
  display: inline-flex;
  height: 34px;
  margin-right: 8px;
  padding: 0 12px;
  align-items: center;
  justify-content: center;
  color: #26342f;
  border: 1px solid #d8e0dd;
  background: #fff;
  font-size: 13px;
  line-height: 1.4;
}

.composer {
  display: flex;
  gap: 10px;
}

.input {
  min-height: 42px;
  max-height: 96px;
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #cbd6d2;
  border-radius: 8px;
  background: #fff;
  font-size: 14px;
  line-height: 1.5;
}

.send {
  width: 84px;
  height: 42px;
  color: #fff;
  background: #1f7a63;
  font-weight: 800;
}

.send.stop {
  background: #a33d2c;
}

.send[disabled],
.prompt[disabled],
.clarify-option[disabled],
.new-button[disabled],
.delete-button[disabled],
.retry[disabled] {
  opacity: 0.55;
}

@media (max-width: 760px) {
  .page {
    --app-header-height: 54px;
  }

  .sidebar {
    width: min(304px, 88vw);
  }

  .sidebar-top {
    align-items: center;
  }

  .chat {
    width: 100%;
  }

  .chat-header {
    min-height: 54px;
    padding: 0 14px 0 62px;
  }

  .header-copy {
    justify-content: flex-start;
  }

  .header-action-button {
    width: 74px;
    height: 32px;
    font-size: 12px;
    line-height: 32px;
  }

  .messages {
    padding: 16px 18px 0 14px;
  }

  .message.user {
    margin-right: 58px;
    padding-left: 42px;
  }

  .message.assistant {
    padding-right: 42px;
  }

  .bubble {
    max-width: 78%;
  }

  .bottom-spacer {
    height: 156px;
  }

  .jump-bottom {
    bottom: 130px;
  }

  .composer-wrap {
    padding: 10px 14px 14px;
  }

  .side-panel {
    top: 64px;
    right: 10px;
    bottom: 124px;
    width: calc(100vw - 20px);
  }
}
</style>
