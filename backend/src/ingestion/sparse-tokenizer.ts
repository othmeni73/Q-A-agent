/**
 * BM25-friendly term extraction.
 *
 * Lowercase → split on non-word characters → drop tokens shorter than
 * MIN_TOKEN_LEN → FNV-1a hash each token to a uint32 "index" → sum term
 * frequencies per index.
 *
 * Returns a `SparseVector` carrying raw term frequencies. The Qdrant
 * collection is provisioned with `sparse_vectors.bm25: { modifier: 'idf' }`
 * (Step 4), so Qdrant handles IDF at query time — we only send TFs.
 *
 * Hash collisions are possible at 2^32 but rare enough at this corpus size to
 * ignore; strictly simpler than maintaining a stateful vocabulary that would
 * serialise ingestion and complicate incremental updates.
 */

import type { SparseVector } from '@app/vector/ports/vector-store.port';

export const MIN_TOKEN_LEN = 2;

export function bm25Tokens(text: string): SparseVector {
  const counts = new Map<number, number>();
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length >= MIN_TOKEN_LEN);

  for (const tok of tokens) {
    const h = fnv1aHash32(tok);
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }

  const entries = Array.from(counts.entries()).sort((a, b) => a[0] - b[0]);
  return {
    indices: entries.map(([h]) => h),
    values: entries.map(([, c]) => c),
  };
}

function fnv1aHash32(input: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0; // force unsigned 32-bit
}
