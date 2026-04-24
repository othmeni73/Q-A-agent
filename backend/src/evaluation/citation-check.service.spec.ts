import type { ResolvedCitation } from '@app/chat/citations.schema';
import type { RetrievalHit } from '@app/retrieval/types';

import { CitationCheckService } from './citation-check.service';

function hit(
  arxivId: string | undefined,
  title = `t-${arxivId ?? 'na'}`,
): RetrievalHit {
  return {
    id: `id-${arxivId ?? Math.random()}`,
    score: 1,
    metadata: {
      sourceTitle: title,
      sourceType: 'paper',
      chunkIndex: 0,
      text: 'chunk',
      arxivId,
    },
  };
}

function cite(n: number, arxivId?: string): ResolvedCitation {
  return {
    n,
    sourceTitle: arxivId ? `paper-${arxivId}` : 'paper',
    chunkIndex: 0,
    arxivId,
  };
}

describe('CitationCheckService.evaluate', () => {
  const svc = new CitationCheckService();

  it('accuracy:false when no citations', () => {
    const out = svc.evaluate([], [hit('2210.03629')]);
    expect(out.accuracy).toBe(false);
    expect(out.citedArxivIds).toEqual([]);
    expect(out.retrievedArxivIds).toEqual(['2210.03629']);
  });

  it('accuracy:true when every cited paper is in retrieved set', () => {
    const out = svc.evaluate(
      [cite(1, '2210.03629'), cite(2, '2305.10601')],
      [hit('2210.03629'), hit('2305.10601'), hit('2303.11366')],
    );
    expect(out.accuracy).toBe(true);
  });

  it('accuracy:false when any cited paper is outside retrieved set', () => {
    const out = svc.evaluate(
      [cite(1, '2210.03629'), cite(2, '9999.99999')],
      [hit('2210.03629'), hit('2305.10601')],
    );
    expect(out.accuracy).toBe(false);
  });

  it('dedupes cited + retrieved ids', () => {
    const out = svc.evaluate(
      [cite(1, '2210.03629'), cite(2, '2210.03629'), cite(3, '2305.10601')],
      [hit('2210.03629'), hit('2210.03629'), hit('2305.10601')],
    );
    expect(out.accuracy).toBe(true);
    expect(out.citedArxivIds.sort()).toEqual(['2210.03629', '2305.10601']);
    expect(out.retrievedArxivIds.sort()).toEqual(['2210.03629', '2305.10601']);
  });

  it('filters citations with missing arxivId before the set check', () => {
    // One citation lacks arxivId (chunk with no source id on metadata). The
    // rest are valid and all in the retrieved set → pass.
    const out = svc.evaluate(
      [cite(1, '2210.03629'), cite(2, undefined)],
      [hit('2210.03629')],
    );
    expect(out.accuracy).toBe(true);
    expect(out.citedArxivIds).toEqual(['2210.03629']);
  });
});
