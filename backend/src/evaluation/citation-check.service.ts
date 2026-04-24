/**
 * Programmatic (no-LLM) citation-accuracy check — the spec's "are citations
 * present and correct?" axis, collapsed to a single pass/fail boolean.
 *
 * Definition: accuracy = |cited| > 0 AND cited ⊆ retrieved.
 *
 * Refusals legitimately have no citations; callers exclude them from the
 * aggregate rather than treating no-citations as a fail universally.
 */

import { Injectable } from '@nestjs/common';

import type { ResolvedCitation } from '@app/chat/citations.schema';
import type { RetrievalHit } from '@app/retrieval/types';

export interface CitationCheckResult {
  /** Spec's Citation accuracy — pass/fail. */
  accuracy: boolean;
  /** Deduped cited arxiv ids from the answer (diagnostic). */
  citedArxivIds: string[];
  /** Deduped retrieved arxiv ids (diagnostic / reproducibility). */
  retrievedArxivIds: string[];
}

@Injectable()
export class CitationCheckService {
  evaluate(
    citations: ResolvedCitation[],
    retrievedHits: RetrievalHit[],
  ): CitationCheckResult {
    const R = new Set(
      retrievedHits
        .map((h) => h.metadata.arxivId)
        .filter((id): id is string => typeof id === 'string'),
    );
    const C = new Set(
      citations
        .map((c) => c.arxivId)
        .filter((id): id is string => typeof id === 'string'),
    );

    const accuracy = C.size > 0 && [...C].every((id) => R.has(id));

    return {
      accuracy,
      citedArxivIds: [...C],
      retrievedArxivIds: [...R],
    };
  }
}
