// 文件职责：
// 回答构造层：生成客户端商品卡片、商品详情、本地兜底回答，以及发送给大模型的结构化 Prompt。
// 这里维护“回答必须基于商品数据”的边界，避免模型编造商品、价格、库存或优惠。
function shortDescription(product) {
  const text = product.marketingDescription || product.title;
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

function imageUrlFor(product) {
  return `/api/products/${encodeURIComponent(product.productId)}/image`;
}

export function buildProductCards(products) {
  // 卡片只暴露客户端展示所需字段，避免把完整 RAG 文本、源文件路径等内部信息塞进聊天流。
  return products.map((product) => ({
    productId: product.productId,
    title: product.title,
    brand: product.brand,
    category: product.category,
    subCategory: product.subCategory,
    price: product.basePrice,
    imagePath: product.imagePath,
    imageUrl: imageUrlFor(product),
    reason: shortDescription(product)
  }));
}

export function buildProductDetail(product) {
  // 详情页可以看到更完整的 FAQ、SKU、评价等字段，但仍全部来自商品数据源。
  return {
    productId: product.productId,
    title: product.title,
    brand: product.brand,
    category: product.category,
    subCategory: product.subCategory,
    price: product.basePrice,
    imagePath: product.imagePath,
    imageUrl: imageUrlFor(product),
    marketingDescription: product.marketingDescription,
    skus: product.skus,
    officialFaq: product.officialFaq,
    userReviews: product.userReviews,
    sourceFile: product.sourceFile
  };
}

export function buildLocalAnswer(message, products, history = [], state = {}) {
  if (products.length === 0) {
    return "我在当前商品库里没有找到足够匹配的商品。你可以换一个预算、类目或使用场景再问我。";
  }

  const hasHistory = history.length > 0;
  const intro = hasHistory
    ? `结合前面的对话和你的新需求“${message}”，我在商品库里优先筛出了 ${products.length} 个候选：`
    : `根据你的需求“${message}”，我在商品库里优先筛出了 ${products.length} 个候选：`;
  const stateNote = state.maxPrice ? `我已经按 ${state.maxPrice} 元以内继续筛选。` : "";
  const lines = products.map((product, index) => {
    const reason = shortDescription(product);
    return `${index + 1}. ${product.title}，参考价 ${product.basePrice} 元。推荐理由：${reason}`;
  });
  // 兜底回答也保留防幻觉边界：价格、规格、优惠等只能以商品卡片/详情中的真实数据为准。
  const guardrail = "以上推荐只基于当前商品库信息，价格和规格以商品卡片/详情为准，我不会额外编造优惠或库存。";

  return [intro, stateNote, ...lines, guardrail].filter(Boolean).join("\n");
}

export function buildModelMessages(message, products, history = [], state = {}) {
  // 给模型的商品上下文是结构化 JSON，目的是让模型基于明确字段回答，而不是自由猜商品信息。
  const productContext = products.map((product, index) => ({
    index: index + 1,
    product_id: product.productId,
    title: product.title,
    brand: product.brand,
    category: product.category,
    sub_category: product.subCategory,
    price: product.basePrice,
    description: product.marketingDescription,
    skus: product.skus
  }));

  return [
    {
      role: "system",
      content:
        "你是电商智能导购。你需要结合最近对话理解用户追问，但只能基于提供的商品上下文回答，不得编造不存在的商品、价格、库存、优惠券或功能。回答要简洁、自然、可执行。"
    },
    ...history.map((turn) => ({
      role: turn.role,
      content: turn.content
    })),
    {
      role: "user",
      content: `用户需求：${message}\n\n结构化导购状态：${JSON.stringify(state, null, 2)}\n\n商品上下文：${JSON.stringify(productContext, null, 2)}`
    }
  ];
}
