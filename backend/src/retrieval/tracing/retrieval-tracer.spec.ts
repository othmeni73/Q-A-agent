import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  JsonlRetrievalTracer,
  NoopRetrievalTracer,
  type RetrievalTraceRecord,
} from './retrieval-tracer';

function sampleRecord(): RetrievalTraceRecord {
  return {
    ts: '2026-04-23T12:00:00.000Z',
    op: 'retrieval',
    correlationId: 'cid-abc',
    queryHash: 'deadbeef',
    stages: {
      embed: { latencyMs: 12 },
      dense: { k: 20, latencyMs: 3 },
      sparse: { k: 20, latencyMs: 2 },
      rrf: { latencyMs: 1 },
    },
    totalLatencyMs: 18,
    finalHitCount: 5,
  };
}

describe('JsonlRetrievalTracer', () => {
  it('writes one JSON line per write() call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-trace-'));
    try {
      const tracer = new JsonlRetrievalTracer(dir);
      tracer.write(sampleRecord());
      tracer.write(sampleRecord());

      const date = new Date().toISOString().slice(0, 10);
      const path = join(dir, `${date}.jsonl`);
      const contents = readFileSync(path, 'utf8').trim().split('\n');
      expect(contents).toHaveLength(2);
      for (const line of contents) {
        const parsed = JSON.parse(line) as RetrievalTraceRecord;
        expect(parsed.op).toBe('retrieval');
        expect(parsed.queryHash).toBe('deadbeef');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the traces dir when missing', () => {
    const parent = mkdtempSync(join(tmpdir(), 'rt-trace-'));
    const dir = join(parent, 'nested', 'traces');
    try {
      expect(existsSync(dir)).toBe(false);
      new JsonlRetrievalTracer(dir);
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('NoopRetrievalTracer', () => {
  it('swallows calls silently', () => {
    const tracer = new NoopRetrievalTracer();
    expect(() => tracer.write(sampleRecord())).not.toThrow();
  });
});
