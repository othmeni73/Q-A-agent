import type { AppConfig } from '@app/config/schema';
import type { Embedder } from '@app/llm/ports/embedder.port';

import { IngestEmbedderService } from './embedder.service';

const baseConfig: AppConfig = {
  env: { NODE_ENV: 'test', PORT: 3000 },
  file: {
    log: { level: 'info' },
    server: { host: '0.0.0.0' },
  },
};

function makeEmbedder(): Embedder {
  return {
    embed: jest.fn().mockImplementation((opts: { values: string[] }) =>
      Promise.resolve({
        embeddings: opts.values.map((_v, i) => [i, i + 1, i + 2]),
        usage: { inputTokens: 1, totalTokens: 1 },
        latencyMs: 1,
      }),
    ),
  };
}

describe('IngestEmbedderService', () => {
  it('returns [] for empty input without calling the embedder', async () => {
    const embedder = makeEmbedder();
    const svc = new IngestEmbedderService(baseConfig, embedder);
    expect(await svc.embedChunks([])).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it('batches input, preserves order, and tags calls with role=ingest', async () => {
    const embedder = makeEmbedder();
    const config: AppConfig = {
      ...baseConfig,
      file: {
        ...baseConfig.file,
        ingestion: {
          docsDir: './docs',
          chunkTargetChars: 2000,
          chunkOverlapChars: 200,
          prefixModel: 'm',
          prefixBaseUrl: 'http://localhost:11434/v1',
          embedModel: 'text-embedding-004',
          embedBatchSize: 2,
        },
      },
    };
    const svc = new IngestEmbedderService(config, embedder);
    const out = await svc.embedChunks(['a', 'b', 'c', 'd', 'e']);

    expect(out).toHaveLength(5);
    expect(embedder.embed).toHaveBeenCalledTimes(3);
    expect(embedder.embed).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'ingest', values: ['a', 'b'] }),
    );
    expect(embedder.embed).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ values: ['e'] }),
    );
  });
});
