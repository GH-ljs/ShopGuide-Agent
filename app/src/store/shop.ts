import Taro from "@tarojs/taro";
import { create } from "zustand";
import type { ProductCard, ProductSkuOption } from "../types/shopguide";

export interface CartItem extends ProductCard {
  itemKey: string;
  skuId?: string;
  skuLabel?: string;
  quantity: number;
}

interface ShopState {
  favorites: ProductCard[];
  cartItems: CartItem[];
  favoriteCount: number;
  cartCount: number;
  cartTotal: number;
  restore: () => void;
  isFavorite: (productId: string) => boolean;
  cartQuantity: (productId: string) => number;
  toggleFavorite: (product: ProductCard) => void;
  addToCart: (product: ProductCard, sku?: ProductSkuOption) => void;
  setCartQuantity: (itemKey: string, quantity: number) => void;
  removeFromCart: (itemKey: string) => void;
  clearCart: () => void;
}

const SHOP_ACTIONS_KEY = "shopguide-agent-shop-actions";
let restored = false;

export const useShopStore = create<ShopState>((set, get) => ({
  favorites: [],
  cartItems: [],
  favoriteCount: 0,
  cartCount: 0,
  cartTotal: 0,
  restore() {
    if (restored) return;
    restored = true;
    const raw = Taro.getStorageSync(SHOP_ACTIONS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(String(raw)) as { favorites?: ProductCard[]; cartItems?: CartItem[] };
      setWithDerived(set, {
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        cartItems: Array.isArray(parsed.cartItems)
          ? parsed.cartItems
              .filter((item) => item.productId && item.quantity > 0)
              .map((item) => ({ ...item, itemKey: item.itemKey || buildCartItemKey(item.productId, item.skuId) }))
          : []
      });
    } catch {
      Taro.removeStorageSync(SHOP_ACTIONS_KEY);
    }
  },
  isFavorite(productId) {
    return get().favorites.some((item) => item.productId === productId);
  },
  cartQuantity(productId) {
    return get()
      .cartItems.filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity, 0);
  },
  toggleFavorite(product) {
    const favorites = get().favorites;
    const index = favorites.findIndex((item) => item.productId === product.productId);
    const nextFavorites = index >= 0 ? favorites.filter((item) => item.productId !== product.productId) : [normalizeProduct(product), ...favorites];
    updateAndPersist(set, { favorites: nextFavorites, cartItems: get().cartItems });
  },
  addToCart(product, sku) {
    const itemKey = buildCartItemKey(product.productId, sku?.skuId);
    const cartItems = [...get().cartItems];
    const existing = cartItems.find((item) => item.itemKey === itemKey);
    if (existing) {
      existing.quantity += 1;
    } else {
      cartItems.unshift({
        ...normalizeProduct(product, sku),
        itemKey,
        skuId: sku?.skuId,
        skuLabel: sku?.label,
        quantity: 1
      });
    }
    updateAndPersist(set, { favorites: get().favorites, cartItems });
  },
  setCartQuantity(itemKey, quantity) {
    const cartItems = get().cartItems
      .map((item) => (item.itemKey === itemKey ? { ...item, quantity } : item))
      .filter((item) => item.quantity > 0);
    updateAndPersist(set, { favorites: get().favorites, cartItems });
  },
  removeFromCart(itemKey) {
    updateAndPersist(set, { favorites: get().favorites, cartItems: get().cartItems.filter((item) => item.itemKey !== itemKey) });
  },
  clearCart() {
    updateAndPersist(set, { favorites: get().favorites, cartItems: [] });
  }
}));

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

function derive(values: { favorites: ProductCard[]; cartItems: CartItem[] }) {
  return {
    ...values,
    favoriteCount: values.favorites.length,
    cartCount: values.cartItems.reduce((sum, item) => sum + item.quantity, 0),
    cartTotal: values.cartItems.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0)
  };
}

function setWithDerived(set: (partial: Partial<ShopState>) => void, values: { favorites: ProductCard[]; cartItems: CartItem[] }) {
  set(derive(values));
}

function updateAndPersist(set: (partial: Partial<ShopState>) => void, values: { favorites: ProductCard[]; cartItems: CartItem[] }) {
  setWithDerived(set, values);
  Taro.setStorageSync(SHOP_ACTIONS_KEY, JSON.stringify(values));
}
