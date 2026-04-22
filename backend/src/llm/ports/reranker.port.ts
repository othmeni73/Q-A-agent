/**
 * Cross-encoder reranker port.
 *
 * Single method — `score(query, docs)` returns one relevance score per doc,
 * jointly encoded with the query (what makes it a "cross-encoder" and gives
 * it the quality edge over bi-encoder embeddings). Higher = more relevant.
 *
 * Implementations should be stateful-per-process (load the model once, reuse
 * across calls); the port doesn't dictate how.
 */

export interface RerankerScoreOptions {
  query: string;
  docs: string[];
  signal?: AbortSignal;
}

export interface Reranker {
  score(opts: RerankerScoreOptions): Promise<number[]>;
}

/** Symbol-based DI token. */
export const RERANKER = Symbol('RERANKER');
