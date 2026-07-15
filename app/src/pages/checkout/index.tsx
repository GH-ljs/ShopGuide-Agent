import React, { useEffect, useMemo, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Text, View } from "@tarojs/components";
import { useShopStore } from "../../store/shop";
import { formatPrice } from "../../utils/format";
import "./index.scss";

const addresses = [
  "北京市海淀区 中关村软件园 8 号",
  "上海市徐汇区 漕河泾开发区 88 号",
  "广东省深圳市南山区 科技园 15 号"
];

export default function CheckoutPage() {
  const { restore, cartItems, cartTotal, clearCart } = useShopStore();
  const [selectedAddress, setSelectedAddress] = useState(addresses[0]);
  const [submittedOrderId, setSubmittedOrderId] = useState("");
  const [submittedCount, setSubmittedCount] = useState(0);
  const [submittedTotal, setSubmittedTotal] = useState(0);

  useEffect(() => {
    restore();
  }, [restore]);

  const totalCount = useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems]);
  const canSubmit = cartItems.length > 0 && Boolean(selectedAddress);

  function submitOrder() {
    if (!canSubmit) {
      Taro.showToast({ title: "请先确认商品和地址", icon: "none" });
      return;
    }
    setSubmittedOrderId(`SO-${Date.now()}`);
    setSubmittedCount(totalCount);
    setSubmittedTotal(cartTotal);
    clearCart();
  }

  if (submittedOrderId) {
    return (
      <View className="checkout-page">
        <View className="success">
          <Text className="success-title">下单成功</Text>
          <Text className="success-text">订单号：{submittedOrderId}</Text>
          <Text className="success-text">商品数量：{submittedCount} 件</Text>
          <Text className="success-text">订单金额：{formatPrice(submittedTotal)}</Text>
          <Text className="success-text">收货地址：{selectedAddress}</Text>
          <Button className="primary-button" onClick={() => Taro.navigateBack()}>
            <Text className="button-text">返回对话</Text>
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="checkout-page">
      <View className="checkout">
        <Text className="page-title">确认订单</Text>
        <View className="section">
          <Text className="section-title">商品清单</Text>
          {!cartItems.length ? <View className="empty">购物车是空的，请先添加商品。</View> : null}
          {cartItems.map((item) => (
            <View key={item.itemKey} className="order-item">
              <View className="item-main">
                <Text className="item-title">{item.title}</Text>
                {item.skuLabel ? <Text className="item-sku">{item.skuLabel}</Text> : null}
                <Text className="item-meta">{formatPrice(item.price)} × {item.quantity}</Text>
              </View>
              <Text className="item-total">{formatPrice((item.price ?? 0) * item.quantity)}</Text>
            </View>
          ))}
        </View>
        <View className="section">
          <Text className="section-title">收货地址</Text>
          {addresses.map((address) => (
            <Button key={address} className={`address-option ${address === selectedAddress ? "active" : ""}`} onClick={() => setSelectedAddress(address)}>
              <Text className="button-text">{address}</Text>
            </Button>
          ))}
        </View>
        <View className="footer">
          <View className="summary">
            <Text className="summary-count">共 {totalCount} 件</Text>
            <Text className="summary-total">{formatPrice(cartTotal)}</Text>
          </View>
          <Button className="primary-button" disabled={!canSubmit} onClick={submitOrder}>
            <Text className="button-text">提交订单</Text>
          </Button>
        </View>
      </View>
    </View>
  );
}
