import type { BenchmarkCase, CaseResult, PerModel } from './types';

export interface AggregateWeights {
  formatCompliance: number;
  accuracy: number;
  faithfulness: number;
  pairwiseWinRate: number;
  latencyScore: number;
}

/** Canonical rubric weights from `choices.md` Decision 3. Sum to 1.0. */
export const DEFAULT_WEIGHTS: AggregateWeights = {
  formatCompliance: 0.3,
  accuracy: 0.3,
  faithfulness: 0.2,
  pairwiseWinRate: 0.1,
  latencyScore: 0.1,
};

function p50(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Per-model aggregate scores computed from per-case results, combined via the
 * weighted-score formula in `choices.md` Decision 3.
 */
export function aggregate(
  cases: BenchmarkCase[],
  results: CaseResult[],
  candidates: readonly string[],
  weights: AggregateWeights = DEFAULT_WEIGHTS,
): Record<string, PerModel> {
  const latency: Record<string, number[]> = {};
  const programPass: Record<string, number> = {};
  const correctness: Record<string, number[]> = {};
  const faithfulness: Record<string, number[]> = {};
  const wins: Record<string, { wins: number; losses: number; ties: number }> =
    {};

  for (const m of candidates) {
    latency[m] = [];
    programPass[m] = 0;
    correctness[m] = [];
    faithfulness[m] = [];
    wins[m] = { wins: 0, losses: 0, ties: 0 };
  }

  for (const r of results) {
    for (const m of candidates) {
      const out = r.modelOutputs[m];
      if (!out) continue;
      if (out.latencyMs > 0) latency[m].push(out.latencyMs);
      if (out.programmatic.overallPass) programPass[m]++;
      if (out.pointwise) {
        correctness[m].push(out.pointwise.correctness);
        faithfulness[m].push(out.pointwise.faithfulness);
      }
      const pw = r.pairwise[m];
      if (pw) {
        wins[m].wins += pw.wins;
        wins[m].losses += pw.losses;
        wins[m].ties += pw.ties;
      }
    }
  }

  const validLatencies = candidates
    .map((m) => p50(latency[m]))
    .filter((x) => x > 0);
  const minLatency = validLatencies.length ? Math.min(...validLatencies) : 1;

  const perModel: Record<string, PerModel> = {};
  for (const m of candidates) {
    const fc = programPass[m] / cases.length;
    const acc = avg(correctness[m]) / 5;
    const faith = avg(faithfulness[m]) / 5;
    const pw = wins[m];
    const total = pw.wins + pw.losses + pw.ties;
    const pwRate = total ? (pw.wins + pw.ties * 0.5) / total : 0;
    const latP50 = p50(latency[m]);
    const latScore = latP50 ? minLatency / latP50 : 0;
    perModel[m] = {
      formatCompliance: fc,
      accuracy: acc,
      faithfulness: faith,
      pairwiseWinRate: pwRate,
      latencyP50Ms: latP50,
      latencyScore: latScore,
      finalScore:
        weights.formatCompliance * fc +
        weights.accuracy * acc +
        weights.faithfulness * faith +
        weights.pairwiseWinRate * pwRate +
        weights.latencyScore * latScore,
    };
  }
  return perModel;
}
