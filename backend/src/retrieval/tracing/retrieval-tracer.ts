import { Injectable, Logger } from '@nestjs/common';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface RetrievalStageTrace {
  k?: number;
  latencyMs: number;
  hits?: { id: string | number; rank: number; score: number }[];
}

export interface RetrievalTraceRecord {
  ts: string;
  op: 'retrieval';
  correlationId?: string;
  queryHash: string;
  stages: {
    embed: RetrievalStageTrace;
    dense: RetrievalStageTrace;
    sparse: RetrievalStageTrace;
    rrf: RetrievalStageTrace;
    rerank?: RetrievalStageTrace;
    mmr?: RetrievalStageTrace;
  };
  totalLatencyMs: number;
  finalHitCount: number;
}

export interface RetrievalTracer {
  write(record: RetrievalTraceRecord): void;
}

function todayPath(dir: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return join(dir, `${d}.jsonl`);
}

@Injectable()
export class JsonlRetrievalTracer implements RetrievalTracer {
  private readonly logger = new Logger(JsonlRetrievalTracer.name);
  private readonly path: string;

  constructor(tracesDir: string = join(process.cwd(), 'traces')) {
    this.path = todayPath(tracesDir);
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  write(record: RetrievalTraceRecord): void {
    try {
      appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (err) {
      this.logger.warn(
        `failed to write retrieval trace: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

@Injectable()
export class NoopRetrievalTracer implements RetrievalTracer {
  write(_record: RetrievalTraceRecord): void {
    /* intentionally empty */
  }
}

export const RETRIEVAL_TRACER = Symbol('RETRIEVAL_TRACER');
