import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import type { AppConfig } from '@app/config/schema';
import type { DatabaseClient } from '@app/persistence/database';
import { runMigrations } from '@app/persistence/migrations/migrations';
import { PapersRepository } from '@app/persistence/papers.repository';
import type { VectorStore } from '@app/vector/ports/vector-store.port';

import { ChunkerService } from './chunker.service';
import type { ContextualPrefixService } from './contextual-prefix.service';
import type { IngestEmbedderService } from './embedder.service';
import { IngestionService } from './ingestion.service';

function makeConfig(docsDir: string): AppConfig {
  return {
    env: { NODE_ENV: 'test', PORT: 3000 },
    file: {
      log: { level: 'info' },
      server: { host: '0.0.0.0' },
      vector: { url: 'http://x', collection: 'c', denseSize: 3 },
      ingestion: {
        docsDir,
        chunkTargetChars: 2000,
        chunkOverlapChars: 200,
        prefixModel: 'm',
        prefixBaseUrl: 'http://localhost:11434/v1',
        embedModel: 'e',
        embedBatchSize: 100,
      },
    },
  };
}

function makeStore(): VectorStore {
  return {
    ensureCollection: jest.fn().mockResolvedValue(undefined),
    collectionExists: jest.fn().mockResolvedValue(true),
    deleteCollection: jest.fn().mockResolvedValue(undefined),
    upsert: jest.fn().mockResolvedValue(undefined),
    queryDense: jest.fn().mockResolvedValue([]),
    querySparse: jest.fn().mockResolvedValue([]),
  };
}

function makeDb(): DatabaseClient {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function makePrefixer(summary = 'doc-summary'): ContextualPrefixService {
  return {
    summarize: jest.fn().mockResolvedValue(summary),
  } as unknown as ContextualPrefixService;
}

function makeEmbedder(): IngestEmbedderService {
  return {
    embedChunks: jest
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => [0.1, 0.2, 0.3])),
      ),
  } as unknown as IngestEmbedderService;
}

describe('IngestionService', () => {
  let dir: string;
  let db: DatabaseClient;
  let papers: PapersRepository;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ingest-'));
    db = makeDb();
    papers = new PapersRepository(db);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('uses sidecar metadata: registers paper + stamps paperId and denormalized fields on every chunk', async () => {
    await writeFile(
      join(dir, 'reflexion.md'),
      '# Methods\n\n## Training\n\nTraining body here.',
    );
    await writeFile(
      join(dir, 'reflexion.meta.json'),
      JSON.stringify({
        arxivId: '2303.11366',
        title: 'Reflexion',
        authors: ['Shinn', 'Labash'],
        year: 2023,
        url: 'https://arxiv.org/abs/2303.11366',
      }),
    );

    const store = makeStore();
    const svc = new IngestionService(
      makeConfig(dir),
      new ChunkerService(),
      makePrefixer(),
      makeEmbedder(),
      papers,
      store,
    );
    const res = await svc.run();

    expect(res).toEqual({ docs: 1, chunks: 1 });

    const [paper] = papers.list();
    expect(paper.arxivId).toBe('2303.11366');
    expect(paper.title).toBe('Reflexion');
    expect(paper.authors).toEqual(['Shinn', 'Labash']);

    const points = (store.upsert as jest.Mock).mock.calls[0]![1] as Array<{
      id: string | number;
      metadata: Record<string, unknown>;
    }>;
    expect(points[0].metadata['paperId']).toBe(paper.id);
    expect(points[0].metadata['arxivId']).toBe('2303.11366');
    expect(points[0].metadata['authors']).toEqual(['Shinn', 'Labash']);
    expect(points[0].metadata['year']).toBe(2023);
    expect(points[0].metadata['sectionPath']).toBe('Methods > Training');
    expect(points[0].metadata['contextualPrefix']).toBe('doc-summary');
  });

  it('falls back to filename title when no .meta.json sidecar is present', async () => {
    await writeFile(join(dir, 'local-note.md'), 'Some text.');

    const store = makeStore();
    const svc = new IngestionService(
      makeConfig(dir),
      new ChunkerService(),
      makePrefixer(),
      makeEmbedder(),
      papers,
      store,
    );
    await svc.run();

    const [paper] = papers.list();
    expect(paper.title).toBe('local-note');
    expect(paper.arxivId).toBeUndefined();

    const points = (store.upsert as jest.Mock).mock.calls[0]![1] as Array<{
      metadata: Record<string, unknown>;
    }>;
    expect(points[0].metadata['paperId']).toBe(paper.id);
    expect(points[0].metadata['arxivId']).toBeUndefined();
    expect(points[0].metadata['authors']).toBeUndefined();
  });

  it('skips empty files — no papers row, no upsert', async () => {
    await writeFile(join(dir, 'empty.txt'), '   \n\n  ');

    const store = makeStore();
    const svc = new IngestionService(
      makeConfig(dir),
      new ChunkerService(),
      makePrefixer(),
      makeEmbedder(),
      papers,
      store,
    );
    const res = await svc.run();

    expect(res).toEqual({ docs: 0, chunks: 0 });
    expect(store.upsert).not.toHaveBeenCalled();
    expect(papers.list()).toEqual([]);
  });
});
