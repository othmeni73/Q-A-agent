import { z } from 'zod';

import { MockEmbedder, MockLlmClient } from './mock-llm.adapter';

describe('MockLlmClient', () => {
  it('records generateText calls', async () => {
    const client = new MockLlmClient();
    const res = await client.generateText({
      model: 'm',
      role: 'chat',
      prompt: 'hi',
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].method).toBe('generateText');
    expect(res.text).toContain('mock');
    expect(res.finishReason).toBe('stop');
    expect(res.usage.outputTokens).toBeGreaterThan(0);
  });

  it('returns overridden text response', async () => {
    const client = new MockLlmClient({ textResponse: 'override' });
    const res = await client.generateText({
      model: 'm',
      role: 'rewriter',
      prompt: 'x',
    });
    expect(res.text).toBe('override');
  });

  it('streams canned chunks and resolves done with TTFT', async () => {
    const client = new MockLlmClient();
    const res = client.stream({
      model: 'm',
      role: 'chat',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const chunks: string[] = [];
    for await (const c of res.textStream) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(0);
    const meta = await res.done;
    expect(meta.text).toBe(chunks.join(''));
    expect(meta.ttftMs).toBeGreaterThanOrEqual(0);
    expect(meta.finishReason).toBe('stop');
  });

  it('generateObject parses override through the supplied schema', async () => {
    const schema = z.object({ x: z.number() });
    const client = new MockLlmClient({ objectResponse: { x: 42 } });
    const res = await client.generateObject({
      model: 'm',
      role: 'chat',
      prompt: '',
      schema,
    });
    expect(res.object.x).toBe(42);
  });
});

describe('MockEmbedder', () => {
  it('returns one vector per input value', async () => {
    const embedder = new MockEmbedder();
    const res = await embedder.embed({
      model: 'm',
      role: 'ingest',
      values: ['a', 'b', 'c'],
    });
    expect(res.embeddings).toHaveLength(3);
    expect(res.embeddings[0]).toHaveLength(768);
  });

  it('is deterministic for the same input', async () => {
    const embedder = new MockEmbedder();
    const r1 = await embedder.embed({
      model: 'm',
      role: 'ingest',
      values: ['hello'],
    });
    const r2 = await embedder.embed({
      model: 'm',
      role: 'ingest',
      values: ['hello'],
    });
    expect(r1.embeddings[0]).toEqual(r2.embeddings[0]);
  });
});
