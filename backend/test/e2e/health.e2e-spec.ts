import { Test, type TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '@app/app.module';

interface HealthBody {
  status: string;
  uptime: number;
  timestamp: string;
}

describe('GET /health (e2e)', () => {
  let app: NestFastifyApplication | undefined;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    // Guarded — if beforeAll threw, `app` is undefined. Let Jest surface
    // the original boot error instead of masking it with "Cannot read 'close'".
    if (app) await app.close();
  });

  it('returns 200 with status=ok, numeric uptime, and ISO timestamp', async () => {
    const res = await app!.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json<HealthBody>();
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(body.uptime)).toBe(true);
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('responds with Content-Type: application/json', async () => {
    const res = await app!.inject({ method: 'GET', url: '/health' });
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
