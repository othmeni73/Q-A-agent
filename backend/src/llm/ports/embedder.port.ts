/**
 * Role tag for embed calls. Split between ingestion (one-time, batched) and
 * query (per-chat-turn, single-value) so the tracer can report cost per use
 * case and the rate-limit budget can be reasoned about per role.
 */
export type EmbedRole = 'ingest' | 'query';

export interface EmbedOptions {
  /** Provider model id, e.g. `'text-embedding-004'`. */
  model: string;
  role: EmbedRole;
  /** Batch of strings to embed. Real adapters send a single batched request. */
  values: string[];
  signal?: AbortSignal;
}

export interface EmbedResult {
  /** One vector per input value, in input order. */
  embeddings: number[][];
  usage: {
    inputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

/** The embeddings port. Real impl in `adapters/google-embedder.adapter.ts`. */
export interface Embedder {
  embed(opts: EmbedOptions): Promise<EmbedResult>;
}

export const EMBEDDER = Symbol('EMBEDDER');
