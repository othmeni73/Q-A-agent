import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(() => {
    service = new HealthService();
  });

  it('returns ok status', () => {
    expect(service.check().status).toBe('ok');
  });

  it('returns a non-negative, finite uptime', () => {
    const { uptime } = service.check();
    expect(uptime).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(uptime)).toBe(true);
  });

  it('returns a parseable ISO-8601 timestamp', () => {
    const { timestamp } = service.check();
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
  });
});
