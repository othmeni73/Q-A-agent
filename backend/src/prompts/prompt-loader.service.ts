/**
 * Loads `.md` prompt templates from a directory at construction time and
 * interpolates `{{placeholder}}` variables at call time.
 *
 * Fails fast on two classes of bug:
 *   1. missing file — throws on `get('does-not-exist')`, listing what was found.
 *   2. unfilled placeholder — throws if the caller didn't supply every
 *      `{{var}}` the template references, so a literal `{{userName}}` never
 *      leaks to the LLM (hard to notice in logs; trivial to detect here).
 */

import { Injectable, Logger } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PromptVars = Record<string, string>;

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

@Injectable()
export class PromptLoaderService {
  private readonly logger = new Logger(PromptLoaderService.name);
  private readonly templates = new Map<string, string>();
  private readonly promptsDir: string;

  constructor(promptsDir?: string) {
    this.promptsDir = promptsDir ?? join(process.cwd(), 'prompts');
    this.loadAll();
  }

  get(name: string, vars: PromptVars = {}): string {
    const key = name.endsWith('.md') ? name.slice(0, -3) : name;
    const template = this.templates.get(key);
    if (!template) {
      const available = Array.from(this.templates.keys()).sort().join(', ');
      throw new Error(
        `Prompt "${key}" not found in ${this.promptsDir}. Available: ${available}`,
      );
    }
    return this.interpolate(key, template, vars);
  }

  /** List loaded prompt names (without `.md`). Handy for sanity-check logs. */
  list(): string[] {
    return Array.from(this.templates.keys()).sort();
  }

  private loadAll(): void {
    const files = readdirSync(this.promptsDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const name = file.slice(0, -3);
      const body = readFileSync(join(this.promptsDir, file), 'utf8');
      this.templates.set(name, body);
    }
    this.logger.log(
      `loaded ${this.templates.size} prompt(s) from ${this.promptsDir}`,
    );
  }

  private interpolate(
    name: string,
    template: string,
    vars: PromptVars,
  ): string {
    const missing = new Set<string>();
    const out = template.replace(PLACEHOLDER_RE, (match, key: string) => {
      if (key in vars) return vars[key];
      missing.add(key);
      return match;
    });
    if (missing.size > 0) {
      throw new Error(
        `Prompt "${name}" has unfilled placeholder(s): ${Array.from(missing).sort().join(', ')}`,
      );
    }
    return out;
  }
}
