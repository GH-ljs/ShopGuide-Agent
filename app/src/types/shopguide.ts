export type Role = "user" | "assistant";

export interface ProductCard {
  productId: string;
  title: string;
  brand?: string;
  category?: string;
  subCategory?: string;
  price?: number;
  imageUrl?: string;
  reason?: string;
}

export interface ProductDetail extends ProductCard {
  marketingDescription?: string;
  skus?: Array<Record<string, unknown>>;
  officialFaq?: Array<Record<string, unknown>>;
  userReviews?: Array<Record<string, unknown>>;
}

export interface ProductSkuOption {
  skuId: string;
  label: string;
  price?: number;
  properties?: Record<string, string>;
}

export interface ComparisonPayload {
  title?: string;
  conclusion?: string;
  recommendedProductId?: string;
  columns?: Array<{
    productId: string;
    label?: string;
    title?: string;
    brand?: string;
  }>;
  rows?: Array<{
    label: string;
    values: Array<{
      productId: string;
      value: string;
    }>;
  }>;
}

export interface ClarifyPayload {
  baseQuery: string;
  question: string;
  options: Array<{
    label: string;
    value: string;
  }>;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  status?: "streaming" | "done" | "error";
  statusText?: string;
  products?: ProductCard[];
  comparison?: ComparisonPayload | null;
  clarify?: ClarifyPayload | null;
  error?: string;
  retryText?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ChatOnceResponse {
  ok: boolean;
  answer: string;
  products: ProductCard[];
  comparison?: ComparisonPayload | null;
  clarify?: ClarifyPayload | null;
  conversationId?: string;
  deviceId?: string;
  review?: Record<string, unknown> | null;
  meta?: Array<Record<string, unknown>>;
}

export interface ChatRequestPayload {
  message: string;
  conversationId: string;
  deviceId: string;
  history: Pick<ChatMessage, "role" | "content">[];
  selectedProductIds?: string[];
}

export interface ChatTransportHandlers {
  onToken?: (token: string) => void;
  onAnswerReset?: () => void;
  onAnswer?: (answer: string) => void;
  onProducts?: (products: ProductCard[]) => void;
  onComparison?: (comparison: ComparisonPayload | null) => void;
  onClarify?: (clarify: ClarifyPayload | null) => void;
  onDone?: (payload: Record<string, unknown>) => void;
  onMeta?: (payload: Record<string, unknown>) => void;
}

export interface ChatTransportOptions {
  signal?: AbortSignal;
  firstTokenTimeoutMs?: number;
  totalTimeoutMs?: number;
}
