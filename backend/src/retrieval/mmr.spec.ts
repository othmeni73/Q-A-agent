import type { RetrievalHit } from './types';

import { mmrSelect } from './mmr';

function hit(id: string, dense: number[]): RetrievalHit {
  return {
    id,
    score: 1,
    dense,
    metadata: {
      sourceTitle: id,
      sourceType: 'paper',
      chunkIndex: 0,
      text: id,
    },
  };
}

describe('mmrSelect', () => {
  it('returns [] when no candidates carry a dense vector', () => {
    const out = mmrSelect(
      [
        { ...hit('a', []), dense: undefined },
        { ...hit('b', []), dense: undefined },
      ],
      { queryVector: [1, 0], k: 2 },
    );
    expect(out).toEqual([]);
  });

  it('picks the most relevant as first', () => {
    const out = mmrSelect(
      [hit('near', [1, 0]), hit('far', [0, 1]), hit('mid', [0.7, 0.7])],
      { queryVector: [1, 0], k: 1 },
    );
    expect(out[0].id).toBe('near');
  });

  it('prefers a diverse second pick over a near-duplicate', () => {
    // 3D geometry where query ≠ near: otherwise MMR degenerates to pure
    // relevance ordering because cos(c, near) ≡ cos(c, query) for every c.
    //
    //   query [0.8, 0.6, 0]   near [1, 0, 0]   rel_near = 0.8
    //   near-dup [0.99, −0.14, 0]   rel = 0.708,  cos(·, near) = 0.99
    //   far      [0.6, 0.3, 0.742]  rel = 0.66,   cos(·, near) = 0.6
    //
    // At λ=0.7:  dup → 0.7·0.708 − 0.3·0.99  ≈ 0.199
    //           far → 0.7·0.66  − 0.3·0.6   ≈ 0.282   ← far wins
    const out = mmrSelect(
      [
        hit('near', [1, 0, 0]),
        hit('near-dup', [0.99, -0.14, 0]),
        hit('far', [0.6, 0.3, 0.742]),
      ],
      { queryVector: [0.8, 0.6, 0], k: 2, lambda: 0.7 },
    );
    expect(out.map((h) => h.id)).toEqual(['near', 'far']);
  });

  it('lambda=1.0 reduces to pure relevance ordering', () => {
    const out = mmrSelect(
      [hit('near', [1, 0]), hit('near-dup', [0.99, 0.01]), hit('far', [0, 1])],
      { queryVector: [1, 0], k: 3, lambda: 1.0 },
    );
    expect(out.map((h) => h.id)).toEqual(['near', 'near-dup', 'far']);
  });
});
