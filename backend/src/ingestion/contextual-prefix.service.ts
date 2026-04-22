/**
 * Generates a 1–2 sentence document-level summary once per document (v1 of
 * contextual retrieval, see step.md design notes). The summary is stored on
 * `ChunkMetadata.contextualPrefix` for every chunk from the document and is
 * prepended to chunk text before embedding — lifts dense-retrieval quality on
 * ambiguous chunks by giving the embedding model a doc-level disambiguator.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';
import {
  PREFIX_LLM_CLIENT,
  type LlmClient,
} from '@app/llm/ports/llm-client.port';

const DEFAULT_MODEL = 'gemma2:27b';
const MAX_OUTPUT_TOKENS = 150;
/**
 * Gemma 2's context window is 8 192 tokens. We truncate the input doc to
 * ~6 000 characters (≈ 1 500 tokens at the 4-char-per-token proxy), leaving
 * comfortable headroom for the prompt wrapper + summary output.
 *
 * This is safe on arXiv papers: the first ~6 000 characters always include
 * the title + abstract + intro, which is exactly what you want a *doc-level*
 * summary to be about. Later sections don't contribute meaningfully to
 * "what is this document about?" framing.
 */
const MAX_INPUT_CHARS = 6000;

const PROMPT_TEMPLATE = `Summarize the following document in one or two sentences. The summary will be prepended to individual chunks from this document during retrieval, so it should state what the document is about (title, topic, scope) — not its conclusions.

Title: {{title}}

Document:
{{text}}

Summary:`;

@Injectable()
export class ContextualPrefixService {
  private readonly logger = new Logger(ContextualPrefixService.name);
  private readonly model: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(PREFIX_LLM_CLIENT) private readonly client: LlmClient,
  ) {
    this.model = config.file.ingestion?.prefixModel ?? DEFAULT_MODEL;
  }

  async summarize(doc: { title: string; text: string }): Promise<string> {
    const truncated =
      doc.text.length > MAX_INPUT_CHARS
        ? doc.text.slice(0, MAX_INPUT_CHARS)
        : doc.text;
    const prompt = PROMPT_TEMPLATE.replace('{{title}}', doc.title).replace(
      '{{text}}',
      truncated,
    );
    const res = await this.client.generateText({
      model: this.model,
      role: 'prefix',
      prompt,
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    const summary = res.text.trim();
    this.logger.debug(
      `summarize "${doc.title}": ${summary.length} chars, ${res.usage.totalTokens} tokens, ${res.latencyMs}ms`,
    );
    return summary;
  }
}
