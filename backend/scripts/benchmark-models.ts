/* eslint-disable no-console -- CLI script; stdout is the primary output surface */
import 'dotenv/config'; // MUST be first — populates process.env from backend/.env before anything reads it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadConfig } from '@app/config/load';
import { aggregate, DEFAULT_WEIGHTS } from '@app/eval/aggregate';
import { generateAnswer, type GenerationConfig } from '@app/eval/generate';
import {
  pairwiseSymmetric,
  pointwiseJudge,
  type JudgeConfig,
} from '@app/eval/judges';
import { scoreProgrammatic } from '@app/eval/score-programmatic';
import type { BenchmarkCase, CaseResult, ModelOutput } from '@app/eval/types';
import { createOllamaClient, createOpenRouterClient } from '@app/llm/clients';
import { parallelMap } from '@app/utils/concurrency';
import { shortName } from '@app/utils/format';
import { interpolate, loadPrompt } from '@app/utils/prompts';

// ─── Boot ──────────────────────────────────────────────────────
const IS_DRY_RUN = process.argv.includes('--dry-run');
const OPENROUTER_KEY = process.env['OPENROUTER_API_KEY'];

if (!IS_DRY_RUN && !OPENROUTER_KEY) {
  console.error('OPENROUTER_API_KEY not set — used for candidate models');
  process.exit(1);
}

const config = loadConfig();
if (!config.file.benchmark) {
  console.error('config.yaml is missing the `benchmark:` section — cannot run.');
  process.exit(1);
}
const bench = config.file.benchmark;

const ROOT = process.cwd(); // expected: backend/
const CASES_PATH = join(ROOT, 'eval/model-selection/cases.json');
const RESULTS_PATH = join(ROOT, 'eval/model-selection/results.json');
const PARTIAL_PATH = join(ROOT, 'eval/model-selection/results.partial.json');

// ─── Clients + prompts + judge/generator configs ───────────────
const openrouter = createOpenRouterClient(OPENROUTER_KEY ?? 'dry-run-placeholder');
const ollama = createOllamaClient({ baseUrl: bench.judge.baseUrl });

const candidateSystem = interpolate(loadPrompt('benchmark-candidate-system'), {
  refusal: bench.refusalString,
});
const pointwiseTpl = loadPrompt('judge-quality-pointwise');
const pairwiseTpl = loadPrompt('judge-relevance-pairwise');

const judgeCfg: JudgeConfig = {
  model: ollama(bench.judge.model),
  pointwiseTpl,
  pairwiseTpl,
  throttleMs: bench.throttles.judgeMs,
};

const genCfg: GenerationConfig = {
  modelFactory: (id) => openrouter(id),
  system: candidateSystem,
  throttleMs: bench.throttles.candidateMs,
};

// ─── Main ──────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { cases } = JSON.parse(readFileSync(CASES_PATH, 'utf8')) as { cases: BenchmarkCase[] };

  // Budget preview — helps size the run against free-tier daily caps.
  const nonSkipped = cases.filter(
    (c) => c.type !== 'out-of-scope' && c.type !== 'adversarial',
  ).length;
  const pairCount = (bench.candidates.length * (bench.candidates.length - 1)) / 2;
  const budget = {
    generation: cases.length * bench.candidates.length,
    pointwise: nonSkipped * bench.candidates.length,
    pairwise: cases.length * pairCount * 2,
  };
  console.log(`cases=${cases.length}  candidates=${bench.candidates.length}`);
  console.log(
    `budget: ${budget.generation} gen + ${budget.pointwise} pointwise + ${budget.pairwise} pairwise = ${budget.generation + budget.pointwise + budget.pairwise} total calls`,
  );

  if (IS_DRY_RUN) {
    console.log('--dry-run: exiting before network calls');
    return;
  }

  // Resume from checkpoint if present.
  let caseResults: CaseResult[] = [];
  if (existsSync(PARTIAL_PATH)) {
    caseResults = JSON.parse(readFileSync(PARTIAL_PATH, 'utf8')) as CaseResult[];
    console.log(`resuming: ${caseResults.length} cases already complete`);
  }
  const done = new Set(caseResults.map((r) => r.caseId));
  const remaining = cases.filter((c) => !done.has(c.id));

  for (const tc of remaining) {
    console.log(
      `\ncase ${tc.id} (${tc.type}): "${tc.question.slice(0, 70)}${tc.question.length > 70 ? '…' : ''}"`,
    );

    // Phase 1 — generate candidate answers + programmatic scoring.
    const phase1 = await parallelMap(bench.candidates, bench.concurrency, async (m) => {
      try {
        const gen = await generateAnswer(m, tc, genCfg);
        return {
          m,
          ...gen,
          programmatic: scoreProgrammatic(tc, gen.answer),
          error: undefined,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ${m}: generation FAILED — ${msg}`);
        return {
          m,
          answer: '',
          latencyMs: 0,
          completionTokens: 0,
          programmatic: scoreProgrammatic(tc, ''),
          error: msg,
        };
      }
    });

    for (const p of phase1) {
      if (p.error) continue;
      const short = shortName(p.m);
      const verdict = p.programmatic.overallPass ? 'PASS' : 'fail';
      const snippet = p.answer.replace(/\s+/g, ' ').slice(0, 80);
      console.log(
        `  [${verdict}] ${short.padEnd(32)} ${String(p.latencyMs).padStart(5)}ms  "${snippet}${p.answer.length > 80 ? '…' : ''}"`,
      );
    }

    // Phase 2 — pointwise judge (skipped for OOS/adversarial).
    const pointwise = await parallelMap(phase1, bench.concurrency, async (p) =>
      p.error ? null : pointwiseJudge(tc, p.answer, judgeCfg),
    );

    for (let i = 0; i < phase1.length; i++) {
      const p = phase1[i];
      const pw = pointwise[i];
      if (!pw) continue;
      console.log(
        `    judge  ${shortName(p.m).padEnd(32)} correctness=${pw.correctness}/5  faith=${pw.faithfulness}/5`,
      );
    }

    const modelOutputs: Record<string, ModelOutput> = {};
    for (let i = 0; i < phase1.length; i++) {
      const p = phase1[i];
      modelOutputs[p.m] = {
        answer: p.answer,
        latencyMs: p.latencyMs,
        completionTokens: p.completionTokens,
        programmatic: p.programmatic,
        pointwise: pointwise[i],
        ...(p.error ? { error: p.error } : {}),
      };
    }

    // Phase 3 — pairwise (symmetric-ordered) for every candidate pair.
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < bench.candidates.length; i++) {
      for (let j = i + 1; j < bench.candidates.length; j++) {
        pairs.push([bench.candidates[i], bench.candidates[j]]);
      }
    }

    const wins: Record<string, { wins: number; losses: number; ties: number }> = {};
    for (const m of bench.candidates) wins[m] = { wins: 0, losses: 0, ties: 0 };

    await parallelMap(pairs, bench.concurrency, async ([a, b]) => {
      try {
        const verdict = await pairwiseSymmetric(
          tc.question,
          modelOutputs[a].answer,
          modelOutputs[b].answer,
          judgeCfg,
        );
        if (verdict === 'A') {
          wins[a].wins++;
          wins[b].losses++;
        } else if (verdict === 'B') {
          wins[b].wins++;
          wins[a].losses++;
        } else {
          wins[a].ties++;
          wins[b].ties++;
        }
      } catch (err) {
        console.error(`  pairwise ${a} vs ${b}: FAILED`, err);
        wins[a].ties++;
        wins[b].ties++;
      }
    });

    const pairwiseLine = bench.candidates
      .map((m) => {
        const w = wins[m];
        return `${shortName(m)}(${w.wins}W ${w.losses}L ${w.ties}T)`;
      })
      .join('  ');
    console.log(`    pairwise  ${pairwiseLine}`);

    caseResults.push({ caseId: tc.id, type: tc.type, modelOutputs, pairwise: wins });

    mkdirSync(dirname(PARTIAL_PATH), { recursive: true });
    writeFileSync(PARTIAL_PATH, JSON.stringify(caseResults, null, 2));
    console.log(`  ✓ case ${tc.id} done, checkpoint updated`);
  }

  // Final aggregate + committed results.
  const perModel = aggregate(cases, caseResults, bench.candidates);
  const ranked = Object.entries(perModel).sort(([, a], [, b]) => b.finalScore - a.finalScore);
  const [pickId, pickAgg] = ranked[0];
  const secondScore = ranked[1]?.[1].finalScore ?? 0;

  const output = {
    runId: new Date().toISOString(),
    judgeModel: bench.judge.model,
    candidates: [...bench.candidates],
    weights: DEFAULT_WEIGHTS,
    caseResults,
    aggregate: {
      perModel,
      recommendation: {
        pick: pickId,
        finalScore: pickAgg.finalScore,
        margin: pickAgg.finalScore - secondScore,
        rationale: `Highest finalScore (${pickAgg.finalScore.toFixed(3)}); margin over second place: ${(pickAgg.finalScore - secondScore).toFixed(3)}.`,
      },
    },
  };
  writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));

  console.log(`\n✓ wrote ${RESULTS_PATH}\n`);
  console.log('=== RANKING ===');
  for (const [id, agg] of ranked) {
    console.log(
      `  ${agg.finalScore.toFixed(3)}  fc=${agg.formatCompliance.toFixed(2)}  acc=${agg.accuracy.toFixed(2)}  faith=${agg.faithfulness.toFixed(2)}  pw=${agg.pairwiseWinRate.toFixed(2)}  lat=${agg.latencyScore.toFixed(2)}  ${id}`,
    );
  }
  console.log(`\nRecommendation: ${pickId}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
