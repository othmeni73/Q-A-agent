/**
 * Thin batching wrapper around the `EMBEDDER` port, tagged with `role: 'ingest'`
 * so tracing can separate ingestion costs from per-turn query-time costs.
 *
 * Google's `text-embedding-004` accepts up to 100 strings per call; we default
 * to that and let config override.
 */

import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';
import { EMBEDDER, type Embedder } from '@app/llm/ports/embedder.port';

const DEFAULT_BATCH = 100;
const DEFAULT_MODEL = 'text-embedding-004';

@Injectable()
export class IngestEmbedderService {
  private readonly batchSize: number;
  private readonly model: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
  ) {
    const ing = config.file.ingestion;
    this.batchSize = ing?.embedBatchSize ?? DEFAULT_BATCH;
    this.model = ing?.embedModel ?? DEFAULT_MODEL;
  }

  /** Returns one embedding per input string, preserving input order. */
  async embedChunks(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = new Array<number[]>(texts.length);
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const slice = texts.slice(i, i + this.batchSize);
      const res = await this.embedder.embed({
        model: this.model,
        role: 'ingest',
        values: slice,
      });
      for (let j = 0; j < res.embeddings.length; j++) {
        out[i + j] = res.embeddings[j]!;
      }
    }
    return out;
  }
}
