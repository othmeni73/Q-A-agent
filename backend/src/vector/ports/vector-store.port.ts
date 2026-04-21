/**
 * Port for the vector database. Collection-scoped.
 *
 * One interface, two adapters: `QdrantVectorStore` (real) and `FakeVectorStore`
 * (in-memory, deterministic, used in unit tests + CI via NODE_ENV=test).
 *
 * Hybrid-retrieval-aware from day one: every point may carry a dense and a
 * sparse vector under named slots (`dense`, `bm25`). Step 7's retrieval uses
 * both; Step 5's ingestion upserts both; this port is what ties them together
 * without leaking Qdrant-isms into the rest of the codebase.
 */

/** Metadata stored on every chunk. Spec-required fields are non-optional. */
export interface ChunkMetadata {
  /** Spec-required: the source document's display title. */
  sourceTitle: string;
  /** Spec-required: one of `'paper' | 'web' | 'internal'`. Used for metadata filters. */
  sourceType: string;
  /** Spec-required: zero-based chunk index within the source document. */
  chunkIndex: number;
  /** Spec-required: the chunk's raw text content. */
  text: string;

  /** Optional: 1–2 sentence document-level prefix (contextual retrieval, Anthropic 2024). */
  contextualPrefix?: string;
  /** Optional: arXiv identifier for papers. */
  arxivId?: string;
  /** Optional: author list. */
  authors?: string[];
  /** Optional: publication year. */
  year?: number;
  /** Optional: section breadcrumb (e.g. "Methods > Training"). */
  sectionPath?: string;

  /** Open slot for task-specific extensions that should round-trip untouched. */
  [key: string]: unknown;
}

/** Qdrant-native sparse vector shape. */
export interface SparseVector {
  /** Ascending token indices. Must be unique. */
  indices: number[];
  /** Term scores (BM25 numerators, or raw term frequencies — adapter-dependent). Same length as `indices`. */
  values: number[];
}

/** A point to upsert. `sparse` is optional so dense-only corpora still work. */
export interface UpsertPoint {
  /** Point identifier. Qdrant accepts UUIDs or unsigned integers. */
  id: string | number;
  /** Dense embedding vector (length == collection's `denseSize`). */
  dense: number[];
  /** Optional sparse vector — only used when the collection was created with `withSparse: true`. */
  sparse?: SparseVector;
  /** Spec-required metadata; payload in Qdrant parlance. */
  metadata: ChunkMetadata;
}

/**
 * Minimal metadata filter: AND over equality. Enough for `sourceType === 'paper'`,
 * `year === 2024`, etc. Richer filters (range, OR, nested) land when a caller
 * actually needs them — not preemptively.
 */
export interface MetadataFilter {
  [key: string]: string | number | boolean;
}

export interface DenseSearchOpts {
  collection: string;
  queryVector: number[];
  k: number;
  filter?: MetadataFilter;
  /** If true, the returned hits carry `dense` for downstream MMR (Step 7). */
  withVector?: boolean;
}

export interface SparseSearchOpts {
  collection: string;
  queryVector: SparseVector;
  k: number;
  filter?: MetadataFilter;
  /** If true, the returned hits carry `sparse` for downstream use. */
  withVector?: boolean;
}

export interface SearchHit {
  id: string | number;
  /** Similarity score as returned by the store (cosine for dense, BM25 for sparse). */
  score: number;
  metadata: ChunkMetadata;
  /** Present iff the search was called with `withVector: true`. */
  dense?: number[];
  /** Present iff the search was called with `withVector: true`. */
  sparse?: SparseVector;
}

export interface EnsureCollectionOpts {
  /** Dense vector dimension — must match the embedder's output size. */
  denseSize: number;
  /** Provision a named `bm25` sparse vector alongside `dense`. */
  withSparse: boolean;
}

/**
 * The vector store port. Methods are collection-scoped because the production
 * corpus may shard later (per-sourceType collections, per-tenant, etc.); the
 * caller passes a collection name on every op so no adapter owns that state.
 */
export interface VectorStore {
  ensureCollection(name: string, opts: EnsureCollectionOpts): Promise<void>;
  collectionExists(name: string): Promise<boolean>;
  deleteCollection(name: string): Promise<void>;
  upsert(collection: string, points: UpsertPoint[]): Promise<void>;
  queryDense(opts: DenseSearchOpts): Promise<SearchHit[]>;
  querySparse(opts: SparseSearchOpts): Promise<SearchHit[]>;
}

/** Symbol-based DI token — safer than a string key. */
export const VECTOR_STORE = Symbol('VECTOR_STORE');
