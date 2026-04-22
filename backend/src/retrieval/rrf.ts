/**
 * Reciprocal Rank Fusion (Cormack et al., SIGIR 2009).
 *
 * `score(doc) = Σ_i 1 / (k + rank_i(doc))` across every ranked list the doc
 * appears in. `k=60` is the canonical constant — larger values flatten the
 * rank-score curve, smaller values sharpen it. Tuning-free; rank-based so it
 * ignores absolute score magnitudes (dense cosine vs. BM25 aren't
 * commensurable anyway, which is the whole point of using RRF here).
 */

import type { SearchHit } from '@app/vector/ports/vector-store.port';

import type { RetrievalHit } from './types';

export const RRF_K_DEFAULT = 60;

/**
 * Fuse N ranked lists into a single list ordered by RRF score, desc.
 * Hits are de-duplicated by `id` — the output carries the first `SearchHit`
 * instance seen for each id, with `fusedScore` set.
 */
export function rrfFuse(
  lists: SearchHit[][],
  rrfK: number = RRF_K_DEFAULT,
): RetrievalHit[] {
  const scored = new Map<string | number, RetrievalHit>();

  for (const list of lists) {
    list.forEach((hit, i) => {
      const rank = i + 1;
      const inc = 1 / (rrfK + rank);
      const existing = scored.get(hit.id);
      if (existing) {
        existing.fusedScore = (existing.fusedScore ?? 0) + inc;
      } else {
        scored.set(hit.id, { ...hit, fusedScore: inc });
      }
    });
  }

  return Array.from(scored.values()).sort(
    (a, b) => (b.fusedScore ?? 0) - (a.fusedScore ?? 0),
  );
}
