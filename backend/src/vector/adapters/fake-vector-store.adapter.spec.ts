import type { UpsertPoint } from '../ports/vector-store.port';
import { FakeVectorStore } from './fake-vector-store.adapter';

const COLLECTION = 'test';
const DENSE_SIZE = 4;

function makePoint(
  id: string,
  dense: number[],
  overrides: {
    sparse?: UpsertPoint['sparse'];
    sourceType?: string;
  } = {},
): UpsertPoint {
  const point: UpsertPoint = {
    id,
    dense,
    metadata: {
      sourceTitle: `doc-${id}`,
      sourceType: overrides.sourceType ?? 'paper',
      chunkIndex: 0,
      text: `text-${id}`,
    },
  };
  if (overrides.sparse) point.sparse = overrides.sparse;
  return point;
}

describe('FakeVectorStore', () => {
  let store: FakeVectorStore;

  beforeEach(() => {
    store = new FakeVectorStore();
  });

  it('collection lifecycle: create, exists, delete, gone', async () => {
    expect(await store.collectionExists(COLLECTION)).toBe(false);
    await store.ensureCollection(COLLECTION, {
      denseSize: DENSE_SIZE,
      withSparse: true,
    });
    expect(await store.collectionExists(COLLECTION)).toBe(true);
    await store.deleteCollection(COLLECTION);
    expect(await store.collectionExists(COLLECTION)).toBe(false);
  });

  it('upsert round-trips metadata via queryDense', async () => {
    await store.ensureCollection(COLLECTION, {
      denseSize: DENSE_SIZE,
      withSparse: false,
    });
    await store.upsert(COLLECTION, [makePoint('a', [1, 0, 0, 0])]);
    const hits = await store.queryDense({
      collection: COLLECTION,
      queryVector: [1, 0, 0, 0],
      k: 1,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('a');
    expect(hits[0].metadata.sourceTitle).toBe('doc-a');
    expect(hits[0].metadata.text).toBe('text-a');
    expect(hits[0].score).toBeCloseTo(1, 6);
  });

  it('queryDense returns top-K in descending cosine order', async () => {
    await store.ensureCollection(COLLECTION, {
      denseSize: DENSE_SIZE,
      withSparse: false,
    });
    await store.upsert(COLLECTION, [
      makePoint('far', [0, 1, 0, 0]),
      makePoint('mid', [0.7, 0.7, 0, 0]),
      makePoint('near', [1, 0.1, 0, 0]),
    ]);
    const hits = await store.queryDense({
      collection: COLLECTION,
      queryVector: [1, 0, 0, 0],
      k: 2,
    });
    expect(hits.map((h) => h.id)).toEqual(['near', 'mid']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('querySparse ranks by dot-product over shared indices, drops disjoint points', async () => {
    await store.ensureCollection(COLLECTION, {
      denseSize: DENSE_SIZE,
      withSparse: true,
    });
    await store.upsert(COLLECTION, [
      makePoint('only-1', [0, 0, 0, 0], {
        sparse: { indices: [1], values: [1] },
      }),
      makePoint('one-and-two', [0, 0, 0, 0], {
        sparse: { indices: [1, 2], values: [1, 3] },
      }),
      makePoint('disjoint', [0, 0, 0, 0], {
        sparse: { indices: [9], values: [5] },
      }),
    ]);
    const hits = await store.querySparse({
      collection: COLLECTION,
      queryVector: { indices: [1, 2], values: [1, 1] },
      k: 3,
    });
    expect(hits.map((h) => h.id)).toEqual(['one-and-two', 'only-1']);
    expect(hits[0].score).toBe(4); // 1*1 + 1*3
    expect(hits[1].score).toBe(1); // 1*1
  });

  it('applies metadata filter before ranking', async () => {
    await store.ensureCollection(COLLECTION, {
      denseSize: DENSE_SIZE,
      withSparse: false,
    });
    await store.upsert(COLLECTION, [
      makePoint('paper-A', [1, 0, 0, 0], { sourceType: 'paper' }),
      makePoint('web-B', [0.99, 0, 0, 0], { sourceType: 'web' }),
    ]);
    const hits = await store.queryDense({
      collection: COLLECTION,
      queryVector: [1, 0, 0, 0],
      k: 5,
      filter: { sourceType: 'paper' },
    });
    expect(hits.map((h) => h.id)).toEqual(['paper-A']);
  });

  it('deleteCollection removes all points', async () => {
    await store.ensureCollection(COLLECTION, {
      denseSize: DENSE_SIZE,
      withSparse: false,
    });
    await store.upsert(COLLECTION, [makePoint('a', [1, 0, 0, 0])]);
    await store.deleteCollection(COLLECTION);
    await expect(
      store.queryDense({
        collection: COLLECTION,
        queryVector: [1, 0, 0, 0],
        k: 1,
      }),
    ).rejects.toThrow(/collection "test" does not exist/);
  });
});
