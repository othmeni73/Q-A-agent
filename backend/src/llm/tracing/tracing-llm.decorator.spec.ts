import {
  MockEmbedder,
  MockLlmClient,
} from '@app/llm/adapters/mock-llm.adapter';
import type { LlmClient } from '@app/llm/ports/llm-client.port';

import type { TraceRecord, TraceSink } from './tracing';
import { TracingEmbedder, TracingLlmClient } from './tracing-llm.decorator';

class CapturingSink implements TraceSink {
  public records: TraceRecord[] = [];
  write(r: TraceRecord): void {
    this.records.push(r);
  }
}

describe('TracingLlmClient', () => {
  it('emits a trace record after generateText', async () => {
    const sink = new CapturingSink();
    const client = new TracingLlmClient(new MockLlmClient(), sink);
    await client.generateText({ model: 'm', role: 'chat', prompt: 'hi' });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].operation).toBe('generateText');
    expect(sink.records[0].model).toBe('m');
    expect(sink.records[0].role).toBe('chat');
    expect(sink.records[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('emits one record after stream completes, carrying ttftMs', async () => {
    const sink = new CapturingSink();
    const client = new TracingLlmClient(new MockLlmClient(), sink);
    const res = client.stream({
      model: 'm',
      role: 'chat',
      messages: [{ role: 'user', content: 'hi' }],
    });
    for await (const _ of res.textStream) {
      // drain
    }
    await res.done;
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].operation).toBe('stream');
    expect(sink.records[0].ttftMs).toBeDefined();
  });

  it('emits an error record and rethrows when the inner call throws', async () => {
    const sink = new CapturingSink();
    const failing: LlmClient = {
      generateText: () => Promise.reject(new Error('boom')),
      generateObject: () => Promise.reject(new Error('na')),
      stream: () => {
        throw new Error('na');
      },
    };
    const client = new TracingLlmClient(failing, sink);
    await expect(
      client.generateText({ model: 'm', role: 'chat', prompt: 'hi' }),
    ).rejects.toThrow('boom');
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].error).toBe('boom');
  });

  it('does not break the call when sink.write throws', async () => {
    const failingSink: TraceSink = {
      write: () => {
        throw new Error('disk full');
      },
    };
    const client = new TracingLlmClient(new MockLlmClient(), failingSink);
    await expect(
      client.generateText({ model: 'm', role: 'chat', prompt: 'hi' }),
    ).resolves.toBeDefined();
  });
});

describe('TracingEmbedder', () => {
  it('emits a trace record after embed', async () => {
    const sink = new CapturingSink();
    const embedder = new TracingEmbedder(new MockEmbedder(), sink);
    await embedder.embed({ model: 'm', role: 'ingest', values: ['a', 'b'] });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].operation).toBe('embed');
    expect(sink.records[0].role).toBe('ingest');
  });
});
