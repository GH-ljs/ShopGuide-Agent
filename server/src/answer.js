// 文件职责：
// 生成商品卡片、本地兜底回答，以及构造发给大模型的 Prompt。

function shortDescription(product) {
  const text = product.marketingDescription || product.title;
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

// 商品卡片返回结构化数据，客户端不要从模型自然语言里再解析商品。
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

// 没有配置模型 Key 时使用本地兜底回答，保证项目早期也能演示完整链路。
export function buildLocalAnswer(message, products, history = []) {
  if (products.length === 0) {
    return "我在当前商品库里没有找到足够匹配的商品。你可以换一个预算、类目或使用场景再问我。";
  }

  const hasHistory = history.length > 0;
  const intro = hasHistory
    ? `结合前面的对话和你的新需求“${message}”，我在商品库里优先筛出了 ${products.length} 个候选：`
    : `根据你的需求“${message}”，我在商品库里优先筛出了 ${products.length} 个候选：`;
  const lines = products.map((product, index) => {
    const reason = shortDescription(product);
    return `${index + 1}. ${product.title}，参考价 ${product.basePrice} 元。推荐理由：${reason}`;
  });
  const guardrail = "以上推荐只基于当前商品库信息，价格和规格以商品卡片/详情为准，我不会额外编造优惠或库存。";

  return [intro, ...lines, guardrail].join("\n");
}

// 构造发给大模型的 Prompt。关键约束是只能基于检索到的商品上下文回答。
export function buildModelMessages(message, products, history = []) {
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
        "你是电商智能导购。需要结合最近对话理解用户追问，但只能基于提供的商品上下文回答，不得编造不存在的商品、价格、库存、优惠券或功能。回答要简洁、自然、可执行。"
    },
    ...history.map((turn) => ({
      role: turn.role,
      content: turn.content
    })),
    {
      role: "user",
      content: `用户需求：${message}\n\n商品上下文：${JSON.stringify(productContext, null, 2)}`
    }
  ];
}
