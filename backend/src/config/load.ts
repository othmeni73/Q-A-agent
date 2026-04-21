import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ZodError } from 'zod';
import { EnvSchema, FileSchema, type AppConfig } from './schema';

/**
 * Reads, validates, and composes config from .env (already loaded into
 * process.env by `dotenv` at main.ts boot) and config.yaml.
 *
 * Fails fast on any validation error so the process never starts with
 * bad config. Runs exactly once, via the APP_CONFIG provider's factory.
 */
export function loadConfig(
  yamlPath: string = join(process.cwd(), 'config.yaml'),
): AppConfig {
  const envResult = EnvSchema.safeParse(process.env);
  if (!envResult.success) {
    throw formatError('env', envResult.error);
  }

  const fileResult = FileSchema.safeParse(readYaml(yamlPath));
  if (!fileResult.success) {
    throw formatError('file', fileResult.error);
  }

  return { env: envResult.data, file: fileResult.data };
}

function readYaml(path: string): unknown {
  try {
    return parseYaml(readFileSync(path, 'utf8'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read ${path}: ${msg}`);
  }
}

function formatError(label: string, error: ZodError): Error {
  const issues = error.issues
    .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('\n');
  return new Error(`${label} config validation failed:\n${issues}`);
}
