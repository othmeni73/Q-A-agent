import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChatService, ChatTurnHandle } from '@app/chat/chat.service';
import type { AppConfig } from '@app/config/schema';
import type { RetrievalHit } from '@app/retrieval/types';

import type { CitationCheckService } from './citation-check.service';
import { EvaluationService } from './evaluation.service';
import type { JudgeService } from './judge.service';

function cfg(overrides: Partial<AppConfig['file']['eval']> = {}): AppConfig {
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
      eval: {
        casesPath: './eval/cases.json',
        resultsPath: './eval/results.json',
        baselinePath: './eval/baseline.json',
        concurrency: 2,
        judgeModel: 'gemma2:27b',
        judgeBaseUrl: 'http://localhost:11434/v1',
        retrievalK: 5,
        successThresholds: { relevance: 4, groundedness: 4 },
        failureThreshold: 2,
        ...overrides,
      },
    },
  };
}

function hit(arxivId: string): RetrievalHit {
  return {
    id: `chunk-${arxivId}`,
    score: 1,
    metadata: {
      sourceTitle: `paper-${arxivId}`,
      sourceType: 'paper',
      chunkIndex: 0,
      text: `chunk about ${arxivId}`,
      arxivId,
    },
  };
}

function mockChat(
  answer: string,
  hits: RetrievalHit[],
  citations: { arxivId?: string; sourceTitle: string; n: number }[] = [],
): ChatService {
  return {
    startTurn: jest.fn().mockImplementation(() => {
      const handle: ChatTurnHandle = {
        sessionId: 'sess-1',
        hits,
        result: {
          textStream: (async function* () {
            await Promise.resolve();
            yield answer;
          })(),
          done: Promise.resolve({
            text: answer,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            latencyMs: 100,
            ttftMs: 50,
            finishReason: 'stop',
          }),
        },
        complete: jest.fn().mockResolvedValue({
          citations: citations.map((c) => ({
            n: c.n,
            sourceTitle: c.sourceTitle,
            chunkIndex: 0,
            arxivId: c.arxivId,
          })),
        }),
      };
      return Promise.resolve(handle);
    }),
  } as unknown as ChatService;
}

function mockJudge(scores: {
  relevance?: number;
  groundedness?: number;
  faithfulness?: number;
  completeness?: number;
}): JudgeService {
  return {
    relevance: jest.fn().mockResolvedValue({
      score: scores.relevance ?? 5,
      reasoning: '',
    }),
    groundedness: jest.fn().mockResolvedValue({
      score: scores.groundedness ?? 5,
      reasoning: '',
    }),
    faithfulness: jest.fn().mockResolvedValue({
      score: scores.faithfulness ?? 5,
      reasoning: '',
    }),
    completeness: jest.fn().mockResolvedValue({
      score: scores.completeness ?? 5,
      reasoning: '',
    }),
    pairwiseRelevance: jest.fn(),
  } as unknown as JudgeService;
}

function mockCitationCheck(accuracy = true): CitationCheckService {
  return {
    evaluate: jest.fn().mockImplementation(() => ({
      accuracy,
      citedArxivIds: [],
      retrievedArxivIds: [],
    })),
  };
}

function writeCasesFile(dir: string, cases: unknown): string {
  const path = join(dir, 'cases.json');
  writeFileSync(path, JSON.stringify({ cases }));
  return path;
}

describe('EvaluationService.run', () => {
  let tmp: string;
  let originalCwd: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'eval-spec-'));
    originalCwd = process.cwd();
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('runs every case through all three ablation lanes', async () => {
    const hits = [hit('2210.03629')];
    writeCasesFile(tmp, [
      {
        id: 'c1',
        category: 'factual',
        question: 'q1',
        expectedAnswer: 'expected',
        supportingArxivIds: ['2210.03629'],
      },
      {
        id: 'c2',
        category: 'factual',
        question: 'q2',
        expectedAnswer: 'expected',
        supportingArxivIds: ['2210.03629'],
      },
    ]);
    writeFileSync(join(tmp, 'eval-cases-dir-hack'), 'placeholder');
    // cases.json is at ./cases.json relative to tmp; config.casesPath points at ./eval/cases.json.
    // Write the expected relative path instead:
    const evalDir = join(tmp, 'eval');
    mkdirSync(evalDir, { recursive: true });
    writeCasesFile(evalDir, [
      {
        id: 'c1',
        category: 'factual',
        question: 'q1',
        expectedAnswer: 'expected',
        supportingArxivIds: ['2210.03629'],
      },
      {
        id: 'c2',
        category: 'factual',
        question: 'q2',
        expectedAnswer: 'expected',
        supportingArxivIds: ['2210.03629'],
      },
    ]);

    const chat = mockChat('answer [1]', hits, [
      { arxivId: '2210.03629', sourceTitle: 'paper-2210.03629', n: 1 },
    ]);
    const svc = new EvaluationService(
      cfg(),
      chat,
      mockJudge({
        relevance: 5,
        groundedness: 5,
        faithfulness: 5,
        completeness: 5,
      }),
      mockCitationCheck(true),
    );

    const out = await svc.run();
    expect(out.lanes.baseline).toHaveLength(2);
    expect(out.lanes['+rerank']).toHaveLength(2);
    expect(out.lanes['+full']).toHaveLength(2);
    // 3 lanes × 2 cases = 6 startTurn calls.
    expect((chat.startTurn as jest.Mock).mock.calls).toHaveLength(6);
  });

  it('sets refusedCorrectly on must-refuse cases', async () => {
    const evalDir = join(tmp, 'eval');
    mkdirSync(evalDir, { recursive: true });
    writeCasesFile(evalDir, [
      {
        id: 'oos',
        category: 'out-of-scope',
        question: 'non-domain',
        mustRefuse: true,
      },
    ]);

    const chat = mockChat('I do not know.', []);
    const svc = new EvaluationService(
      cfg(),
      chat,
      mockJudge({}),
      mockCitationCheck(false),
    );
    const out = await svc.run();
    for (const lane of ['baseline', '+rerank', '+full'] as const) {
      const row = out.lanes[lane][0];
      expect(row.refusedCorrectly).toBe(true);
      expect(row.isRefusal).toBe(true);
      // Refusals skip groundedness/faithfulness.
      expect(row.judge.groundedness).toBeUndefined();
      expect(row.judge.faithfulness).toBeUndefined();
    }
  });

  it('computes per-lane aggregates (relevance mean, citationAccuracyPct, successRatePct)', async () => {
    const evalDir = join(tmp, 'eval');
    mkdirSync(evalDir, { recursive: true });
    writeCasesFile(evalDir, [
      {
        id: 'c1',
        category: 'factual',
        question: 'q',
        expectedAnswer: 'e',
        supportingArxivIds: ['2210.03629'],
      },
      {
        id: 'c2',
        category: 'factual',
        question: 'q',
        expectedAnswer: 'e',
        supportingArxivIds: ['2210.03629'],
      },
    ]);

    const chat = mockChat(
      'answer',
      [hit('2210.03629')],
      [{ arxivId: '2210.03629', sourceTitle: 'p', n: 1 }],
    );
    const svc = new EvaluationService(
      cfg(),
      chat,
      mockJudge({
        relevance: 5,
        groundedness: 5,
        faithfulness: 5,
        completeness: 5,
      }),
      mockCitationCheck(true),
    );

    const out = await svc.run();
    const baseline = out.aggregate.baseline;
    expect(baseline.relevance.mean).toBe(5);
    expect(baseline.relevance.n).toBe(2);
    expect(baseline.citationAccuracyPct).toBe(100);
    expect(baseline.successRatePct).toBe(100);
    expect(baseline.recallAtK).toBe(1);
    expect(baseline.mrr).toBe(1);
  });

  it('runId + startedAt + finishedAt are ISO-formatted strings', async () => {
    const evalDir = join(tmp, 'eval');
    mkdirSync(evalDir, { recursive: true });
    writeCasesFile(evalDir, [
      { id: 'c1', category: 'ambiguous', question: 'q' },
    ]);
    const chat = mockChat('a', []);
    const svc = new EvaluationService(
      cfg(),
      chat,
      mockJudge({}),
      mockCitationCheck(false),
    );
    const out = await svc.run();
    expect(out.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.runId).toContain('run-');
  });
});
