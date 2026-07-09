import type { ProductCard } from "../types/shopguide";

export type CartIntent =
  | { type: "none" }
  | { type: "view_cart" }
  | { type: "checkout" }
  | { type: "clear_cart" }
  | { type: "add"; product?: ProductCard; needsClarification?: boolean }
  | { type: "remove"; itemIndex?: number }
  | { type: "change_qty"; itemIndex?: number; quantity?: number };

const ADD_PATTERN =
  /(加入购物车|加购物车|加购|放购物车|放进购物车|买这个|买它|要这个|加入第?[一二两三四五六七八九十\d]+[个款件项]?|加第?[一二两三四五六七八九十\d]+[个款件项]?|第?[一二两三四五六七八九十\d]+[个款件项]?.{0,4}(加入|加购|放进|买))/;
const REMOVE_PATTERN = /(删除|删掉|移除|不要).{0,8}(购物车|第|这个|它|商品)?/;
const CHANGE_QTY_PATTERN = /(数量|件数|买|来).{0,8}(改成|改为|设为|变成|调整到|要|买|来)?\s*([一二两三四五六七八九十\d]+)\s*(件|个|份)?/;
const CHECKOUT_PATTERN = /(下单|结算|提交订单|去结算|买单|付款)/;
const VIEW_CART_PATTERN = /(看|打开|查看).{0,4}购物车|购物车.{0,6}(有什么|有啥|里面|列表)/;
const CLEAR_CART_PATTERN = /(清空|清除|清掉).{0,4}购物车/;

export function parseCartIntent(message: string, recentProducts: ProductCard[]): CartIntent {
  const text = message.trim();
  if (!text) return { type: "none" };

  if (CLEAR_CART_PATTERN.test(text)) return { type: "clear_cart" };
  if (CHECKOUT_PATTERN.test(text)) return { type: "checkout" };
  if (VIEW_CART_PATTERN.test(text)) return { type: "view_cart" };
  if (CHANGE_QTY_PATTERN.test(text) && /(购物车|数量|件数|第|这个|它)/.test(text)) {
    return {
      type: "change_qty",
      itemIndex: extractOrdinalIndex(text),
      quantity: extractQuantity(text)
    };
  }
  if (REMOVE_PATTERN.test(text) && /(购物车|第|这个|它|删掉|删除|移除)/.test(text)) {
    return { type: "remove", itemIndex: extractOrdinalIndex(text) };
  }
  if (ADD_PATTERN.test(text)) {
    return resolveAddIntent(text, recentProducts);
  }
  return { type: "none" };
}

export function extractRecentProducts(messages: Array<{ products?: ProductCard[] }>): ProductCard[] {
  const seen = new Set<string>();
  const products: ProductCard[] = [];
  for (const message of [...messages].reverse()) {
    for (const product of message.products ?? []) {
      if (!seen.has(product.productId)) {
        seen.add(product.productId);
        products.push(product);
      }
    }
    if (products.length >= 8) break;
  }
  return products;
}

function resolveAddIntent(text: string, recentProducts: ProductCard[]): CartIntent {
  if (!recentProducts.length) return { type: "add", needsClarification: true };

  const ordinal = extractOrdinalIndex(text);
  if (typeof ordinal === "number") {
    return { type: "add", product: recentProducts[ordinal] };
  }

  const keyword = text.replace(ADD_PATTERN, "").trim();
  const matched = keyword ? matchProduct(keyword, recentProducts) : null;
  if (matched) return { type: "add", product: matched };
  if (/(这个|它|这款|刚才|上面)/.test(text) && recentProducts.length === 1) {
    return { type: "add", product: recentProducts[0] };
  }
  if (recentProducts.length === 1) return { type: "add", product: recentProducts[0] };
  return { type: "add", needsClarification: true };
}

function matchProduct(keyword: string, products: ProductCard[]): ProductCard | null {
  const normalized = keyword.replace(/\s+/g, "");
  if (!normalized) return null;
  return (
    products.find((product) => product.title.replace(/\s+/g, "").includes(normalized)) ||
    products.find((product) => normalized.includes(product.title.slice(0, 4))) ||
    null
  );
}

function extractOrdinalIndex(text: string): number | undefined {
  const match = text.match(/第?\s*([一二两三四五六七八九十\d]+)\s*(个|款|件|项)?/);
  if (!match) return undefined;
  const value = parseChineseNumber(match[1]);
  return value > 0 ? value - 1 : undefined;
}

function extractQuantity(text: string): number | undefined {
  const match = text.match(CHANGE_QTY_PATTERN);
  if (!match) return undefined;
  const value = parseChineseNumber(match[3]);
  return value > 0 ? value : undefined;
}

function parseChineseNumber(value: string): number {
  const raw = value.trim();
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };
  if (raw === "十") return 10;
  if (raw.includes("十")) {
    const [left, right] = raw.split("十");
    return (left ? map[left] ?? 0 : 1) * 10 + (right ? map[right] ?? 0 : 0);
  }
  return map[raw] ?? 0;
}
