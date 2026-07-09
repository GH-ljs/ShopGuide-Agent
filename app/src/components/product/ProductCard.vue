<script setup lang="ts">
import { resolveAssetUrl } from "../../api/shopguide";
import type { ProductCard } from "../../types/shopguide";
import { formatPrice } from "../../utils/format";

defineProps<{
  product: ProductCard;
  favorite?: boolean;
  cartQuantity?: number;
  compareSelected?: boolean;
}>();

const emit = defineEmits<{
  open: [product: ProductCard];
  toggleFavorite: [product: ProductCard];
  addToCart: [product: ProductCard];
  toggleCompare: [product: ProductCard];
}>();
</script>

<template>
  <view class="product-card" @click="emit('open', product)">
    <image v-if="product.imageUrl" class="product-image" mode="aspectFill" :src="resolveAssetUrl(product.imageUrl)" />
    <view v-else class="product-image product-placeholder">图</view>
    <view class="product-body">
      <text class="detail-link">详情</text>
      <text class="product-brand">{{ product.brand || product.category || "商品" }}</text>
      <text class="product-title">{{ product.title }}</text>
      <view class="product-row">
        <text class="price">{{ formatPrice(product.price) }}</text>
      </view>
      <text v-if="product.reason" class="reason">{{ product.reason }}</text>
      <view class="actions">
        <button
          class="action-button compare"
          :class="{ selected: compareSelected }"
          @click.stop="emit('toggleCompare', product)"
        >
          {{ compareSelected ? "已选" : "对比" }}
        </button>
        <button class="action-button" :class="{ active: favorite }" @click.stop="emit('toggleFavorite', product)">
          {{ favorite ? "已收藏" : "收藏" }}
        </button>
        <button class="action-button primary" @click.stop="emit('addToCart', product)">
          {{ cartQuantity ? `购物车 ${cartQuantity}` : "加入购物车" }}
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.product-card {
  display: flex;
  gap: 12px;
  padding: 10px;
  border: 1px solid #d8e0dd;
  border-radius: 8px;
  background: #fff;
}

.product-image {
  flex: 0 0 auto;
  width: 86px;
  height: 112px;
  border-radius: 7px;
  background: #f3f6f5;
}

.product-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #66756f;
}

.product-body {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 5px;
  padding-right: 54px;
}

.product-brand {
  color: #66756f;
  font-size: 12px;
}

.product-title {
  color: #1d252c;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}

.product-row {
  display: flex;
  align-items: center;
}

.price {
  color: #9a4b21;
  font-weight: 800;
}

.detail-link {
  position: absolute;
  top: 2px;
  right: 0;
  color: #17644f;
  font-size: 13px;
  font-weight: 700;
}

.reason {
  color: #586762;
  font-size: 13px;
  line-height: 1.5;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.action-button {
  display: flex;
  height: 30px;
  min-width: 70px;
  padding: 0 10px;
  align-items: center;
  justify-content: center;
  color: #52615c;
  border: 1px solid #d8e0dd;
  background: #fff;
  font-size: 12px;
}

.action-button::after {
  border: 0;
}

.action-button.active {
  color: #9a4b21;
  border-color: #e1c7b7;
  background: #fff7f2;
}

.action-button.compare.selected {
  color: #fff;
  border-color: #395f8f;
  background: #395f8f;
}

.action-button.primary {
  color: #fff;
  border-color: #1f7a63;
  background: #1f7a63;
}

@media (max-width: 520px) {
  .product-card {
    gap: 9px;
    padding: 9px;
  }

  .product-image {
    width: 72px;
    height: 96px;
  }

  .product-body {
    gap: 4px;
    padding-right: 44px;
  }

  .product-title {
    font-size: 14px;
  }

  .reason {
    font-size: 12px;
  }

  .actions {
    gap: 6px;
  }

  .action-button {
    min-width: 62px;
    height: 28px;
    padding: 0 8px;
    font-size: 11px;
  }
}
</style>
