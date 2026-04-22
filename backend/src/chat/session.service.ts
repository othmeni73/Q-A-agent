/**
 * Session memory for the chat flow.
 *
 * Thin facade over SessionsRepository + MessagesRepository from Step 5.
 * Exposes the two operations the chat route (Step 11) and the eval harness
 * (Step 13) need:
 *
 *   - recentMessages(id, limit=10)  — sliding window, chronological order.
 *   - appendTurn(id?, user, asst[, citations])  — transactional write of
 *                                                 both messages + first-
 *                                                 turn title + updatedAt
 *                                                 bump. Returns the
 *                                                 resolved Session so the
 *                                                 HTTP response can echo
 *                                                 the id on new sessions.
 *
 * Stateless; restart-persistence falls out of the repositories writing to
 * SQLite.
 */

import { Inject, Injectable } from '@nestjs/common';

import { DATABASE, type DatabaseClient } from '@app/persistence/database';
import {
  MessagesRepository,
  type Message,
} from '@app/persistence/messages.repository';
import {
  SessionsRepository,
  type Session,
} from '@app/persistence/sessions.repository';

export const DEFAULT_WINDOW = 10;
const TITLE_MAX_CHARS = 80;

@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(SessionsRepository) private readonly sessions: SessionsRepository,
    @Inject(MessagesRepository) private readonly messages: MessagesRepository,
  ) {}

  /** Most recent `limit` messages in chronological (oldest-first) order. */
  recentMessages(sessionId: string, limit: number = DEFAULT_WINDOW): Message[] {
    return this.messages.listForSession(sessionId, limit);
  }

  /**
   * Persist a completed user+assistant turn. Call only AFTER the assistant
   * stream finishes successfully — mid-stream failure must leave the session
   * in its prior state (no partial assistant message).
   *
   * If `sessionId` is missing or unknown, a new session is minted with a
   * server-assigned UUID and a title derived from the first 80 chars of the
   * user message (truncated at a word boundary). Returns the resolved
   * `Session` so the HTTP layer can echo its id.
   *
   * All three writes (user insert, assistant insert, touch) run inside a
   * single better-sqlite3 transaction — half-failures roll back rather than
   * leaving an orphan user message.
   */
  appendTurn(
    sessionId: string | undefined,
    userContent: string,
    assistantContent: string,
    citations?: unknown[],
  ): Session {
    const run = this.db.transaction((): Session => {
      const existing = sessionId
        ? this.sessions.findById(sessionId)
        : undefined;
      const session =
        existing ?? this.sessions.create({ title: deriveTitle(userContent) });

      this.messages.append({
        sessionId: session.id,
        role: 'user',
        content: userContent,
      });
      this.messages.append({
        sessionId: session.id,
        role: 'assistant',
        content: assistantContent,
        citations,
      });
      this.sessions.touch(session.id);
      return session;
    });
    return run();
  }
}

/**
 * First-turn title: trim, cap at TITLE_MAX_CHARS, prefer a word boundary in
 * the last half of the window. Returns `undefined` for blank input so the
 * caller falls back to a null title column rather than storing whitespace.
 */
function deriveTitle(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= TITLE_MAX_CHARS) return trimmed;
  const cut = trimmed.slice(0, TITLE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  const head = lastSpace > TITLE_MAX_CHARS / 2 ? cut.slice(0, lastSpace) : cut;
  return `${head}…`;
}
