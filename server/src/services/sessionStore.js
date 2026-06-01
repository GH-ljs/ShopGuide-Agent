// 文件职责：
// 持久化后端会话记忆。优先使用 Node 自带的 SQLite，把每个 deviceId + conversationId
// 对应的结构化 session 写入本地数据库；如果运行时不支持 node:sqlite，则降级为 JSON 文件。
// 这样后端重启后仍能恢复多轮上下文，同时不需要先引入完整登录系统。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeStorePath(rawPath) {
  return path.resolve(process.cwd(), rawPath || ".data/shopguide_sessions.db");
}

function loadSqliteModule() {
  try {
    return require("node:sqlite");
  } catch {
    return null;
  }
}

function serialize(session) {
  return JSON.stringify(session);
}

function deserialize(raw) {
  if (!raw) return null;
  return JSON.parse(raw);
}

function createSqliteSessionStore(dbPath) {
  const sqlite = loadSqliteModule();
  if (!sqlite?.DatabaseSync) return null;

  ensureParentDir(dbPath);
  const db = new sqlite.DatabaseSync(dbPath);
  // WAL + busy_timeout 降低并发读写时的锁冲突概率；上层仍会把持久化失败视为可降级事件。
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 1000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_sessions (
      device_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      session_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (device_id, conversation_id)
    )
  `);

  const selectSession = db.prepare(`
    SELECT session_json
    FROM conversation_sessions
    WHERE device_id = ? AND conversation_id = ?
  `);
  const upsertSession = db.prepare(`
    INSERT INTO conversation_sessions (device_id, conversation_id, session_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id, conversation_id) DO UPDATE SET
      session_json = excluded.session_json,
      updated_at = excluded.updated_at
  `);
  const deleteSession = db.prepare(`
    DELETE FROM conversation_sessions
    WHERE device_id = ? AND conversation_id = ?
  `);

  return {
    type: "sqlite",
    path: dbPath,
    load(deviceId, conversationId) {
      const row = selectSession.get(deviceId, conversationId);
      return deserialize(row?.session_json);
    },
    save(session) {
      // session_json 是后端可信的结构化记忆快照，不把自然语言回答当成事实来源；
      // 恢复后仍会用商品 ID 和 state 参与检索边界控制。
      upsertSession.run(
        session.deviceId,
        session.conversationId,
        serialize(session),
        new Date().toISOString()
      );
    },
    remove(deviceId, conversationId) {
      deleteSession.run(deviceId, conversationId);
    },
    clearAll() {
      db.exec("DELETE FROM conversation_sessions");
    },
    close() {
      db.close();
    }
  };
}

function createJsonSessionStore(filePath) {
  ensureParentDir(filePath);

  function readAll() {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8") || "{}");
  }

  function writeAll(payload) {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  return {
    type: "json",
    path: filePath,
    load(deviceId, conversationId) {
      return readAll()[`${deviceId}::${conversationId}`] || null;
    },
    save(session) {
      const all = readAll();
      all[`${session.deviceId}::${session.conversationId}`] = session;
      writeAll(all);
    },
    remove(deviceId, conversationId) {
      const all = readAll();
      delete all[`${deviceId}::${conversationId}`];
      writeAll(all);
    },
    clearAll() {
      writeAll({});
    },
    close() {
      // JSON 降级存储没有长连接，这里保留同名方法，方便测试和上层统一收尾。
    }
  };
}

export function createSessionStore(options = {}) {
  if (options.enabled === false) {
    return {
      type: "disabled",
      path: "",
      load: () => null,
      save: () => {},
      remove: () => {},
      clearAll: () => {},
      close: () => {}
    };
  }

  const dbPath = normalizeStorePath(options.path);
  const sqliteStore = createSqliteSessionStore(dbPath);
  if (sqliteStore) return sqliteStore;

  // 旧 Node 版本没有 node:sqlite 时仍保持功能可用。这个降级层只影响存储介质，
  // 上层 memory/http 的 deviceId 隔离和恢复逻辑完全一致。
  return createJsonSessionStore(dbPath.replace(/\.db$/i, ".json"));
}
