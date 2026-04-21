import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './load';

describe('loadConfig', () => {
  let yamlPath: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    yamlPath = join(tmpdir(), `config-${Date.now()}-${Math.random()}.yaml`);
  });

  afterEach(() => {
    try {
      unlinkSync(yamlPath);
    } catch {
      /* fine if missing */
    }
    process.env = { ...origEnv };
  });

  it('validates and composes both sources', () => {
    writeFileSync(
      yamlPath,
      'log:\n  level: debug\nserver:\n  host: 127.0.0.1\n',
    );
    process.env['NODE_ENV'] = 'test';
    process.env['PORT'] = '4001';

    const config = loadConfig(yamlPath);

    expect(config.env.NODE_ENV).toBe('test');
    expect(config.env.PORT).toBe(4001);
    expect(config.file.log.level).toBe('debug');
    expect(config.file.server.host).toBe('127.0.0.1');
  });

  it('applies defaults when yaml fields are missing', () => {
    writeFileSync(yamlPath, '{}\n');
    const config = loadConfig(yamlPath);
    expect(config.file.log.level).toBe('info');
    expect(config.file.server.host).toBe('0.0.0.0');
  });

  it('rejects an invalid yaml log level', () => {
    writeFileSync(yamlPath, 'log:\n  level: fancy\nserver:\n  host: 0.0.0.0\n');
    expect(() => loadConfig(yamlPath)).toThrow(/file config validation failed/);
  });

  it('rejects a missing yaml file', () => {
    expect(() => loadConfig(yamlPath)).toThrow(/Failed to read/);
  });

  it('rejects a non-numeric PORT', () => {
    writeFileSync(yamlPath, '{}\n');
    process.env['PORT'] = 'abc';
    expect(() => loadConfig(yamlPath)).toThrow(/env config validation failed/);
  });
});
