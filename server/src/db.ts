import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.DB_PATH ?? "./data.sqlite";

export const db = new DatabaseSync(DB_PATH);

// Schema per the prototype spec §5 — minimal, because v0 has exactly one user.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    ma_session_id TEXT,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id),
    tool_name TEXT NOT NULL,
    mcp_server TEXT NOT NULL,
    input_json TEXT NOT NULL,
    evaluated_permission TEXT NOT NULL,
    user_decision TEXT,
    result_summary TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vault_refs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    vault_id TEXT,
    swiggy_credential_id TEXT
  );
`);

/**
 * node:sqlite's prepared-statement handles don't accept `undefined` bind
 * parameters (unlike better-sqlite3) — pass `null` explicitly where a value
 * may be absent. `.get()` / `.all()` / `.run()` otherwise match the shape
 * used throughout the routes.
 */
