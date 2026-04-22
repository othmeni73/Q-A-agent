import BetterSqlite3 from 'better-sqlite3';

import { type DatabaseClient } from '@app/persistence/database';
import { MessagesRepository } from '@app/persistence/messages.repository';
import { runMigrations } from '@app/persistence/migrations/migrations';
import { SessionsRepository } from '@app/persistence/sessions.repository';

import { DEFAULT_WINDOW, SessionService } from './session.service';

function setup(): {
  db: DatabaseClient;
  sessions: SessionsRepository;
  messages: MessagesRepository;
  service: SessionService;
} {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const sessions = new SessionsRepository(db);
  const messages = new MessagesRepository(db);
  const service = new SessionService(db, sessions, messages);
  return { db, sessions, messages, service };
}

describe('SessionService', () => {
  describe('appendTurn', () => {
    it('creates a new session when sessionId is undefined', () => {
      const { service, sessions } = setup();
      const session = service.appendTurn(
        undefined,
        'What is Reflexion?',
        'It is a technique.',
      );
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(sessions.findById(session.id)).toBeDefined();
    });

    it('reuses an existing session when sessionId is known', () => {
      const { service } = setup();
      const first = service.appendTurn(undefined, 'Q1', 'A1');
      const second = service.appendTurn(first.id, 'Q2', 'A2');
      expect(second.id).toBe(first.id);
    });

    it('mints a fresh session when sessionId is unknown (lenient)', () => {
      const { service } = setup();
      const session = service.appendTurn('does-not-exist', 'hello', 'hi');
      expect(session.id).not.toBe('does-not-exist');
    });

    it('derives the title from the first user message on new sessions', () => {
      const { service, sessions } = setup();
      const session = service.appendTurn(
        undefined,
        'What is Reflexion?',
        'It is a technique.',
      );
      expect(sessions.findById(session.id)?.title).toBe('What is Reflexion?');
    });

    it('does NOT re-title on subsequent turns', () => {
      const { service, sessions } = setup();
      const first = service.appendTurn(
        undefined,
        'First question',
        'First answer',
      );
      service.appendTurn(
        first.id,
        'Second question with different text',
        'Second answer',
      );
      expect(sessions.findById(first.id)?.title).toBe('First question');
    });

    it('truncates long titles at a word boundary with an ellipsis', () => {
      const { service, sessions } = setup();
      const long =
        'This is a very long opening question that exceeds the eighty character limit imposed on session titles and therefore should be truncated';
      const session = service.appendTurn(undefined, long, 'ok');
      const title = sessions.findById(session.id)?.title ?? '';
      expect(title.length).toBeLessThanOrEqual(81); // 80 + ellipsis
      expect(title.endsWith('…')).toBe(true);
      expect(title).not.toMatch(/ $/); // trailing word boundary, not mid-word
    });

    it('stores citations on the assistant message only', () => {
      const { service, messages } = setup();
      const cites = [{ sourceTitle: 'Reflexion', chunkIndex: 7 }];
      const session = service.appendTurn(undefined, 'Q', 'A', cites);
      const history = messages.listForSession(session.id, 10);
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].citations).toBeUndefined();
      expect(history[1].role).toBe('assistant');
      expect(history[1].citations).toEqual(cites);
    });

    it('bumps updatedAt on each turn', async () => {
      const { service, sessions } = setup();
      const first = service.appendTurn(undefined, 'Q1', 'A1');
      const firstUpdatedAt = sessions.findById(first.id)!.updatedAt;
      // Ensure clock advances (Date.now has ms granularity).
      await new Promise((r) => setTimeout(r, 5));
      service.appendTurn(first.id, 'Q2', 'A2');
      const secondUpdatedAt = sessions.findById(first.id)!.updatedAt;
      expect(secondUpdatedAt).toBeGreaterThan(firstUpdatedAt);
    });
  });

  describe('recentMessages', () => {
    it('returns messages in chronological (oldest-first) order', () => {
      const { service } = setup();
      const session = service.appendTurn(undefined, 'Q1', 'A1');
      service.appendTurn(session.id, 'Q2', 'A2');
      const hist = service.recentMessages(session.id);
      expect(hist.map((m) => m.content)).toEqual(['Q1', 'A1', 'Q2', 'A2']);
    });

    it('respects the default window of 10', () => {
      const { service } = setup();
      const session = service.appendTurn(undefined, 'Q1', 'A1');
      // Five more turns → 12 total messages (6 turns × 2).
      for (let i = 2; i <= 6; i++) {
        service.appendTurn(session.id, `Q${i}`, `A${i}`);
      }
      const hist = service.recentMessages(session.id);
      expect(hist).toHaveLength(DEFAULT_WINDOW);
      // 10 most recent → drops Q1 + A1, keeps Q2…A6.
      expect(hist[0].content).toBe('Q2');
      expect(hist[hist.length - 1].content).toBe('A6');
    });

    it('honours a custom limit', () => {
      const { service } = setup();
      const session = service.appendTurn(undefined, 'Q1', 'A1');
      service.appendTurn(session.id, 'Q2', 'A2');
      const hist = service.recentMessages(session.id, 2);
      expect(hist).toHaveLength(2);
      expect(hist.map((m) => m.content)).toEqual(['Q2', 'A2']);
    });

    it('isolates messages between sessions', () => {
      const { service } = setup();
      const a = service.appendTurn(undefined, 'A-Q1', 'A-A1');
      const b = service.appendTurn(undefined, 'B-Q1', 'B-A1');
      expect(
        service.recentMessages(a.id).every((m) => m.sessionId === a.id),
      ).toBe(true);
      expect(
        service.recentMessages(b.id).every((m) => m.sessionId === b.id),
      ).toBe(true);
    });

    it('returns [] for an unknown sessionId', () => {
      const { service } = setup();
      expect(service.recentMessages('not-a-real-id')).toEqual([]);
    });
  });
});
