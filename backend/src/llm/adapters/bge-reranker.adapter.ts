/**
 * Local cross-encoder reranker via `@xenova/transformers`.
 *
 * Model: `Xenova/bge-reranker-v2-m3` (ONNX, quantized). Loads once on first
 * call (~2-3 s cold start, ~550 MB download the first time — cached in
 * ~/.cache/huggingface thereafter). Subsequent calls batch through the same
 * pipeline instance; ~400 ms per 8-pair batch on CPU per choices.md
 * Decision 8.
 *
 * The model returns a binary-classification output where index 1 = "relevant"
 * per the BGE reranker training objective. transformers.js returns the label
 * with the top score per input, so we return the `score` field directly;
 * higher = more relevant.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Pipeline } from '@xenova/transformers';

import type { Reranker, RerankerScoreOptions } from '../ports/reranker.port';

const DEFAULT_MODEL = 'Xenova/bge-reranker-v2-m3';

interface RerankerClassificationOutput {
  label: string;
  score: number;
}

@Injectable()
export class BgeReranker implements Reranker {
  private readonly logger = new Logger(BgeReranker.name);
  private pipelinePromise: Promise<Pipeline> | undefined;
  private readonly modelId: string;

  constructor(modelId: string = DEFAULT_MODEL) {
    this.modelId = modelId;
  }

  async score(opts: RerankerScoreOptions): Promise<number[]> {
    if (opts.docs.length === 0) return [];
    const pipe = await this.getPipeline();
    const pairs = opts.docs.map((d) => ({ text: opts.query, text_pair: d }));
    const raw = (await (
      pipe as unknown as (input: unknown, opts?: unknown) => Promise<unknown>
    )(pairs, { topk: 1 })) as
      | RerankerClassificationOutput[]
      | RerankerClassificationOutput[][];
    const flat: RerankerClassificationOutput[] = Array.isArray(raw[0])
      ? (raw as RerankerClassificationOutput[][]).map((r) => r[0])
      : (raw as RerankerClassificationOutput[]);
    return flat.map((r) => r.score);
  }

  private async getPipeline(): Promise<Pipeline> {
    if (!this.pipelinePromise) {
      this.logger.log(`loading reranker model "${this.modelId}"…`);
      // Dynamic import so the ~550 MB package isn't loaded in test/mock paths.
      this.pipelinePromise = import('@xenova/transformers').then(
        (mod) =>
          mod.pipeline('text-classification', this.modelId, {
            quantized: true,
          }) as unknown as Promise<Pipeline>,
      );
    }
    return this.pipelinePromise;
  }
}
