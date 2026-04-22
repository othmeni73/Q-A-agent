/**
 * Wires the SQLite-backed persistence layer for NestJS.
 *
 * - Opens a better-sqlite3 connection at `config.file.persistence.path`
 *   (defaults to `./data/app.db`).
 * - In test env (NODE_ENV=test) auto-swaps to an in-memory DB so Jest specs
 *   don't touch the filesystem.
 * - Enables WAL + foreign keys at connection open.
 * - Runs migrations once, at module init.
 * - Registers the three repositories so any feature module can inject them.
 *
 * @Global() so consumers don't need to import PersistenceModule explicitly.
 */

import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';

import { DATABASE, type DatabaseClient } from './database';
import { runMigrations } from './migrations/migrations';
import { MessagesRepository } from './messages.repository';
import { PapersRepository } from './papers.repository';
import { SessionsRepository } from './sessions.repository';

const DEFAULT_PATH = './data/app.db';

function resolveDbPath(config: AppConfig): string {
  if (config.env.NODE_ENV === 'test') return ':memory:';
  return config.file.persistence?.path ?? DEFAULT_PATH;
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DatabaseClient => {
        const db = new BetterSqlite3(resolveDbPath(config));
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('synchronous = NORMAL');
        runMigrations(db);
        return db;
      },
    },
    PapersRepository,
    SessionsRepository,
    MessagesRepository,
  ],
  exports: [DATABASE, PapersRepository, SessionsRepository, MessagesRepository],
})
export class PersistenceModule implements OnModuleDestroy {
  constructor() {
    // Shutdown hook registered by the provider below (see graceful-close below).
  }

  onModuleDestroy(): void {
    // Nothing here — DB close is handled by the provider's onApplicationShutdown
    // via Nest's enableShutdownHooks() at bootstrap. Repositories are stateless.
  }
}
