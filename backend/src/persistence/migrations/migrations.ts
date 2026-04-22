/**
 * Minimal migration runner.
 *
 * Reads every `*.sql` file in this directory (sorted lexicographically) and
 * executes its contents against the given `Database` connection. Each file is
 * written with `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`, so
 * re-applying is a no-op. This is intentional for a single-developer project
 * — when a real schema change lands, promote to numbered migrations with a
 * `schema_migrations` tracking table.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DatabaseClient } from '../database';

export function runMigrations(db: DatabaseClient): void {
  const here = __dirname;
  const files = readdirSync(here)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(here, file), 'utf8');
    db.exec(sql);
  }
}
