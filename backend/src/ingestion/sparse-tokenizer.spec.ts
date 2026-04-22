import { bm25Tokens } from './sparse-tokenizer';

describe('bm25Tokens', () => {
  it('counts term frequencies and sorts indices ascending', () => {
    const sv = bm25Tokens('hello world hello');
    expect(sv.indices).toHaveLength(2);
    expect(sv.indices[0]).toBeLessThan(sv.indices[1]);
    expect(sv.values.reduce((a, b) => a + b, 0)).toBe(3);
    expect(sv.values).toContain(2);
    expect(sv.values).toContain(1);
  });

  it('is case-insensitive', () => {
    expect(bm25Tokens('Hello WORLD')).toEqual(bm25Tokens('hello world'));
  });

  it('returns empty vectors for empty or punctuation-only input', () => {
    expect(bm25Tokens('')).toEqual({ indices: [], values: [] });
    expect(bm25Tokens('!!! ??? ...')).toEqual({ indices: [], values: [] });
  });
});
