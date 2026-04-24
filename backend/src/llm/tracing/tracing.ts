/**
 * Per-call tracing record + sink interface + concrete sinks.
 *
 * Records are emitted by the TracingLlmClient / TracingEmbedder decorators.
 * Step 12's eval harness joins records against results.json for per-case
 * cost/latency/ttft columns in the output report.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TraceUsage {
  inputTokens: number;
  outputTokens?: number;
  totalTokens: number;
}

export interface TraceRecord {
  /** ISO 8601 timestamp at call-completion time. */
  timestamp: string;
  /** Provider model id, e.g. 'nvidia/nemotron-3-super-120b-a12b:free'. */
  model: string;
  /** Caller role (`LlmRole` or `EmbedRole`). Kept as string so both unions fit one field. */
  role: string;
  operation: 'generateText' | 'generateObject' | 'stream' | 'embed' | 'rerank';
  /** Optional correlation id threaded from chat controller → retrieval + LLM. */
  correlationId?: string;
  /** Only populated for `rerank` records — number of docs scored in the batch. */
  batchSize?: number;
  usage: TraceUsage;
  latencyMs: number;
  /** Present only for `stream` operations. */
  ttftMs?: number;
  finishReason?: string;
  /** Present only when the inner call threw. */
  error?: string;
}

export interface TraceSink {
  write(record: TraceRecord): void;
}

/** Appends trace records as newline-delimited JSON to a file. */
export class JsonlTraceSink implements TraceSink {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  write(record: TraceRecord): void {
    appendFileSync(this.path, JSON.stringify(record) + '\n');
  }
}

/** No-op sink for test envs where tracing is undesirable. */
export class NoopTraceSink implements TraceSink {
  write(): void {
    // intentionally empty
  }
}

/** YYYY-MM-DD daily-rotated path, joined on `baseDir`. */
export function todayTracePath(baseDir: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${baseDir}/${date}.jsonl`;
}
