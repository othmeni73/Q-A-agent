/**
 * Real Google AI Studio-backed implementation of the Embedder port.
 * Wraps AI SDK's embedMany() for batched embedding calls.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embedMany } from 'ai';

import type {
  Embedder,
  EmbedOptions,
  EmbedResult,
} from '@app/llm/ports/embedder.port';

export class GoogleEmbedder implements Embedder {
  private readonly google: ReturnType<typeof createGoogleGenerativeAI>;

  constructor(apiKey: string) {
    this.google = createGoogleGenerativeAI({ apiKey });
  }

  async embed(opts: EmbedOptions): Promise<EmbedResult> {
    const t0 = Date.now();
    const res = await embedMany({
      model: this.google.textEmbeddingModel(opts.model),
      values: opts.values,
      abortSignal: opts.signal,
    });
    const totalTokens = res.usage?.tokens ?? 0;
    return {
      embeddings: res.embeddings,
      usage: {
        inputTokens: totalTokens,
        totalTokens,
      },
      latencyMs: Date.now() - t0,
    };
  }
}
