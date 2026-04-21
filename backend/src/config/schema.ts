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
});
export type FileConfig = z.infer<typeof FileSchema>;

// ─── Composite shape services see via APP_CONFIG ──────────────
export interface AppConfig {
  env: EnvConfig;
  file: FileConfig;
}

// Symbol token — safer than a string for DI (no collision risk).
export const APP_CONFIG = Symbol('APP_CONFIG');
