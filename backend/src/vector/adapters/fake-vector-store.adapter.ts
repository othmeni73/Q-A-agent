/**
 * In-memory FakeVectorStore — exact same surface as QdrantVectorStore, no network.
 *
 * Purpose:
 *   - Unit tests and CI: 50× faster than booting a Qdrant container, and no flake.
 *   - Local dev without Docker: set `VECTOR_ADAPTER=fake` to bring up the app.
 *
 * Design:
 *   - Points live in `Map<collection, Map<id, UpsertPoint>>`.
 *   - Dense search: cosine similarity, sorted descending, top-K.
 *   - Sparse search: dot-product over shared indices — monotone in TF overlap,
 *     deterministic, and sufficient for tests that only need ordering (not
 *     numerical fidelity to BM25). Zero-score hits are filtered out (no overlap
 *     means no match, matching Qdrant's default behaviour for sparse search).
 *   - Metadata filter: AND over key/value equality, applied **before** ranking.
 *
 * Determinism: no randomness; Node 22's stable `Array.prototype.sort` gives
 * insertion-order tie-breaking, which the tests rely on.
 */

import type {
  DenseSearchOpts,
  EnsureCollectionOpts,
  MetadataFilter,
  SearchHit,
  SparseSearchOpts,
  SparseVector,
  UpsertPoint,
  VectorStore,
} from '../ports/vector-store.port';

interface Collection {
  opts: EnsureCollectionOpts;
  points: Map<string | number, UpsertPoint>;
}

export class FakeVectorStore implements VectorStore {
  private readonly collections = new Map<string, Collection>();

  ensureCollection(name: string, opts: EnsureCollectionOpts): Promise<void> {
    if (!this.collections.has(name)) {
      this.collections.set(name, { opts, points: new Map() });
    }
    return Promise.resolve();
  }

  collectionExists(name: string): Promise<boolean> {
    return Promise.resolve(this.collections.has(name));
  }

  deleteCollection(name: string): Promise<void> {
    this.collections.delete(name);
    return Promise.resolve();
  }

  async upsert(collection: string, points: UpsertPoint[]): Promise<void> {
    const c = await this.getOrReject(collection);
    for (const p of points) {
      c.points.set(p.id, p);
    }
  }

  async queryDense({
    collection,
    queryVector,
    k,
    filter,
    withVector,
  }: DenseSearchOpts): Promise<SearchHit[]> {
    const c = await this.getOrReject(collection);
    const hits: SearchHit[] = [];
    for (const p of c.points.values()) {
      if (!matchesFilter(p, filter)) continue;
      hits.push({
        id: p.id,
        score: cosine(queryVector, p.dense),
        metadata: p.metadata,
        ...(withVector ? { dense: p.dense } : {}),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  async querySparse({
    collection,
    queryVector,
    k,
    filter,
    withVector,
  }: SparseSearchOpts): Promise<SearchHit[]> {
    const c = await this.getOrReject(collection);
    const hits: SearchHit[] = [];
    for (const p of c.points.values()) {
      if (!matchesFilter(p, filter)) continue;
      if (!p.sparse) continue;
      const score = sparseDot(queryVector, p.sparse);
      if (score === 0) continue;
      hits.push({
        id: p.id,
        score,
        metadata: p.metadata,
        ...(withVector ? { sparse: p.sparse } : {}),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  /**
   * Collection lookup that rejects (rather than throws synchronously) on miss,
   * so callers using `.rejects` in tests — and the real Qdrant adapter's
   * HTTP-404-as-rejection behaviour — see the same failure shape.
   */
  private getOrReject(name: string): Promise<Collection> {
    const c = this.collections.get(name);
    if (!c) {
      return Promise.reject(
        new Error(`FakeVectorStore: collection "${name}" does not exist`),
      );
    }
    return Promise.resolve(c);
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function sparseDot(q: SparseVector, p: SparseVector): number {
  const qMap = new Map<number, number>();
  for (let i = 0; i < q.indices.length; i++) {
    qMap.set(q.indices[i], q.values[i]);
  }
  let score = 0;
  for (let i = 0; i < p.indices.length; i++) {
    const qv = qMap.get(p.indices[i]);
    if (qv !== undefined) score += qv * p.values[i];
  }
  return score;
}

function matchesFilter(p: UpsertPoint, f?: MetadataFilter): boolean {
  if (!f) return true;
  for (const [key, value] of Object.entries(f)) {
    if (p.metadata[key] !== value) return false;
  }
  return true;
}
