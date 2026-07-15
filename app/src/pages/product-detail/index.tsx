import React, { useEffect, useMemo, useState } from "react";
import Taro, { useRouter } from "@tarojs/taro";
import { Button, Image, Text, View } from "@tarojs/components";
import { fetchProductDetail, resolveAssetUrl } from "../../api/shopguide";
import { useShopStore } from "../../store/shop";
import type { ProductDetail } from "../../types/shopguide";
import { formatPrice } from "../../utils/format";
import { normalizeSkuOptions } from "../../utils/sku";
import "./index.scss";

export default function ProductDetailPage() {
  const router = useRouter();
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const { restore, isFavorite, cartQuantity, toggleFavorite, addToCart } = useShopStore();

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    const productId = typeof router.params.productId === "string" ? router.params.productId : "";
    if (!productId) {
      setError("缺少商品 ID");
      setLoading(false);
      return;
    }

    fetchProductDetail(productId)
      .then((nextDetail) => {
        setDetail(nextDetail);
        const options = normalizeSkuOptions(nextDetail.skus);
        setSelectedSkuId(options.length === 1 ? options[0].skuId : "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "商品详情加载失败"))
      .finally(() => setLoading(false));
  }, [router.params.productId]);

  const skuOptions = useMemo(() => normalizeSkuOptions(detail?.skus), [detail?.skus]);
  const selectedSku = skuOptions.find((sku) => sku.skuId === selectedSkuId);
  const displayPrice = selectedSku?.price ?? detail?.price;
  const currentProductId = detail?.productId || "";
  const faqItems = detail?.officialFaq?.slice(0, 3) ?? [];
  const reviewItems = detail?.userReviews?.slice(0, 3) ?? [];

  function addCurrentToCart() {
    if (!detail) return;
    if (skuOptions.length > 1 && !selectedSku) {
      Taro.showToast({ title: "请先选择规格", icon: "none" });
      return;
    }
    addToCart(detail, selectedSku);
    Taro.showToast({ title: "已加入购物车", icon: "none" });
  }

  function goBackToChat() {
    if (Taro.getCurrentPages().length > 1) {
      Taro.navigateBack();
      return;
    }
    Taro.redirectTo({ url: "/pages/chat/index" });
  }

  if (loading) return <View className="detail-page"><Text className="state">加载中...</Text></View>;
  if (error) return <View className="detail-page"><Text className="state error">{error}</Text></View>;
  if (!detail) return null;

  return (
    <View className="detail-page">
      <View className="detail-header">
        <Button className="back-button" onClick={goBackToChat}>
          <Text className="back-icon">‹</Text>
        </Button>
        <Text className="header-title">商品详情</Text>
      </View>
      <View className="detail">
        {detail.imageUrl ? (
          <View className="hero-image-wrap">
            <Image className="hero-image" mode="aspectFit" src={resolveAssetUrl(detail.imageUrl)} />
          </View>
        ) : null}
        <Text className="title">{detail.title}</Text>
        <Text className="price">{formatPrice(displayPrice)}</Text>
        <Text className="desc">{detail.marketingDescription || detail.reason || "暂无商品描述。"}</Text>
        <View className="detail-actions">
          <Button className={`action-button ${isFavorite(currentProductId) ? "active" : ""}`} onClick={() => toggleFavorite(detail)}>
            <Text className="button-text">{isFavorite(currentProductId) ? "已收藏" : "收藏"}</Text>
          </Button>
          <Button className="action-button primary" onClick={addCurrentToCart}>
            <Text className="button-text">{cartQuantity(currentProductId) ? `购物车 ${cartQuantity(currentProductId)}` : "加入购物车"}</Text>
          </Button>
        </View>

        {skuOptions.length ? (
          <View className="section">
            <Text className="section-title">可选规格</Text>
            <View className="sku-list">
              {skuOptions.map((sku) => (
                <Button key={sku.skuId} className={`sku-option ${sku.skuId === selectedSkuId ? "active" : ""}`} onClick={() => setSelectedSkuId(sku.skuId)}>
                  <Text className="sku-label">{sku.label}</Text>
                  {sku.price ? <Text className="sku-price">{formatPrice(sku.price)}</Text> : null}
                </Button>
              ))}
            </View>
          </View>
        ) : null}

        {faqItems.length ? (
          <View className="section">
            <Text className="section-title">官方 FAQ</Text>
            {faqItems.map((item, index) => (
              <View key={index} className="info-card">
                <Text className="info-title">{pickText(item, ["question", "q"], "常见问题")}</Text>
                <Text className="info-content">{pickText(item, ["answer", "a", "content"], "暂无回答")}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {reviewItems.length ? (
          <View className="section">
            <Text className="section-title">用户评价</Text>
            {reviewItems.map((item, index) => (
              <View key={index} className="info-card">
                <Text className="info-content">{pickText(item, ["content", "text", "comment"], "暂无评价内容")}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function pickText(item: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}
