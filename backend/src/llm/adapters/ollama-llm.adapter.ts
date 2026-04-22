/**
 * Local-Ollama-backed `LlmClient` for the 'prefix' role.
 *
 * Deliberately narrow: only `generateText` is implemented today because the
 * sole caller (`ContextualPrefixService`) only needs it. `generateObject` and
 * `stream` throw — extend when a caller actually needs them.
 *
 * Reuses the shared `createOllamaClient` factory (OpenAI-compatible endpoint
 * at `http://localhost:11434/v1`) that the benchmark script also uses for the
 * judge, so one configured Ollama instance serves ingestion, eval, and any
 * future local role without duplicating plumbing.
 */

import { generateText as aiGenerateText } from 'ai';

import { createOllamaClient } from '../clients';
import type {
  GenerateObjectOptions,
  GenerateObjectResult,
  GenerateTextOptions,
  GenerateTextResult,
  LlmClient,
  StreamOptions,
  StreamResult,
  Usage,
} from '../ports/llm-client.port';

export interface OllamaLlmClientOptions {
  /** OpenAI-compatible base URL for the Ollama instance. */
  baseUrl: string;
}

export class OllamaLlmClient implements LlmClient {
  private readonly ollama: ReturnType<typeof createOllamaClient>;

  constructor(opts: OllamaLlmClientOptions) {
    this.ollama = createOllamaClient({ baseUrl: opts.baseUrl });
  }

  async generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
    const t0 = Date.now();
    const res = await aiGenerateText({
      model: this.ollama(opts.model),
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.signal,
    });
    return {
      text: res.text,
      usage: toUsage(res.usage),
      latencyMs: Date.now() - t0,
      finishReason: res.finishReason ?? 'unknown',
    };
  }

  generateObject<T>(
    _opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<T>> {
    return Promise.reject(
      new Error(
        'OllamaLlmClient.generateObject: not implemented (add when a caller needs it)',
      ),
    );
  }

  stream(_opts: StreamOptions): StreamResult {
    throw new Error(
      'OllamaLlmClient.stream: not implemented (add when a caller needs it)',
    );
  }
}

function toUsage(
  u:
    | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined,
): Usage {
  const input = u?.inputTokens ?? 0;
  const output = u?.outputTokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: u?.totalTokens ?? input + output,
  };
}
