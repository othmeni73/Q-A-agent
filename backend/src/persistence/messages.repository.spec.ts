import BetterSqlite3 from 'better-sqlite3';

import { type DatabaseClient } from './database';
import { MessagesRepository } from './messages.repository';
import { runMigrations } from './migrations/migrations';
import { SessionsRepository } from './sessions.repository';

function makeDb(): DatabaseClient {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('MessagesRepository', () => {
  let db: DatabaseClient;
  let sessions: SessionsRepository;
  let messages: MessagesRepository;
  let sessionId: string;

  beforeEach(() => {
    db = makeDb();
    sessions = new SessionsRepository(db);
    messages = new MessagesRepository(db);
    sessionId = sessions.create().id;
  });

  afterEach(() => {
    db.close();
  });

  it('append then listForSession returns messages in chronological order', async () => {
    messages.append({ sessionId, role: 'user', content: 'hello' });
    await new Promise((r) => setTimeout(r, 2));
    messages.append({ sessionId, role: 'assistant', content: 'hi there' });

    const list = messages.listForSession(sessionId, 10);
    expect(list.map((m) => m.content)).toEqual(['hello', 'hi there']);
    expect(list[0].role).toBe('user');
    expect(list[1].role).toBe('assistant');
  });

  it('listForSession with limit N returns the N most recent, chronologically', async () => {
    for (let i = 0; i < 5; i++) {
      messages.append({
        sessionId,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `msg-${i}`,
      });
      await new Promise((r) => setTimeout(r, 1));
    }
    const recent = messages.listForSession(sessionId, 3);
    expect(recent.map((m) => m.content)).toEqual(['msg-2', 'msg-3', 'msg-4']);
  });

  it('messages are isolated between sessions', () => {
    const otherId = sessions.create().id;
    messages.append({ sessionId, role: 'user', content: 'A1' });
    messages.append({ sessionId: otherId, role: 'user', content: 'B1' });

    expect(
      messages.listForSession(sessionId, 10).map((m) => m.content),
    ).toEqual(['A1']);
    expect(messages.listForSession(otherId, 10).map((m) => m.content)).toEqual([
      'B1',
    ]);
  });
});
