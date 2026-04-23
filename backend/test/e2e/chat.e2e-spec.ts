import { Test, type TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from '@app/app.module';
import {
  VECTOR_STORE,
  type VectorStore,
} from '@app/vector/ports/vector-store.port';

interface ParsedSse {
  deltas: string[];
  done: { sessionId: string; citations: unknown[] } | undefined;
  error: { message: string } | undefined;
}

function parseSse(body: string): ParsedSse {
  const out: ParsedSse = {
    deltas: [],
    done: undefined,
    error: undefined,
  };
  for (const block of body.split('\n\n')) {
    const lines = block.split('\n');
    const eventLine = lines.find((l) => l.startsWith('event: '));
    const dataLine = lines.find((l) => l.startsWith('data: '));
    if (!eventLine || !dataLine) continue;
    const event = eventLine.slice(7).trim();
    const data = dataLine.slice(6);
    const payload = JSON.parse(data);
    if (event === 'delta') out.deltas.push(payload.text);
    else if (event === 'done') out.done = payload;
    else if (event === 'error') out.error = payload;
  }
  return out;
}

describe('POST /chat (e2e)', () => {
  let app: NestFastifyApplication | undefined;

  beforeAll(async () => {
    process.env['LLM_ADAPTER'] = 'mock';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // FakeVectorStore starts empty in NODE_ENV=test; provision the collection
    // the chat flow queries so the stream completes without an error event.
    const store = app.get<VectorStore>(VECTOR_STORE);
    await store.ensureCollection('agentic-systems-papers', {
      denseSize: 768,
      withSparse: true,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('streams an SSE body and emits a `done` event with a new sessionId', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 'What is Reflexion?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    const parsed = parseSse(res.body);
    expect(parsed.error).toBeUndefined();
    expect(parsed.deltas.length).toBeGreaterThan(0);
    expect(parsed.done).toBeDefined();
    expect(parsed.done!.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('second turn in the same session echoes the same sessionId', async () => {
    const first = await app!.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 'First question about Reflexion' },
    });
    const firstParsed = parseSse(first.body);
    const sessionId = firstParsed.done!.sessionId;

    const second = await app!.inject({
      method: 'POST',
      url: '/chat',
      payload: { sessionId, message: 'Follow-up question' },
    });
    const secondParsed = parseSse(second.body);
    expect(secondParsed.error).toBeUndefined();
    expect(secondParsed.done).toBeDefined();
    expect(secondParsed.done!.sessionId).toBe(sessionId);
    expect(secondParsed.deltas.length).toBeGreaterThan(0);
  });

  it('returns 400 on invalid body (missing message)', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/chat',
      payload: { sessionId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeTruthy();
  });
});
