/**
 * Canonical paper store. Source of truth for arXiv paper metadata.
 *
 * `upsertByArxivId` is what the Step-6 ingestion pipeline calls to register a
 * paper before embedding its chunks — existing rows are updated in place so
 * re-ingest stays idempotent. `findById` is what the chat service calls when
 * a user drills down from a citation.
 */

import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { DATABASE, type DatabaseClient } from './database';

export interface Paper {
  id: string;
  arxivId: string | undefined;
  title: string;
  authors: string[];
  year: number | undefined;
  abstract: string | undefined;
  url: string | undefined;
  ingestedAt: number;
}

export interface NewPaper {
  arxivId?: string;
  title: string;
  authors?: string[];
  year?: number;
  abstract?: string;
  url?: string;
}

interface PaperRow {
  id: string;
  arxivId: string | null;
  title: string;
  authors: string | null;
  year: number | null;
  abstract: string | null;
  url: string | null;
  ingestedAt: number;
}

@Injectable()
export class PapersRepository {
  private readonly upsertStmt;
  private readonly findByIdStmt;
  private readonly findByArxivIdStmt;
  private readonly listStmt;

  constructor(@Inject(DATABASE) db: DatabaseClient) {
    this.upsertStmt = db.prepare<
      [
        string,
        string | null,
        string,
        string | null,
        number | null,
        string | null,
        string | null,
        number,
      ]
    >(
      `INSERT INTO papers (id, arxivId, title, authors, year, abstract, url, ingestedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(arxivId) DO UPDATE SET
         title = excluded.title,
         authors = excluded.authors,
         year = excluded.year,
         abstract = excluded.abstract,
         url = excluded.url,
         ingestedAt = excluded.ingestedAt`,
    );

    this.findByIdStmt = db.prepare<[string]>(
      'SELECT * FROM papers WHERE id = ?',
    );
    this.findByArxivIdStmt = db.prepare<[string]>(
      'SELECT * FROM papers WHERE arxivId = ?',
    );
    this.listStmt = db.prepare<[number, number]>(
      'SELECT * FROM papers ORDER BY ingestedAt DESC LIMIT ? OFFSET ?',
    );
  }

  /**
   * Insert a new paper or update the existing one matched by arxivId.
   * Returns the resulting Paper (with stable id — preserved on update).
   */
  upsertByArxivId(input: NewPaper): Paper {
    if (input.arxivId !== undefined) {
      const existing = this.findByArxivIdStmt.get(input.arxivId) as
        | PaperRow
        | undefined;
      const id = existing?.id ?? randomUUID();
      const now = Date.now();
      this.upsertStmt.run(
        id,
        input.arxivId,
        input.title,
        input.authors ? JSON.stringify(input.authors) : null,
        input.year ?? null,
        input.abstract ?? null,
        input.url ?? null,
        now,
      );
      return {
        id,
        arxivId: input.arxivId,
        title: input.title,
        authors: input.authors ?? [],
        year: input.year,
        abstract: input.abstract,
        url: input.url,
        ingestedAt: now,
      };
    }
    // No arxivId — always insert a fresh row with a new id.
    const id = randomUUID();
    const now = Date.now();
    this.upsertStmt.run(
      id,
      null,
      input.title,
      input.authors ? JSON.stringify(input.authors) : null,
      input.year ?? null,
      input.abstract ?? null,
      input.url ?? null,
      now,
    );
    return {
      id,
      arxivId: undefined,
      title: input.title,
      authors: input.authors ?? [],
      year: input.year,
      abstract: input.abstract,
      url: input.url,
      ingestedAt: now,
    };
  }

  findById(id: string): Paper | undefined {
    const row = this.findByIdStmt.get(id) as PaperRow | undefined;
    return row ? rowToPaper(row) : undefined;
  }

  list(opts: { limit?: number; offset?: number } = {}): Paper[] {
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    const rows = this.listStmt.all(limit, offset) as PaperRow[];
    return rows.map(rowToPaper);
  }
}

function rowToPaper(row: PaperRow): Paper {
  return {
    id: row.id,
    arxivId: row.arxivId ?? undefined,
    title: row.title,
    authors: row.authors ? (JSON.parse(row.authors) as string[]) : [],
    year: row.year ?? undefined,
    abstract: row.abstract ?? undefined,
    url: row.url ?? undefined,
    ingestedAt: row.ingestedAt,
  };
}
