import { generateText, type LanguageModel } from 'ai';

import { withBackoff } from '@app/utils/backoff';
import { getThrottle } from '@app/utils/concurrency';
import type { BenchmarkCase } from './types';

export interface GenerationConfig {
  /**
   * Factory that returns an AI-SDK model instance for the given candidate id.
   * Typically `(id) => openrouter(id)` so one provider client serves all candidates.
   */
  modelFactory: (modelId: string) => LanguageModel;
  /** Identical system prompt fed to every candidate (keeps the benchmark an apples-to-apples test). */
  system: string;
  /** Minimum ms between consecutive calls to the same candidate model. */
  throttleMs: number;
}

export interface GenerationResult {
  answer: string;
  latencyMs: number;
  completionTokens: number;
}

/**
 * Generate an answer for a single `(case, candidate)` pair.
 * Throttle is keyed by the candidate model id so every candidate has its own rate clock.
 */
export async function generateAnswer(
  modelId: string,
  tc: BenchmarkCase,
  cfg: GenerationConfig,
): Promise<GenerationResult> {
  await getThrottle(modelId, cfg.throttleMs).acquire();
  const t0 = Date.now();
  const res = await withBackoff(() =>
    generateText({
      model: cfg.modelFactory(modelId),
      system: cfg.system,
      prompt: `Context:\n${tc.context}\n\nQuestion: ${tc.question}`,
      temperature: 0.2,
      maxOutputTokens: 400,
    }),
  );
  return {
    answer: res.text.trim(),
    latencyMs: Date.now() - t0,
    completionTokens: res.usage?.outputTokens ?? 0,
  };
}
