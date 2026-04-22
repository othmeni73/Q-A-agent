import { parseArxivHtml } from './arxiv-parser';

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="citation_title" content="Reflexion: Language Agents with Verbal Reinforcement Learning" />
  <meta name="citation_author" content="Shinn, Noah" />
  <meta name="citation_author" content="Labash, Beck" />
  <meta name="citation_author" content="Gopinath, Ashwin" />
  <meta name="citation_publication_date" content="2023/03/20" />
  <meta name="citation_abstract" content="We propose Reflexion, a novel framework to reinforce language agents not by updating weights, but through linguistic feedback." />
</head>
<body>
  <article>
    <section class="ltx_abstract">
      <h2>Abstract</h2>
      <p>We propose Reflexion, a novel framework.</p>
    </section>
    <section class="ltx_section" id="S1">
      <h2>Introduction</h2>
      <p>Agents that learn from trial and error are central.</p>
      <p>We show the loss is <math alttext="L = -\\log p"></math>.</p>
      <section class="ltx_subsection" id="S1.SS1">
        <h3>Background</h3>
        <p>Prior work on ReAct-style agents.</p>
      </section>
    </section>
    <section class="ltx_bibliography" id="bib">
      <h2>References</h2>
      <p>Citations we do not want.</p>
    </section>
  </article>
</body>
</html>`;

describe('parseArxivHtml', () => {
  it('extracts title, authors, year, abstract from meta tags', () => {
    const p = parseArxivHtml(SAMPLE_HTML, '2303.11366');
    expect(p.title).toContain('Reflexion');
    expect(p.authors).toEqual([
      'Shinn, Noah',
      'Labash, Beck',
      'Gopinath, Ashwin',
    ]);
    expect(p.year).toBe(2023);
    expect(p.abstract).toContain('linguistic feedback');
  });

  it('falls back to arxivId year when citation date is missing', () => {
    const html = SAMPLE_HTML.replace(
      /<meta name="citation_publication_date"[^>]*>/,
      '',
    );
    const p = parseArxivHtml(html, '2210.03629');
    expect(p.year).toBe(2022);
  });

  it('emits markdown with section headers at the right levels', () => {
    const p = parseArxivHtml(SAMPLE_HTML, '2303.11366');
    expect(p.markdown).toContain('## Abstract');
    expect(p.markdown).toContain('## Introduction');
    expect(p.markdown).toContain('### Background');
  });

  it('replaces <math alttext="..."> with $alttext$', () => {
    const p = parseArxivHtml(SAMPLE_HTML, '2303.11366');
    expect(p.markdown).toContain('$L = -\\log p$');
  });

  it('skips the bibliography section', () => {
    const p = parseArxivHtml(SAMPLE_HTML, '2303.11366');
    expect(p.markdown).not.toContain('Citations we do not want');
    expect(p.markdown).not.toContain('References');
  });

  it('preserves paragraph text inside sections', () => {
    const p = parseArxivHtml(SAMPLE_HTML, '2303.11366');
    expect(p.markdown).toContain('Agents that learn from trial and error');
    expect(p.markdown).toContain('Prior work on ReAct-style agents.');
  });
});
