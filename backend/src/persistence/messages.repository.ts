/**
 * Per-session message log. Step 10's session memory reads the tail of this
 * via `listForSession(sessionId, limit)`; Step 11 appends both the user turn
 * and the assistant turn after streaming completes.
 *
 * `citations` is a JSON-encoded array (structure owned by the chat service)
 * or null when the message has no citations (user turns, failed responses).
 */

import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { DATABASE, type DatabaseClient } from './database';

export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  citations: unknown[] | undefined;
  createdAt: number;
}

export interface NewMessage {
  sessionId: string;
  role: MessageRole;
  content: string;
  citations?: unknown[];
}

interface MessageRow {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  citations: string | null;
  createdAt: number;
}

@Injectable()
export class MessagesRepository {
  private readonly insertStmt;
  private readonly listForSessionStmt;

  constructor(@Inject(DATABASE) db: DatabaseClient) {
    this.insertStmt = db.prepare<
      [string, string, MessageRole, string, string | null, number]
    >(
      `INSERT INTO messages (id, sessionId, role, content, citations, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // Pull the most recent `limit` messages, then flip to chronological order
    // so the caller gets [oldest, …, newest] — matches how LLM histories are
    // assembled. Secondary sort on `rowid` breaks ties when user+assistant
    // inserts within one transaction land on the same Date.now() ms.
    this.listForSessionStmt = db.prepare<[string, number]>(
      `SELECT id, sessionId, role, content, citations, createdAt FROM (
         SELECT *, rowid AS _rid FROM messages
         WHERE sessionId = ?
         ORDER BY createdAt DESC, _rid DESC
         LIMIT ?
       )
       ORDER BY createdAt ASC, _rid ASC`,
    );
  }

  append(input: NewMessage): Message {
    const id = randomUUID();
    const now = Date.now();
    this.insertStmt.run(
      id,
      input.sessionId,
      input.role,
      input.content,
      input.citations ? JSON.stringify(input.citations) : null,
      now,
    );
    return {
      id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      citations: input.citations,
      createdAt: now,
    };
  }

  listForSession(sessionId: string, limit: number): Message[] {
    const rows = this.listForSessionStmt.all(sessionId, limit) as MessageRow[];
    return rows.map(rowToMessage);
  }
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    citations: row.citations
      ? (JSON.parse(row.citations) as unknown[])
      : undefined,
    createdAt: row.createdAt,
  };
}
