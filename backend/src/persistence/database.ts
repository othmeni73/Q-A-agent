/**
 * DI token + type alias for the better-sqlite3 Database client.
 *
 * Repositories inject `DATABASE` (the symbol) and type the field as
 * `DatabaseClient` (the better-sqlite3 instance type).
 */

import type BetterSqlite3 from 'better-sqlite3';

export type DatabaseClient = BetterSqlite3.Database;

export const DATABASE = Symbol('DATABASE');
