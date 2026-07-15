// 文件职责：
// 用“图节点”的方式描述当前 Agentic RAG 编排。这里不引入 LangGraph 运行时，
// 而是把现有稳定服务整理成可解释的 graph trace，方便学习、调试和简历讲解。

export const AGENT_GRAPH_NODES = [
  {
    id: "intent_node",
    label: "意图识别",
    llm: "optional",
    module: "services/intent.js",
    description: "判断本轮是新搜索、追问、指代、对比、越界还是多需求。"
  },
  {
    id: "slot_extract_node",
    label: "槽位抽取",
    llm: "optional",
    module: "services/intent.js + services/memory.js",
    description: "抽取类目、商品类型、预算、偏好、排除词和指代目标。"
  },
  {
    id: "clarification_node",
    label: "主动追问",
    llm: "optional",
    module: "services/clarify.js",
    description: "宽泛需求先返回结构化 clarify 卡片，避免过早推荐。"
  },
  {
    id: "retrieval_planner_node",
    label: "检索计划",
    llm: "optional",
    module: "services/memory.js",
    description: "决定使用全库、新需求状态、历史候选、点名商品还是用户勾选商品。"
  },
  {
    id: "product_retrieval_node",
    label: "商品检索",
    llm: "no",
    module: "services/retriever.js + vectordb/",
    description: "通过 Qdrant 或本地检索召回商品候选。"
  },
  {
    id: "backend_validate_node",
    label: "后端校验",
    llm: "no",
    module: "services/retriever.js + services/intent.js",
    description: "校验类目、商品类型、预算、排除词、无糖等硬边界。"
  },
  {
    id: "rerank_node",
    label: "候选排序",
    llm: "optional",
    module: "services/retriever.js",
    description: "结合向量相似度、偏好命中和商品字段做排序。"
  },
  {
    id: "answer_generate_node",
    label: "回答生成",
    llm: "optional",
    module: "services/answer.js + services/llm.js",
    description: "生成文本回答、商品卡、对比卡、详情字段或本地兜底回答。"
  },
  {
    id: "response_boundary_node",
    label: "响应事实边界",
    llm: "no",
    module: "services/reviewTrace.js + services/answer.js",
    description: "把本轮候选固化为商品卡、对比卡和证据链；模型文本由 Prompt 约束，不宣称已完成语义事实核验。"
  }
];

export const AGENT_GRAPH_EDGES = [
  ["intent_node", "slot_extract_node"],
  ["slot_extract_node", "clarification_node"],
  ["clarification_node", "retrieval_planner_node"],
  ["retrieval_planner_node", "product_retrieval_node"],
  ["product_retrieval_node", "backend_validate_node"],
  ["backend_validate_node", "rerank_node"],
  ["rerank_node", "answer_generate_node"],
  ["answer_generate_node", "response_boundary_node"]
];

const BOUNDARY_INTENTS = new Set(["missing_context", "out_of_scope", "multi_need"]);

function nodeStatus(nodeId, context) {
  const hasTurnIntent = Boolean(context.turnIntent?.type);
  const isBoundary = BOUNDARY_INTENTS.has(context.turnIntent?.type);
  const hasClarify = Boolean(context.clarify);
  const hasRetrieval = Boolean(context.retrievalScope && !["clarify", "boundary"].includes(context.retrievalScope));
  const hasVectorMatches = Number(context.debug?.counts?.vectorMatches || 0) > 0;

  if (nodeId === "intent_node") return hasTurnIntent ? "completed" : "pending";
  if (nodeId === "slot_extract_node") return hasTurnIntent ? "completed" : "pending";
  if (nodeId === "clarification_node") return hasClarify ? "completed" : "skipped";
  if (nodeId === "retrieval_planner_node") return isBoundary || hasClarify ? "skipped" : "completed";
  if (nodeId === "product_retrieval_node") return hasRetrieval ? "completed" : "skipped";
  if (nodeId === "backend_validate_node") return isBoundary ? "skipped" : "completed";
  if (nodeId === "rerank_node") return hasVectorMatches ? "completed" : "skipped";
  if (nodeId === "answer_generate_node") return "completed";
  if (nodeId === "response_boundary_node") return "completed";
  return "pending";
}

function nodeSummary(nodeId, context) {
  const parsed = context.debug?.parsed || context.turnIntent?.parsed || {};
  if (nodeId === "intent_node") {
    return `${context.turnIntent?.type || "unknown"} / ${context.turnIntent?.source || "unknown"}`;
  }
  if (nodeId === "slot_extract_node") {
    return [
      parsed.category || "",
      parsed.itemIntent || parsed.itemIntent?.itemType || "",
      Number.isFinite(parsed.maxPrice) ? `${parsed.maxPrice}元以内` : "",
      (parsed.preferences || []).join("/")
    ]
      .filter(Boolean)
      .join("，");
  }
  if (nodeId === "clarification_node") return context.clarify?.question || "";
  if (nodeId === "retrieval_planner_node") return context.retrievalScope || "";
  if (nodeId === "product_retrieval_node") {
    const counts = context.debug?.counts || {};
    return `filtered=${counts.filteredCandidates ?? "-"}, returned=${counts.finalProducts ?? counts.returned ?? "-"}`;
  }
  if (nodeId === "backend_validate_node") return "硬边界由 Validator / retriever / final boundary 共同保证";
  if (nodeId === "rerank_node") return `vectorMatches=${context.debug?.counts?.vectorMatches ?? 0}`;
  if (nodeId === "answer_generate_node") return context.usedModel ? "LLM streaming" : "deterministic/local";
  if (nodeId === "response_boundary_node") return "结构化响应只使用本轮 products；模型文本未做独立语义事实核验";
  return "";
}

export function buildAgentGraphTrace(context = {}) {
  return {
    style: "graph-style-agentic-rag",
    framework: "custom-lightweight",
    note: "当前实现借鉴 LangGraph 的节点化编排思想，但不依赖 LangGraph 运行时。",
    nodes: AGENT_GRAPH_NODES.map((node) => ({
      ...node,
      status: nodeStatus(node.id, context),
      summary: nodeSummary(node.id, context)
    })),
    edges: AGENT_GRAPH_EDGES.map(([from, to]) => ({ from, to }))
  };
}
