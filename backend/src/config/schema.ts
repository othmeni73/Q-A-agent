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
});
export type FileConfig = z.infer<typeof FileSchema>;

// ─── Composite shape services see via APP_CONFIG ──────────────
export interface AppConfig {
  env: EnvConfig;
  file: FileConfig;
}

// Symbol token — safer than a string for DI (no collision risk).
export const APP_CONFIG = Symbol('APP_CONFIG');
