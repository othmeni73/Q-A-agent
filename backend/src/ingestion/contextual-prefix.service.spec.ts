import type { AppConfig } from '@app/config/schema';
import type { LlmClient } from '@app/llm/ports/llm-client.port';

import { ContextualPrefixService } from './contextual-prefix.service';

const baseConfig: AppConfig = {
  env: { NODE_ENV: 'test', PORT: 3000 },
  file: {
    log: { level: 'info' },
    server: { host: '0.0.0.0' },
  },
};

function makeClient(text: string): LlmClient {
  return {
    generateText: jest.fn().mockResolvedValue({
      text,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      latencyMs: 42,
      finishReason: 'stop',
    }),
    generateObject: jest.fn(),
    stream: jest.fn(),
  };
}

describe('ContextualPrefixService', () => {
  it('returns the trimmed summary', async () => {
    const client = makeClient('  Paper about agent reflection loops.  ');
    const svc = new ContextualPrefixService(baseConfig, client);
    const res = await svc.summarize({
      title: 'Reflexion',
      text: 'long doc body',
    });
    expect(res).toBe('Paper about agent reflection loops.');
  });

  it('uses the configured prefix model and the prefix role tag', async () => {
    const client = makeClient('summary');
    const config: AppConfig = {
      ...baseConfig,
      file: {
        ...baseConfig.file,
        ingestion: {
          docsDir: './docs',
          chunkTargetChars: 2000,
          chunkOverlapChars: 200,
          prefixModel: 'custom-local',
          prefixBaseUrl: 'http://localhost:11434/v1',
          embedModel: 'text-embedding-004',
          embedBatchSize: 100,
        },
      },
    };
    const svc = new ContextualPrefixService(config, client);
    await svc.summarize({ title: 'T', text: 'body' });
    expect(client.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom-local',
        role: 'prefix',
      }),
    );
  });

  it('truncates very long documents before calling the LLM', async () => {
    const client = makeClient('summary');
    const svc = new ContextualPrefixService(baseConfig, client);
    const hugeText = 'x'.repeat(20_000);
    await svc.summarize({ title: 'Long paper', text: hugeText });
    const call = (client.generateText as jest.Mock).mock.calls[0]![0] as {
      prompt: string;
    };
    expect(call.prompt).toContain('Long paper');
    expect(call.prompt.length).toBeLessThan(7000);
  });
});
