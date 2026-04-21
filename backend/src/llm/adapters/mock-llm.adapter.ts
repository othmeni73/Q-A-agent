/**
 * Deterministic mocks for LlmClient + Embedder. Used by CI's mocked-E2E job
 * (`LLM_ADAPTER=mock`) and in unit tests.
 *
 * Mocks record every call on `.calls` for assertion and return canned or
 * overridden responses. Zero network I/O, zero secrets, predictable latency.
 */

import type {
  Embedder,
  EmbedOptions,
  EmbedResult,
} from '@app/llm/ports/embedder.port';
import type {
  GenerateObjectOptions,
  GenerateObjectResult,
  GenerateTextOptions,
  GenerateTextResult,
  LlmClient,
  StreamOptions,
  StreamResult,
  Usage,
} from '@app/llm/ports/llm-client.port';

export interface MockLlmOverrides {
  /** Used by `generateText`. Default: `"[mock-text-for-<role>]"`. */
  textResponse?: string;
  /** Raw value passed to the schema's `parse()` on `generateObject`. Default: `{}`. */
  objectResponse?: unknown;
  /** Yielded one-at-a-time by `stream()`. Default: `["[mock]", " streamed", " response."]`. */
  streamChunks?: string[];
}

export class MockLlmClient implements LlmClient {
  public readonly calls: Array<{
    method: 'generateText' | 'generateObject' | 'stream';
    opts: unknown;
  }> = [];

  constructor(private readonly overrides: MockLlmOverrides = {}) {}

  generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
    this.calls.push({ method: 'generateText', opts });
    const text = this.overrides.textResponse ?? `[mock-text-for-${opts.role}]`;
    return Promise.resolve({
      text,
      usage: fakeUsage(text),
      latencyMs: 5,
      finishReason: 'stop',
    });
  }

  generateObject<T>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<T>> {
    this.calls.push({ method: 'generateObject', opts });
    const raw = this.overrides.objectResponse ?? {};
    return Promise.resolve({
      object: opts.schema.parse(raw),
      usage: fakeUsage(JSON.stringify(raw)),
      latencyMs: 5,
    });
  }

  stream(opts: StreamOptions): StreamResult {
    this.calls.push({ method: 'stream', opts });
    const chunks = this.overrides.streamChunks ?? [
      '[mock]',
      ' streamed',
      ' response.',
    ];
    // Async generator yields awaited values so eslint's require-await stays happy
    // AND the returned iterable is a proper AsyncIterable<string>.
    async function* gen(): AsyncGenerator<string, void, unknown> {
      for (const c of chunks) {
        yield await Promise.resolve(c);
      }
    }
    const text = chunks.join('');
    return {
      textStream: gen(),
      done: Promise.resolve({
        text,
        usage: fakeUsage(text),
        latencyMs: 10,
        ttftMs: 1,
        finishReason: 'stop',
      }),
    };
  }
}

export class MockEmbedder implements Embedder {
  public readonly calls: EmbedOptions[] = [];

  embed(opts: EmbedOptions): Promise<EmbedResult> {
    this.calls.push(opts);
    const embeddings = opts.values.map((v) => hashVector(v, 768));
    const tokens = Math.max(1, Math.ceil(opts.values.join(' ').length / 4));
    return Promise.resolve({
      embeddings,
      usage: { inputTokens: tokens, totalTokens: tokens },
      latencyMs: 3,
    });
  }
}

function fakeUsage(text: string): Usage {
  const tokens = Math.max(1, Math.ceil(text.length / 4));
  return {
    inputTokens: tokens,
    outputTokens: tokens,
    totalTokens: tokens * 2,
  };
}

/** Deterministic pseudo-random dim-sized vector per input string. */
function hashVector(text: string, dim: number): number[] {
  const out: number[] = new Array<number>(dim);
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < dim; i++) {
    h = (h * 1103515245 + 12345) | 0;
    out[i] = ((h >>> 0) / 0xffffffff) * 2 - 1;
  }
  return out;
}
