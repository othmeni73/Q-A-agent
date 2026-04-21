import { QdrantClient } from '@qdrant/js-client-rest';

import type {
  ChunkMetadata,
  DenseSearchOpts,
  EnsureCollectionOpts,
  MetadataFilter,
  SearchHit,
  SparseSearchOpts,
  SparseVector,
  UpsertPoint,
  VectorStore,
} from '../ports/vector-store.port';

const DENSE_VECTOR_NAME = 'dense';
const SPARSE_VECTOR_NAME = 'bm25';

export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;

  constructor(url: string) {
    this.client = new QdrantClient({ url });
  }

  async ensureCollection(
    name: string,
    { denseSize, withSparse }: EnsureCollectionOpts,
  ): Promise<void> {
    if (await this.collectionExists(name)) return;
    await this.client.createCollection(name, {
      vectors: {
        [DENSE_VECTOR_NAME]: { size: denseSize, distance: 'Cosine' },
      },
      ...(withSparse
        ? {
            sparse_vectors: {
              [SPARSE_VECTOR_NAME]: { modifier: 'idf' },
            },
          }
        : {}),
    });
  }

  async collectionExists(name: string): Promise<boolean> {
    const res = await this.client.getCollections();
    return res.collections.some((c) => c.name === name);
  }

  async deleteCollection(name: string): Promise<void> {
    await this.client.deleteCollection(name);
  }

  async upsert(collection: string, points: UpsertPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.client.upsert(collection, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: {
          [DENSE_VECTOR_NAME]: p.dense,
          ...(p.sparse
            ? {
                [SPARSE_VECTOR_NAME]: {
                  indices: p.sparse.indices,
                  values: p.sparse.values,
                },
              }
            : {}),
        },
        payload: p.metadata,
      })),
    });
  }

  async queryDense({
    collection,
    queryVector,
    k,
    filter,
    withVector,
  }: DenseSearchOpts): Promise<SearchHit[]> {
    const res = await this.client.query(collection, {
      query: queryVector,
      using: DENSE_VECTOR_NAME,
      limit: k,
      filter: toQdrantFilter(filter),
      with_payload: true,
      with_vector: withVector ?? false,
    });
    return res.points.map(toSearchHit);
  }

  async querySparse({
    collection,
    queryVector,
    k,
    filter,
    withVector,
  }: SparseSearchOpts): Promise<SearchHit[]> {
    const res = await this.client.query(collection, {
      query: {
        indices: queryVector.indices,
        values: queryVector.values,
      },
      using: SPARSE_VECTOR_NAME,
      limit: k,
      filter: toQdrantFilter(filter),
      with_payload: true,
      with_vector: withVector ?? false,
    });
    return res.points.map(toSearchHit);
  }
}

/** Translate our simple AND-equality filter into Qdrant's `must` clauses. */
function toQdrantFilter(f?: MetadataFilter):
  | {
      must: Array<{
        key: string;
        match: { value: string | number | boolean };
      }>;
    }
  | undefined {
  if (!f) return undefined;
  const entries = Object.entries(f);
  if (entries.length === 0) return undefined;
  return {
    must: entries.map(([key, value]) => ({ key, match: { value } })),
  };
}

/** Shape Qdrant's ScoredPoint → our SearchHit, extracting dense/sparse by name. */
function toSearchHit(point: {
  id: string | number;
  score: number;
  payload?: Record<string, unknown> | null;
  vector?: unknown;
}): SearchHit {
  const { dense, sparse } = extractVectors(point.vector);
  return {
    id: point.id,
    score: point.score,
    metadata: (point.payload ?? {}) as ChunkMetadata,
    ...(dense ? { dense } : {}),
    ...(sparse ? { sparse } : {}),
  };
}

function extractVectors(v: unknown): {
  dense?: number[];
  sparse?: SparseVector;
} {
  if (!v || typeof v !== 'object') return {};
  const named = v as Record<string, unknown>;
  const out: { dense?: number[]; sparse?: SparseVector } = {};

  const d = named[DENSE_VECTOR_NAME];
  if (Array.isArray(d) && d.every((n) => typeof n === 'number')) {
    out.dense = d;
  }

  const s = named[SPARSE_VECTOR_NAME];
  if (
    s !== null &&
    typeof s === 'object' &&
    Array.isArray((s as { indices?: unknown }).indices) &&
    Array.isArray((s as { values?: unknown }).values)
  ) {
    const sv = s as SparseVector;
    out.sparse = { indices: sv.indices, values: sv.values };
  }

  return out;
}
