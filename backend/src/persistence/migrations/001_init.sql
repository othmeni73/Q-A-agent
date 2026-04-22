-- Initial schema for Path B persistence layer.
-- Idempotent: CREATE TABLE IF NOT EXISTS so the runner is safe to re-apply.
-- Every table uses TEXT ids (UUID v4 from crypto.randomUUID()).
-- Timestamps are milliseconds-since-epoch stored as INTEGER.

CREATE TABLE IF NOT EXISTS papers (
  id          TEXT PRIMARY KEY,
  arxivId     TEXT UNIQUE,
  title       TEXT NOT NULL,
  authors     TEXT,                   -- JSON-encoded string[]
  year        INTEGER,
  abstract    TEXT,
  url         TEXT,
  ingestedAt  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_papers_ingestedAt
  ON papers (ingestedAt DESC);

-- `sessions` renamed to `chat_sessions` — SESSION is a reserved word in
-- SQL:2008 / Postgres (not in SQLite), prefix keeps us portable.
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  createdAt   INTEGER NOT NULL,
  updatedAt   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_updatedAt
  ON chat_sessions (updatedAt DESC);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  sessionId   TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  citations   TEXT,                   -- JSON-encoded citation array, nullable
  createdAt   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON messages (sessionId, createdAt);