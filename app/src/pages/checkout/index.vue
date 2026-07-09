<script setup lang="ts">
import { computed, ref } from "vue";
import { useShopActions } from "../../composables/useShopActions";
import { formatPrice } from "../../utils/format";

const addresses = [
  "北京市海淀区 中关村软件园 8 号",
  "上海市徐汇区 漕河泾开发区 88 号",
  "广东省深圳市南山区 科技园 15 号"
];

const selectedAddress = ref(addresses[0]);
const submittedOrderId = ref("");
const submittedCount = ref(0);
const submittedTotal = ref(0);
const { cartItems, cartTotal, clearCart } = useShopActions();

const totalCount = computed(() => cartItems.value.reduce((sum, item) => sum + item.quantity, 0));
const canSubmit = computed(() => cartItems.value.length > 0 && Boolean(selectedAddress.value));

function selectAddress(address: string) {
  selectedAddress.value = address;
}

function submitOrder() {
  if (!canSubmit.value) {
    uni.showToast({ title: "请先确认商品和地址", icon: "none" });
    return;
  }
  submittedOrderId.value = `SO-${Date.now()}`;
  submittedCount.value = totalCount.value;
  submittedTotal.value = cartTotal.value;
  clearCart();
}

function backToChat() {
  uni.navigateBack();
}
</script>

<template>
  <view class="page">
    <view v-if="submittedOrderId" class="success">
      <text class="success-title">下单成功</text>
      <text class="success-text">订单号：{{ submittedOrderId }}</text>
      <text class="success-text">商品数量：{{ submittedCount }} 件</text>
      <text class="success-text">订单金额：{{ formatPrice(submittedTotal) }}</text>
      <text class="success-text">收货地址：{{ selectedAddress }}</text>
      <button class="primary-button" @click="backToChat">返回对话</button>
    </view>

    <view v-else class="checkout">
      <text class="page-title">确认订单</text>

      <view class="section">
        <text class="section-title">商品清单</text>
        <view v-if="!cartItems.length" class="empty">购物车是空的，请先添加商品。</view>
        <view v-for="item in cartItems" :key="item.itemKey" class="order-item">
          <view class="item-main">
            <text class="item-title">{{ item.title }}</text>
            <text v-if="item.skuLabel" class="item-sku">{{ item.skuLabel }}</text>
            <text class="item-meta">{{ formatPrice(item.price) }} × {{ item.quantity }}</text>
          </view>
          <text class="item-total">{{ formatPrice((item.price ?? 0) * item.quantity) }}</text>
        </view>
      </view>

      <view class="section">
        <text class="section-title">收货地址</text>
        <button
          v-for="address in addresses"
          :key="address"
          class="address-option"
          :class="{ active: address === selectedAddress }"
          @click="selectAddress(address)"
        >
          {{ address }}
        </button>
      </view>

      <view class="footer">
        <view class="summary">
          <text class="summary-count">共 {{ totalCount }} 件</text>
          <text class="summary-total">{{ formatPrice(cartTotal) }}</text>
        </view>
        <button class="primary-button" :disabled="!canSubmit" @click="submitOrder">提交订单</button>
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

.checkout,
.success {
  display: flex;
  max-width: 760px;
  margin: 0 auto;
  flex-direction: column;
  gap: 14px;
}

.page-title,
.success-title {
  color: #15231d;
  font-size: 22px;
  font-weight: 900;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  color: #26342f;
  font-weight: 800;
}

.empty,
.order-item,
.address-option,
.success {
  border: 1px solid #d8e0dd;
  border-radius: 8px;
  background: #fff;
}

.empty {
  padding: 14px;
  color: #66756f;
  font-size: 14px;
}

.order-item {
  display: flex;
  gap: 12px;
  padding: 12px;
}

.item-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 5px;
}

.item-title {
  color: #1d252c;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.5;
}

.item-sku,
.item-meta,
.summary-count,
.success-text {
  color: #66756f;
  font-size: 13px;
  line-height: 1.5;
}

.item-total,
.summary-total {
  color: #9a4b21;
  font-weight: 900;
}

.address-option {
  margin: 0;
  padding: 12px;
  color: #26342f;
  font-size: 14px;
  line-height: 1.5;
  text-align: left;
}

.address-option::after,
.primary-button::after {
  border: 0;
}

.address-option.active {
  border-color: #1d8068;
  background: #e9f5f1;
  font-weight: 800;
}

.footer {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 2px -16px -16px;
  padding: 12px 16px 16px;
  border-top: 1px solid #d7dfdc;
  background: #f8faf9;
}

.summary {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.primary-button {
  width: 112px;
  height: 38px;
  color: #fff;
  background: #1f7a63;
  font-size: 14px;
  font-weight: 800;
}

.primary-button[disabled] {
  opacity: 0.55;
}

.success {
  padding: 18px;
}
</style>
