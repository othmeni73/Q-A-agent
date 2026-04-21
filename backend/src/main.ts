import 'dotenv/config'; // MUST be first — populates process.env before anything else reads it.

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.env.PORT, config.file.server.host);
}

bootstrap().catch((err: unknown) => {
  // No logger yet if AppModule itself failed to construct — fall back to stderr.
  console.error('Failed to start application', err);
  process.exit(1);
});
