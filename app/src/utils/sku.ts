import type { ProductSkuOption } from "../types/shopguide";

const SKU_ID_KEYS = ["skuId", "sku_id", "id"];
const SKU_LABEL_KEYS = ["name", "title", "specName", "skuName", "label"];

export function normalizeSkuOptions(skus?: Array<Record<string, unknown>>): ProductSkuOption[] {
  if (!Array.isArray(skus)) return [];
  return skus
    .map((sku, index) => normalizeSkuOption(sku, index))
    .filter((sku): sku is ProductSkuOption => Boolean(sku));
}

function normalizeSkuOption(sku: Record<string, unknown>, index = 0): ProductSkuOption | null {
  const properties = normalizeProperties(sku.properties);
  const skuId = pickString(sku, SKU_ID_KEYS) || `sku_${index + 1}`;
  const label = pickString(sku, SKU_LABEL_KEYS) || propertiesToLabel(properties) || `规格 ${index + 1}`;
  const price = pickNumber(sku.price);

  return {
    skuId,
    label,
    price,
    properties: Object.keys(properties).length ? properties : undefined
  };
}

function propertiesToLabel(properties?: Record<string, string>): string {
  if (!properties) return "";
  return Object.entries(properties)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" / ");
}

function normalizeProperties(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((result, [key, item]) => {
    if (typeof item === "string" || typeof item === "number") result[key] = String(item);
    return result;
  }, {});
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function pickNumber(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}
