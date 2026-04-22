/**
 * Conversation sessions. Each row is one chat thread; messages join via
 * `messages.sessionId`. `title` is derived from the first user message in
 * Step 11 — created null, set later.
 *
 * Underlying table is `chat_sessions` (renamed from `sessions` for SQL:2008 /
 * Postgres portability — SESSION is a reserved word there). The domain name
 * "session" still flows through the API surface (Session type, sessionId
 * column on messages, /chat route's sessionId param).
 */

import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { DATABASE, type DatabaseClient } from './database';

export interface Session {
  id: string;
  title: string | undefined;
  createdAt: number;
  updatedAt: number;
}

interface SessionRow {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

@Injectable()
export class SessionsRepository {
  private readonly insertStmt;
  private readonly findByIdStmt;
  private readonly touchStmt;
  private readonly listStmt;

  constructor(@Inject(DATABASE) db: DatabaseClient) {
    this.insertStmt = db.prepare<[string, string | null, number, number]>(
      'INSERT INTO chat_sessions (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)',
    );
    this.findByIdStmt = db.prepare<[string]>(
      'SELECT * FROM chat_sessions WHERE id = ?',
    );
    this.touchStmt = db.prepare<[number, string]>(
      'UPDATE chat_sessions SET updatedAt = ? WHERE id = ?',
    );
    this.listStmt = db.prepare<[number, number]>(
      'SELECT * FROM chat_sessions ORDER BY updatedAt DESC LIMIT ? OFFSET ?',
    );
  }

  create(input: { title?: string } = {}): Session {
    const id = randomUUID();
    const now = Date.now();
    this.insertStmt.run(id, input.title ?? null, now, now);
    return {
      id,
      title: input.title,
      createdAt: now,
      updatedAt: now,
    };
  }

  findById(id: string): Session | undefined {
    const row = this.findByIdStmt.get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  touch(id: string): void {
    this.touchStmt.run(Date.now(), id);
  }

  list(opts: { limit?: number; offset?: number } = {}): Session[] {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const rows = this.listStmt.all(limit, offset) as SessionRow[];
    return rows.map(rowToSession);
  }
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
