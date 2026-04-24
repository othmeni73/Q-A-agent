/**
 * Wires the LLM layer for NestJS.
 *
 * Adapter selection (`useMockAdapter`):
 *   - LLM_ADAPTER=mock           → MockLlmClient + MockEmbedder + MockReranker
 *   - LLM_ADAPTER=real           → real adapters (hard opt-out of the NODE_ENV=test default)
 *   - default                    → NODE_ENV=test gets mocks, anything else gets real
 *
 * The `LLM_ADAPTER=real` override exists for the Step-13 eval harness, which
 * sets `NODE_ENV=test` to get :memory: SQLite but still needs real LLMs.
 *
 * Tracing (`tracingEnabled()` — reads DISABLE_TRACING env):
 *   - DISABLE_TRACING=1          → NoopTraceSink (Jest)
 *   - default                    → JsonlTraceSink under backend/traces/YYYY-MM-DD.jsonl
 *
 * Decoupling NODE_ENV=test from tracing lets eval have real traces + :memory: SQLite.
 */

import { Global, Module } from '@nestjs/common';
import { join } from 'node:path';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';
import { tracingEnabled } from '@app/tracing/enabled';

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
import { TracingReranker } from './tracing/tracing-reranker.decorator';

const TRACE_SINK = Symbol('TRACE_SINK');

function useMockAdapter(config: AppConfig): boolean {
  const explicit = process.env['LLM_ADAPTER'];
  if (explicit === 'mock') return true;
  if (explicit === 'real') return false;
  return config.env.NODE_ENV === 'test';
}

@Global()
@Module({
  providers: [
    {
      provide: TRACE_SINK,
      useFactory: (): TraceSink => {
        if (!tracingEnabled()) return new NoopTraceSink();
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
      inject: [APP_CONFIG, TRACE_SINK],
      useFactory: (config: AppConfig, sink: TraceSink): Reranker => {
        if (useMockAdapter(config)) return new MockReranker();
        const modelId =
          config.file.retrieval?.rerankerModel ?? 'Xenova/bge-reranker-large';
        return new TracingReranker(new BgeReranker(modelId), sink);
      },
    },
  ],
  exports: [LLM_CLIENT, EMBEDDER, PREFIX_LLM_CLIENT, RERANKER],
})
export class LlmModule {}
