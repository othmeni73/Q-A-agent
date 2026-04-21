/**
 * Wires the LLM layer for NestJS.
 *
 * Selects the adapter via the `LLM_ADAPTER` env var:
 *   - `mock`  → `MockLlmClient` + `MockEmbedder` (for CI and unit tests)
 *   - default → real `OpenRouterLlmClient` + `GoogleEmbedder` (needs keys)
 *
 * Every adapter is wrapped with its tracing decorator, which writes per-call
 * records to a daily-rotated JSONL file under `backend/traces/YYYY-MM-DD.jsonl`.
 * In test mode the sink is a no-op (avoids polluting the repo during test runs).
 */

import { Global, Module } from '@nestjs/common';
import { join } from 'node:path';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';

import { GoogleEmbedder } from './adapters/google-embedder.adapter';
import { MockEmbedder, MockLlmClient } from './adapters/mock-llm.adapter';
import { OpenRouterLlmClient } from './adapters/openrouter-llm.adapter';
import { EMBEDDER, type Embedder } from './ports/embedder.port';
import { LLM_CLIENT, type LlmClient } from './ports/llm-client.port';
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
      inject: [TRACE_SINK],
      useFactory: (sink: TraceSink): LlmClient => {
        if (process.env['LLM_ADAPTER'] === 'mock') {
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
      inject: [TRACE_SINK],
      useFactory: (sink: TraceSink): Embedder => {
        if (process.env['LLM_ADAPTER'] === 'mock') {
          return new TracingEmbedder(new MockEmbedder(), sink);
        }
        const key = process.env['GOOGLE_GENERATIVE_AI_API_KEY'];
        if (!key) {
          throw new Error(
            'GOOGLE_GENERATIVE_AI_API_KEY not set (or set LLM_ADAPTER=mock for test/CI runs)',
          );
        }
        return new TracingEmbedder(new GoogleEmbedder(key), sink);
      },
    },
  ],
  exports: [LLM_CLIENT, EMBEDDER],
})
export class LlmModule {}
