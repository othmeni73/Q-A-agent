import type { AppConfig } from '@app/config/schema';
import type { LlmClient } from '@app/llm/ports/llm-client.port';
import type { PromptLoaderService } from '@app/prompts/prompt-loader.service';
import type { RetrievalHit } from '@app/retrieval/types';

import type { CitationPick } from './citations.schema';
import { CitationsService } from './citations.service';

function baseConfig(): AppConfig {
  return {
    env: { NODE_ENV: 'test', PORT: 3000 },
    file: {
      log: { level: 'info' },
      server: { host: '0.0.0.0' },
      chat: {
        model: 'mock/model',
        temperature: 0.2,
        maxOutputTokens: 1024,
        refusalString: 'I do not know.',
        userName: 'tester',
      },
    },
  };
}

function mkHit(
  id: string,
  overrides: Partial<RetrievalHit['metadata']> = {},
): RetrievalHit {
  return {
    id,
    score: 1,
    metadata: {
      sourceTitle: `paper-${id}`,
      sourceType: 'paper',
      chunkIndex: 0,
      text: `chunk-${id}`,
      arxivId: `200${id}.00000`,
      year: 2023,
      paperId: `pid-${id}`,
      ...overrides,
    },
  };
}

function mockPrompts(): PromptLoaderService {
  return {
    get: jest
      .fn()
      .mockImplementation(
        (_name: string, vars: Record<string, string>) =>
          `PROMPT[${vars['chunkCount']}]`,
      ),
    list: jest.fn().mockReturnValue(['citation-picker']),
  } as unknown as PromptLoaderService;
}

function mockLlm(
  picks: CitationPick | Error | (CitationPick | Error)[],
): LlmClient {
  const queue: (CitationPick | Error)[] = Array.isArray(picks)
    ? picks
    : [picks];
  const generateObject = jest.fn().mockImplementation(() => {
    const next = queue.shift() ?? queue[0];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      object: next,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 1,
    });
  });
  return {
    generateText: jest.fn(),
    generateObject,
    stream: jest.fn(),
  };
}

describe('CitationsService.pick', () => {
  it('returns [] when hits is empty', async () => {
    const svc = new CitationsService(
      baseConfig(),
      mockPrompts(),
      mockLlm({ used: [] }),
    );
    expect(await svc.pick('any answer', [])).toEqual([]);
  });

  it('returns [] when answer is empty/whitespace', async () => {
    const svc = new CitationsService(
      baseConfig(),
      mockPrompts(),
      mockLlm({ used: [1] }),
    );
    expect(await svc.pick('  \n  ', [mkHit('a')])).toEqual([]);
  });

  it('enriches LLM-picked indices with metadata from the corresponding hit', async () => {
    const hits = [mkHit('a'), mkHit('b'), mkHit('c')];
    const svc = new CitationsService(
      baseConfig(),
      mockPrompts(),
      mockLlm({ used: [1, 3] }),
    );
    const out = await svc.pick('uses [1] and [3]', hits);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      n: 1,
      sourceTitle: 'paper-a',
      arxivId: '200a.00000',
      paperId: 'pid-a',
    });
    expect(out[1]).toMatchObject({ n: 3, sourceTitle: 'paper-c' });
  });

  it('retries generateObject once on failure then succeeds', async () => {
    const llm = mockLlm([new Error('schema violation'), { used: [2] }]);
    const svc = new CitationsService(baseConfig(), mockPrompts(), llm);
    const out = await svc.pick('uses [2]', [mkHit('a'), mkHit('b')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.n).toBe(2);
    expect(llm.generateObject).toHaveBeenCalledTimes(2);
  });

  it('falls back to regex when both LLM attempts fail', async () => {
    const err = new Error('malformed');
    const svc = new CitationsService(
      baseConfig(),
      mockPrompts(),
      mockLlm([err, err]),
    );
    const out = await svc.pick('cites [1] and later [3]', [
      mkHit('a'),
      mkHit('b'),
      mkHit('c'),
    ]);
    expect(out.map((c) => c.n)).toEqual([1, 3]);
  });

  it('drops out-of-range indices (e.g. [99] when only 3 hits)', async () => {
    const svc = new CitationsService(
      baseConfig(),
      mockPrompts(),
      mockLlm({ used: [1, 99, 2] }),
    );
    const out = await svc.pick('…', [mkHit('a'), mkHit('b'), mkHit('c')]);
    expect(out.map((c) => c.n)).toEqual([1, 2]);
  });

  it('deduplicates and sorts ascending', async () => {
    const svc = new CitationsService(
      baseConfig(),
      mockPrompts(),
      mockLlm({ used: [3, 1, 1, 3, 2] }),
    );
    const out = await svc.pick('…', [mkHit('a'), mkHit('b'), mkHit('c')]);
    expect(out.map((c) => c.n)).toEqual([1, 2, 3]);
  });

  it('regex fallback handles no-citation answers (refusal) → []', async () => {
    const err = new Error('boom');
    const svc = new CitationsService(
      baseConfig(),
      mockPrompts(),
      mockLlm([err, err]),
    );
    const out = await svc.pick("I don't have information on that.", [
      mkHit('a'),
    ]);
    expect(out).toEqual([]);
  });
});
