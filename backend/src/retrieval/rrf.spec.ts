import type { SearchHit } from '@app/vector/ports/vector-store.port';

import { RRF_K_DEFAULT, rrfFuse } from './rrf';

function hit(id: string, score = 1): SearchHit {
  return {
    id,
    score,
    metadata: {
      sourceTitle: id,
      sourceType: 'paper',
      chunkIndex: 0,
      text: id,
    },
  };
}

describe('rrfFuse', () => {
  it('returns [] for empty input', () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([[]])).toEqual([]);
  });

  it('scores a single list by reciprocal rank', () => {
    const out = rrfFuse([[hit('a'), hit('b'), hit('c')]]);
    expect(out.map((h) => h.id)).toEqual(['a', 'b', 'c']);
    expect(out[0].fusedScore).toBeCloseTo(1 / (RRF_K_DEFAULT + 1));
    expect(out[1].fusedScore).toBeCloseTo(1 / (RRF_K_DEFAULT + 2));
  });

  it('sums scores across lists when a doc appears in both', () => {
    const listA = [hit('shared'), hit('only-a'), hit('tail-a')];
    const listB = [hit('only-b'), hit('tail-b'), hit('shared')];

    const out = rrfFuse([listA, listB]);
    expect(out[0].id).toBe('shared');
    const sharedScore = out[0].fusedScore!;
    const onlyAScore = out.find((h) => h.id === 'only-a')!.fusedScore!;
    expect(sharedScore).toBeGreaterThan(onlyAScore);
    expect(sharedScore).toBeCloseTo(
      1 / (RRF_K_DEFAULT + 1) + 1 / (RRF_K_DEFAULT + 3),
    );
  });

  it('is invariant to the absolute score values in input', () => {
    const out1 = rrfFuse([[hit('a', 0.99), hit('b', 0.98)]]);
    const out2 = rrfFuse([[hit('a', 0.01), hit('b', 0.001)]]);
    expect(out1.map((h) => h.id)).toEqual(out2.map((h) => h.id));
    expect(out1[0].fusedScore).toBeCloseTo(out2[0].fusedScore!);
  });

  it('honours a custom k', () => {
    const strict = rrfFuse([[hit('a'), hit('b')]], 1);
    const loose = rrfFuse([[hit('a'), hit('b')]], 1000);
    // Smaller k → steeper score difference between rank 1 and rank 2.
    const strictRatio = strict[0].fusedScore! / strict[1].fusedScore!;
    const looseRatio = loose[0].fusedScore! / loose[1].fusedScore!;
    expect(strictRatio).toBeGreaterThan(looseRatio);
  });
});
