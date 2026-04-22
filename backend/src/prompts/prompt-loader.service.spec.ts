import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PromptLoaderService } from './prompt-loader.service';

function setupTmpDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'prompts-spec-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, 'utf8');
  }
  return dir;
}

describe('PromptLoaderService', () => {
  it('loads every .md file in the directory', () => {
    const dir = setupTmpDir({
      'a.md': 'alpha',
      'b.md': 'beta',
      'skip.txt': 'ignored',
    });
    const loader = new PromptLoaderService(dir);
    expect(loader.list()).toEqual(['a', 'b']);
  });

  it('interpolates {{placeholders}} from supplied vars', () => {
    const dir = setupTmpDir({
      'greet.md': 'Hello {{name}}, welcome to {{place}}.',
    });
    const loader = new PromptLoaderService(dir);
    expect(loader.get('greet', { name: 'Ada', place: 'arXiv' })).toBe(
      'Hello Ada, welcome to arXiv.',
    );
  });

  it('accepts name with or without .md suffix', () => {
    const dir = setupTmpDir({ 'x.md': 'no placeholders here' });
    const loader = new PromptLoaderService(dir);
    expect(loader.get('x')).toBe('no placeholders here');
    expect(loader.get('x.md')).toBe('no placeholders here');
  });

  it('throws when a referenced prompt is missing', () => {
    const dir = setupTmpDir({ 'only-one.md': 'hi' });
    const loader = new PromptLoaderService(dir);
    expect(() => loader.get('nope')).toThrow(/not found/);
  });

  it('throws when a placeholder is unfilled', () => {
    const dir = setupTmpDir({
      'needs-var.md': 'Hello {{name}}, from {{place}}.',
    });
    const loader = new PromptLoaderService(dir);
    expect(() => loader.get('needs-var', { name: 'Ada' })).toThrow(
      /unfilled placeholder/,
    );
  });

  it('does not treat single-brace {x} as a placeholder', () => {
    // Arxiv papers embed LaTeX like {x}, which must pass through unchanged.
    const dir = setupTmpDir({
      'latex.md': 'The variable {x} equals {{value}}.',
    });
    const loader = new PromptLoaderService(dir);
    expect(loader.get('latex', { value: '42' })).toBe(
      'The variable {x} equals 42.',
    );
  });
});
