// 文件职责：
// 回答构造层：生成客户端商品卡片、商品详情、本地兜底回答，以及发给大模型的结构化 Prompt。
// 这里是 RAG 的“生成边界”：回答只能使用检索到的商品证据，不能把模型自己的猜测当成商品事实。

function shortDescription(product) {
  const text = product.marketingDescription || product.title;
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

function imageUrlFor(product) {
  return `/api/products/${encodeURIComponent(product.productId)}/image`;
}

function formatStateConstraints(state = {}) {
  const parts = [];
  if (state.category) parts.push(`类目：${state.category}`);
  if (state.itemIntent?.itemType) parts.push(`商品类型：${state.itemIntent.itemType}`);
  if (Number.isFinite(state.maxPrice)) parts.push(`预算上限：${state.maxPrice} 元`);
  if (Number.isFinite(state.minPrice)) parts.push(`预算下限：${state.minPrice} 元`);
  if (state.excludeTerms?.length) parts.push(`排除条件：${state.excludeTerms.join("、")}`);
  return parts;
}

function formatMemorySummary(state = {}) {
  return String(state.memorySummary || "").trim();
}

function buildNoResultAnswer(message, state = {}) {
  const constraints = formatStateConstraints(state);
  const constraintText = constraints.length > 0 ? `我识别到的条件是：${constraints.join("；")}。` : "";
  // 空结果时不能让模型或本地兜底“硬凑商品”，否则就违背了 RAG 必须基于商品库回答的原则。
  return [
    `当前商品库里没有找到能同时满足“${message}”的商品。`,
    constraintText,
    "你可以放宽其中一个条件再试，比如调整预算、去掉某个排除条件，或换成相近品类。",
    "我不会推荐不在商品库里或不符合硬性条件的商品。"
  ]
    .filter(Boolean)
    .join("\n");
}

function buildProductEvidence(product) {
  const faqEvidence = (product.officialFaq || [])
    .slice(0, 2)
    .map((item) => `${item.question} ${item.answer}`)
    .join(" ");
  const reviewEvidence = (product.userReviews || [])
    .slice(0, 2)
    .map((item) => item.content)
    .join(" ");

  return {
    product_id: product.productId,
    title: product.title,
    brand: product.brand,
    category: product.category,
    sub_category: product.subCategory,
    price: product.basePrice,
    description: product.marketingDescription,
    sku_count: product.skus.length,
    faq_evidence: faqEvidence,
    review_evidence: reviewEvidence
  };
}

function formatProductListRule(products) {
  if (products.length === 0) return "";
  const titles = products.map((product, index) => `${index + 1}. ${product.title}`).join("\n");
  // 这段规则把自然语言回答和 products 事件中的卡片强绑定，减少“回答 3 个、展示 4 个”或顺序不一致。
  return [
    `本轮商品卡片会展示 ${products.length} 个候选商品，你必须只围绕这 ${products.length} 个候选回答。`,
    "请按下面顺序逐个说明候选商品，不要跳过、不要新增候选之外的商品：",
    titles
  ].join("\n");
}

function buildSafeModelHistory(history = []) {
  // 历史 assistant 回复里常包含上一轮完整商品清单。它对语气有帮助，但不能继续作为本轮商品事实，
  // 否则模型在“便宜点/1万预算”这类追问里容易把已被硬过滤排除的旧商品又写回答案。
  return history
    .filter((turn) => turn.role === "user")
    .slice(-3)
    .map((turn) => ({
      role: "user",
      content: turn.content
    }));
}

export function buildProductCards(products) {
  // 卡片只暴露客户端展示所需字段，避免把源文件路径、完整 RAG 文本等内部信息塞进聊天流。
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
  // 详情页展示 FAQ、SKU、评价等更完整证据，但仍全部来自商品数据源。
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
    return buildNoResultAnswer(message, state);
  }

  const hasHistory = history.length > 0;
  const intro = hasHistory
    ? `结合前面的对话和你的新需求“${message}”，我从当前商品库里筛出了 ${products.length} 个候选：`
    : `根据你的需求“${message}”，我从当前商品库里筛出了 ${products.length} 个候选：`;
  const stateNote = formatStateConstraints(state);
  const lines = products.map((product, index) => {
    const reason = shortDescription(product);
    return `${index + 1}. ${product.title}，参考价 ${product.basePrice} 元。推荐理由：${reason}`;
  });
  // 本地兜底回答也保留防幻觉边界：价格、规格、功效只能以商品卡片和详情里的真实数据为准。
  const guardrail = "以上推荐只基于当前商品库信息，价格和规格以商品卡片/详情为准，我不会额外编造优惠、库存或商品功效。";

  return [intro, stateNote.length ? `已应用条件：${stateNote.join("；")}。` : "", ...lines, guardrail]
    .filter(Boolean)
    .join("\n");
}

export function buildModelMessages(message, products, history = [], state = {}) {
  const productContext = products.map(buildProductEvidence);
  const constraints = formatStateConstraints(state);
  const memorySummary = formatMemorySummary(state);
  const productListRule = formatProductListRule(products);
  const noResultInstruction =
    products.length === 0
      ? "本轮没有检索到商品。你必须明确说明当前商品库没有满足条件的商品，并建议用户放宽条件；禁止推荐任何商品。"
      : "本轮已有候选商品。你只能围绕候选商品回答，推荐理由必须能从商品上下文中找到依据。";

  return [
    {
      role: "system",
      content: [
        "你是电商智能导购，负责基于商品库做 RAG 推荐。",
        "必须遵守：只使用提供的商品上下文；不得编造不存在的商品、价格、库存、优惠券、销量、功效或活动。",
        "如果候选商品不能完全满足用户条件，要如实说明“更接近需求”或“未完全满足”，不要夸大。",
        "回答要简洁、中文、自然；候选商品有几个，就按顺序回答几个。",
        "不要输出 JSON，不要提到内部字段名或检索分数。",
        productListRule,
        noResultInstruction
      ]
        .filter(Boolean)
        .join("\n")
    },
    ...buildSafeModelHistory(history),
    {
      role: "user",
      content: [
        `用户需求：${message}`,
        memorySummary ? `会话长期摘要：\n${memorySummary}` : "",
        constraints.length ? `结构化条件：${constraints.join("；")}` : "结构化条件：未识别到明确硬约束",
        `商品上下文：${JSON.stringify(productContext, null, 2)}`,
        "请基于以上商品上下文回答。"
      ].join("\n\n")
    }
  ];
}
