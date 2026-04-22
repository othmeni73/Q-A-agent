/**
 * Maximal Marginal Relevance (Carbonell & Goldstein, SIGIR 1998).
 *
 *   MMR(d, Q, S) = λ · sim(d, Q) − (1-λ) · max_{s ∈ S} sim(d, s)
 *
 * Greedy selection: pick the candidate that maximises MMR, add to S, repeat
 * until |S| = k. `λ=0.7` strongly favours relevance; only penalises near-
 * duplicates. `λ=0.5` would diversify more aggressively — tuned here for the
 * known-factual-answer case at the cost of multi-doc synthesis.
 *
 * Requires `candidate.dense` on every input hit (we ask for it via
 * `withVector: true` on the vector-store query when rerank is disabled, or
 * reuse what the reranker consumed otherwise).
 */

import type { RetrievalHit } from './types';

export const MMR_LAMBDA_DEFAULT = 0.7;

export interface MmrOpts {
  queryVector: number[];
  k: number;
  lambda?: number;
}

export function mmrSelect(
  candidates: RetrievalHit[],
  opts: MmrOpts,
): RetrievalHit[] {
  const lambda = opts.lambda ?? MMR_LAMBDA_DEFAULT;
  const pool = candidates.filter((c): c is RetrievalHit & { dense: number[] } =>
    Array.isArray(c.dense),
  );
  if (pool.length === 0) return [];

  const selected: (RetrievalHit & { dense: number[] })[] = [];
  const remaining = [...pool];
  const k = Math.min(opts.k, pool.length);

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const relevance = cosine(opts.queryVector, cand.dense);
      const maxSim =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((s) => cosine(cand.dense, s.dense)));
      const score = lambda * relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const winner = remaining.splice(bestIdx, 1)[0];
    selected.push({ ...winner, mmrScore: bestScore });
  }

  return selected;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
