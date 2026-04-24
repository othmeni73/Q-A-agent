/**
 * End-to-end retrieval: query → hybrid search → RRF → rerank → MMR → top-k.
 *
 * Stages are individually toggleable via `TopKOpts` so Step-13 eval ablations
 * (`baseline` / `+rerank` / `+full`) can run against the same service.
 *
 * Emits a structured `op: "retrieval"` trace record per `topK()` call via the
 * injected `RetrievalTracer` — per-stage timings + top-k hit ids, joinable
 * post-hoc by correlationId against the LLM trace lane for per-case cost.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';

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
import {
  RETRIEVAL_TRACER,
  type RetrievalStageTrace,
  type RetrievalTracer,
} from './tracing/retrieval-tracer';
import type { RetrievalHit, TopKOpts } from './types';

const DEFAULT_DENSE_K = 20;
const DEFAULT_SPARSE_K = 20;
const DEFAULT_RERANK_K = 8;
const DEFAULT_FINAL_K = 5;
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_COLLECTION = 'agentic-systems-papers';

@Injectable()
export class RetrievalService {
  private readonly collection: string;
  private readonly embedModel: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
    @Inject(RERANKER) private readonly reranker: Reranker,
    @Inject(VECTOR_STORE) private readonly store: VectorStore,
    @Optional()
    @Inject(RETRIEVAL_TRACER)
    private readonly tracer: RetrievalTracer | null = null,
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
    const embedStart = Date.now();
    const embedRes = await this.embedder.embed({
      model: this.embedModel,
      role: 'query',
      values: [query],
    });
    const queryVector = embedRes.embeddings[0];
    const sparse = bm25Tokens(query);
    const embedTrace: RetrievalStageTrace = {
      latencyMs: Date.now() - embedStart,
    };

    // Stage 2 — dense + sparse, in parallel.
    const searchStart = Date.now();
    const [dense, sparseHits] = await Promise.all([
      this.store.queryDense({
        collection: this.collection,
        queryVector,
        k: DEFAULT_DENSE_K,
        filter: opts.filter,
        withVector: doMmr,
      }),
      this.store.querySparse({
        collection: this.collection,
        queryVector: sparse,
        k: DEFAULT_SPARSE_K,
        filter: opts.filter,
      }),
    ]);
    const searchEnd = Date.now();
    const denseTrace: RetrievalStageTrace = {
      k: DEFAULT_DENSE_K,
      latencyMs: searchEnd - searchStart,
      hits: dense.slice(0, 5).map((h, i) => ({
        id: h.id,
        rank: i + 1,
        score: h.score,
      })),
    };
    const sparseTrace: RetrievalStageTrace = {
      k: DEFAULT_SPARSE_K,
      latencyMs: searchEnd - searchStart,
      hits: sparseHits.slice(0, 5).map((h, i) => ({
        id: h.id,
        rank: i + 1,
        score: h.score,
      })),
    };

    // Stage 3 — RRF fuse the two lists.
    const rrfStart = Date.now();
    const fused = rrfFuse([dense, sparseHits]);
    const rrfTrace: RetrievalStageTrace = {
      latencyMs: Date.now() - rrfStart,
      hits: fused.slice(0, 5).map((h, i) => ({
        id: h.id,
        rank: i + 1,
        score: h.fusedScore ?? 0,
      })),
    };
    if (fused.length === 0) {
      this.tracer?.write({
        ts: new Date().toISOString(),
        op: 'retrieval',
        correlationId: opts.correlationId,
        queryHash: hashQuery(query),
        stages: {
          embed: embedTrace,
          dense: denseTrace,
          sparse: sparseTrace,
          rrf: rrfTrace,
        },
        totalLatencyMs: Date.now() - t0,
        finalHitCount: 0,
      });
      return [];
    }

    // Stage 4 — cross-encoder rerank (optional).
    let reranked: RetrievalHit[] = fused;
    let rerankTrace: RetrievalStageTrace | undefined;
    if (doRerank) {
      const rerankStart = Date.now();
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
      rerankTrace = {
        k: DEFAULT_RERANK_K,
        latencyMs: Date.now() - rerankStart,
        hits: reranked.slice(0, 5).map((h, i) => ({
          id: h.id,
          rank: i + 1,
          score: h.rerankScore ?? 0,
        })),
      };
    }

    // Stage 5 — MMR diversify (optional).
    let finalHits: RetrievalHit[];
    let mmrTrace: RetrievalStageTrace | undefined;
    if (doMmr) {
      const mmrStart = Date.now();
      finalHits = mmrSelect(reranked, { queryVector, k });
      if (finalHits.length < k) {
        const seen = new Set(finalHits.map((h) => h.id));
        for (const h of reranked) {
          if (finalHits.length >= k) break;
          if (!seen.has(h.id)) finalHits.push(h);
        }
      }
      mmrTrace = {
        k,
        latencyMs: Date.now() - mmrStart,
        hits: finalHits.map((h, i) => ({
          id: h.id,
          rank: i + 1,
          score: h.mmrScore ?? h.rerankScore ?? h.fusedScore ?? 0,
        })),
      };
    } else {
      finalHits = reranked.slice(0, k);
    }

    this.tracer?.write({
      ts: new Date().toISOString(),
      op: 'retrieval',
      correlationId: opts.correlationId,
      queryHash: hashQuery(query),
      stages: {
        embed: embedTrace,
        dense: denseTrace,
        sparse: sparseTrace,
        rrf: rrfTrace,
        rerank: rerankTrace,
        mmr: mmrTrace,
      },
      totalLatencyMs: Date.now() - t0,
      finalHitCount: finalHits.length,
    });

    return finalHits;
  }
}

function hashQuery(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
