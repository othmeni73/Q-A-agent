/**
 * Local-Ollama-backed implementation of the Embedder port.
 *
 * Reuses the shared `createOllamaClient` factory (OpenAI-compatible `/v1`
 * endpoint) so one configured Ollama instance serves the judge (Step 2), the
 * contextual prefix (Step 6), and embeddings — single local-model-service
 * story.
 *
 * Default model is `nomic-embed-text` (768-dim, Apache 2.0). Matches the
 * Qdrant collection's `denseSize: 768` — zero collection rebuild vs. the
 * Google `text-embedding-004` it replaces.
 */

import { embedMany } from 'ai';

import { createOllamaClient } from '../clients';
import type {
  Embedder,
  EmbedOptions,
  EmbedResult,
} from '../ports/embedder.port';

export interface OllamaEmbedderOptions {
  /** OpenAI-compatible base URL for the Ollama instance. */
  baseUrl: string;
}

export class OllamaEmbedder implements Embedder {
  private readonly ollama: ReturnType<typeof createOllamaClient>;

  constructor(opts: OllamaEmbedderOptions) {
    this.ollama = createOllamaClient({ baseUrl: opts.baseUrl });
  }

  async embed(opts: EmbedOptions): Promise<EmbedResult> {
    const t0 = Date.now();
    const res = await embedMany({
      model: this.ollama.textEmbeddingModel(opts.model),
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
