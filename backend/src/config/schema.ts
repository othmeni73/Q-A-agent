import { z } from 'zod';

// ─── From .env (runtime + secrets) ─────────────────────────────
export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Future additions (land in their own step):
  // OPENROUTER_API_KEY: z.string().min(1),
  // GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  // HF_TOKEN: z.string().min(1),
});
export type EnvConfig = z.infer<typeof EnvSchema>;

// ─── From config.yaml (non-secret app config) ─────────────────
// `.default({})` on nested sections so an empty/partial yaml still
// resolves — missing sections fall back to their field-level defaults.

/**
 * Benchmark knobs. Consumed by `scripts/benchmark-models.ts` (Decision 3).
 * Left `.optional()` at the top level because the main NestJS app boot path
 * doesn't need this section — only the standalone script reads it.
 */
export const BenchmarkSchema = z.object({
  judge: z.object({
    model: z.string().min(1),
    baseUrl: z.string().url().default('http://localhost:11434/v1'),
  }),
  candidates: z.array(z.string().min(1)).min(2),
  concurrency: z.number().int().positive().default(4),
  throttles: z
    .object({
      judgeMs: z.number().int().nonnegative().default(0),
      candidateMs: z.number().int().nonnegative().default(4000),
    })
    .default({}),
  refusalString: z.string().min(1),
  maxRetries: z.number().int().nonnegative().default(3),
});
export type BenchmarkConfig = z.infer<typeof BenchmarkSchema>;

export const VectorSchema = z.object({
  url: z.string().url().default('http://localhost:6333'),
  collection: z.string().min(1),
  denseSize: z.number().int().positive().default(768),
});
export type VectorConfig = z.infer<typeof VectorSchema>;

/**
 * Persistence layer config (Step 5). Optional at top level — defaults to
 * `./data/app.db` when the yaml section is missing. NODE_ENV=test overrides
 * to `:memory:` inside PersistenceModule regardless of this value.
 */
export const PersistenceSchema = z.object({
  path: z.string().min(1).default('./data/app.db'),
});
export type PersistenceConfig = z.infer<typeof PersistenceSchema>;

/**
 * Ingestion pipeline config (Step 6). Optional at top level — defaults kick in
 * when the yaml section is missing.
 */
export const IngestionSchema = z.object({
  docsDir: z.string().min(1).default('./docs'),
  chunkTargetChars: z.number().int().positive().default(2000),
  chunkOverlapChars: z.number().int().nonnegative().default(200),
  prefixModel: z.string().min(1).default('gemma2:27b'),
  prefixBaseUrl: z.string().url().default('http://localhost:11434/v1'),
  embedModel: z.string().min(1).default('nomic-embed-text'),
  embedBaseUrl: z.string().url().default('http://localhost:11434/v1'),
  embedBatchSize: z.number().int().positive().default(100),
});
export type IngestionConfig = z.infer<typeof IngestionSchema>;

/**
 * Retrieval-time config (Step 8). Optional at top level — defaults match
 * the README-documented pipeline parameters.
 */
export const RetrievalSchema = z.object({
  denseK: z.number().int().positive().default(20),
  sparseK: z.number().int().positive().default(20),
  rerankK: z.number().int().positive().default(8),
  finalK: z.number().int().positive().default(5),
  mmrLambda: z.number().min(0).max(1).default(0.7),
  rrfK: z.number().int().positive().default(60),
  rerankerModel: z.string().min(1).default('Xenova/bge-reranker-large'),
});
export type RetrievalConfig = z.infer<typeof RetrievalSchema>;

/**
 * Chat-time config (Step 11). Required at top level — the chat route is the
 * main product surface; fail fast at boot if the yaml section is missing.
 */
export const ChatSchema = z.object({
  /** Fully-qualified provider model id for the chat role. */
  model: z.string().min(1),
  /** Sampling temperature. 0.2 keeps answers anchored to context. */
  temperature: z.number().min(0).max(2).default(0.2),
  /** Per-turn generation budget. */
  maxOutputTokens: z.number().int().positive().default(1024),
  /**
   * Verbatim refusal string the chat prompt interpolates. Must match the
   * string used in `benchmark.refusalString` when eval cross-compares.
   */
  refusalString: z
    .string()
    .min(1)
    .default("I don't have information on that in the current knowledge base."),
  /** Friendly form of address for the end user. */
  userName: z.string().min(1).default('the user'),
});
export type ChatConfig = z.infer<typeof ChatSchema>;

/**
 * Evaluation-harness config (Step 13). Consumed by `pnpm evaluate`.
 * Optional at top level — the main app boot path doesn't need it.
 */
export const EvalSchema = z.object({
  casesPath: z.string().min(1).default('./eval/cases.json'),
  resultsPath: z.string().min(1).default('./eval/results.json'),
  baselinePath: z.string().min(1).default('./eval/baseline.json'),
  concurrency: z.number().int().positive().default(2),
  judgeModel: z.string().min(1).default('gemma2:27b'),
  judgeBaseUrl: z.string().url().default('http://localhost:11434/v1'),
  retrievalK: z.number().int().positive().default(5),
  successThresholds: z
    .object({
      relevance: z.number().min(1).max(5).default(4),
      groundedness: z.number().min(1).max(5).default(4),
    })
    .default({}),
  failureThreshold: z.number().min(1).max(5).default(2),
});
export type EvalConfig = z.infer<typeof EvalSchema>;

export const FileSchema = z.object({
  log: z
    .object({
      level: z
        .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
        .default('info'),
    })
    .default({}),
  server: z
    .object({
      host: z.string().min(1).default('0.0.0.0'),
    })
    .default({}),
  benchmark: BenchmarkSchema.optional(),
  vector: VectorSchema.optional(),
  persistence: PersistenceSchema.optional(),
  ingestion: IngestionSchema.optional(),
  retrieval: RetrievalSchema.optional(),
  chat: ChatSchema.optional(),
  eval: EvalSchema.optional(),
});
export type FileConfig = z.infer<typeof FileSchema>;

// ─── Composite shape services see via APP_CONFIG ──────────────
export interface AppConfig {
  env: EnvConfig;
  file: FileConfig;
}

// Symbol token — safer than a string for DI (no collision risk).
export const APP_CONFIG = Symbol('APP_CONFIG');
