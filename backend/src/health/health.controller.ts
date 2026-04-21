import { Controller, Get } from '@nestjs/common';
import { HealthService, type HealthResponse } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly service: HealthService) {}

  @Get()
  check(): HealthResponse {
    return this.service.check();
  }
}
