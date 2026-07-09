export function formatPrice(price?: number): string {
  if (typeof price !== "number") return "价格待确认";
  return `¥${price.toFixed(price % 1 === 0 ? 0 : 2)}`;
}

export function createId(prefix = "id"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
