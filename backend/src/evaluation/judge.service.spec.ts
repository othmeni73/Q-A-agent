import type { AppConfig } from '@app/config/schema';
import type { LlmClient } from '@app/llm/ports/llm-client.port';
import type { PromptLoaderService } from '@app/prompts/prompt-loader.service';

import { JudgeService } from './judge.service';

function baseConfig(opts: { includeEval?: boolean } = {}): AppConfig {
  const { includeEval = true } = opts;
  return {
    env: { NODE_ENV: 'test', PORT: 3000 },
    file: {
      log: { level: 'info' },
      server: { host: '0.0.0.0' },
      eval: includeEval
        ? {
            casesPath: './eval/cases.json',
            resultsPath: './eval/results.json',
            baselinePath: './eval/baseline.json',
            concurrency: 2,
            judgeModel: 'gemma2:27b',
            judgeBaseUrl: 'http://localhost:11434/v1',
            retrievalK: 5,
            successThresholds: { relevance: 4, groundedness: 4 },
            failureThreshold: 2,
          }
        : undefined,
    },
  };
}

function mockPrompts(): PromptLoaderService {
  return {
    get: jest.fn().mockImplementation((name: string) => `PROMPT[${name}]`),
    list: jest.fn().mockReturnValue([]),
  } as unknown as PromptLoaderService;
}

function mockLlm(canned: {
  generateText?: (n: number) => string;
  generateObject?: (n: number) => { score: number; reasoning: string };
}): LlmClient {
  let textCalls = 0;
  let objCalls = 0;
  return {
    generateText: jest.fn().mockImplementation(() => {
      textCalls += 1;
      return Promise.resolve({
        text: canned.generateText?.(textCalls) ?? 'T',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        latencyMs: 1,
        finishReason: 'stop',
      });
    }),
    generateObject: jest.fn().mockImplementation(() => {
      objCalls += 1;
      return Promise.resolve({
        object: canned.generateObject?.(objCalls) ?? {
          score: 5,
          reasoning: 'ok',
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        latencyMs: 1,
      });
    }),
    stream: jest.fn(),
  };
}

describe('JudgeService.relevance', () => {
  it('returns {score, reasoning} against a reference answer', async () => {
    const svc = new JudgeService(
      baseConfig(),
      mockPrompts(),
      mockLlm({
        generateObject: () => ({ score: 4, reasoning: 'mostly matches' }),
      }),
    );
    const out = await svc.relevance('q?', 'expected', 'candidate');
    expect(out).toEqual({ score: 4, reasoning: 'mostly matches' });
  });
});

describe('JudgeService.groundedness', () => {
  it('returns {score 1-5, reasoning} given context', async () => {
    const svc = new JudgeService(
      baseConfig(),
      mockPrompts(),
      mockLlm({
        generateObject: () => ({
          score: 3,
          reasoning: 'one unsupported claim',
        }),
      }),
    );
    const out = await svc.groundedness('q?', 'ctx', 'ans');
    expect(out.score).toBe(3);
  });
});

describe('JudgeService.faithfulness', () => {
  it('returns {score 0-5, reasoning} given context', async () => {
    const svc = new JudgeService(
      baseConfig(),
      mockPrompts(),
      mockLlm({
        generateObject: () => ({ score: 5, reasoning: 'refusal' }),
      }),
    );
    const out = await svc.faithfulness('q?', 'ctx', 'ans');
    expect(out.score).toBe(5);
  });
});

describe('JudgeService.completeness', () => {
  it('returns {score 0-5, reasoning} against a reference answer', async () => {
    const svc = new JudgeService(
      baseConfig(),
      mockPrompts(),
      mockLlm({
        generateObject: () => ({ score: 2, reasoning: 'partial coverage' }),
      }),
    );
    const out = await svc.completeness('q?', 'expected', 'candidate');
    expect(out.score).toBe(2);
  });
});

describe('JudgeService.pairwiseRelevance', () => {
  it("returns 'A' when both orderings agree A is better", async () => {
    // forward (A-vs-B) → A; reverse (B-vs-A) → B (still A better).
    const seq = ['A', 'B'];
    const svc = new JudgeService(
      baseConfig(),
      mockPrompts(),
      mockLlm({ generateText: (n) => seq[n - 1] ?? 'T' }),
    );
    expect(await svc.pairwiseRelevance('q?', 'a', 'b')).toBe('A');
  });

  it("returns 'B' when both orderings agree B is better", async () => {
    const seq = ['B', 'A']; // forward: B better; reverse (swapped): A (which was originally B) better.
    const svc = new JudgeService(
      baseConfig(),
      mockPrompts(),
      mockLlm({ generateText: (n) => seq[n - 1] ?? 'T' }),
    );
    expect(await svc.pairwiseRelevance('q?', 'a', 'b')).toBe('B');
  });

  it("returns 'T' on disagreement between orderings (position bias)", async () => {
    const seq = ['A', 'A']; // forward + reverse both say "first is better" → position bias → tie.
    const svc = new JudgeService(
      baseConfig(),
      mockPrompts(),
      mockLlm({ generateText: (n) => seq[n - 1] ?? 'T' }),
    );
    expect(await svc.pairwiseRelevance('q?', 'a', 'b')).toBe('T');
  });

  it("returns 'T' on malformed judge output", async () => {
    const svc = new JudgeService(
      baseConfig(),
      mockPrompts(),
      mockLlm({ generateText: () => 'XYZ' }),
    );
    expect(await svc.pairwiseRelevance('q?', 'a', 'b')).toBe('T');
  });
});

describe('JudgeService config errors', () => {
  it('throws when eval.judgeModel is missing', async () => {
    const svc = new JudgeService(
      baseConfig({ includeEval: false }),
      mockPrompts(),
      mockLlm({}),
    );
    await expect(svc.relevance('q', 'e', 'c')).rejects.toThrow(/judgeModel/);
  });
});
