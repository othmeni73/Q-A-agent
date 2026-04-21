import { Injectable } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  check(): HealthResponse {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
