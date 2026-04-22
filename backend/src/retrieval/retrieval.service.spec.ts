import type { AppConfig } from '@app/config/schema';
import type { Embedder } from '@app/llm/ports/embedder.port';
import type { Reranker } from '@app/llm/ports/reranker.port';
import type {
  SearchHit,
  VectorStore,
} from '@app/vector/ports/vector-store.port';

import { RetrievalService } from './retrieval.service';

const baseConfig: AppConfig = {
  env: { NODE_ENV: 'test', PORT: 3000 },
  file: {
    log: { level: 'info' },
    server: { host: '0.0.0.0' },
    vector: { url: 'http://x', collection: 'c', denseSize: 3 },
    ingestion: {
      docsDir: './docs',
      chunkTargetChars: 2000,
      chunkOverlapChars: 200,
      prefixModel: 'p',
      prefixBaseUrl: 'http://localhost:11434/v1',
      embedModel: 'nomic-embed-text',
      embedBaseUrl: 'http://localhost:11434/v1',
      embedBatchSize: 100,
    },
  },
};

function mkHit(id: string, dense?: number[], text = id): SearchHit {
  return {
    id,
    score: 1,
    ...(dense ? { dense } : {}),
    metadata: {
      sourceTitle: id,
      sourceType: 'paper',
      chunkIndex: 0,
      text,
    },
  };
}

function mockEmbedder(vec: number[] = [1, 0, 0]): Embedder {
  return {
    embed: jest.fn().mockResolvedValue({
      embeddings: [vec],
      usage: { inputTokens: 1, totalTokens: 1 },
      latencyMs: 1,
    }),
  };
}

function mockReranker(scores?: number[]): Reranker {
  return {
    score: jest
      .fn()
      .mockImplementation((opts: { docs: string[] }) =>
        Promise.resolve(scores ?? opts.docs.map((_d, i) => 1 / (i + 1))),
      ),
  };
}

function mockStore(dense: SearchHit[], sparse: SearchHit[]): VectorStore {
  return {
    ensureCollection: jest.fn().mockResolvedValue(undefined),
    collectionExists: jest.fn().mockResolvedValue(true),
    deleteCollection: jest.fn().mockResolvedValue(undefined),
    upsert: jest.fn().mockResolvedValue(undefined),
    queryDense: jest.fn().mockResolvedValue(dense),
    querySparse: jest.fn().mockResolvedValue(sparse),
  };
}

describe('RetrievalService', () => {
  it('runs the full pipeline and returns k hits', async () => {
    const dense = [
      mkHit('d1', [1, 0, 0]),
      mkHit('d2', [0.9, 0.1, 0]),
      mkHit('d3', [0.1, 0.9, 0]),
    ];
    const sparse = [mkHit('d2'), mkHit('s1'), mkHit('s2')];
    const svc = new RetrievalService(
      baseConfig,
      mockEmbedder([1, 0, 0]),
      mockReranker(),
      mockStore(dense, sparse),
    );
    const hits = await svc.topK('what is reflexion', { k: 2 });
    expect(hits).toHaveLength(2);
    // d2 appears in both lists, should fuse high.
    expect(hits.some((h) => h.id === 'd2')).toBe(true);
  });

  it('honours rerank: false by skipping the reranker call', async () => {
    const reranker = mockReranker();
    const svc = new RetrievalService(
      baseConfig,
      mockEmbedder(),
      reranker,
      mockStore([mkHit('d1', [1, 0, 0])], [mkHit('s1', [0, 1, 0])]),
    );
    await svc.topK('q', { k: 2, rerank: false });
    expect(reranker.score).not.toHaveBeenCalled();
  });

  it('honours mmr: false (no dense-vector requirement on hits)', async () => {
    const svc = new RetrievalService(
      baseConfig,
      mockEmbedder(),
      mockReranker(),
      // Note: no `dense` on hits — would break MMR, fine with mmr:false.
      mockStore([mkHit('d1')], [mkHit('s1')]),
    );
    const hits = await svc.topK('q', { k: 2, mmr: false });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('returns [] when both hybrid lists are empty', async () => {
    const svc = new RetrievalService(
      baseConfig,
      mockEmbedder(),
      mockReranker(),
      mockStore([], []),
    );
    expect(await svc.topK('q')).toEqual([]);
  });
});
