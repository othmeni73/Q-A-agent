/**
 * Pure function: arXiv HTML page → structured content.
 *
 * Takes the HTML string from `https://arxiv.org/html/<id>` and returns
 * `{ title, authors, year, abstract, markdown }`
 *
 * Design:
 *   - Metadata comes from `<meta name="citation_*">` tags (schema.org-ish,
 *     vastly more reliable than body parsing).
 *   - Body is built by walking `section.ltx_section` / `.ltx_subsection` /
 *     `.ltx_subsubsection` nodes in document order, emitting markdown
 *     headers (`##`, `###`, `####`) and paragraph text.
 *   - `<math alttext="...">` is replaced with `$alttext$` so LaTeX source
 *     survives into the embedder instead of being silently stripped.
 *   - Bibliography / references sections are skipped (by class name).
 */

import * as cheerio from 'cheerio';

export interface ParsedPaper {
  title: string;
  authors: string[];
  year: number | undefined;
  abstract: string;
  /** Markdown body: `## Section`, `### Subsection`, paragraphs, inline `$latex$`. */
  markdown: string;
}

export function parseArxivHtml(
  html: string,
  fallbackArxivId?: string,
): ParsedPaper {
  const $ = cheerio.load(html);

  const title =
    metaContent($, 'citation_title') ??
    $('h1.ltx_title, h1.ltx_title_document').first().text().trim();

  const authors = metaContentAll($, 'citation_author');

  const yearString =
    metaContent($, 'citation_publication_date') ??
    metaContent($, 'citation_date') ??
    '';
  const yearFromMeta = yearFromDateString(yearString);
  const yearFromId = fallbackArxivId
    ? yearFromArxivId(fallbackArxivId)
    : undefined;
  const year = yearFromMeta ?? yearFromId;

  const abstract =
    metaContent($, 'citation_abstract') ??
    $('.ltx_abstract p').first().text().trim();

  const markdown = extractBody($);

  return {
    title: title || fallbackArxivId || 'Untitled',
    authors,
    year,
    abstract: abstract.replace(/\s+/g, ' ').trim(),
    markdown,
  };
}

function metaContent($: cheerio.CheerioAPI, name: string): string | undefined {
  const el = $(`meta[name="${name}"]`).first();
  const content = el.attr('content');
  return content?.trim() || undefined;
}

function metaContentAll($: cheerio.CheerioAPI, name: string): string[] {
  const out: string[] = [];
  $(`meta[name="${name}"]`).each((_, el) => {
    const v = $(el).attr('content')?.trim();
    if (v) out.push(v);
  });
  return out;
}

function yearFromDateString(s: string): number | undefined {
  const m = /\b(19|20)\d{2}\b/.exec(s);
  return m ? parseInt(m[0], 10) : undefined;
}

/** arXiv IDs since 2007 start `YYMM.nnnnn`. `2303.11366` → 2023. */
function yearFromArxivId(id: string): number | undefined {
  const m = /^(\d{2})\d{2}\./.exec(id);
  if (!m) return undefined;
  const yy = parseInt(m[1], 10);
  return 2000 + yy;
}

/**
 * Walk the document, emitting markdown. Strategy:
 *   - Replace every `<math>` in place with its `alttext` wrapped in `$ … $`.
 *   - For each top-level `.ltx_section` / `.ltx_subsection` / `.ltx_subsubsection`
 *     node in document order, emit a markdown header (level = nesting depth + 1)
 *     followed by the paragraph text of the section.
 *   - Skip nodes whose class matches bibliography / references / appendix-bib.
 */
function extractBody($: cheerio.CheerioAPI): string {
  // Inline math → $alttext$ (mutating the tree is fine — cheerio handles it).
  $('math').each((_, el) => {
    const alt = $(el).attr('alttext');
    if (alt) {
      $(el).replaceWith(`$${alt}$`);
    } else {
      $(el).remove();
    }
  });

  // Drop elements we don't want in the body.
  $(
    'nav, header, footer, .ltx_bibliography, .ltx_biblist, .ltx_ref_tag, .ltx_page_header, .ltx_page_footer',
  ).remove();

  const out: string[] = [];

  const root = $('article, main, .ltx_document').first();
  const container = root.length > 0 ? root : $('body');

  // Walk section-y elements.
  container
    .find('.ltx_section, .ltx_subsection, .ltx_subsubsection, .ltx_abstract')
    .each((_, el) => {
      const $el = $(el);
      const cls = $el.attr('class') ?? '';
      if (/bibliography|references/i.test(cls)) return;

      const level = cls.includes('ltx_subsubsection')
        ? 4
        : cls.includes('ltx_subsection')
          ? 3
          : cls.includes('ltx_abstract')
            ? 2
            : 2;

      const titleEl = $el.children('h1, h2, h3, h4, h5, h6').first();
      const title = titleEl.text().trim();

      if (title) {
        out.push(`${'#'.repeat(level)} ${title}`);
      }

      // Paragraphs inside this section (direct-ish; we want to avoid
      // double-emitting when we later visit a nested subsection).
      $el.children('p, .ltx_para').each((__, p) => {
        const text = $(p).text().replace(/\s+/g, ' ').trim();
        if (text) out.push(text);
      });
    });

  // If we got nothing (non-standard layout), fall back to all paragraphs.
  if (out.length === 0) {
    container.find('p').each((_, p) => {
      const text = $(p).text().replace(/\s+/g, ' ').trim();
      if (text) out.push(text);
    });
  }

  return out.join('\n\n');
}
