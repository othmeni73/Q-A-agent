/**
 * Prompt-template utilities.
 * Loads markdown prompts from `backend/prompts/` and interpolates {{vars}}.
 * Used by the benchmark script today; reused by the production `PromptTemplate`
 * service (Step 8) when it lands.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROMPTS_DIR = join(process.cwd(), 'prompts');

/** Read a prompt template from `backend/prompts/<name>.md`. Caches nothing — callers cache at their own layer. */
export function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf8');
}

/**
 * Replace `{{key}}` placeholders in the template with values from `vars`.
 * Unknown placeholders become empty strings (deliberately silent — treat as a templating choice, not an error).
 */
export function interpolate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(
    /\{\{(\w+)\}\}/g,
    (_match: string, key: string) => vars[key] ?? '',
  );
}
