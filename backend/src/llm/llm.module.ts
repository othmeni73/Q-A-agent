/**
 * Wires the LLM layer for NestJS.
 *
 * Selects adapters via `NODE_ENV` / `LLM_ADAPTER`:
 *   - test or `LLM_ADAPTER=mock` → `MockLlmClient` + `MockEmbedder`
 *   - default                   → real adapters:
 *       LLM_CLIENT         → OpenRouter (chat, rewriter)
 *       PREFIX_LLM_CLIENT  → local Ollama (contextual prefix at ingest)
 *       EMBEDDER           → local Ollama (dense embeddings at ingest + query)
 *
 * Every adapter is wrapped with its tracing decorator, which writes per-call
 * records to a daily-rotated JSONL file under `backend/traces/YYYY-MM-DD.jsonl`.
 * In test mode the sink is a no-op (avoids polluting the repo during test runs).
 */

import { Global, Module } from '@nestjs/common';
import { join } from 'node:path';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';

import { BgeReranker } from './adapters/bge-reranker.adapter';
import { MockEmbedder, MockLlmClient } from './adapters/mock-llm.adapter';
import { MockReranker } from './adapters/mock-reranker.adapter';
import { OllamaEmbedder } from './adapters/ollama-embedder.adapter';
import { OllamaLlmClient } from './adapters/ollama-llm.adapter';
import { OpenRouterLlmClient } from './adapters/openrouter-llm.adapter';
import { EMBEDDER, type Embedder } from './ports/embedder.port';
import {
  LLM_CLIENT,
  PREFIX_LLM_CLIENT,
  type LlmClient,
} from './ports/llm-client.port';
import { RERANKER, type Reranker } from './ports/reranker.port';
import {
  JsonlTraceSink,
  NoopTraceSink,
  todayTracePath,
  type TraceSink,
} from './tracing/tracing';
import {
  TracingEmbedder,
  TracingLlmClient,
} from './tracing/tracing-llm.decorator';

const TRACE_SINK = Symbol('TRACE_SINK');

/**
 * Returns true when the mock adapter should be used.
 * Auto-enabled in the test environment (Jest sets NODE_ENV=test) so e2e tests
 * boot AppModule without needing any provider key. Explicit opt-in via
 * LLM_ADAPTER=mock still works outside tests (e.g. local dev without keys).
 */
function useMockAdapter(config: AppConfig): boolean {
  return (
    config.env.NODE_ENV === 'test' || process.env['LLM_ADAPTER'] === 'mock'
  );
}

@Global()
@Module({
  providers: [
    {
      provide: TRACE_SINK,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): TraceSink => {
        if (config.env.NODE_ENV === 'test') {
          return new NoopTraceSink();
        }
        return new JsonlTraceSink(
          todayTracePath(join(process.cwd(), 'traces')),
        );
      },
    },
    {
      provide: LLM_CLIENT,
      inject: [APP_CONFIG, TRACE_SINK],
      useFactory: (config: AppConfig, sink: TraceSink): LlmClient => {
        if (useMockAdapter(config)) {
          return new TracingLlmClient(new MockLlmClient(), sink);
        }
        const key = process.env['OPENROUTER_API_KEY'];
        if (!key) {
          throw new Error(
            'OPENROUTER_API_KEY not set (or set LLM_ADAPTER=mock for test/CI runs)',
          );
        }
        return new TracingLlmClient(new OpenRouterLlmClient(key), sink);
      },
    },
    {
      provide: EMBEDDER,
      inject: [APP_CONFIG, TRACE_SINK],
      useFactory: (config: AppConfig, sink: TraceSink): Embedder => {
        if (useMockAdapter(config)) {
          return new TracingEmbedder(new MockEmbedder(), sink);
        }
        const baseUrl =
          config.file.ingestion?.embedBaseUrl ?? 'http://localhost:11434/v1';
        return new TracingEmbedder(new OllamaEmbedder({ baseUrl }), sink);
      },
    },
    {
      provide: PREFIX_LLM_CLIENT,
      inject: [APP_CONFIG, TRACE_SINK],
      useFactory: (config: AppConfig, sink: TraceSink): LlmClient => {
        if (useMockAdapter(config)) {
          return new TracingLlmClient(new MockLlmClient(), sink);
        }
        const baseUrl =
          config.file.ingestion?.prefixBaseUrl ?? 'http://localhost:11434/v1';
        return new TracingLlmClient(new OllamaLlmClient({ baseUrl }), sink);
      },
    },
    {
      provide: RERANKER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Reranker => {
        if (useMockAdapter(config)) {
          return new MockReranker();
        }
        const modelId =
          config.file.retrieval?.rerankerModel ?? 'Xenova/bge-reranker-large';
        return new BgeReranker(modelId);
      },
    },
  ],
  exports: [LLM_CLIENT, EMBEDDER, PREFIX_LLM_CLIENT, RERANKER],
})
export class LlmModule {}
