import { HealthController } from './health.controller';
import type { HealthResponse } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: { check: jest.Mock<HealthResponse, []> };

  beforeEach(() => {
    service = { check: jest.fn() };
    controller = new HealthController(service);
  });

  it('delegates to HealthService.check', () => {
    const response: HealthResponse = {
      status: 'ok',
      uptime: 42,
      timestamp: '2026-04-20T00:00:00.000Z',
    };
    service.check.mockReturnValue(response);

    expect(controller.check()).toBe(response);
    expect(service.check).toHaveBeenCalledTimes(1);
  });
});
