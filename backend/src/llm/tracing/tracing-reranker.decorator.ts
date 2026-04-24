/**
 * Wraps the RERANKER port to emit a rerank trace record per score() call.
 * Symmetric with TracingLlmClient / TracingEmbedder (Step 3).
 *
 * The rerank op has no token usage (local cross-encoder) — we track latency
 * and batch size so Step-13 ablation attribution can show how much rerank
 * contributes to per-case latency.
 */

import type {
  Reranker,
  RerankerScoreOptions,
} from '@app/llm/ports/reranker.port';

import type { TraceSink } from './tracing';

export class TracingReranker implements Reranker {
  constructor(
    private readonly inner: Reranker,
    private readonly sink: TraceSink,
  ) {}

  async score(opts: RerankerScoreOptions): Promise<number[]> {
    const t0 = Date.now();
    try {
      const out = await this.inner.score(opts);
      this.emit({
        timestamp: new Date().toISOString(),
        model: 'reranker',
        role: 'rerank',
        operation: 'rerank',
        usage: { inputTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - t0,
        batchSize: opts.docs.length,
      });
      return out;
    } catch (err) {
      this.emit({
        timestamp: new Date().toISOString(),
        model: 'reranker',
        role: 'rerank',
        operation: 'rerank',
        usage: { inputTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - t0,
        batchSize: opts.docs.length,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private emit(record: Parameters<TraceSink['write']>[0]): void {
    try {
      this.sink.write(record);
    } catch {
      /* swallow */
    }
  }
}
