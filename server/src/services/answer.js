// 文件职责：
// 回答构造层：生成客户端商品卡片、商品详情、本地兜底回答，以及发给大模型的结构化 Prompt。
// 这里是 RAG 的“生成边界”：回答只能使用检索到的商品证据，不能把模型自己的猜测当成商品事实。

function shortDescription(product) {
  const text = product.marketingDescription || product.title;
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

function skuSummary(product) {
  const sku = product.skus?.[0];
  if (!sku?.properties) return "";
  return Object.entries(sku.properties)
    .slice(0, 2)
    .map(([key, value]) => `${key}${value}`)
    .join("、");
}

function isCategory(product, category) {
  return product.category === category;
}

function scopedTagRules(product) {
  if (isCategory(product, "食品饮料")) {
    return [
      ["无糖", /(无糖|0糖|零糖|不含糖|零添加糖)/],
      ["低负担", /(0脂|0卡|低糖|低负担|控糖|减脂|怕胖|热量低)/],
      ["茶感", /(茶|乌龙|茉莉|绿茶|回甘|茶底|茶香|清润)/],
      ["气泡", /(气泡|碳酸|苏打|杀口|爽感)/],
      ["提神", /(咖啡因|提神|犯困|熬夜|能量|牛磺酸)/],
      ["维C", /(维生素C|维C|柠檬)/],
      ["少甜", /(不甜|不那么甜|甜度低|低糖|清淡|不腻|不齁|没有甜味|无糖)/]
    ];
  }

  if (isCategory(product, "美妆护肤")) {
    return [
      ["控油", /(控油|油皮|减少油光|清爽)/],
      ["清爽", /(清爽|轻薄|不黏腻|水感)/],
      ["敏感肌", /(敏感肌|舒缓|修护|屏障|温和)/],
      ["防水防汗", /(防水|防汗|户外|运动)/],
      ["保湿", /(保湿|滋润|补水)/]
    ];
  }

  if (isCategory(product, "数码电子")) {
    return [
      ["轻薄便携", /(轻薄|轻量|便携|通勤|出差)/],
      ["办公", /(办公|商务|生产力|会议|键盘)/],
      ["性能", /(高性能|性能|处理器|芯片|内存|Pro)/],
      ["续航", /(续航|电池|快充)/],
      ["屏幕", /(屏幕|高刷|色彩|分辨率|护眼)/]
    ];
  }

  if (isCategory(product, "服饰运动")) {
    return [
      ["通勤", /(通勤|日常|百搭|城市)/],
      ["户外", /(户外|徒步|防水|防风|耐磨)/],
      ["轻量", /(轻量|轻便|轻盈)/],
      ["运动", /(运动|跑步|训练|篮球)/],
      ["耐用", /(耐用|耐磨|支撑|稳定)/]
    ];
  }

  return [
    ["预算", /(高性价比|预算|入门|标准版|价格|省)/],
    ["耐用", /(耐用|稳定|可靠)/],
    ["便携", /(便携|轻量|轻薄)/]
  ];
}

function productFeatureTags(product) {
  const evidence = productEvidenceText(product);
  const tagRules = scopedTagRules(product);
  return tagRules.filter(([, pattern]) => pattern.test(evidence)).map(([tag]) => tag);
}

function compactFeatureText(product) {
  const tags = productFeatureTags(product).slice(0, 3);
  if (tags.length > 0) return tags.join("、");
  const sku = skuSummary(product);
  if (sku) return sku;
  return `${product.category}/${product.subCategory}`;
}

function comparisonTradeoffText(product) {
  const title = `${product.title} ${product.brand}`;
  if (isCategory(product, "美妆护肤")) {
    if (/(安热沙|防水防汗|户外|身体)/.test(title)) {
      return "户外防水防汗更强；价格最高";
    }
    if (/(理肤泉|易敏肌|敏感肌|特护)/.test(title)) {
      return "偏敏感肌和控油；价格偏高";
    }
    if (/(欧莱雅|水感|隔离|提亮)/.test(title)) {
      return "预算更友好，兼顾提亮；户外防护弱一些";
    }
  }

  const tags = productFeatureTags(product);
  const highlights = tags.length > 0 ? tags.slice(0, 2).join("、") : compactFeatureText(product);
  const priceText =
    product.basePrice >= 1000
      ? "预算占用高"
      : product.basePrice >= 200
        ? "价格偏高"
        : product.basePrice <= 80
          ? "入手门槛低"
          : "价格适中";

  // 取舍点强调“为什么选/为什么犹豫”，不能和适合场景复用同一套标签。
  // 对比卡需要帮助用户决策：这里把商品主打点和价格取舍放在一起，场景行再单独说明适用人群。
  return `主打${highlights}；${priceText}`;
}

function comparisonScenarioText(product) {
  const title = `${product.title} ${product.brand}`;
  if (isCategory(product, "美妆护肤")) {
    if (/(安热沙|防水防汗|户外|身体)/.test(title)) {
      return "户外运动、出汗场景";
    }
    if (/(理肤泉|易敏肌|敏感肌|特护)/.test(title)) {
      return "油皮/敏感肌日常通勤";
    }
    if (/(欧莱雅|水感|隔离|提亮)/.test(title)) {
      return "日常通勤、妆前打底";
    }
  }

  const evidence = productEvidenceText(product);
  const scenarioRules = isCategory(product, "食品饮料")
    ? [
        ["控糖/减脂期", /(无糖|0糖|零糖|控糖|减脂|怕胖|低负担)/],
        ["日常饮用", /(日常|上班|学生|不爱喝白水|随手|办公室|工位)/],
        ["解腻佐餐", /(解腻|火锅|外卖|重油|重盐|撸串|聚餐)/],
        ["运动后", /(运动|健身|补水|电解质)/],
        ["提神补能", /(提神|熬夜|犯困|咖啡因|能量|牛磺酸)/]
      ]
    : isCategory(product, "美妆护肤")
      ? [
          ["油皮日常", /(油皮|控油|清爽|日常)/],
          ["户外活动", /(户外|防水|防汗|运动)/],
          ["敏感肌", /(敏感肌|舒缓|修护|温和)/],
          ["通勤", /(通勤|日常|上班)/]
        ]
      : isCategory(product, "数码电子")
        ? [
            ["办公学习", /(办公|学习|商务|生产力|会议)/],
            ["通勤出差", /(通勤|出差|便携|轻薄|轻量)/],
            ["高负载任务", /(性能|剪辑|设计|高性能|Pro)/]
          ]
        : [
            ["日常使用", /(日常|通勤|百搭)/],
            ["户外运动", /(户外|运动|跑步|徒步|训练)/],
            ["长时间使用", /(舒适|耐用|支撑|稳定)/]
          ];

  const scenarios = scenarioRules.filter(([, pattern]) => pattern.test(evidence)).map(([label]) => label);
  if (scenarios.length > 0) return [...new Set(scenarios)].slice(0, 3).join("、");
  return `${product.category}/${product.subCategory}`;
}

function inferComparisonFocus(message, state = {}) {
  const preferenceText = `${message} ${(state.preferences || []).join(" ")}`;
  if (/(便宜|价格|预算|省钱|性价比)/.test(preferenceText)) return "价格";
  if (/(通勤|办公|上班|出差|便携|轻薄|轻量)/.test(preferenceText)) return "通勤";
  if (/(户外|运动|防水|防汗|续航|耐用)/.test(preferenceText)) return "场景";
  if (/(油皮|控油|清爽|肤感|敏感肌)/.test(preferenceText)) return "肤感";
  if (/(健康|天然|无糖|0糖|零糖|低糖|无添加|低负担)/.test(preferenceText)) return "健康";
  return "";
}

function inferExplicitComparisonFocus(message) {
  // 只看“本轮用户话”里的维度词。普通“第二和第三对比下”不应该自动继承上一轮的“清爽/控油”，
  // 否则普通对比和“哪个更清爽”会输出同一套结论，用户看不出追问维度带来的差异。
  return inferComparisonFocus(message, { preferences: [] });
}

function isGenericComparisonQuestion(message) {
  return /(对比|比较|区别|差别|不同)/.test(message) && !/(哪个|哪款|哪一个|谁|选哪|怎么选|更|些|一点|不那么|没那么)/.test(message);
}

function genericComparisonFollowUpDimensions(products) {
  const categoryText = products.map((product) => `${product.category} ${product.subCategory}`).join(" ");
  if (/食品饮料|饮料|茶饮|气泡水|碳酸|咖啡/.test(categoryText)) {
    return "口味、茶感/气泡感、代糖负担或价格";
  }
  if (/美妆护肤|防晒|洁面|精华|面膜|眉笔|唇/.test(categoryText)) {
    return "肤感、成分温和度、防护/功效或价格";
  }
  if (/服饰运动|上衣|T恤|卫衣|裤|鞋|背包|帽子/.test(categoryText)) {
    return "穿着场景、版型/舒适度、耐用性或价格";
  }
  if (/数码电子|笔记本|耳机|手机|键盘/.test(categoryText)) {
    return "性能、续航、便携性或价格";
  }
  return "预算、使用场景、核心功能或价格";
}

function focusRowLabel(focus) {
  if (focus === "肤感") return "清爽/肤感";
  return `${focus}表现`;
}

function productFocusText(product, focus) {
  const title = `${product.title} ${product.brand}`;
  if (focus === "肤感" && isCategory(product, "美妆护肤")) {
    if (/(理肤泉|易敏肌|敏感肌|特护)/.test(title)) return "更偏清爽控油，兼顾敏感肌";
    if (/(安热沙|防水防汗|户外|身体)/.test(title)) return "防水防汗强，肤感不如清爽款";
    if (/(欧莱雅|水感|隔离|提亮)/.test(title)) return "水感轻薄，兼顾妆前提亮";
  }

  if (focus === "价格") return `${product.basePrice} 元`;
  const keywordsByFocus = {
    通勤: ["通勤", "办公", "出差", "便携", "轻薄", "轻量", "续航"],
    场景: ["户外", "运动", "防水", "防汗", "续航", "耐用"],
    健康: ["健康", "天然", "无糖", "0糖", "零糖", "低糖", "无添加", "低负担"]
  };
  const matched = matchedKeywords(product, keywordsByFocus[focus] || []);
  return matched.length ? matched.slice(0, 3).join("、") : compactFeatureText(product);
}

function productEvidenceText(product) {
  return [
    product.title,
    product.brand,
    product.category,
    product.subCategory,
    product.marketingDescription,
    ...(product.userReviews || []).map((item) => item.content),
    ...(product.officialFaq || []).flatMap((item) => [item.question, item.answer]),
    ...(product.skus || []).flatMap((sku) => Object.values(sku.properties || {}))
  ]
    .filter(Boolean)
    .join(" ");
}

function matchedKeywords(product, keywords) {
  const evidence = productEvidenceText(product);
  return keywords.filter((keyword) => evidence.includes(keyword));
}

function pickRecommendedProduct(message, products, state = {}) {
  const focus = inferComparisonFocus(message, state);
  if (focus === "价格") {
    const ranked = [...products].sort((a, b) => a.basePrice - b.basePrice);
    return { product: ranked[0], focus, matched: ["价格更低"], score: 1 };
  }
  const keywordGroups = {
    通勤: ["通勤", "办公", "出差", "便携", "轻薄", "轻量", "续航"],
    场景: ["户外", "防水", "防汗", "续航", "耐用"],
    肤感: ["油皮", "控油", "清爽", "敏感肌", "舒缓"],
    健康: ["健康", "天然", "无糖", "0糖", "零糖", "低糖", "无添加", "茶", "低负担"]
  };
  const keywords = keywordGroups[focus] || [];
  if (keywords.length === 0) return null;

  const ranked = products
    .map((product) => {
      const matched = matchedKeywords(product, keywords);
      return { product, focus, matched, score: matched.length };
    })
    .sort((a, b) => b.score - a.score || a.product.basePrice - b.product.basePrice);
  return ranked[0]?.score > 0 ? ranked[0] : null;
}

function buildDecisionSummary(message, products, state = {}) {
  const explicitFocus = inferExplicitComparisonFocus(message);
  if (!explicitFocus && isGenericComparisonQuestion(message)) {
    const productSummaries = products
      .map((product, index) => `第 ${index + 1} 款偏${comparisonTradeoffText(product)}`)
      .join("；");
    const followUpDimensions = genericComparisonFollowUpDimensions(products);
    // 普通“对比一下”先呈现差异，不把上一轮偏好直接升级成单一推荐结论。
    // 如果用户继续问“哪个更清爽/哪个更适合户外”，下一轮再按明确维度给决策。
    return `明确结论：这几款主要差异是 ${productSummaries}。如果你更看重${followUpDimensions}，我可以继续按单一维度帮你定。`;
  }

  const recommendation = pickRecommendedProduct(message, products, state);
  if (!recommendation) {
    return "明确结论：这几款没有明显压倒性的单一选择。你可以再补一句最看重什么，例如预算、通勤、续航、控油或户外，我再按这个维度给你排序。";
  }

  const recommendedIndex = products.findIndex((product) => product.productId === recommendation.product.productId) + 1;
  const alternatives = products.filter((product) => product.productId !== recommendation.product.productId);
  const focusText = recommendation.focus || "当前偏好";
  const matchedText = recommendation.matched.slice(0, 3).join("、");
  const evidenceText =
    recommendation.focus === "价格"
      ? `它在这几款里价格更低，参考价 ${recommendation.product.basePrice} 元，更适合控制预算。`
      : `它的商品信息更贴近${focusText}场景，关键点是${matchedText || compactFeatureText(recommendation.product)}。`;
  const cheaperAlternative = alternatives
    .filter((product) => product.basePrice < recommendation.product.basePrice)
    .sort((a, b) => a.basePrice - b.basePrice)[0];
  const alternativeText =
    recommendation.focus !== "价格" && cheaperAlternative
      ? `如果你更在意价格，第 ${products.findIndex((product) => product.productId === cheaperAlternative.productId) + 1} 款更省预算，可作为备选。`
      : "";

  // 决策结论只基于候选商品已有文本和结构化价格，不把模型猜测升级成事实。
  // 备选理由也必须和结构化价格一致：只有真的存在更便宜的候选时，才说“更在意价格可选它”。
  // 这样“我主要通勤，偶尔出差，选哪个”会得到明确推荐，同时仍保留另一款在不同偏好下的价值。
  return [
    `明确结论：更推荐第 ${recommendedIndex} 款 **${recommendation.product.title}**。`,
    `选择理由：${evidenceText}`,
    alternativeText
  ]
    .filter(Boolean)
    .join("\n");
}

function stripMarkdown(text) {
  return String(text || "").replace(/\*\*/g, "");
}

function imageUrlFor(product) {
  return `/api/products/${encodeURIComponent(product.productId)}/image`;
}

export function buildComparisonPayload(message, products, state = {}) {
  if (state.answerMode !== "compare" || products.length < 2) return null;

  const decisionSummary = stripMarkdown(buildDecisionSummary(message, products, state));
  const recommendationMatch = decisionSummary.match(/更推荐第\s*(\d+)\s*款/);
  const recommendedIndex = recommendationMatch ? Number(recommendationMatch[1]) - 1 : -1;
  const recommendedProduct = products[recommendedIndex] || null;
  const explicitFocus = inferExplicitComparisonFocus(message);
  const focusRows = explicitFocus
    ? [
        {
          label: focusRowLabel(explicitFocus),
          values: products.map((product) => ({
            productId: product.productId,
            value: productFocusText(product, explicitFocus)
          }))
        }
      ]
    : [];
  const rows = [
    ...focusRows,
    {
      label: "价格",
      values: products.map((product) => ({
        productId: product.productId,
        value: `${product.basePrice} 元`
      }))
    },
    {
      label: "取舍点",
      values: products.map((product) => ({
        productId: product.productId,
        value: comparisonTradeoffText(product)
      }))
    },
    {
      label: "适合场景",
      values: products.map((product) => ({
        productId: product.productId,
        value: comparisonScenarioText(product)
      }))
    }
  ];

  // comparison 事件是给客户端渲染“对比组件”的结构化协议：文本回答负责自然语言解释，
  // 这里负责稳定字段和商品 ID 绑定，避免任一客户端从自然语言里再猜价格、推荐项或对比维度。
  return {
    title: "商品对比",
    conclusion: decisionSummary,
    recommendedProductId: recommendedProduct?.productId || "",
    columns: products.map((product, index) => ({
      productId: product.productId,
      label: `第 ${index + 1} 款`,
      title: product.title,
      brand: product.brand
    })),
    rows
  };
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

function buildComparisonAnswer(message, products, state = {}) {
  if (products.length === 0) {
    return buildNoResultAnswer(message);
  }
  if (products.length === 1) {
    const product = products[0];
    return [
      `你提到的是 ${product.title}，参考价 ${product.basePrice} 元。`,
      `从商品数据看，它的主要特点是：${compactFeatureText(product)}`,
      "如果你想做对比，可以再指定另一款，例如“和第二款对比”。"
    ]
      .filter(Boolean)
      .join("\n");
  }

  const decisionSummary = buildDecisionSummary(message, products, state);
  // 对比详情已经通过 comparison SSE 事件结构化返回给客户端。文本流只保留一句兜底结论，
  // 避免 App 同时展示长文本对比和对比卡，造成用户看到两份重复信息。
  return `${decisionSummary}\n\n我已把价格、取舍点和适合场景整理在下方对比卡里。`;
}

function buildReferencedProductAnswer(message, products) {
  if (products.length !== 1) return null;
  const product = products[0];
  const sku = skuSummary(product);

  // 指代单品追问的目标是“解释这款”，不是重新推荐一组候选。
  // 单独模板可以避免回复里出现“又筛出 3 个/1 个候选”的口吻，让多轮导购更像真实销售沟通。
  return [
    `你问的是 **${product.title}**。`,
    `价格：${product.basePrice} 元`,
    sku ? `规格：${sku}` : "",
    `特点：${compactFeatureText(product)}`,
    "建议：如果你想，我可以继续从预算、使用场景或和其他款对比的角度帮你判断。"
  ]
    .filter(Boolean)
    .join("\n\n");
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
    imageUrl: imageUrlFor(product),
    marketingDescription: product.marketingDescription,
    skus: product.skus,
    officialFaq: product.officialFaq,
    userReviews: product.userReviews
  };
}

export function buildLocalAnswer(message, products, history = [], state = {}) {
  if (products.length === 0) {
    return buildNoResultAnswer(message, state);
  }
  if (state.answerMode === "compare") {
    return buildComparisonAnswer(message, products, state);
  }
  if (state.answerMode === "refer") {
    const referencedAnswer = buildReferencedProductAnswer(message, products);
    if (referencedAnswer) return referencedAnswer;
  }

  const hasHistory = history.length > 0;
  const intro = hasHistory
    ? `结合前面的对话和你的新需求“${message}”，我从当前商品库里筛出了 ${products.length} 个候选：`
    : `根据你的需求“${message}”，我从当前商品库里筛出了 ${products.length} 个候选：`;
  const stateNote = formatStateConstraints(state);
  const lines = products.map((product, index) => {
    const reason = shortDescription(product);
    return `${index + 1}. **${product.title}**，参考价 ${product.basePrice} 元。推荐理由：${reason}`;
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
  const isCompareMode = state.answerMode === "compare";
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
        "回答要简洁、中文、自然；候选商品有几个，就按顺序回答几个；每个候选商品名称必须用 Markdown **加粗**。",
        isCompareMode
          ? "本轮是商品对比/决策问题。请用“主要差异、逐款优缺点、适合谁、明确结论”的结构回答；必须给出更推荐哪一款，并说明依据；只能比较候选商品，不要新增商品。"
          : "",
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
