/**
 * Orchestrates the Step-13 evaluation harness.
 *
 * For each test case, runs the question through three retrieval ablation
 * lanes (`baseline` / `+rerank` / `+full`) via the *same* `ChatService` the
 * HTTP route uses — no drift between prod and eval code paths. Collects
 * per-case signals (retrieval hits, citations, tokens, latency), then grades
 * answers with four pointwise LLM judges (relevance, groundedness,
 * faithfulness, completeness) + a programmatic citation-accuracy check.
 *
 * Emits a single `EvalRunResults` covering all lanes with per-case rows +
 * per-lane aggregates + stratified (per-category) breakdowns.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ChatService } from '@app/chat/chat.service';
import { APP_CONFIG, type AppConfig } from '@app/config/schema';
import type { RetrievalHit } from '@app/retrieval/types';

import { CitationCheckService } from './citation-check.service';
import { JudgeService } from './judge.service';
import {
  EvalCasesFileSchema,
  LANES,
  type EvalCase,
  type EvalLane,
  type EvalRunResults,
  type LaneAggregate,
  type MeanStd,
  type PerCaseResult,
  type StratifiedAggregate,
} from './schemas';

interface LaneOpts {
  rerank: boolean;
  mmr: boolean;
}

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(JudgeService) private readonly judge: JudgeService,
    @Inject(CitationCheckService)
    private readonly citationCheck: CitationCheckService,
  ) {}

  async run(): Promise<EvalRunResults> {
    const cases = await this.loadCases();
    const startedAt = new Date().toISOString();
    const runId = `run-${startedAt}`;

    const lanes: Record<EvalLane, PerCaseResult[]> = {
      baseline: [],
      '+rerank': [],
      '+full': [],
    };

    for (const lane of LANES) {
      const opts = this.laneToOpts(lane);
      this.logger.log(
        `=== lane=${lane} rerank=${opts.rerank} mmr=${opts.mmr} ===`,
      );
      for (const c of cases) {
        try {
          const result = await this.runCase(c, opts, lane);
          lanes[lane].push(result);
          this.logger.log(
            `  [${lane}] ${c.id}: rel=${result.judge.relevance ?? '—'} grd=${
              result.judge.groundedness ?? '—'
            } cit=${result.citationAccuracy ? '✓' : '✗'} succ=${
              result.answerSuccess ?? '—'
            }`,
          );
        } catch (err) {
          this.logger.error(
            `  [${lane}] ${c.id} FAILED: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          // Push a placeholder row marking the case as failed so the
          // aggregate still has a spot for it. A complete crash midway
          // would lose the partial run.
          lanes[lane].push(this.failedPlaceholder(c, lane));
        }
      }
    }

    const finishedAt = new Date().toISOString();
    return {
      runId,
      startedAt,
      finishedAt,
      commit: process.env['GIT_SHA'] ?? '',
      lanes,
      aggregate: {
        baseline: this.aggregateLane(lanes.baseline),
        '+rerank': this.aggregateLane(lanes['+rerank']),
        '+full': this.aggregateLane(lanes['+full']),
      },
    };
  }

  private laneToOpts(lane: EvalLane): LaneOpts {
    switch (lane) {
      case 'baseline':
        return { rerank: false, mmr: false };
      case '+rerank':
        return { rerank: true, mmr: false };
      case '+full':
        return { rerank: true, mmr: true };
    }
  }

  private async runCase(
    c: EvalCase,
    opts: LaneOpts,
    lane: EvalLane,
  ): Promise<PerCaseResult> {
    // Seed session with prior turn for follow-up cases.
    let sessionId: string | undefined;
    if (c.priorTurn) {
      const priorSignal = new AbortController().signal;
      const prior = await this.chat.startTurn({
        sessionId: undefined,
        message: c.priorTurn,
        signal: priorSignal,
        correlationId: randomUUID(),
        retrievalOpts: opts,
      });
      let priorText = '';
      for await (const d of prior.result.textStream) priorText += d;
      await prior.result.done;
      await prior.complete(priorText);
      sessionId = prior.sessionId;
    }

    // Run the target turn.
    const correlationId = randomUUID();
    const t0 = Date.now();
    const handle = await this.chat.startTurn({
      sessionId,
      message: c.question,
      signal: new AbortController().signal,
      correlationId,
      retrievalOpts: opts,
    });
    let answer = '';
    for await (const delta of handle.result.textStream) answer += delta;
    const meta = await handle.result.done;
    const { citations } = await handle.complete(answer);
    const latencyMs = Date.now() - t0;

    const hits = handle.hits;
    const refusalString = this.config.file.chat?.refusalString ?? '';
    const isRefusal =
      refusalString.length > 0 && answer.includes(refusalString);

    // Retrieval quality — only when supportingArxivIds is present.
    const rankedIds = hits.map((h) => h.metadata.arxivId);
    const retrievedArxivIdsSet = new Set(
      rankedIds.filter((id): id is string => typeof id === 'string'),
    );
    let recallAtK: number | undefined;
    let mrr: number | undefined;
    if (c.supportingArxivIds && c.supportingArxivIds.length > 0) {
      const hitsOfSupporting = c.supportingArxivIds.filter((id) =>
        retrievedArxivIdsSet.has(id),
      );
      recallAtK = hitsOfSupporting.length / c.supportingArxivIds.length;
      const firstRank = rankedIds.findIndex(
        (id) => typeof id === 'string' && c.supportingArxivIds!.includes(id),
      );
      mrr = firstRank === -1 ? 0 : 1 / (firstRank + 1);
    }

    // Judges — each axis gated on its applicability.
    const context = buildContextString(hits);
    const relevance = c.expectedAnswer
      ? (await this.judge.relevance(c.question, c.expectedAnswer, answer)).score
      : undefined;
    const completeness = c.expectedAnswer
      ? (await this.judge.completeness(c.question, c.expectedAnswer, answer))
          .score
      : undefined;
    const groundedness = isRefusal
      ? undefined
      : (await this.judge.groundedness(c.question, context, answer)).score;
    const faithfulness = isRefusal
      ? undefined
      : (await this.judge.faithfulness(c.question, context, answer)).score;

    // Citation accuracy — programmatic; refusals skip.
    const citationResult = this.citationCheck.evaluate(citations, hits);
    const citationAccuracy = isRefusal ? false : citationResult.accuracy;

    const thresholds = this.config.file.eval?.successThresholds ?? {
      relevance: 4,
      groundedness: 4,
    };
    const answerSuccess: 0 | 1 | undefined =
      relevance !== undefined && groundedness !== undefined
        ? relevance >= thresholds.relevance &&
          groundedness >= thresholds.groundedness &&
          citationAccuracy
          ? 1
          : 0
        : undefined;

    return {
      caseId: c.id,
      category: c.category,
      lane,
      answer,
      isRefusal,
      citations: citations.map((ct) => ({
        arxivId: ct.arxivId,
        sourceTitle: ct.sourceTitle,
        n: ct.n,
      })),
      retrieval: {
        topKIds: hits.map((h) => h.id),
        retrievedArxivIds: [...retrievedArxivIdsSet],
        recallAtK,
        mrr,
      },
      judge: { relevance, groundedness, faithfulness, completeness },
      citationAccuracy,
      answerSuccess,
      refusedCorrectly: c.mustRefuse === true ? isRefusal : undefined,
      tokens: {
        input: meta.usage.inputTokens,
        output: meta.usage.outputTokens,
        total: meta.usage.totalTokens,
      },
      latency: { totalMs: latencyMs, ttftMs: meta.ttftMs },
    };
  }

  private failedPlaceholder(c: EvalCase, lane: EvalLane): PerCaseResult {
    return {
      caseId: c.id,
      category: c.category,
      lane,
      answer: '',
      isRefusal: false,
      citations: [],
      retrieval: { topKIds: [], retrievedArxivIds: [] },
      judge: {},
      citationAccuracy: false,
      tokens: { input: 0, output: 0, total: 0 },
      latency: { totalMs: 0 },
    };
  }

  private aggregateLane(rows: PerCaseResult[]): LaneAggregate {
    const nonRefusal = rows.filter((r) => !r.isRefusal);
    const withExpected = rows.filter((r) => r.judge.relevance !== undefined);
    const withSupporting = rows.filter(
      (r) => r.retrieval.recallAtK !== undefined,
    );
    const mustRefuse = rows.filter((r) => r.refusedCorrectly !== undefined);

    const recallAtK =
      withSupporting.length > 0
        ? mean(withSupporting.map((r) => r.retrieval.recallAtK ?? 0))
        : 0;
    const mrr =
      withSupporting.length > 0
        ? mean(withSupporting.map((r) => r.retrieval.mrr ?? 0))
        : 0;

    const relevance = meanStd(
      withExpected.map((r) => r.judge.relevance!).filter(isFiniteNumber),
    );
    const groundedness = meanStd(
      nonRefusal.map((r) => r.judge.groundedness).filter(isFiniteNumber),
    );
    const faithfulness = meanStd(
      nonRefusal.map((r) => r.judge.faithfulness).filter(isFiniteNumber),
    );
    const completeness = meanStd(
      withExpected.map((r) => r.judge.completeness).filter(isFiniteNumber),
    );

    const failureThreshold = this.config.file.eval?.failureThreshold ?? 2;
    const failureRate =
      withExpected.length === 0
        ? 0
        : withExpected.filter(
            (r) =>
              r.judge.relevance !== undefined &&
              r.judge.relevance <= failureThreshold,
          ).length / withExpected.length;

    const citationAccuracyPct =
      nonRefusal.length === 0
        ? 0
        : (nonRefusal.filter((r) => r.citationAccuracy).length /
            nonRefusal.length) *
          100;

    const refusalCorrectPct =
      mustRefuse.length === 0
        ? 0
        : (mustRefuse.filter((r) => r.refusedCorrectly).length /
            mustRefuse.length) *
          100;

    const refusalRatePct =
      rows.length === 0
        ? 0
        : (rows.filter((r) => r.isRefusal).length / rows.length) * 100;

    const withSuccess = rows.filter((r) => r.answerSuccess !== undefined);
    const successRatePct =
      withSuccess.length === 0
        ? 0
        : (withSuccess.filter((r) => r.answerSuccess === 1).length /
            withSuccess.length) *
          100;

    const inTokens = rows.map((r) => r.tokens.input);
    const outTokens = rows.map((r) => r.tokens.output);
    const totTokens = rows.map((r) => r.tokens.total);
    const latencies = rows.map((r) => r.latency.totalMs);

    const avgInputTokens = rows.length ? mean(inTokens) : 0;
    const avgOutputTokens = rows.length ? mean(outTokens) : 0;
    const avgTotalTokens = rows.length ? mean(totTokens) : 0;

    return {
      recallAtK,
      mrr,
      relevance,
      groundedness,
      faithfulness,
      completeness,
      failureRate,
      citationAccuracyPct,
      refusalCorrectPct,
      refusalRatePct,
      successRatePct,
      avgInputTokens,
      avgOutputTokens,
      avgTotalTokens,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      byCategory: this.stratify(rows, failureThreshold),
    };
  }

  private stratify(
    rows: PerCaseResult[],
    failureThreshold: number,
  ): Partial<Record<EvalCase['category'], StratifiedAggregate>> {
    const out: Partial<Record<EvalCase['category'], StratifiedAggregate>> = {};
    const groups = new Map<EvalCase['category'], PerCaseResult[]>();
    for (const r of rows) {
      const arr = groups.get(r.category) ?? [];
      arr.push(r);
      groups.set(r.category, arr);
    }
    for (const [category, subset] of groups) {
      const nonRefusal = subset.filter((r) => !r.isRefusal);
      const withExpected = subset.filter(
        (r) => r.judge.relevance !== undefined,
      );
      const withSupporting = subset.filter(
        (r) => r.retrieval.recallAtK !== undefined,
      );
      const withSuccess = subset.filter((r) => r.answerSuccess !== undefined);
      out[category] = {
        n: subset.length,
        recallAtK:
          withSupporting.length === 0
            ? undefined
            : mean(withSupporting.map((r) => r.retrieval.recallAtK ?? 0)),
        mrr:
          withSupporting.length === 0
            ? undefined
            : mean(withSupporting.map((r) => r.retrieval.mrr ?? 0)),
        relevance:
          withExpected.length === 0
            ? undefined
            : meanStd(
                withExpected
                  .map((r) => r.judge.relevance)
                  .filter(isFiniteNumber),
              ),
        groundedness:
          nonRefusal.length === 0
            ? undefined
            : meanStd(
                nonRefusal
                  .map((r) => r.judge.groundedness)
                  .filter(isFiniteNumber),
              ),
        faithfulness:
          nonRefusal.length === 0
            ? undefined
            : meanStd(
                nonRefusal
                  .map((r) => r.judge.faithfulness)
                  .filter(isFiniteNumber),
              ),
        completeness:
          withExpected.length === 0
            ? undefined
            : meanStd(
                withExpected
                  .map((r) => r.judge.completeness)
                  .filter(isFiniteNumber),
              ),
        citationAccuracyPct:
          nonRefusal.length === 0
            ? undefined
            : (nonRefusal.filter((r) => r.citationAccuracy).length /
                nonRefusal.length) *
              100,
        successRatePct:
          withSuccess.length === 0
            ? undefined
            : (withSuccess.filter((r) => r.answerSuccess === 1).length /
                withSuccess.length) *
              100,
        failureRate:
          withExpected.length === 0
            ? undefined
            : withExpected.filter(
                (r) =>
                  r.judge.relevance !== undefined &&
                  r.judge.relevance <= failureThreshold,
              ).length / withExpected.length,
      };
    }
    return out;
  }

  private async loadCases(): Promise<EvalCase[]> {
    const rel = this.config.file.eval?.casesPath ?? './eval/cases.json';
    const path = resolve(process.cwd(), rel);
    const raw = await readFile(path, 'utf8');
    const parsed = EvalCasesFileSchema.parse(JSON.parse(raw));
    return parsed.cases;
  }
}

function buildContextString(hits: RetrievalHit[]): string {
  if (hits.length === 0) return '(no matching sources)';
  return hits
    .map((h, i) => {
      const title = h.metadata.sourceTitle;
      return `[${i + 1}] ${h.metadata.text}\n(source: ${title})`;
    })
    .join('\n\n');
}

function isFiniteNumber(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function meanStd(xs: number[]): MeanStd {
  if (xs.length === 0) return { mean: 0, std: 0, n: 0 };
  const m = mean(xs);
  if (xs.length === 1) return { mean: m, std: 0, n: 1 };
  const variance =
    xs.reduce((acc, x) => acc + (x - m) * (x - m), 0) / xs.length;
  return { mean: m, std: Math.sqrt(variance), n: xs.length };
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx] ?? 0;
}
