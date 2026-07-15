import React from "react";
import { Button, Image, Text, View } from "@tarojs/components";
import type { ProductCard as ProductCardType } from "../types/shopguide";
import { resolveAssetUrl } from "../api/shopguide";
import { formatPrice } from "../utils/format";
import "./ProductCard.scss";

interface Props {
  product: ProductCardType;
  favorite?: boolean;
  cartQuantity?: number;
  compareSelected?: boolean;
  onOpen: (product: ProductCardType) => void;
  onToggleFavorite: (product: ProductCardType) => void;
  onAddToCart: (product: ProductCardType) => void;
  onToggleCompare: (product: ProductCardType) => void;
}

export function ProductCard(props: Props) {
  const { product, favorite, cartQuantity, compareSelected } = props;

  return (
    <View className="product-card" onClick={() => props.onOpen(product)}>
      {product.imageUrl ? (
        <Image className="product-image" mode="aspectFill" src={resolveAssetUrl(product.imageUrl)} />
      ) : (
        <View className="product-image product-placeholder">图</View>
      )}
      <View className="product-body">
        <Text className="detail-link">详情</Text>
        <Text className="product-brand">{product.brand || product.category || "商品"}</Text>
        <Text className="product-title">{product.title}</Text>
        <Text className="price">{formatPrice(product.price)}</Text>
        {product.reason ? <Text className="reason">{product.reason}</Text> : null}
        <View className="actions">
          <Button
            className={`action-button compare ${compareSelected ? "selected" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggleCompare(product);
            }}
          >
            <Text className="button-text">{compareSelected ? "已选" : "对比"}</Text>
          </Button>
          <Button
            className={`action-button ${favorite ? "active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggleFavorite(product);
            }}
          >
            <Text className="button-text">{favorite ? "已收藏" : "收藏"}</Text>
          </Button>
          <Button
            className="action-button primary"
            onClick={(event) => {
              event.stopPropagation();
              props.onAddToCart(product);
            }}
          >
            <Text className="button-text">{cartQuantity ? `购物车 ${cartQuantity}` : "加入购物车"}</Text>
          </Button>
        </View>
      </View>
    </View>
  );
}
