/**
 * Types exposed by the retrieval layer.
 *
 * `RetrievalHit` is a superset of the port-level `SearchHit` — it carries the
 * per-stage score decomposition so downstream (eval, UI) can explain why a
 * chunk surfaced. The chat service only consumes `id` + `metadata` + `text`.
 */

import type { SearchHit } from '@app/vector/ports/vector-store.port';

export interface RetrievalHit extends SearchHit {
  /** Score from RRF fusion (rank-based, not comparable across corpora). */
  fusedScore?: number;
  /** Cross-encoder score, if rerank ran. */
  rerankScore?: number;
  /** MMR score at the moment of selection, if mmr ran. */
  mmrScore?: number;
}

export interface TopKOpts {
  /** Final number of hits to return after all stages. Default: 5. */
  k?: number;
  /** Enable cross-encoder rerank stage. Default: true. */
  rerank?: boolean;
  /** Enable MMR diversification stage. Default: true. */
  mmr?: boolean;
  /** Optional metadata filter passed straight through to the vector store. */
  filter?: Record<string, string | number | boolean>;
  /** Step 13: correlation id threaded from the chat controller for post-hoc joining. */
  correlationId?: string;
}
