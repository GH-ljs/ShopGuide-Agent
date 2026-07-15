import React, { useEffect, useMemo, useRef, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, ScrollView, Text, Textarea, View } from "@tarojs/components";
import { ComparisonCard } from "../../components/ComparisonCard";
import { ProductCard } from "../../components/ProductCard";
import { RichTextContent } from "../../components/RichTextContent";
import { useChatStore } from "../../store/chat";
import { useShopStore } from "../../store/shop";
import type { ChatMessage, ProductCard as ProductCardType } from "../../types/shopguide";
import { formatPrice } from "../../utils/format";
import "./index.scss";

const quickPrompts = ["预算200内的油皮防晒", "通勤用清爽不黏", "帮我对比无糖饮料"];

// 页面层只组合 UI 和用户交互，复杂业务状态放在 store，后端事实字段通过组件展示。
// 这种分层能避免聊天页变成“所有逻辑都堆在一个页面”的大文件。
export default function ChatPage() {
  const {
    input,
    isSending,
    streamStatus,
    sessions,
    activeSessionId,
    shouldAutoScroll,
    setInput,
    sendMessage,
    stopGeneration,
    retryMessage,
    selectClarifyOption,
    createNewConversation,
    selectConversation,
    deleteConversation,
    setShouldAutoScroll,
    restore
  } = useChatStore();
  const {
    favorites,
    favoriteCount,
    cartItems,
    cartCount,
    cartTotal,
    restore: restoreShop,
    isFavorite,
    cartQuantity,
    toggleFavorite,
    addToCart,
    setCartQuantity,
    removeFromCart
  } = useShopStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [compareSelections, setCompareSelections] = useState<Record<string, string[]>>({});
  const scrollTopRef = useRef(0);
  const [scrollIntoView, setScrollIntoView] = useState("");

  useEffect(() => {
    restore();
    restoreShop();
  }, [restore, restoreShop]);

  const activeSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) || sessions[0], [activeSessionId, sessions]);
  const messages = activeSession?.messages || [];

  useEffect(() => {
    if (!shouldAutoScroll) return;
    const timer = setTimeout(() => {
      setScrollIntoView("chat-bottom-anchor");
    }, 30);
    const resetTimer = setTimeout(() => {
      setScrollIntoView("");
    }, 220);
    setScrollIntoView("");
    return () => {
      clearTimeout(timer);
      clearTimeout(resetTimer);
    };
  }, [messages, shouldAutoScroll]);

  function openProduct(product: ProductCardType) {
    Taro.navigateTo({ url: `/pages/product-detail/index?productId=${encodeURIComponent(product.productId)}` });
  }

  function addProductToCart(product: ProductCardType) {
    addToCart(product);
    Taro.showToast({ title: "已加入购物车", icon: "none" });
  }

  function selectedCompareCount(messageId: string) {
    return compareSelections[messageId]?.length || 0;
  }

  function isCompareSelected(messageId: string, productId: string) {
    return (compareSelections[messageId] || []).includes(productId);
  }

  function toggleCompareSelection(message: ChatMessage, product: ProductCardType) {
    const current = compareSelections[message.id] || [];
    if (current.includes(product.productId)) {
      setCompareSelections({ ...compareSelections, [message.id]: current.filter((id) => id !== product.productId) });
      return;
    }
    if (current.length >= 3) {
      Taro.showToast({ title: "最多选择 3 款对比", icon: "none" });
      return;
    }
    setCompareSelections({ ...compareSelections, [message.id]: [...current, product.productId] });
  }

  function startCompare(message: ChatMessage) {
    const products = message.products || [];
    const selectedIds = compareSelections[message.id] || [];
    if (selectedIds.length < 2) {
      Taro.showToast({ title: "至少选择 2 款商品", icon: "none" });
      return;
    }
    const selectedIndexes = selectedIds
      .map((id) => products.findIndex((product) => product.productId === id))
      .filter((index) => index >= 0)
      .map((index) => index + 1);
    if (selectedIndexes.length < 2) return;
    setCompareSelections({ ...compareSelections, [message.id]: [] });
    // 同时发送自然语言和 selectedProductIds：自然语言保证对话可读，ID 保证后端对比的是用户勾选的真实商品。
    sendMessage(`${selectedIndexes.map((index) => `第${index}款`).join("、")}对比一下`, { selectedProductIds: selectedIds });
  }

  function handleScroll(event: { detail?: { scrollTop?: number; scrollHeight?: number; height?: number } }) {
    const detail = event.detail || {};
    const nextTop = Number(detail.scrollTop || 0);
    const scrollHeight = Number(detail.scrollHeight || 0);
    const height = Number(detail.height || 0);
    const isScrollingUp = nextTop < scrollTopRef.current - 6;

    if (isScrollingUp) {
      // 用户主动上滑看历史时暂停自动贴底，避免流式输出抢走阅读位置。
      setShouldAutoScroll(false);
      setScrollIntoView("");
      scrollTopRef.current = nextTop;
      return;
    }

    if (scrollHeight > 0 && height > 0) {
      setShouldAutoScroll(scrollHeight - nextTop - height < 90);
    }
    scrollTopRef.current = nextTop;
  }

  function pauseAutoScroll() {
    setShouldAutoScroll(false);
    setScrollIntoView("");
  }

  function jumpToBottom() {
    setShouldAutoScroll(true);
    setScrollIntoView("");
    setTimeout(() => {
      setScrollIntoView("chat-bottom-anchor");
      setTimeout(() => setScrollIntoView(""), 220);
    }, 30);
  }

  return (
    <View className={`page ${drawerOpen ? "drawer-open" : ""}`}>
      {drawerOpen ? <View className="drawer-backdrop" onClick={() => setDrawerOpen(false)} /> : null}

      <View className="sidebar">
        <View className="sidebar-top">
          <View className="brand">
            <Text className="brand-title">ShopGuide</Text>
            <Text className="brand-subtitle">智能导购 Agent</Text>
          </View>
          <Button className="drawer-close" onClick={() => setDrawerOpen(false)}>
            <Text className="button-text">×</Text>
          </Button>
        </View>
        <View className="sidebar-content">
          <Button
            className="new-button"
            disabled={isSending}
            onClick={() => {
              createNewConversation();
              setDrawerOpen(false);
            }}
          >
            <Text className="button-text">新对话</Text>
          </Button>
          <ScrollView className="session-list" scrollY>
            {sessions.map((session) => (
              <View
                key={session.id}
                className={`session-item ${session.id === activeSessionId ? "active" : ""}`}
                onClick={() => {
                  selectConversation(session.id);
                  setDrawerOpen(false);
                }}
              >
                <Text className="session-title">{session.title}</Text>
                <Button
                  className="delete-button"
                  disabled={isSending}
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteConversation(session.id);
                  }}
                >
                  <Text className="delete-text">删除</Text>
                </Button>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>

      <View className="chat">
        <View className="chat-header">
          <Button className="drawer-open-button" onClick={() => setDrawerOpen(true)}>
            <Text className="drawer-open-icon" />
          </Button>
          <Text className="chat-title">ShopGuide</Text>
          <View className="header-actions">
            <Button
              className="header-action-button"
              onClick={() => {
                setCartOpen(false);
                setFavoritesOpen(true);
              }}
            >
              <Text className="header-action-text">收藏</Text>
              {favoriteCount ? <Text className="action-badge">{favoriteCount}</Text> : null}
            </Button>
            <Button
              className="header-action-button"
              onClick={() => {
                setFavoritesOpen(false);
                setCartOpen(true);
              }}
            >
              <Text className="header-action-text">购物车</Text>
              {cartCount ? <Text className="action-badge">{cartCount}</Text> : null}
            </Button>
          </View>
        </View>

        <ScrollView
          className="messages"
          scrollY
          scrollIntoView={scrollIntoView}
          scrollWithAnimation
          lowerThreshold={120}
          onScroll={handleScroll}
          onTouchMove={pauseAutoScroll}
          onScrollToLower={() => setShouldAutoScroll(true)}
        >
          {messages.map((message) => (
            <View key={message.id} className={`message ${message.role}`}>
              <View className="avatar">{message.role === "assistant" ? "S" : "你"}</View>
              <View className="bubble">
                {message.content ? (
                  message.role === "assistant" ? (
                    <RichTextContent content={message.content} />
                  ) : (
                    <Text className="content">{message.content}</Text>
                  )
                ) : null}
                {message.statusText ? <Text className="status-text">{message.statusText}</Text> : null}
                {message.error ? <Text className="error">{message.error}</Text> : null}
                {message.status === "error" && message.retryText ? (
                  <Button className="retry" disabled={isSending} onClick={() => retryMessage(message)}>
                    <Text className="button-text">重试</Text>
                  </Button>
                ) : null}
                {message.clarify ? (
                  <View className="clarify-card">
                    <Text className="clarify-question">{message.clarify.question}</Text>
                    <View className="clarify-options">
                      {message.clarify.options.map((option) => (
                        <Button
                          key={option.value}
                          className="clarify-option"
                          disabled={isSending}
                          onClick={() => selectClarifyOption(message, option.value)}
                        >
                          <Text className="button-text">{option.label}</Text>
                        </Button>
                      ))}
                    </View>
                  </View>
                ) : null}
                {message.comparison ? <ComparisonCard comparison={message.comparison} /> : null}
                {message.products?.length ? (
                  <View className="products">
                    {message.products.map((product) => (
                      <ProductCard
                        key={product.productId}
                        product={product}
                        favorite={isFavorite(product.productId)}
                        cartQuantity={cartQuantity(product.productId)}
                        compareSelected={isCompareSelected(message.id, product.productId)}
                        onOpen={openProduct}
                        onToggleFavorite={toggleFavorite}
                        onAddToCart={addProductToCart}
                        onToggleCompare={() => toggleCompareSelection(message, product)}
                      />
                    ))}
                    {selectedCompareCount(message.id) ? (
                      <View className="compare-toolbar">
                        <Text className="compare-count">已选 {selectedCompareCount(message.id)} 款</Text>
                        <View className="compare-actions">
                          <Button className="compare-action secondary" disabled={isSending} onClick={() => setCompareSelections({ ...compareSelections, [message.id]: [] })}>
                            <Text className="button-text">清空</Text>
                          </Button>
                          <Button
                            className="compare-action primary"
                            disabled={isSending || selectedCompareCount(message.id) < 2}
                            onClick={() => startCompare(message)}
                          >
                            <Text className="button-text">对比</Text>
                          </Button>
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          ))}
          <View id="chat-bottom-anchor" className="bottom-spacer" />
        </ScrollView>

        {!shouldAutoScroll ? (
          <Button className="jump-bottom" onClick={jumpToBottom}>
            <Text className="button-text">↓</Text>
          </Button>
        ) : null}

        <View className="composer-wrap">
          {streamStatus ? <Text className="stream-status">{streamStatus}</Text> : null}
          <View className="quick-prompts">
            {quickPrompts.map((prompt) => (
              <Button key={prompt} className="prompt" disabled={isSending} onClick={() => sendMessage(prompt)}>
                <Text className="prompt-text">{prompt}</Text>
              </Button>
            ))}
          </View>
          <View className="composer">
            <Textarea
              className="input"
              value={input}
              autoHeight
              maxlength={500}
              placeholder="输入购物需求，例如：油皮防晒、预算200以内"
              onInput={(event) => setInput(String(event.detail.value || ""))}
            />
            <Button className={`send ${isSending ? "stop" : ""}`} disabled={!isSending && !input.trim()} onClick={() => (isSending ? stopGeneration() : sendMessage())}>
              <Text className="button-text">{isSending ? "停止" : "发送"}</Text>
            </Button>
          </View>
        </View>

        {favoritesOpen ? (
          <SidePanel title="收藏" onClose={() => setFavoritesOpen(false)}>
            {!favorites.length ? (
              <Text className="panel-empty">还没有收藏商品，可以在推荐卡片或详情页点收藏。</Text>
            ) : (
              <ScrollView className="panel-list" scrollY>
                {favorites.map((item) => (
                  <View key={item.productId} className="favorite-item">
                    <View className="favorite-main" onClick={() => openProduct(item)}>
                      <Text className="favorite-title">{item.title}</Text>
                      <Text className="favorite-price">{formatPrice(item.price)}</Text>
                    </View>
                    <View className="favorite-actions">
                      <Button className="small-action" onClick={() => addProductToCart(item)}>
                        <Text className="button-text">加入购物车</Text>
                      </Button>
                      <Button className="remove-button" onClick={() => toggleFavorite(item)}>
                        <Text className="button-text">取消</Text>
                      </Button>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </SidePanel>
        ) : null}

        {cartOpen ? (
          <SidePanel title="购物车" onClose={() => setCartOpen(false)}>
            {!cartItems.length ? (
              <Text className="panel-empty">购物车还是空的，可以先从推荐商品加入。</Text>
            ) : (
              <ScrollView className="panel-list" scrollY>
                {cartItems.map((item) => (
                  <View key={item.itemKey} className="cart-item">
                    <View className="cart-item-main">
                      <Text className="cart-item-title">{item.title}</Text>
                      {item.skuLabel ? <Text className="cart-item-sku">{item.skuLabel}</Text> : null}
                      <Text className="cart-item-price">{formatPrice(item.price)}</Text>
                    </View>
                    <View className="cart-controls">
                      <Button className="qty-button" onClick={() => setCartQuantity(item.itemKey, item.quantity - 1)}>
                        <Text className="button-text">-</Text>
                      </Button>
                      <Text className="qty-text">{item.quantity}</Text>
                      <Button className="qty-button" onClick={() => setCartQuantity(item.itemKey, item.quantity + 1)}>
                        <Text className="button-text">+</Text>
                      </Button>
                      <Button className="remove-button" onClick={() => removeFromCart(item.itemKey)}>
                        <Text className="button-text">删除</Text>
                      </Button>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
            <View className="cart-footer">
              <Text className="cart-total">合计 {formatPrice(cartTotal)}</Text>
              <Button className="checkout-button" disabled={!cartItems.length} onClick={() => Taro.navigateTo({ url: "/pages/checkout/index" })}>
                <Text className="button-text">去结算</Text>
              </Button>
            </View>
          </SidePanel>
        ) : null}
      </View>
    </View>
  );
}

function SidePanel(props: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <View className="side-panel">
      <View className="panel-header">
        <Text className="panel-title">{props.title}</Text>
        <Button className="panel-close" onClick={props.onClose}>
          <Text className="button-text">×</Text>
        </Button>
      </View>
      {props.children}
    </View>
  );
}
