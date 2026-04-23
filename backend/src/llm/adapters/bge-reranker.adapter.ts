/**
 * Local cross-encoder reranker via `@xenova/transformers`.
 *
 * Model: `Xenova/bge-reranker-large` (ONNX, quantized). Loads once on first
 * call (~2-3 s cold start, ~550 MB download the first time — cached in
 * ~/.cache/huggingface thereafter). Subsequent calls batch through the same
 * pipeline instance; ~400 ms per 8-pair batch on CPU per choices.md
 * Decision 8.
 *
 * BGE rerankers are cross-encoders: one forward pass scores a (query, doc)
 * pair jointly. The high-level `text-classification` pipeline doesn't
 * support sentence-pair inputs (it expects plain strings), so we call the
 * tokenizer + model directly with parallel arrays of queries and docs.
 *
 * Score semantics: bge-reranker-{base,large} have a single-logit regression
 * head — the raw logit IS the relevance score (higher = more relevant).
 * No softmax. The v2-m3 binary-classification variant would need
 * `softmax(logits)[index 1]`; we handle both shapes defensively.
 */

import { Injectable, Logger } from '@nestjs/common';

import type { Reranker, RerankerScoreOptions } from '../ports/reranker.port';

const DEFAULT_MODEL = 'Xenova/bge-reranker-large';

/**
 * Minimal shape of the @xenova/transformers cross-encoder pipeline we rely
 * on. The public type surface exposes neither `.tokenizer` nor `.model` as
 * callable, so we re-declare what we actually use.
 */
interface TokenizerInput {
  text_pair: string[];
  padding: boolean;
  truncation: boolean;
}

interface ModelLogits {
  data: Float32Array | number[];
  dims: number[];
}

interface RerankerPipeline {
  tokenizer(text: string[], opts: TokenizerInput): unknown;
  model(inputs: unknown): Promise<{ logits: ModelLogits }>;
}

@Injectable()
export class BgeReranker implements Reranker {
  private readonly logger = new Logger(BgeReranker.name);
  private pipelinePromise: Promise<RerankerPipeline> | undefined;
  private readonly modelId: string;

  constructor(modelId: string = DEFAULT_MODEL) {
    this.modelId = modelId;
  }

  async score(opts: RerankerScoreOptions): Promise<number[]> {
    if (opts.docs.length === 0) return [];
    const pipe = await this.getPipeline();

    // Sentence-pair classification: tokenizer takes parallel arrays of
    // queries and docs via the `text_pair` option. NOT an array of
    // {text, text_pair} objects (that's only valid for single inputs).
    const queries = opts.docs.map(() => opts.query);
    const tokens = pipe.tokenizer(queries, {
      text_pair: opts.docs,
      padding: true,
      truncation: true,
    });

    const outputs = await pipe.model(tokens);
    const logits = outputs.logits;
    const numLabels = logits.dims[logits.dims.length - 1] ?? 1;
    const rawData = logits.data;
    const data: number[] = [];
    for (let i = 0; i < rawData.length; i++) {
      data.push(Number(rawData[i]));
    }

    const scores: number[] = [];
    for (let i = 0; i < opts.docs.length; i++) {
      if (numLabels === 1) {
        // Regression head (bge-reranker base/large): raw logit IS the score.
        scores.push(data[i] ?? 0);
      } else {
        // Classification head: softmax + take "relevant" class probability.
        const row = data.slice(i * numLabels, (i + 1) * numLabels);
        const max = Math.max(...row);
        const exps = row.map((x) => Math.exp(x - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        const probs = exps.map((e) => e / sum);
        scores.push(probs[probs.length - 1] ?? 0);
      }
    }
    return scores;
  }

  private async getPipeline(): Promise<RerankerPipeline> {
    if (!this.pipelinePromise) {
      this.logger.log(`loading reranker model "${this.modelId}"…`);
      // Dynamic import so the ~550 MB package isn't loaded in test/mock paths.
      this.pipelinePromise = import('@xenova/transformers').then(
        (mod) =>
          mod.pipeline('text-classification', this.modelId, {
            quantized: true,
          }) as unknown as Promise<RerankerPipeline>,
      );
    }
    return this.pipelinePromise;
  }
}
