import { z } from 'zod';

/**
 * What we ask the LLM to produce via generateObject.
 * Kept minimal on purpose — the model can only hallucinate integers here,
 * and integers are easy to range-check server-side.
 */
export const CitationPickSchema = z.object({
  used: z.array(z.number().int().positive()).max(20),
});
export type CitationPick = z.infer<typeof CitationPickSchema>;

/**
 * What the server returns in the `done` SSE event after enrichment.
 * The `n` field matches the `[N]` marker in the assistant's text; everything
 * else is copied from the retrieval hit's metadata (no DB round-trip).
 */
export interface ResolvedCitation {
  /** 1-indexed marker number as seen in the assistant's answer text. */
  n: number;
  sourceTitle: string;
  chunkIndex: number;
  /** FK into the papers table for drill-down. Absent when the chunk lacks it. */
  paperId?: string;
  arxivId?: string;
  year?: number;
  authors?: string[];
  sectionPath?: string;
}
