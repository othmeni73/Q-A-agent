/**
 * End-to-end retrieval: query → hybrid search → RRF → rerank → MMR → top-k.
 *
 * Stages are individually toggleable via `TopKOpts` so Step-13 eval ablations
 * (`baseline` / `+hybrid+rerank` / `+full`) can run against the same service.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';
import { bm25Tokens } from '@app/ingestion/sparse-tokenizer';
import { EMBEDDER, type Embedder } from '@app/llm/ports/embedder.port';
import { RERANKER, type Reranker } from '@app/llm/ports/reranker.port';
import {
  VECTOR_STORE,
  type VectorStore,
} from '@app/vector/ports/vector-store.port';

import { mmrSelect } from './mmr';
import { rrfFuse } from './rrf';
import type { RetrievalHit, TopKOpts } from './types';

const DEFAULT_DENSE_K = 20;
const DEFAULT_SPARSE_K = 20;
const DEFAULT_RERANK_K = 8;
const DEFAULT_FINAL_K = 5;
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_COLLECTION = 'agentic-systems-papers';

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly collection: string;
  private readonly embedModel: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
    @Inject(RERANKER) private readonly reranker: Reranker,
    @Inject(VECTOR_STORE) private readonly store: VectorStore,
  ) {
    this.collection = config.file.vector?.collection ?? DEFAULT_COLLECTION;
    this.embedModel = config.file.ingestion?.embedModel ?? DEFAULT_EMBED_MODEL;
  }

  async topK(query: string, opts: TopKOpts = {}): Promise<RetrievalHit[]> {
    const t0 = Date.now();
    const k = opts.k ?? DEFAULT_FINAL_K;
    const doRerank = opts.rerank ?? true;
    const doMmr = opts.mmr ?? true;

    // Stage 1 — embed + tokenise the query.
    const embedRes = await this.embedder.embed({
      model: this.embedModel,
      role: 'query',
      values: [query],
    });
    const queryVector = embedRes.embeddings[0];
    const sparse = bm25Tokens(query);
    const tEmbed = Date.now() - t0;

    // Stage 2 — dense + sparse, in parallel.
    const [dense, sparseHits] = await Promise.all([
      this.store.queryDense({
        collection: this.collection,
        queryVector,
        k: DEFAULT_DENSE_K,
        filter: opts.filter,
        withVector: doMmr, // need dense vectors back for MMR if it'll run
      }),
      this.store.querySparse({
        collection: this.collection,
        queryVector: sparse,
        k: DEFAULT_SPARSE_K,
        filter: opts.filter,
      }),
    ]);
    const tSearch = Date.now() - t0 - tEmbed;

    // Stage 3 — RRF fuse the two lists.
    const fused = rrfFuse([dense, sparseHits]);
    if (fused.length === 0) return [];

    // Stage 4 — cross-encoder rerank (optional).
    let reranked: RetrievalHit[] = fused;
    if (doRerank) {
      const top = fused.slice(0, DEFAULT_RERANK_K);
      const scores = await this.reranker.score({
        query,
        docs: top.map(
          (h) =>
            `${typeof h.metadata.contextualPrefix === 'string' ? h.metadata.contextualPrefix : ''}\n\n${h.metadata.text}`,
        ),
      });
      reranked = top
        .map((h, i) => ({ ...h, rerankScore: scores[i] ?? 0 }))
        .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
    }
    const tRerank = Date.now() - t0 - tEmbed - tSearch;

    // Stage 5 — MMR diversify (optional).
    let finalHits: RetrievalHit[];
    if (doMmr) {
      finalHits = mmrSelect(reranked, { queryVector, k });
      // If MMR dropped items (e.g., candidates without dense vectors), fall
      // back to pre-MMR order for the missing slots.
      if (finalHits.length < k) {
        const seen = new Set(finalHits.map((h) => h.id));
        for (const h of reranked) {
          if (finalHits.length >= k) break;
          if (!seen.has(h.id)) finalHits.push(h);
        }
      }
    } else {
      finalHits = reranked.slice(0, k);
    }

    this.logger.debug(
      `topK "${hashQuery(query)}" — embed=${tEmbed}ms search=${tSearch}ms rerank=${tRerank}ms total=${
        Date.now() - t0
      }ms hits=${finalHits.length}`,
    );
    return finalHits;
  }
}

/** Short stable fingerprint of the query for logs (no PII). */
function hashQuery(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
