import BetterSqlite3 from 'better-sqlite3';

import { type DatabaseClient } from './database';
import { runMigrations } from './migrations/migrations';
import { PapersRepository } from './papers.repository';

function makeDb(): DatabaseClient {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('PapersRepository', () => {
  let db: DatabaseClient;
  let repo: PapersRepository;

  beforeEach(() => {
    db = makeDb();
    repo = new PapersRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upsertByArxivId → findById round-trips all fields', () => {
    const paper = repo.upsertByArxivId({
      arxivId: '2303.11366',
      title: 'Reflexion: Language Agents with Verbal Reinforcement Learning',
      authors: ['Shinn', 'Labash', 'Gopinath'],
      year: 2023,
      abstract: 'We propose Reflexion...',
      url: 'https://arxiv.org/abs/2303.11366',
    });

    const found = repo.findById(paper.id);
    expect(found).toBeDefined();
    expect(found!.arxivId).toBe('2303.11366');
    expect(found!.title).toContain('Reflexion');
    expect(found!.authors).toEqual(['Shinn', 'Labash', 'Gopinath']);
    expect(found!.year).toBe(2023);
    expect(found!.url).toBe('https://arxiv.org/abs/2303.11366');
  });

  it('re-upsert on the same arxivId updates fields and keeps the id stable', () => {
    const first = repo.upsertByArxivId({
      arxivId: '2303.11366',
      title: 'Old title',
      authors: ['A'],
      year: 2023,
    });
    const second = repo.upsertByArxivId({
      arxivId: '2303.11366',
      title: 'New title',
      authors: ['A', 'B'],
      year: 2024,
    });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe('New title');
    expect(second.authors).toEqual(['A', 'B']);
    expect(second.year).toBe(2024);

    expect(repo.list()).toHaveLength(1);
  });

  it('list orders papers by ingestedAt descending', async () => {
    const a = repo.upsertByArxivId({ arxivId: 'a', title: 'Alpha' });
    await new Promise((r) => setTimeout(r, 2));
    const b = repo.upsertByArxivId({ arxivId: 'b', title: 'Beta' });

    const list = repo.list();
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it('supports papers with no arxivId — each insert is a distinct row', () => {
    const one = repo.upsertByArxivId({ title: 'Local note 1' });
    const two = repo.upsertByArxivId({ title: 'Local note 2' });
    expect(one.id).not.toBe(two.id);
    expect(one.arxivId).toBeUndefined();
    expect(two.arxivId).toBeUndefined();
    expect(repo.list()).toHaveLength(2);
  });
});
