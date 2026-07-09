<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import { fetchProductDetail, resolveAssetUrl } from "../../api/shopguide";
import { useShopActions } from "../../composables/useShopActions";
import type { ProductDetail } from "../../types/shopguide";
import { formatPrice } from "../../utils/format";
import { normalizeSkuOptions } from "../../utils/sku";

const detail = ref<ProductDetail | null>(null);
const loading = ref(true);
const error = ref("");
const { isFavorite, cartQuantity, toggleFavorite, addToCart } = useShopActions();
const selectedSkuId = ref("");

const faqItems = computed(() => detail.value?.officialFaq?.slice(0, 3) ?? []);
const reviewItems = computed(() => detail.value?.userReviews?.slice(0, 3) ?? []);
const currentProductId = computed(() => detail.value?.productId ?? "");
const skuOptions = computed(() => normalizeSkuOptions(detail.value?.skus));
const selectedSku = computed(() => skuOptions.value.find((sku) => sku.skuId === selectedSkuId.value));
const displayPrice = computed(() => selectedSku.value?.price ?? detail.value?.price);

onLoad(async (query) => {
  const productId = typeof query.productId === "string" ? query.productId : "";
  if (!productId) {
    error.value = "缺少商品 ID";
    loading.value = false;
    return;
  }

  try {
    detail.value = await fetchProductDetail(productId);
    const options = normalizeSkuOptions(detail.value.skus);
    selectedSkuId.value = options.length === 1 ? options[0].skuId : "";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "商品详情加载失败";
  } finally {
    loading.value = false;
  }
});

function pickText(item: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function toggleCurrentFavorite() {
  if (!detail.value) return;
  toggleFavorite(detail.value);
}

function addCurrentToCart() {
  if (!detail.value) return;
  if (skuOptions.value.length > 1 && !selectedSku.value) {
    uni.showToast({ title: "请先选择规格", icon: "none" });
    return;
  }
  addToCart(detail.value, selectedSku.value);
  uni.showToast({ title: "已加入购物车", icon: "none" });
}

function selectSku(skuId: string) {
  selectedSkuId.value = skuId;
}
</script>

<template>
  <view class="page">
    <text v-if="loading" class="state">加载中...</text>
    <text v-else-if="error" class="state error">{{ error }}</text>
    <view v-else-if="detail" class="detail">
      <view v-if="detail.imageUrl" class="hero-image-wrap">
        <image class="hero-image" mode="aspectFit" :src="resolveAssetUrl(detail.imageUrl)" />
      </view>
      <text class="brand">{{ detail.brand || detail.category }}</text>
      <text class="title">{{ detail.title }}</text>
      <text class="price">{{ formatPrice(displayPrice) }}</text>
      <text class="desc">{{ detail.marketingDescription || detail.reason || "暂无商品描述。" }}</text>
      <view class="detail-actions">
        <button class="action-button" :class="{ active: isFavorite(currentProductId) }" @click="toggleCurrentFavorite">
          {{ isFavorite(currentProductId) ? "已收藏" : "收藏" }}
        </button>
        <button class="action-button primary" @click="addCurrentToCart">
          {{ cartQuantity(currentProductId) ? `购物车 ${cartQuantity(currentProductId)}` : "加入购物车" }}
        </button>
      </view>

      <view v-if="skuOptions.length" class="section">
        <text class="section-title">可选规格</text>
        <view class="sku-list">
          <button
            v-for="sku in skuOptions"
            :key="sku.skuId"
            class="sku-option"
            :class="{ active: sku.skuId === selectedSkuId }"
            @click="selectSku(sku.skuId)"
          >
            <text class="sku-label">{{ sku.label }}</text>
            <text v-if="sku.price" class="sku-price">{{ formatPrice(sku.price) }}</text>
          </button>
        </view>
      </view>

      <view v-if="faqItems.length" class="section">
        <text class="section-title">官方 FAQ</text>
        <view v-for="(item, index) in faqItems" :key="index" class="info-card">
          <text class="info-title">{{ pickText(item, ["question", "q"], "常见问题") }}</text>
          <text class="info-content">{{ pickText(item, ["answer", "a", "content"], "暂无回答") }}</text>
        </view>
      </view>

      <view v-if="reviewItems.length" class="section">
        <text class="section-title">用户评价</text>
        <view v-for="(item, index) in reviewItems" :key="index" class="info-card">
          <text class="info-content">{{ pickText(item, ["content", "text", "comment"], "暂无评价内容") }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 16px;
  background: #eef2f1;
}

.state {
  color: #66756f;
  line-height: 1.7;
}

.error {
  color: #a33d2c;
}

.detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hero-image-wrap {
  display: flex;
  width: 100%;
  height: min(56vh, 420px);
  min-height: 260px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #f3f6f5;
  overflow: hidden;
}

.hero-image {
  width: 100%;
  height: 100%;
  max-width: 720px;
}

.brand {
  color: #66756f;
  font-size: 13px;
}

.title {
  color: #1d252c;
  font-size: 20px;
  font-weight: 800;
  line-height: 1.4;
}

.price {
  color: #9a4b21;
  font-size: 22px;
  font-weight: 800;
}

.desc {
  color: #46554f;
  font-size: 15px;
  line-height: 1.7;
}

.detail-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.action-button {
  min-width: 108px;
  margin: 0;
  padding: 0 18px;
  border: 1px solid #cfd8d5;
  border-radius: 8px;
  background: #fff;
  color: #1d252c;
  font-size: 14px;
  line-height: 40px;
}

.action-button::after {
  border: 0;
}

.action-button.active {
  border-color: #8ec8b9;
  background: #e9f5f1;
  color: #176b57;
  font-weight: 700;
}

.action-button.primary {
  border-color: #1d8068;
  background: #1d8068;
  color: #fff;
  font-weight: 700;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.section-title {
  color: #26342f;
  font-weight: 800;
}

.sku-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.sku-option {
  display: flex;
  min-width: 132px;
  margin: 0;
  padding: 10px 12px;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  border: 1px solid #d8e0dd;
  border-radius: 8px;
  background: #fff;
  text-align: left;
}

.sku-option::after {
  border: 0;
}

.sku-option.active {
  border-color: #1d8068;
  background: #e9f5f1;
}

.sku-label {
  color: #26342f;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.sku-price {
  color: #9a4b21;
  font-size: 13px;
  font-weight: 800;
}

.info-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid #d8e0dd;
  border-radius: 8px;
  background: #fff;
}

.info-title {
  color: #26342f;
  font-weight: 800;
}

.info-content {
  color: #46554f;
  font-size: 14px;
  line-height: 1.7;
}
</style>
