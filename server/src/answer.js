function shortDescription(product) {
  const text = product.marketingDescription || product.title;
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

export function buildProductCards(products) {
  return products.map((product) => ({
    productId: product.productId,
    title: product.title,
    brand: product.brand,
    category: product.category,
    subCategory: product.subCategory,
    price: product.basePrice,
    imagePath: product.imagePath,
    reason: shortDescription(product)
  }));
}

export function buildLocalAnswer(message, products) {
  if (products.length === 0) {
    return "我在当前商品库里没有找到足够匹配的商品。你可以换一个预算、类目或使用场景再问我。";
  }

  const intro = `根据你的需求“${message}”，我在商品库里优先筛出了 ${products.length} 个候选：`;
  const lines = products.map((product, index) => {
    const reason = shortDescription(product);
    return `${index + 1}. ${product.title}，参考价 ${product.basePrice} 元。推荐理由：${reason}`;
  });
  const guardrail = "以上推荐只基于当前商品库信息，价格和规格以商品卡片/详情为准，我不会额外编造优惠或库存。";

  return [intro, ...lines, guardrail].join("\n");
}

export function buildModelMessages(message, products) {
  const productContext = products.map((product, index) => ({
    index: index + 1,
    product_id: product.productId,
    title: product.title,
    brand: product.brand,
    category: product.category,
    price: product.basePrice,
    description: product.marketingDescription,
    skus: product.skus
  }));

  return [
    {
      role: "system",
      content:
        "你是电商智能导购。只能基于提供的商品上下文回答，不得编造不存在的商品、价格、库存、优惠券或功能。回答要简洁、自然、可执行。"
    },
    {
      role: "user",
      content: `用户需求：${message}\n\n商品上下文：${JSON.stringify(productContext, null, 2)}`
    }
  ];
}
