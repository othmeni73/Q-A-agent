/**
 * Deterministic mock reranker for unit tests. Scores by inverse document
 * length so tests can assert ordering without needing the real ONNX model.
 */

import { Injectable } from '@nestjs/common';

import type { Reranker, RerankerScoreOptions } from '../ports/reranker.port';

@Injectable()
export class MockReranker implements Reranker {
  score(opts: RerankerScoreOptions): Promise<number[]> {
    // Shorter docs score higher — arbitrary but deterministic.
    const scores = opts.docs.map((d) => 1 / (1 + d.length));
    return Promise.resolve(scores);
  }
}
