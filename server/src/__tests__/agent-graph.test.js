import { buildAgentGraphTrace } from "../agent/graph.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function node(trace, id) {
  return trace.nodes.find((item) => item.id === id);
}

function run() {
  const clarifyTrace = buildAgentGraphTrace({
    turnIntent: { type: "new_search", source: "llm" },
    retrievalScope: "clarify",
    clarify: { question: "你更想按哪个场景挑？" },
    debug: { counts: {} }
  });

  assert(node(clarifyTrace, "intent_node").status === "completed", "intent node should complete for clarify flow");
  assert(node(clarifyTrace, "clarification_node").status === "completed", "clarify node should complete when clarify exists");
  assert(node(clarifyTrace, "product_retrieval_node").status === "skipped", "retrieval node should skip for clarify-only flow");

  const retrievalTrace = buildAgentGraphTrace({
    turnIntent: { type: "new_search", source: "llm" },
    retrievalScope: "new_search",
    debug: {
      parsed: { category: "食品饮料", itemIntent: "饮料", preferences: ["无糖"] },
      counts: { filteredCandidates: 5, vectorMatches: 5, finalProducts: 4 }
    },
    usedModel: true
  });

  assert(node(retrievalTrace, "retrieval_planner_node").status === "completed", "retrieval planner should complete for search flow");
  assert(node(retrievalTrace, "product_retrieval_node").status === "completed", "retrieval node should complete for search flow");
  assert(node(retrievalTrace, "rerank_node").status === "completed", "rerank node should complete when vector matches exist");
  assert(node(retrievalTrace, "answer_generate_node").summary === "LLM streaming", "answer node should expose model path");

  console.log("Agent graph tests passed.");
}

run();
