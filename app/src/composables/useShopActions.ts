import { computed, ref } from "vue";
import type { ProductCard, ProductSkuOption } from "../types/shopguide";

export interface CartItem extends ProductCard {
  itemKey: string;
  skuId?: string;
  skuLabel?: string;
  quantity: number;
}

const SHOP_ACTIONS_KEY = "shopguide-agent-shop-actions";
const favorites = ref<ProductCard[]>([]);
const cartItems = ref<CartItem[]>([]);
let restored = false;

export function useShopActions() {
  restoreShopActions();

  const favoriteCount = computed(() => favorites.value.length);
  const cartCount = computed(() => cartItems.value.reduce((sum, item) => sum + item.quantity, 0));
  const cartTotal = computed(() => {
    return cartItems.value.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);
  });

  function isFavorite(productId: string): boolean {
    return favorites.value.some((item) => item.productId === productId);
  }

  function isInCart(productId: string, skuId?: string): boolean {
    return cartItems.value.some((item) => item.itemKey === buildCartItemKey(productId, skuId));
  }

  function cartQuantity(productId: string): number {
    return cartItems.value
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity, 0);
  }

  function toggleFavorite(product: ProductCard) {
    const index = favorites.value.findIndex((item) => item.productId === product.productId);
    if (index >= 0) {
      favorites.value.splice(index, 1);
    } else {
      favorites.value.unshift(normalizeProduct(product));
    }
    persistShopActions();
  }

  function addToCart(product: ProductCard, sku?: ProductSkuOption) {
    const itemKey = buildCartItemKey(product.productId, sku?.skuId);
    const existing = cartItems.value.find((item) => item.itemKey === itemKey);
    if (existing) {
      existing.quantity += 1;
    } else {
      cartItems.value.unshift({
        ...normalizeProduct(product, sku),
        itemKey,
        skuId: sku?.skuId,
        skuLabel: sku?.label,
        quantity: 1
      });
    }
    persistShopActions();
  }

  function setCartQuantity(itemKey: string, quantity: number) {
    const item = cartItems.value.find((entry) => entry.itemKey === itemKey);
    if (!item) return;
    if (quantity <= 0) {
      removeFromCart(itemKey);
      return;
    }
    item.quantity = quantity;
    persistShopActions();
  }

  function removeFromCart(itemKey: string) {
    cartItems.value = cartItems.value.filter((item) => item.itemKey !== itemKey);
    persistShopActions();
  }

  function clearCart() {
    cartItems.value = [];
    persistShopActions();
  }

  return {
    favorites,
    cartItems,
    favoriteCount,
    cartCount,
    cartTotal,
    isFavorite,
    isInCart,
    cartQuantity,
    toggleFavorite,
    addToCart,
    setCartQuantity,
    removeFromCart,
    clearCart
  };
}

function normalizeProduct(product: ProductCard, sku?: ProductSkuOption): ProductCard {
  return {
    productId: product.productId,
    title: product.title,
    brand: product.brand,
    category: product.category,
    subCategory: product.subCategory,
    price: sku?.price ?? product.price,
    imageUrl: product.imageUrl,
    reason: product.reason
  };
}

function buildCartItemKey(productId: string, skuId?: string): string {
  return `${productId}::${skuId || "default"}`;
}

function restoreShopActions() {
  if (restored) return;
  restored = true;
  const raw = uni.getStorageSync(SHOP_ACTIONS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(String(raw)) as {
      favorites?: ProductCard[];
      cartItems?: CartItem[];
    };
    favorites.value = Array.isArray(parsed.favorites) ? parsed.favorites : [];
    cartItems.value = Array.isArray(parsed.cartItems)
      ? parsed.cartItems
          .filter((item) => item.productId && item.quantity > 0)
          .map((item) => ({
            ...item,
            itemKey: item.itemKey || buildCartItemKey(item.productId, item.skuId)
          }))
      : [];
  } catch {
    uni.removeStorageSync(SHOP_ACTIONS_KEY);
  }
}

function persistShopActions() {
  uni.setStorageSync(
    SHOP_ACTIONS_KEY,
    JSON.stringify({
      favorites: favorites.value,
      cartItems: cartItems.value
    })
  );
}
