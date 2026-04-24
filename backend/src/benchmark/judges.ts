import { generateText, type LanguageModel } from 'ai';

import { withBackoff } from '@app/utils/backoff';
import { getThrottle } from '@app/utils/concurrency';
import { stripJsonFences } from '@app/utils/format';
import { interpolate } from '@app/utils/prompts';
import { PointwiseSchema } from './schemas';
import type { BenchmarkCase, Pointwise } from './types';

export interface JudgeConfig {
  /** AI-SDK model instance for the judge — typically `ollama(JUDGE_MODEL)`. */
  model: LanguageModel;
  /** Loaded + interpolated pointwise-judge prompt template. */
  pointwiseTpl: string;
  /** Loaded + interpolated pairwise-judge prompt template. */
  pairwiseTpl: string;
  /** Minimum ms between consecutive judge calls (0 = no throttle). */
  throttleMs: number;
}

/**
 * Pointwise judge: returns `{ correctness, faithfulness, reasoning }` on the case.
 * Skipped (returns null) for OOS/adversarial cases — those are decided fully by programmatic checks.
 * Parse failures log and return null so the aggregator can downrank the case without crashing the run.
 */
export async function pointwiseJudge(
  tc: BenchmarkCase,
  answer: string,
  cfg: JudgeConfig,
): Promise<Pointwise | null> {
  if (tc.type === 'out-of-scope' || tc.type === 'adversarial') return null;
  const prompt = interpolate(cfg.pointwiseTpl, {
    question: tc.question,
    context: tc.context,
    answer,
  });
  try {
    await getThrottle('judge', cfg.throttleMs).acquire();
    // generateText + manual Zod parse (not generateObject) because Ollama's
    // OpenAI-compat endpoint doesn't propagate `response_format` with JSON
    // schemas for Gemma — AI SDK would fall back to prompt-engineering and
    // emit a warning per call.
    const res = await withBackoff(() =>
      generateText({
        model: cfg.model,
        prompt,
        temperature: 0,
        maxOutputTokens: 300,
      }),
    );
    return PointwiseSchema.parse(JSON.parse(stripJsonFences(res.text)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    console.error(`  pointwise judge failed: ${msg}`);
    return null;
  }
}

/** Pairwise judge, single ordering. Returns 'A' | 'B' | 'T' (tie). */
export async function pairwiseOnce(
  question: string,
  a: string,
  b: string,
  cfg: JudgeConfig,
): Promise<'A' | 'B' | 'T'> {
  const prompt = interpolate(cfg.pairwiseTpl, {
    question,
    answerA: a,
    answerB: b,
  });
  await getThrottle('judge', cfg.throttleMs).acquire();
  const res = await withBackoff(() =>
    generateText({
      model: cfg.model,
      prompt,
      temperature: 0,
      maxOutputTokens: 4,
    }),
  );
  const v = res.text.trim().charAt(0).toUpperCase();
  return v === 'A' || v === 'B' ? v : 'T';
}

/**
 * Symmetric-ordering wrapper: kills position bias.
 * Only counts a candidate as a winner when both orderings agree (A-vs-B == A AND B-vs-A == B).
 * Disagreements and identical answers are ties.
 */
export async function pairwiseSymmetric(
  question: string,
  a: string,
  b: string,
  cfg: JudgeConfig,
): Promise<'A' | 'B' | 'T'> {
  if (a.trim() === b.trim()) return 'T';
  const [ab, ba] = await Promise.all([
    pairwiseOnce(question, a, b, cfg),
    pairwiseOnce(question, b, a, cfg),
  ]);
  if (ab === 'A' && ba === 'B') return 'A';
  if (ab === 'B' && ba === 'A') return 'B';
  return 'T';
}
