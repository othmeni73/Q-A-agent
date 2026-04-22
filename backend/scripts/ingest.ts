/**
 * `pnpm ingest` entry point.
 *
 * Boots the Nest app as an application context (no HTTP server), resolves
 * `IngestionService`, runs it, prints the summary, closes the context.
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '@app/app.module';
import { IngestionService } from '@app/ingestion/ingestion.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const svc = app.get(IngestionService);
    const res = await svc.run();
    process.stdout.write(`${JSON.stringify(res)}\n`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`ingest failed: ${message}\n`);
  process.exit(1);
});
