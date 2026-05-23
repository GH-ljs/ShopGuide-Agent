// 文件职责：
// 用内存保存多轮会话上下文，支持“再便宜点”“不要这个”等追问。

const MAX_TURNS = 6;
const sessions = new Map();

function createEmptySession(conversationId) {
  return {
    conversationId,
    turns: [],
    lastProducts: []
  };
}

export function getSession(conversationId) {
  const id = conversationId || "default";
  if (!sessions.has(id)) sessions.set(id, createEmptySession(id));
  return sessions.get(id);
}

export function buildRetrievalQuery(session, message) {
  const recentUserMessages = session.turns
    .filter((turn) => turn.role === "user")
    .slice(-3)
    .map((turn) => turn.content);

  const previousProducts = session.lastProducts
    .slice(0, 4)
    .map((product) => `${product.title} ${product.category} ${product.subCategory} ${product.basePrice}元`);

  // 检索 query 合并最近需求和上一轮商品摘要，让省略式追问能继承上下文。
  return [...recentUserMessages, ...previousProducts, message].filter(Boolean).join(" ");
}

export function getRecentTurns(session) {
  return session.turns.slice(-MAX_TURNS);
}

export function appendTurn(session, role, content) {
  session.turns.push({
    role,
    content,
    createdAt: new Date().toISOString()
  });

  if (session.turns.length > MAX_TURNS * 2) {
    session.turns = session.turns.slice(-MAX_TURNS * 2);
  }
}

export function rememberProducts(session, products) {
  session.lastProducts = products;
}
