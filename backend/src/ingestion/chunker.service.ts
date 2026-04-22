/**
 * Two-stage section-aware chunker.
 *
 * Stage 1 — section splitter. Line-by-line scan for markdown-style headers
 * (#, ##, ###, …) builds a flat list of section blocks, each carrying:
 *   - `path`: breadcrumb of header titles from root to leaf
 *   - `text`: the body paragraphs under that header, up to the next header
 *
 * A block with `path: []` represents preamble before the first header (or a
 * plain `.txt` with no headers at all) — ensures backward compatibility.
 *
 * Stage 2 — paragraph-greedy accumulation INSIDE each section block. Chunks
 * never span section boundaries. Each chunk inherits its block's path flattened
 * into `sectionPath` (e.g. "Methods > Training procedure"). Paragraphs are
 * joined greedily until adding the next one would exceed `targetChars`; the
 * chunk is emitted and the next chunk carries the last `overlapChars`
 * characters of the previous chunk so facts straddling a paragraph boundary
 * survive.
 *
 * Char-per-token proxy: English prose averages ~4 chars/token, so
 * `targetChars=2000` ≈ 500 tokens and `overlapChars=200` ≈ 50 tokens.
 *
 * Edge case — a single paragraph longer than `targetChars` is hard-split on
 * character count. Rare in arXiv prose, common in code blocks / tables.
 *
 * Edge case — a "skip-level" header (e.g. ### with no ## above it) is clamped
 * to depth `pathStack.length + 1` so the path never has undefined gaps.
 */

import { Injectable } from '@nestjs/common';

export interface Chunk {
  index: number;
  text: string;
  /** "Methods > Training procedure", or undefined when the chunk comes from a block with no header above it. */
  sectionPath?: string;
}

export interface ChunkOpts {
  /** Approximate character budget per chunk. */
  targetChars: number;
  /** Character-count overlap between adjacent chunks within the same section. */
  overlapChars: number;
}

const DEFAULT_OPTS: ChunkOpts = {
  targetChars: 2000,
  overlapChars: 200,
};

/** Internal: a section block produced by stage 1. */
interface SectionBlock {
  path: string[];
  text: string;
}

@Injectable()
export class ChunkerService {
  chunk(text: string, opts: Partial<ChunkOpts> = {}): Chunk[] {
    const cfg: ChunkOpts = { ...DEFAULT_OPTS, ...opts };
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (normalized.length === 0) return [];

    const blocks = splitSections(normalized);
    const chunks: Chunk[] = [];

    for (const block of blocks) {
      const sectionPath =
        block.path.length > 0 ? block.path.join(' > ') : undefined;
      for (const bodyText of chunkParagraphs(block.text, cfg)) {
        chunks.push({
          index: chunks.length,
          text: bodyText,
          ...(sectionPath !== undefined ? { sectionPath } : {}),
        });
      }
    }

    return chunks;
  }
}

/** Markdown header: leading 1–6 '#' chars, whitespace, title, optional trailing '#'s. */
const HEADER_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Stage 1. Walk lines, maintain a header-path stack keyed by (title, level),
 * emit one SectionBlock per leaf section (plus a leading block with empty path
 * for any preamble before the first header).
 *
 * Stack semantics: when we see a header at `level`, pop every existing entry
 * whose level is >= new level (those are not ancestors of the new section),
 * then push the new entry. Peer-level headers replace each other; deeper
 * headers nest; skip-level headers (e.g. `### A` with no `##` above) produce
 * a compressed path (no undefined gaps).
 */
interface HeaderEntry {
  title: string;
  level: number;
}

function splitSections(text: string): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  const stack: HeaderEntry[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    const body = buffer.join('\n').trim();
    buffer = [];
    if (body.length === 0) return;
    blocks.push({ path: stack.map((e) => e.title), text: body });
  };

  for (const line of text.split('\n')) {
    const m = HEADER_RE.exec(line);
    if (!m) {
      buffer.push(line);
      continue;
    }
    flush();
    const level = m[1].length;
    const title = m[2].trim();
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack.push({ title, level });
  }
  flush();

  return blocks;
}

/**
 * Stage 2. Greedy paragraph accumulation with overlap, scoped to one section.
 */
function chunkParagraphs(text: string, cfg: ChunkOpts): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const out: string[] = [];
  let buffer = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > cfg.targetChars) {
      if (buffer.length > 0) {
        out.push(buffer);
        buffer = tail(buffer, cfg.overlapChars);
      }
      for (const slice of hardSplit(paragraph, cfg.targetChars)) {
        const next = buffer.length > 0 ? `${buffer}\n\n${slice}` : slice;
        out.push(next);
        buffer = tail(slice, cfg.overlapChars);
      }
      continue;
    }

    const candidate =
      buffer.length > 0 ? `${buffer}\n\n${paragraph}` : paragraph;

    if (candidate.length <= cfg.targetChars) {
      buffer = candidate;
      continue;
    }

    out.push(buffer);
    const carry = tail(buffer, cfg.overlapChars);
    buffer = carry.length > 0 ? `${carry}\n\n${paragraph}` : paragraph;
  }

  if (buffer.length > 0) out.push(buffer);
  return out;
}

function tail(text: string, n: number): string {
  if (n <= 0) return '';
  return text.length <= n ? text : text.slice(-n);
}

function hardSplit(text: string, size: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    pieces.push(text.slice(i, i + size));
  }
  return pieces;
}
