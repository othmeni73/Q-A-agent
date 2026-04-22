/**
 * End-to-end corpus ingestion.
 *
 * Pipeline per document:
 *   read .md + optional .meta.json sidecar →
 *   PapersRepository.upsertByArxivId (registers paper, returns paperId) →
 *   chunk (section-aware) → doc-level summary (contextual prefix) →
 *   embed (dense) → BM25 tokenise (sparse) → upsert to Qdrant with
 *   paperId + denormalized paper metadata in every chunk.
 *
 * Chunk ids are deterministic UUIDs from (paperId, chunkIndex) so
 * re-ingesting an already-registered paper overwrites its chunks in place.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';
import {
  PapersRepository,
  type Paper,
} from '@app/persistence/papers.repository';
import {
  VECTOR_STORE,
  type ChunkMetadata,
  type UpsertPoint,
  type VectorStore,
} from '@app/vector/ports/vector-store.port';

import { ChunkerService } from './chunker.service';
import { ContextualPrefixService } from './contextual-prefix.service';
import { IngestEmbedderService } from './embedder.service';
import { bm25Tokens } from './sparse-tokenizer';

const DEFAULT_DOCS_DIR = './docs';
const DEFAULT_COLLECTION = 'agentic-systems-papers';
const DEFAULT_DENSE_SIZE = 768;

export interface IngestionResult {
  docs: number;
  chunks: number;
}

/** Shape of the optional `<slug>.meta.json` sidecar produced by Step 7's fetcher. */
interface PaperMeta {
  arxivId?: string;
  title?: string;
  authors?: string[];
  year?: number;
  abstract?: string;
  url?: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly docsDir: string;
  private readonly collection: string;
  private readonly denseSize: number;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(ChunkerService) private readonly chunker: ChunkerService,
    @Inject(ContextualPrefixService)
    private readonly prefixer: ContextualPrefixService,
    @Inject(IngestEmbedderService)
    private readonly embedder: IngestEmbedderService,
    @Inject(PapersRepository) private readonly papers: PapersRepository,
    @Inject(VECTOR_STORE) private readonly store: VectorStore,
  ) {
    this.docsDir = config.file.ingestion?.docsDir ?? DEFAULT_DOCS_DIR;
    this.collection = config.file.vector?.collection ?? DEFAULT_COLLECTION;
    this.denseSize = config.file.vector?.denseSize ?? DEFAULT_DENSE_SIZE;
  }

  async run(): Promise<IngestionResult> {
    await this.store.ensureCollection(this.collection, {
      denseSize: this.denseSize,
      withSparse: true,
    });

    const files = await this.listCorpus();
    this.logger.log(
      `ingesting ${files.length} document(s) into "${this.collection}"`,
    );

    let docCount = 0;
    let totalChunks = 0;

    for (const file of files) {
      const raw = await readFile(file, 'utf8');
      const filenameTitle = basename(file, extname(file));
      const chunks = this.chunker.chunk(raw);
      if (chunks.length === 0) {
        this.logger.warn(`  skip "${filenameTitle}" — empty after chunking`);
        continue;
      }

      const meta = await readMetaSidecar(file);
      const paper = this.papers.upsertByArxivId({
        arxivId: meta?.arxivId,
        title: meta?.title ?? filenameTitle,
        authors: meta?.authors,
        year: meta?.year,
        abstract: meta?.abstract,
        url: meta?.url,
      });

      const prefix = await this.prefixer.summarize({
        title: paper.title,
        text: raw,
      });
      const embedInputs = chunks.map((c) => `${prefix}\n\n${c.text}`);
      const dense = await this.embedder.embedChunks(embedInputs);

      const points: UpsertPoint[] = chunks.map((c, i) => ({
        id: chunkId(paper.id, c.index),
        dense: dense[i],
        sparse: bm25Tokens(c.text),
        metadata: buildChunkMetadata(paper, c, prefix),
      }));

      await this.store.upsert(this.collection, points);
      docCount += 1;
      totalChunks += points.length;
      this.logger.log(`  ${paper.title}: ${points.length} chunk(s)`);
    }

    this.logger.log(`done — ${docCount} doc(s), ${totalChunks} chunk(s)`);
    return { docs: docCount, chunks: totalChunks };
  }

  private async listCorpus(): Promise<string[]> {
    const entries = await readdir(this.docsDir, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.txt')),
      )
      .map((e) => join(this.docsDir, e.name))
      .sort();
  }
}

/** Read `<doc>.meta.json` if present; return undefined on ENOENT, throw on other I/O errors. */
async function readMetaSidecar(
  docPath: string,
): Promise<PaperMeta | undefined> {
  const metaPath = docPath.replace(/\.(md|txt)$/i, '.meta.json');
  try {
    const raw = await readFile(metaPath, 'utf8');
    return JSON.parse(raw) as PaperMeta;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

function buildChunkMetadata(
  paper: Paper,
  chunk: { index: number; text: string; sectionPath?: string },
  prefix: string,
): ChunkMetadata {
  return {
    sourceTitle: paper.title,
    sourceType: 'paper',
    chunkIndex: chunk.index,
    text: chunk.text,
    contextualPrefix: prefix,
    paperId: paper.id,
    ...(paper.arxivId !== undefined ? { arxivId: paper.arxivId } : {}),
    ...(paper.authors.length > 0 ? { authors: paper.authors } : {}),
    ...(paper.year !== undefined ? { year: paper.year } : {}),
    ...(chunk.sectionPath !== undefined
      ? { sectionPath: chunk.sectionPath }
      : {}),
  };
}

/** Deterministic UUID from (paperId, chunkIndex). */
function chunkId(paperId: string, chunkIndex: number): string {
  const hex = createHash('sha256')
    .update(`${paperId}#${chunkIndex}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
