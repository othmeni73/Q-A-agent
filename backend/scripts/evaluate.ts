/**
 * `pnpm evaluate` CLI — Step 13 harness entry point.
 *
 * Boots Nest as an application context (no HTTP server), runs every test
 * case through all three retrieval ablation lanes, writes eval/results.json,
 * refreshes eval/baseline.json (Step-14 regression target), prints a
 * summary table.
 *
 * Env knobs:
 *   NODE_ENV=test        → PersistenceModule swaps to :memory: SQLite.
 *   LLM_ADAPTER=real     → opt out of the NODE_ENV=test→mock default; real
 *                          OpenRouter + Ollama adapters.
 *   DISABLE_TRACING unset→ real Jsonl trace sinks (eval joins on correlationId).
 */

import 'dotenv/config';

process.env['NODE_ENV'] = 'test';
process.env['LLM_ADAPTER'] = 'real';
process.env['VECTOR_ADAPTER'] = 'real';

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '@app/app.module';
import { APP_CONFIG, type AppConfig } from '@app/config/schema';
import { EvaluationService } from '@app/evaluation/evaluation.service';
import type {
  EvalLane,
  EvalRunResults,
  LaneAggregate,
} from '@app/evaluation/schemas';

const LANES: EvalLane[] = ['baseline', '+rerank', '+full'];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const svc = app.get(EvaluationService);
  const config = app.get<AppConfig>(APP_CONFIG);

  const results = await svc.run();

  const resultsPath = resolve(
    process.cwd(),
    config.file.eval?.resultsPath ?? './eval/results.json',
  );
  const baselinePath = resolve(
    process.cwd(),
    config.file.eval?.baselinePath ?? './eval/baseline.json',
  );

  await writeFile(resultsPath, JSON.stringify(results, null, 2) + '\n');
  // Baseline tracks the `+full` lane only — Step 14's CI gate diffs against it.
  const baseline = {
    runId: results.runId,
    startedAt: results.startedAt,
    finishedAt: results.finishedAt,
    commit: results.commit,
    aggregate: { '+full': results.aggregate['+full'] },
  };
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n');

  printTable(results);
  await app.close();
}

function fmtMeanStd(m: { mean: number; std: number; n: number }): string {
  if (m.n === 0) return 'n/a';
  return `${m.mean.toFixed(2)} ± ${m.std.toFixed(2)} (n=${m.n})`;
}

function fmtPct(v: number | undefined): string {
  if (v === undefined) return 'n/a';
  return `${v.toFixed(1)}%`;
}

function printTable(r: EvalRunResults): void {
  const header = [
    'lane',
    'relevance (1-5)',
    'groundedness (1-5)',
    'cite-acc %',
    'faithful (0-5)',
    'complete (0-5)',
    'recall@5',
    'MRR',
    'succ %',
    'fail %',
    'refuse ok %',
    'refuse %',
    'p50ms',
    'p95ms',
    'avg tok',
  ];
  const rows = LANES.map((lane) => laneRow(lane, r.aggregate[lane]));

  const lines = [
    `\n=== Eval run ${r.runId} (commit=${r.commit || 'unversioned'}) ===\n`,
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

function laneRow(lane: EvalLane, a: LaneAggregate): string[] {
  return [
    lane,
    fmtMeanStd(a.relevance),
    fmtMeanStd(a.groundedness),
    fmtPct(a.citationAccuracyPct),
    fmtMeanStd(a.faithfulness),
    fmtMeanStd(a.completeness),
    a.recallAtK.toFixed(2),
    a.mrr.toFixed(2),
    fmtPct(a.successRatePct),
    fmtPct(a.failureRate * 100),
    fmtPct(a.refusalCorrectPct),
    fmtPct(a.refusalRatePct),
    a.p50LatencyMs.toFixed(0),
    a.p95LatencyMs.toFixed(0),
    a.avgTotalTokens.toFixed(0),
  ];
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
