import BetterSqlite3 from 'better-sqlite3';

import { type DatabaseClient } from './database';
import { runMigrations } from './migrations/migrations';
import { SessionsRepository } from './sessions.repository';

function makeDb(): DatabaseClient {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('SessionsRepository', () => {
  let db: DatabaseClient;
  let repo: SessionsRepository;

  beforeEach(() => {
    db = makeDb();
    repo = new SessionsRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('create → findById round-trips', () => {
    const s = repo.create({ title: 'First chat' });
    const found = repo.findById(s.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('First chat');
    expect(found!.createdAt).toBe(s.createdAt);
    expect(found!.updatedAt).toBe(s.updatedAt);
  });

  it('touch advances updatedAt without changing createdAt', async () => {
    const s = repo.create();
    await new Promise((r) => setTimeout(r, 2));
    repo.touch(s.id);
    const after = repo.findById(s.id)!;
    expect(after.updatedAt).toBeGreaterThan(s.updatedAt);
    expect(after.createdAt).toBe(s.createdAt);
  });

  it('list orders by updatedAt descending (most recent first)', async () => {
    const a = repo.create({ title: 'A' });
    await new Promise((r) => setTimeout(r, 2));
    const b = repo.create({ title: 'B' });
    await new Promise((r) => setTimeout(r, 2));
    repo.touch(a.id);

    const list = repo.list();
    expect(list.map((s) => s.id)).toEqual([a.id, b.id]);
  });
});
