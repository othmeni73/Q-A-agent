import { z } from 'zod';

/** Zod schema for the pointwise-judge's structured output — validated on parse. */
export const PointwiseSchema = z.object({
  correctness: z.number().int().min(0).max(5),
  faithfulness: z.number().int().min(0).max(5),
  reasoning: z.string(),
});
