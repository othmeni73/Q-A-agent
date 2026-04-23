/**
 * Post-stream citation extractor.
 *
 * Given the completed assistant answer and the retrieval hits the model saw,
 * return a structured list of which chunks the answer cites. Primary path is
 * LLM-driven (generateObject with CitationPickSchema). Fallback path is a
 * regex sweep over [N] markers in the answer text. Empty array if both fail
 * or if the answer genuinely cites nothing (e.g. a refusal).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';
import { LLM_CLIENT, type LlmClient } from '@app/llm/ports/llm-client.port';
import { PromptLoaderService } from '@app/prompts/prompt-loader.service';
import type { RetrievalHit } from '@app/retrieval/types';

import { CitationPickSchema, type ResolvedCitation } from './citations.schema';

const CITATION_MARK_RE = /\[(\d+)\]/g;

@Injectable()
export class CitationsService {
  private readonly logger = new Logger(CitationsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PromptLoaderService) private readonly prompts: PromptLoaderService,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
  ) {}

  /**
   * Extract citations from a finished assistant turn.
   *
   * Tries generateObject first; retries once on parse failure; falls back to
   * regex on the answer text if both attempts fail. Then enriches each index
   * from the retrieval hit metadata and returns sorted, deduplicated,
   * range-filtered citations.
   */
  async pick(
    answer: string,
    hits: RetrievalHit[],
  ): Promise<ResolvedCitation[]> {
    if (hits.length === 0 || answer.trim().length === 0) return [];

    let indices: number[];
    try {
      indices = await this.askLlm(answer, hits.length);
    } catch (err) {
      this.logger.warn(
        `citation-picker first attempt failed: ${errMsg(err)}; retrying`,
      );
      try {
        indices = await this.askLlm(answer, hits.length);
      } catch (err2) {
        this.logger.warn(
          `citation-picker retry failed: ${errMsg(err2)}; falling back to regex`,
        );
        indices = extractRegex(answer);
      }
    }

    return enrich(indices, hits);
  }

  private async askLlm(answer: string, chunkCount: number): Promise<number[]> {
    const chatCfg = this.config.file.chat;
    if (!chatCfg) {
      throw new Error(
        'chat config missing — CitationsService requires chat.model',
      );
    }
    const prompt = this.prompts.get('citation-picker', {
      answer,
      chunkCount: String(chunkCount),
    });
    const result = await this.llm.generateObject({
      model: chatCfg.model,
      role: 'citation-picker',
      prompt,
      schema: CitationPickSchema,
      temperature: 0,
      maxOutputTokens: 256,
    });
    return result.object.used;
  }
}

function extractRegex(answer: string): number[] {
  const out = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = CITATION_MARK_RE.exec(answer)) !== null) {
    const n = parseInt(m[1] ?? '0', 10);
    if (n > 0) out.add(n);
  }
  return Array.from(out);
}

function enrich(indices: number[], hits: RetrievalHit[]): ResolvedCitation[] {
  const unique = Array.from(new Set(indices)).sort((a, b) => a - b);
  const out: ResolvedCitation[] = [];
  for (const n of unique) {
    if (n < 1 || n > hits.length) continue;
    const hit = hits[n - 1];
    const meta = hit.metadata;
    const paperId =
      typeof meta['paperId'] === 'string' ? meta['paperId'] : undefined;
    out.push({
      n,
      sourceTitle: meta.sourceTitle,
      chunkIndex: meta.chunkIndex,
      paperId,
      arxivId: meta.arxivId,
      year: meta.year,
      authors: meta.authors,
      sectionPath: meta.sectionPath,
    });
  }
  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
