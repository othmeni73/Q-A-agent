/**
 * `pnpm fetch-corpus` entry point.
 *
 * Reads `backend/data/corpus.json`, downloads each arXiv paper's HTML view,
 * parses it into `{title, authors, year, abstract, markdown}`, and writes:
 *   - `./docs/<arxivId>.md`        — the paper body as markdown
 *   - `./docs/<arxivId>.meta.json` — the metadata sidecar for the ingester
 *
 * Idempotent: papers whose `.md` already exists are skipped. Pass `--force`
 * to re-download.
 *
 * Rate-limited: 500 ms between requests (2 RPS, inside arXiv's etiquette
 * threshold when amortized over HTTP setup).
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseArxivHtml } from '@app/ingestion/arxiv-parser';

interface CorpusEntry {
  arxivId: string;
  category: string;
  note?: string;
}

const CORPUS_PATH = join(process.cwd(), 'data', 'corpus.json');
const DOCS_DIR = join(process.cwd(), 'docs');
const BASE_URL = 'https://arxiv.org/html';
const DELAY_MS = 500;

const FORCE = process.argv.includes('--force');

async function main(): Promise<void> {
  const corpus = await readCorpus();
  await mkdir(DOCS_DIR, { recursive: true });

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, entry] of corpus.entries()) {
    const mdPath = join(DOCS_DIR, `${entry.arxivId}.md`);
    if (!FORCE && (await exists(mdPath))) {
      skipped += 1;
      continue;
    }

    process.stdout.write(
      `[${i + 1}/${corpus.length}] ${entry.arxivId} (${entry.category})\n`,
    );

    try {
      const html = await fetchHtml(entry.arxivId);
      const parsed = parseArxivHtml(html, entry.arxivId);
      const meta = {
        arxivId: entry.arxivId,
        title: parsed.title,
        authors: parsed.authors,
        year: parsed.year,
        abstract: parsed.abstract,
        url: `https://arxiv.org/abs/${entry.arxivId}`,
      };
      await writeFile(mdPath, parsed.markdown, 'utf8');
      await writeFile(
        join(DOCS_DIR, `${entry.arxivId}.meta.json`),
        `${JSON.stringify(meta, null, 2)}\n`,
        'utf8',
      );
      fetched += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  failed: ${message}\n`);
      failed += 1;
    }

    await sleep(DELAY_MS);
  }

  process.stdout.write(
    `done — fetched=${fetched} skipped=${skipped} failed=${failed}\n`,
  );
}

async function readCorpus(): Promise<CorpusEntry[]> {
  const raw = await readFile(CORPUS_PATH, 'utf8');
  return JSON.parse(raw) as CorpusEntry[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchHtml(arxivId: string): Promise<string> {
  const url = `${BASE_URL}/${arxivId}`;
  const res = await fetch(url, {
    headers: {
      'user-agent': 'q-a-agent/0.1 (research; RAG corpus ingestion)',
      accept: 'text/html',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`fetch-corpus failed: ${message}\n`);
  process.exit(1);
});